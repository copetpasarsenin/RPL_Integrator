const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { pool } = require("../config/database");
const { assertSafeHttpUrl, createSafeLookup } = require("../utils/urlSafety");

const feePercentEnv = Number.parseFloat(process.env.GATEWAY_FEE_PERCENT);
const GATEWAY_FEE_PERCENT = Number.isFinite(feePercentEnv)
  ? feePercentEnv
  : 0.5;
const PROXY_TIMEOUT_MS =
  Number.parseInt(process.env.PROXY_TIMEOUT_MS, 10) || 10000;
const FEE_TIMEOUT_MS = Number.parseInt(process.env.FEE_TIMEOUT_MS, 10) || 5000;
const FORWARD_AUTHORIZATION_TO_SERVICES =
  process.env.FORWARD_AUTHORIZATION_TO_SERVICES === "true";

const REQUEST_LOG_FIELDS = new Set([
  "service_tujuan",
  "status",
  "response_status",
  "user_id",
  "mode",
]);

function safeAxiosNetworkOptions() {
  const lookup = createSafeLookup();
  return {
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup }),
  };
}

function normalizeServiceName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function joinUrl(baseUrl, path = "") {
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/^\/+/, "");
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}

function appendQueryString(url, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

function hasRequestBody(method) {
  return !["GET", "HEAD"].includes(String(method || "").toUpperCase());
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function apiKeyScopes(req) {
  return String(req.apiKey?.scopes || "proxy:*,routing:read,validation:read")
    .split(/[,\s]+/)
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean);
}

function apiKeyHasScope(req, requiredScope) {
  if (!req.apiKey?.id) return true;
  const scopes = apiKeyScopes(req);
  return (
    scopes.includes("*") ||
    scopes.includes(requiredScope) ||
    (requiredScope.startsWith("proxy:") && scopes.includes("proxy:*"))
  );
}

function rejectMissingScope(res, requiredScope) {
  return res.status(403).json({
    status: "error",
    message: `API Key tidak memiliki scope yang dibutuhkan: ${requiredScope}`,
  });
}

function requestFingerprint(req, normalizedServiceName, forwardPath) {
  return sha256(
    stableJson({
      method: req.method,
      service: normalizedServiceName,
      path: forwardPath || "",
      query: req.query || {},
      body: hasRequestBody(req.method) ? req.body || {} : {},
    }),
  );
}

function idempotencyRouteKey(req, normalizedServiceName, forwardPath) {
  return `${req.method}:${normalizedServiceName}:${forwardPath || ""}`;
}

async function beginIdempotency(req, normalizedServiceName, forwardPath) {
  const rawKey = String(req.headers["idempotency-key"] || "").trim();
  if (!rawKey || !hasRequestBody(req.method)) return null;

  const userId = String(
    req.user?.user_id ||
      req.user?.npm ||
      req.user?.username ||
      req.user?.sub ||
      "anonymous",
  );
  const routeKey = idempotencyRouteKey(req, normalizedServiceName, forwardPath);
  const requestHash = requestFingerprint(
    req,
    normalizedServiceName,
    forwardPath,
  );
  const keyHash = sha256(`${userId}:${routeKey}:${rawKey}`);

  await pool
    .query("DELETE FROM gateway_idempotency_keys WHERE expires_at <= NOW()")
    .catch(() => {});

  const [existingRows] = await pool.query(
    `SELECT status, response_status, response_body, request_hash
         FROM gateway_idempotency_keys
         WHERE key_hash = ? LIMIT 1`,
    [keyHash],
  );
  const existing = existingRows[0];

  if (existing) {
    if (existing.request_hash !== requestHash) {
      return { conflict: true };
    }
    if (existing.status === "COMPLETED" && existing.response_status) {
      const responseBody =
        typeof existing.response_body === "string"
          ? JSON.parse(existing.response_body)
          : existing.response_body;
      return {
        replay: true,
        responseStatus: existing.response_status,
        responseBody,
      };
    }
    return { processing: true };
  }

  try {
    await pool.query(
      `INSERT INTO gateway_idempotency_keys
         (key_hash, idempotency_key, request_hash, user_id, method, route_key, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [
        keyHash,
        rawKey.slice(0, 255),
        requestHash,
        userId,
        req.method,
        routeKey,
      ],
    );
  } catch (err) {
    const [rows] = await pool.query(
      `SELECT status, response_status, response_body, request_hash
           FROM gateway_idempotency_keys
           WHERE key_hash = ? LIMIT 1`,
      [keyHash],
    );
    if (
      rows[0]?.request_hash === requestHash &&
      rows[0]?.status === "COMPLETED"
    ) {
      return {
        replay: true,
        responseStatus: rows[0].response_status,
        responseBody:
          typeof rows[0].response_body === "string"
            ? JSON.parse(rows[0].response_body)
            : rows[0].response_body,
      };
    }
    throw err;
  }

  return { keyHash };
}

async function completeIdempotency(context, status, body) {
  if (!context?.keyHash) return;
  await pool
    .query(
      `UPDATE gateway_idempotency_keys
         SET status = ?, response_status = ?, response_body = ?
         WHERE key_hash = ?`,
      [
        status >= 200 && status < 500 ? "COMPLETED" : "FAILED",
        status,
        JSON.stringify(body),
        context.keyHash,
      ],
    )
    .catch(() => {});
}

function parseTransactionAmount(req) {
  if (
    req.body?.amount === undefined ||
    req.body?.amount === null ||
    req.body?.amount === ""
  ) {
    return { amount: 0, valid: true };
  }

  const amount = Number.parseFloat(req.body.amount);
  return {
    amount,
    valid: Number.isFinite(amount) && amount >= 0,
  };
}

function buildForwardHeaders(req) {
  const headers = {
    Accept: req.headers.accept || "application/json",
    "X-Integrator-Request-Id": req.logId ? String(req.logId) : "",
    "X-Integrator-User-Id": String(
      req.user?.user_id || req.user?.npm || req.user?.username || "",
    ),
    "X-Integrator-Auth-Method": String(req.user?.auth_method || "jwt"),
  };

  if (req.headers["content-type"] && hasRequestBody(req.method)) {
    headers["Content-Type"] = req.headers["content-type"];
  }

  if (req.headers["idempotency-key"]) {
    headers["Idempotency-Key"] = req.headers["idempotency-key"];
  }

  if (FORWARD_AUTHORIZATION_TO_SERVICES && req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  return headers;
}

async function getActiveServices() {
  const [rows] = await pool.query(
    `SELECT id, nama_service, url_tujuan, health_path, status_aktif
         FROM api_services
         WHERE status_aktif = 1
         ORDER BY nama_service ASC`,
  );

  return rows;
}

async function getActiveServiceByName(serviceName) {
  const [rows] = await pool.query(
    `SELECT id, nama_service, url_tujuan, health_path, status_aktif
         FROM api_services
         WHERE nama_service = ? AND status_aktif = 1
         LIMIT 1`,
    [normalizeServiceName(serviceName)],
  );

  return rows[0] || null;
}

async function updateRequestLog(logId, fields) {
  if (!logId) return;

  const entries = Object.entries(fields).filter(
    ([key, value]) => REQUEST_LOG_FIELDS.has(key) && value !== undefined,
  );
  if (entries.length === 0) return;

  const setSql = entries.map(([key]) => `\`${key}\` = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(logId);

  await pool.query(`UPDATE request_logs SET ${setSql} WHERE id = ?`, values);
}

async function recordRevenue(requestId, nominalFee) {
  if (!requestId || nominalFee <= 0) return;

  await pool.query(
    `INSERT INTO revenue_logs (request_id, nominal_fee, waktu)
         VALUES (?, ?, ?)`,
    [requestId, nominalFee, new Date()],
  );
}

async function tryDebitGatewayFee(req, gatewayFee, transactionAmount) {
  if (transactionAmount <= 0 || gatewayFee <= 0) return "tidak_ada_amount";

  const smartbank = await getActiveServiceByName("smartbank");
  if (!smartbank) return "smartbank_tidak_aktif";

  const feeUrl = joinUrl(
    smartbank.url_tujuan,
    "smartbank/pembayaran_transaksi",
  );
  const feeUrlSafety = await assertSafeHttpUrl(feeUrl);
  if (!feeUrlSafety.ok) {
    console.log(
      `[FEE] SmartBank URL ditolak proteksi SSRF: ${feeUrlSafety.reason}`,
    );
    return "gagal_potong";
  }

  try {
    const response = await axios.post(
      feeUrl,
      {
        user_id: req.body?.user_id || req.user?.user_id,
        amount: gatewayFee,
        parameter: `Biaya Layanan Integrasi (Gateway Fee ${GATEWAY_FEE_PERCENT}%)`,
        source: "integrator",
        request_id: req.logId,
        original_amount: transactionAmount,
      },
      {
        timeout: FEE_TIMEOUT_MS,
        validateStatus: () => true,
        maxRedirects: 0,
        ...safeAxiosNetworkOptions(),
      },
    );

    if (response.status >= 200 && response.status < 400) {
      return "terpotong";
    }

    console.log(
      `[FEE] Gagal potong fee Rp ${gatewayFee} - SmartBank HTTP ${response.status}`,
    );
    return "gagal_potong";
  } catch (feeError) {
    console.log(
      `[FEE] Gagal potong fee Rp ${gatewayFee} - SmartBank offline/error`,
    );
    return "gagal_potong";
  }
}

async function proxyToService(req, res, serviceName, forwardPath = "") {
  const normalizedServiceName = normalizeServiceName(serviceName);
  const targetService = await getActiveServiceByName(normalizedServiceName);

  if (!targetService) {
    const services = await getActiveServices();
    return res.status(404).json({
      status: "error",
      message: `Service "${normalizedServiceName}" tidak terdaftar atau tidak aktif di gateway`,
      available_services: services.map((service) => service.nama_service),
    });
  }

  const requiredScope = `proxy:${normalizedServiceName}`;
  if (!apiKeyHasScope(req, requiredScope)) {
    await updateRequestLog(req.logId, {
      service_tujuan: normalizedServiceName,
      status: "ERROR",
      response_status: 403,
    });
    return rejectMissingScope(res, requiredScope);
  }

  const targetUrlSafety = await assertSafeHttpUrl(targetService.url_tujuan);
  if (!targetUrlSafety.ok) {
    await updateRequestLog(req.logId, {
      service_tujuan: normalizedServiceName,
      status: "ERROR",
      response_status: 502,
    });
    return res.status(502).json({
      status: "error",
      message: `Service "${normalizedServiceName}" memiliki target URL tidak aman`,
      error_detail: targetUrlSafety.reason,
    });
  }

  // CIRCUIT BREAKER: Fast fail if health check marks it as Down
  if (
    global.serviceHealth &&
    global.serviceHealth[normalizedServiceName] === "Down"
  ) {
    await updateRequestLog(req.logId, {
      service_tujuan: normalizedServiceName,
      status: "ERROR",
      response_status: 503,
    });
    return res.status(503).json({
      status: "error",
      message: `Service "${normalizedServiceName}" sedang mengalami gangguan (Offline). Circuit Breaker aktif, request ditolak.`,
      error_detail: "Service Unavailable - Health Check Failed",
    });
  }

  const { amount: transactionAmount, valid: amountValid } =
    parseTransactionAmount(req);
  if (!amountValid) {
    await updateRequestLog(req.logId, {
      service_tujuan: normalizedServiceName,
      status: "ERROR",
      response_status: 400,
    });
    return res.status(400).json({
      status: "error",
      message: "Amount tidak valid. Nilai amount harus berupa angka >= 0.",
    });
  }

  const idempotency = await beginIdempotency(
    req,
    normalizedServiceName,
    forwardPath,
  );
  if (idempotency?.conflict) {
    return res.status(409).json({
      status: "error",
      message:
        "Idempotency-Key sudah digunakan untuk payload berbeda pada route ini",
    });
  }
  if (idempotency?.processing) {
    return res.status(409).json({
      status: "error",
      message: "Request dengan Idempotency-Key ini masih diproses",
    });
  }
  if (idempotency?.replay) {
    res.setHeader("X-Idempotency-Replayed", "true");
    return res
      .status(idempotency.responseStatus)
      .json(idempotency.responseBody);
  }

  const gatewayFee = Math.round(
    transactionAmount * (GATEWAY_FEE_PERCENT / 100),
  );
  let feeStatus =
    transactionAmount > 0 && gatewayFee > 0
      ? "belum_dipotong"
      : "tidak_ada_amount";
  let recordedFee = 0;

  try {
    await updateRequestLog(req.logId, {
      service_tujuan: normalizedServiceName,
      status: "FORWARDED",
    });

    const targetUrl = appendQueryString(
      joinUrl(targetService.url_tujuan, forwardPath),
      req.query,
    );
    console.log(`[PROXY] Forwarding ${req.method} to: ${targetUrl}`);

    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: hasRequestBody(req.method) ? req.body : undefined,
      headers: buildForwardHeaders(req),
      timeout: PROXY_TIMEOUT_MS,
      validateStatus: () => true,
      maxRedirects: 0,
      ...safeAxiosNetworkOptions(),
    });

    const downstreamSuccess = response.status >= 200 && response.status < 400;

    if (downstreamSuccess) {
      feeStatus = await tryDebitGatewayFee(req, gatewayFee, transactionAmount);
      recordedFee = feeStatus === "terpotong" ? gatewayFee : 0;

      if (recordedFee > 0) {
        await recordRevenue(req.logId, recordedFee);
      }
    } else if (transactionAmount > 0 && gatewayFee > 0) {
      feeStatus = "tidak_dipotong_downstream_gagal";
    }

    await updateRequestLog(req.logId, {
      status: downstreamSuccess ? "SUCCESS" : "ERROR",
      response_status: response.status,
    });

    if (req.method === "HEAD") {
      return res.status(response.status).end();
    }

    const responseBody = {
      status: downstreamSuccess ? "success" : "error",
      integrator_info: {
        service_tujuan: normalizedServiceName,
        fee_percent: `${GATEWAY_FEE_PERCENT}%`,
        transaction_amount: transactionAmount,
        calculated_fee: gatewayFee,
        fee_terpotong: recordedFee,
        fee_status: feeStatus,
        forwarded_to: targetUrl,
        downstream_status: response.status,
      },
      data: response.data,
    };
    await completeIdempotency(idempotency, response.status, responseBody);
    return res.status(response.status).json(responseBody);
  } catch (error) {
    const responseStatus =
      error.code === "ECONNABORTED" ? 504 : error.response?.status || 502;
    await updateRequestLog(req.logId, {
      status: "ERROR",
      response_status: responseStatus,
      service_tujuan: normalizedServiceName,
    });

    const responseBody = {
      status: "error",
      message: `Gagal meneruskan request ke ${normalizedServiceName}`,
      integrator_info: {
        service_tujuan: normalizedServiceName,
        fee_percent: `${GATEWAY_FEE_PERCENT}%`,
        calculated_fee: gatewayFee,
        fee_terpotong: 0,
        fee_status: feeStatus,
      },
      error_detail: error.message,
      target_response: error.response?.data || null,
    };
    await completeIdempotency(idempotency, responseStatus, responseBody);
    return res.status(responseStatus).json(responseBody);
  }
}

router.get("/routing_api", async (req, res) => {
  try {
    const services = await getActiveServices();

    res.json({
      status: "success",
      message: "Daftar routing service yang terdaftar di gateway",
      data: {
        total_services: services.length,
        fee_gateway: `${GATEWAY_FEE_PERCENT}%`,
        services: services.map((service) => ({
          service: service.nama_service,
          url: service.url_tujuan,
          health_path: service.health_path || "/",
          status: service.status_aktif ? "Aktif" : "Nonaktif",
        })),
      },
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Gagal membaca service",
      detail: err.message,
    });
  }
});

router.get("/validasi_request", (req, res) => {
  res.json({
    status: "success",
    message: "Token JWT/API Key tervalidasi",
    data: {
      user: req.user,
      token_valid: true,
      validated_at: new Date().toLocaleString("id-ID"),
    },
  });
});

router.get("/logging", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM request_logs ORDER BY id DESC LIMIT 50",
    );
    res.json({
      status: "success",
      message: "Log aktivitas gateway",
      data: {
        total_logs: rows.length,
        logs: rows,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Gagal membaca log",
      detail: err.message,
    });
  }
});

router.get("/biaya_layanan_integrasi", async (req, res) => {
  try {
    const [countResult] = await pool.query(
      "SELECT COUNT(*) AS total FROM revenue_logs",
    );
    const [feeResult] = await pool.query(
      "SELECT COALESCE(SUM(nominal_fee), 0) AS total_fee FROM revenue_logs",
    );

    res.json({
      status: "success",
      message: "Informasi biaya layanan integrasi",
      data: {
        fee_percent: `${GATEWAY_FEE_PERCENT}%`,
        total_transaksi_berbayar: countResult[0].total,
        total_pendapatan_fee: parseFloat(feeResult[0].total_fee),
        keterangan: `Fee ${GATEWAY_FEE_PERCENT}% dicatat di revenue_logs untuk transaksi sukses dengan amount > 0 dan fee berhasil dipotong`,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Gagal membaca data biaya",
      detail: err.message,
    });
  }
});

router.all("/:service/{*path}", async (req, res) => {
  const { service } = req.params;
  const forwardPath = Array.isArray(req.params.path)
    ? req.params.path.join("/")
    : req.params.path || "";
  return proxyToService(req, res, service, forwardPath);
});

router.all("/:service", async (req, res) => {
  return proxyToService(req, res, req.params.service);
});

module.exports = router;
