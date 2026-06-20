require("dotenv").config();

const http = require("node:http");
const https = require("node:https");
const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const multer = require("multer");
const { pool, initDatabase } = require("./config/database");
const loggerMiddleware = require("./middleware/logger");
const {
  validateApiToken,
  verifyPassword,
  createPasswordHash,
  issueSessionToken,
  issueApiToken,
  verifyApiTokenForRevocation,
  verifySessionTokenForRevocation,
  revokeApiToken,
  revokeSessionToken,
  setSessionCookie,
  clearSessionCookie,
  clearAllSessionCookies,
  getAllSessions,
  getSessionTokens,
  ROLE_COOKIES,
  ACTIVE_COOKIE,
  requireAuth,
  requireRole,
  logAudit,
} = require("./middleware/auth");
const rateLimitPerUser = require("./middleware/rateLimitPerUser");
const { ensureCsrfToken, verifyCsrfToken } = require("./middleware/csrf");
const gatewayRoutes = require("./routes/gateway");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const {
  assertSafeHttpUrl,
  createSafeLookup,
  isSafeHttpUrlSync,
} = require("./utils/urlSafety");

// Multer: in-memory storage untuk CSV import
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
});

global.serviceHealth = {}; // Store health status (Online/Offline)
global.serviceHealthFailures = {}; // Consecutive health-check failures per service
let healthCheckInterval = null;

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

const MIN_PASSWORD_LENGTH =
  Number.parseInt(process.env.MIN_PASSWORD_LENGTH, 10) || 8;
app.locals.minPasswordLength = MIN_PASSWORD_LENGTH;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(
  express.urlencoded({
    extended: false,
    limit: process.env.FORM_BODY_LIMIT || "100kb",
  }),
);
app.use(express.static("public", { dotfiles: "ignore" }));

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://unpkg.com",
        ],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(ensureCsrfToken);
app.use(verifyCsrfToken);

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    status: "error",
    message: "Terlalu banyak percobaan login. Coba lagi setelah 1 menit.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    status: "error",
    message: "Terlalu banyak request. Coba lagi setelah 1 menit.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
//  PUBLIC ROUTES
// ============================================================

app.get("/", (req, res) => res.render("index"));

app.get("/login", (req, res) => res.render("login", { error: null }));

app.post("/login", loginLimiter, async (req, res) => {
  const demoAccounts = {
    admin: { username: "admin", password: "admin123" },
    operator: { username: "operator", password: "operator123" },
    user: { username: "user", password: "user123" },
  };
  const demoAccount = demoAccounts[req.body.demo_role];
  const username = demoAccount?.username || req.body.username;
  const password = demoAccount?.password || req.body.password;
  try {
    const [rows] = await pool.query(
      "SELECT id, username, password_hash, role FROM users WHERE username = ? LIMIT 1",
      [username],
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res
        .status(401)
        .render("login", { error: "Username atau password salah." });
    }
    const token = issueSessionToken(user);
    setSessionCookie(res, token, user.role);
    return res.redirect(user.role === "user" ? "/client-portal" : "/dashboard");
  } catch (err) {
    console.error("[LOGIN] Error:", err.message);
    return res
      .status(500)
      .render("login", { error: "Login gagal karena masalah server." });
  }
});

async function revokeSessionTokensFromRequest(req, roles, reason) {
  const tokens = getSessionTokens(req);
  const selectedRoles = roles?.length ? roles : Object.keys(tokens);
  for (const role of selectedRoles) {
    const token = tokens[role];
    if (!token) continue;
    try {
      const decoded = verifySessionTokenForRevocation(token);
      await revokeSessionToken(decoded, decoded.id, reason);
    } catch (_) {
      // Invalid/expired sessions are already unusable; cookie clearing still proceeds.
    }
  }
}

// Logout — hapus session role yang aktif dan cabut token server-side
app.post("/logout", async (req, res) => {
  const role = req.body.role;
  if (role) {
    await revokeSessionTokensFromRequest(req, [role], "logout");
    clearSessionCookie(res, role);
  } else {
    await revokeSessionTokensFromRequest(req, null, "logout");
    clearAllSessionCookies(res);
  }
  res.redirect("/login");
});

// Logout semua session
app.post("/logout-all", async (req, res) => {
  await revokeSessionTokensFromRequest(req, null, "logout_all");
  clearAllSessionCookies(res);
  res.redirect("/login");
});

// Switch session — pindah ke role lain tanpa login ulang
app.get("/switch-session/:role", (req, res) => {
  const role = req.params.role;
  const sessions = getAllSessions(req);
  if (!ROLE_COOKIES[role] || !sessions[role]) return res.redirect("/login");
  res.cookie(ACTIVE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
  });
  return res.redirect(role === "user" ? "/client-portal" : "/dashboard");
});

app.get("/register", (req, res) =>
  res.render("register", { error: null, success: null }),
);

app.post("/register", loginLimiter, async (req, res) => {
  const { username, password, confirm_password } = req.body;
  if (!username || !password) {
    return res.render("register", {
      error: "Username dan password wajib diisi.",
      success: null,
    });
  }
  if (username.length < 3) {
    return res.render("register", {
      error: "Username minimal 3 karakter.",
      success: null,
    });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.render("register", {
      error: `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`,
      success: null,
    });
  }
  if (password !== confirm_password) {
    return res.render("register", {
      error: "Konfirmasi password tidak cocok.",
      success: null,
    });
  }
  try {
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE username = ?",
      [username],
    );
    if (existing.length > 0) {
      return res.render("register", {
        error: `Username "${username}" sudah digunakan.`,
        success: null,
      });
    }
    const hash = createPasswordHash(password);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      [username, hash, "user"],
    );
    return res.render("register", {
      error: null,
      success: "Akun berhasil dibuat! Silakan login.",
    });
  } catch (err) {
    console.error("[REGISTER] Error:", err.message);
    return res.render("register", {
      error: "Registrasi gagal karena masalah server.",
      success: null,
    });
  }
});

// ============================================================
//  DASHBOARD — Multi-section routes
// ============================================================

const dashboardAuth = [requireAuth, requireRole(["admin", "operator"])];
const adminOnly = [requireAuth, requireRole(["admin"])];

function normalizeServiceName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function safeAxiosNetworkOptions() {
  const lookup = createSafeLookup();
  return {
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup }),
  };
}

function assertValidHttpUrl(url) {
  return isSafeHttpUrlSync(url).ok;
}

function normalizeHealthPath(healthPath) {
  const value = String(healthPath || "/").trim();
  return value.startsWith("/") ? value : `/${value}`;
}

function joinUrl(baseUrl, pathPart = "") {
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  const cleanPath = String(pathPart || "").replace(/^\/+/, "");
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}

function getGatewayFeePercent() {
  const parsed = Number.parseFloat(process.env.GATEWAY_FEE_PERCENT);
  return Number.isFinite(parsed) ? parsed : 0.5;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replace(
    /[<>&]/g,
    (char) =>
      ({
        "<": "\\u003c",
        ">": "\\u003e",
        "&": "\\u0026",
      })[char],
  );
}

app.locals.safeJson = safeJson;

function getDateRange(query, defaultDays = 14) {
  const today = new Date();
  const end = query.end ? new Date(`${query.end}T23:59:59`) : today;
  const start = query.start
    ? new Date(`${query.start}T00:00:00`)
    : new Date(end.getTime() - (defaultDays - 1) * 24 * 60 * 60 * 1000);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    const fallbackEnd = today;
    const fallbackStart = new Date(
      fallbackEnd.getTime() - (defaultDays - 1) * 24 * 60 * 60 * 1000,
    );
    return {
      start: fallbackStart.toISOString().slice(0, 10),
      end: fallbackEnd.toISOString().slice(0, 10),
      params: [fallbackStart, fallbackEnd],
    };
  }

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    params: [start, end],
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === quoteChar) {
        if (text[i + 1] === quoteChar) {
          field += quoteChar;
          i++;
        } else {
          inQuotes = false;
          quoteChar = null;
        }
      } else {
        field += char;
      }
      continue;
    }

    if ((char === '"' || char === "'") && field.trim() === "") {
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (char === ",") {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows.filter((cols) => {
    const first = cols[0] || "";
    return cols.some(Boolean) && !first.trim().startsWith("#");
  });
}

function sendCsv(res, filename, columns, rows) {
  const csv = [
    columns.map((col) => csvCell(col.label)).join(","),
    ...rows.map((row) => columns.map((col) => csvCell(row[col.key])).join(",")),
  ].join("\n");
  res.header("Content-Type", "text/csv; charset=utf-8");
  res.attachment(filename);
  return res.send(csv);
}

// Helper: base data passed to every dashboard render
async function dashboardBase(req) {
  const [[services], [alertRows]] = await Promise.all([
    pool.query("SELECT * FROM api_services ORDER BY nama_service ASC"),
    pool.query(
      "SELECT COUNT(*) AS total FROM system_alerts WHERE is_resolved = 0",
    ),
  ]);
  return {
    currentUser: req.sessionUser,
    canViewRevenue: req.sessionUser.role === "admin",
    isAdmin: req.sessionUser.role === "admin",
    serviceCount: services.length,
    openAlertCount: alertRows[0]?.total || 0,
    serviceHealth: global.serviceHealth || {},
  };
}

// 1. Overview
app.get("/dashboard", ...dashboardAuth, async (req, res) => {
  try {
    const [
      base,
      [reqCount],
      [successCount],
      [errorCount],
      [revenueSum],
      [services],
      [recentLogs],
      [consumers],
      [chartRows],
      [alerts],
    ] = await Promise.all([
      dashboardBase(req),
      pool.query("SELECT COUNT(*) AS total FROM request_logs"),
      pool.query(
        "SELECT COUNT(*) AS total FROM request_logs WHERE status = 'SUCCESS'",
      ),
      pool.query(
        "SELECT COUNT(*) AS total FROM request_logs WHERE status = 'ERROR'",
      ),
      pool.query(
        "SELECT COALESCE(SUM(nominal_fee), 0) AS total FROM revenue_logs",
      ),
      pool.query("SELECT * FROM api_services ORDER BY nama_service ASC"),
      pool.query("SELECT * FROM request_logs ORDER BY id DESC LIMIT 5"),
      pool.query(
        "SELECT COUNT(DISTINCT user_id) AS total FROM request_logs WHERE user_id IS NOT NULL",
      ),
      pool.query(`
                SELECT DATE_FORMAT(timestamp, '%m/%d') AS label, COUNT(*) AS total
                FROM request_logs
                WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(timestamp), DATE_FORMAT(timestamp, '%m/%d')
                ORDER BY DATE(timestamp) ASC
            `),
      pool.query(
        "SELECT * FROM system_alerts WHERE is_resolved = 0 ORDER BY created_at DESC LIMIT 5",
      ),
    ]);
    const totalReq = reqCount[0].total;
    const totalSuccess = successCount[0].total;
    res.render("dashboard", {
      ...base,
      section: "overview",
      totalRequests: totalReq,
      totalSuccess,
      totalError: errorCount[0].total,
      successRate:
        totalReq > 0 ? ((totalSuccess / totalReq) * 100).toFixed(1) : "0.0",
      totalRevenue: parseFloat(revenueSum[0].total),
      totalConsumers: consumers[0].total,
      services,
      recentLogs,
      alerts,
      chartLabels: chartRows.map((r) => r.label),
      chartData: chartRows.map((r) => Number(r.total)),
      uptime: Math.floor(process.uptime()),
    });
  } catch (err) {
    console.error("[DASHBOARD] Error:", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "overview",
      totalRequests: 0,
      totalSuccess: 0,
      totalError: 0,
      successRate: "0.0",
      totalRevenue: 0,
      totalConsumers: 0,
      services: [],
      recentLogs: [],
      alerts: [],
      chartLabels: [],
      chartData: [],
      uptime: 0,
    });
  }
});

// 2. Services
app.get("/dashboard/services", ...dashboardAuth, async (req, res) => {
  try {
    const filterSearch = req.query.search || "";
    const range = getDateRange(req.query, 30);
    let where = "1=1";
    const params = [];
    if (filterSearch) {
      where += " AND nama_service LIKE ?";
      params.push(`%${filterSearch}%`);
    }

    const [base, [services], [serviceStats]] = await Promise.all([
      dashboardBase(req),
      pool.query(
        `SELECT * FROM api_services WHERE ${where} ORDER BY nama_service ASC`,
        params,
      ),
      pool.query(
        `
                SELECT s.id, s.nama_service, COUNT(r.id) AS total_requests,
                       MAX(r.timestamp) AS last_activity
                FROM api_services s
                LEFT JOIN request_logs r ON r.service_tujuan = s.nama_service
                    AND r.timestamp BETWEEN ? AND ?
                WHERE ${where.replace("nama_service", "s.nama_service")}
                GROUP BY s.id, s.nama_service
            `,
        [...range.params, ...params],
      ),
    ]);
    const statsMap = {};
    serviceStats.forEach((s) => {
      statsMap[s.id] = s;
    });
    res.render("dashboard", {
      ...base,
      section: "services",
      services,
      statsMap,
      filterSearch,
      dateStart: range.start,
      dateEnd: range.end,
    });
  } catch (err) {
    console.error("[SERVICES]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "services",
      services: [],
      statsMap: {},
      filterSearch: "",
      dateStart: "",
      dateEnd: "",
    });
  }
});

// 3. Routes
app.get("/dashboard/routes", ...dashboardAuth, async (req, res) => {
  const [base, [services]] = await Promise.all([
    dashboardBase(req),
    pool.query("SELECT * FROM api_services ORDER BY nama_service ASC"),
  ]);
  res.render("dashboard", { ...base, section: "routes", services });
});

// 4. Consumers
app.get("/dashboard/consumers", ...dashboardAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 10;
    const offset = (page - 1) * perPage;
    const filterSearch = req.query.search || "";

    let where = "user_id IS NOT NULL AND user_id != ''";
    const params = [];
    if (filterSearch) {
      where += " AND user_id LIKE ?";
      params.push(`%${filterSearch}%`);
    }

    const [base, [countResult], [consumers]] = await Promise.all([
      dashboardBase(req),
      pool.query(
        `SELECT COUNT(DISTINCT user_id) AS total FROM request_logs WHERE ${where}`,
        params,
      ),
      pool.query(
        `
                SELECT user_id, COUNT(*) AS total_requests,
                       MAX(timestamp) AS last_seen,
                       MIN(timestamp) AS first_seen
                FROM request_logs
                WHERE ${where}
                GROUP BY user_id
                ORDER BY total_requests DESC
                LIMIT ? OFFSET ?
            `,
        [...params, perPage, offset],
      ),
    ]);

    const totalConsumers = countResult[0].total || 0;
    res.render("dashboard", {
      ...base,
      section: "consumers",
      consumers,
      page,
      perPage,
      totalPages: Math.ceil(totalConsumers / perPage),
      filterSearch,
    });
  } catch (err) {
    console.error("[CONSUMERS]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "consumers",
      consumers: [],
      page: 1,
      totalPages: 0,
      filterSearch: "",
    });
  }
});

// 5. Plugins
app.get("/dashboard/plugins", ...dashboardAuth, async (req, res) => {
  const base = await dashboardBase(req);
  const plugins = [
    {
      name: "JWT Authentication",
      icon: "shield-check",
      desc: "Validasi token Bearer JWT pada setiap request API. Token berlaku 24 jam.",
      status: true,
      config: { algorithm: "HS256", expiry: "24h", header: "Authorization" },
    },
    {
      name: "Rate Limiting",
      icon: "gauge",
      desc: "Batasi jumlah request per menit untuk mencegah abuse.",
      status: true,
      config: { login: "10 req/min", api: "60 req/min", window: "60 detik" },
    },
    {
      name: "API Key Quota",
      icon: "key-round",
      desc: "Batasi penggunaan API Key berdasarkan kuota harian per key.",
      status: true,
      config: {
        default: "1000 req/day",
        tracking: "api_key_usage",
        reset: "harian",
      },
    },
    {
      name: "Request Logger",
      icon: "clipboard-list",
      desc: "Catat semua traffic gateway ke database MySQL untuk audit trail.",
      status: true,
      config: {
        storage: "MySQL",
        table: "request_logs",
        fields: "ip, method, url, user_id, status",
      },
    },
    {
      name: "Audit Trail",
      icon: "shield-alert",
      desc: "Catat aksi admin seperti CRUD service, user, API Key, dan import CSV.",
      status: true,
      config: { table: "audit_logs", export: "CSV", retention: "database" },
    },
    {
      name: "Health Monitor",
      icon: "heartbeat",
      desc: "Cek health path tiap service dan simpan histori status online/down.",
      status: true,
      config: {
        interval: "60 detik",
        history: "7 hari",
        table: "service_health_logs",
      },
    },
    {
      name: "Helmet Security",
      icon: "hard-hat",
      desc: "HTTP security headers otomatis: X-Frame-Options, X-Content-Type, dll.",
      status: true,
      config: { CSP: "enabled", COEP: "disabled", XFrame: "SAMEORIGIN" },
    },
  ];
  res.render("dashboard", { ...base, section: "plugins", plugins });
});

// 6. Analytics
app.get("/dashboard/analytics", ...dashboardAuth, async (req, res) => {
  try {
    const range = getDateRange(req.query, 14);
    const [
      base,
      [serviceChart],
      [timelineChart],
      [errorRate],
      [topConsumers],
      [sourceUsage],
      [serviceEffectiveness],
      [shadowSummary],
    ] =
      await Promise.all([
        dashboardBase(req),
        pool.query(
          `
                SELECT s.nama_service AS label, COUNT(r.id) AS total
                FROM api_services s
                LEFT JOIN request_logs r ON r.service_tujuan = s.nama_service
                    AND r.timestamp BETWEEN ? AND ?
                GROUP BY s.id, s.nama_service
                ORDER BY s.id ASC
            `,
          range.params,
        ),
        pool.query(
          `
                SELECT DATE_FORMAT(timestamp, '%m/%d') AS label, COUNT(*) AS total
                FROM request_logs
                WHERE timestamp BETWEEN ? AND ?
                GROUP BY DATE(timestamp), DATE_FORMAT(timestamp, '%m/%d')
                ORDER BY DATE(timestamp) ASC
            `,
          range.params,
        ),
        pool.query(
          `
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) AS errors
                FROM request_logs
                WHERE timestamp BETWEEN ? AND ?
            `,
          range.params,
        ),
        pool.query(
          `
                SELECT user_id, COUNT(*) AS total
                FROM request_logs
                WHERE user_id IS NOT NULL AND user_id != ''
                    AND timestamp BETWEEN ? AND ?
                GROUP BY user_id ORDER BY total DESC LIMIT 5
            `,
          range.params,
        ),
        pool.query(
          `
                SELECT source_app,
                       COUNT(*) AS total_usage,
                       SUM(CASE WHEN request_status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
                       SUM(CASE WHEN request_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count
                FROM shadow_service_usage
                WHERE used_at BETWEEN ? AND ?
                GROUP BY source_app
                ORDER BY total_usage DESC
                LIMIT 8
            `,
          range.params,
        ),
        pool.query(
          `
                SELECT service_name,
                       COUNT(*) AS total_usage,
                       SUM(CASE WHEN request_status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
                       SUM(CASE WHEN request_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count,
                       ROUND(SUM(CASE WHEN request_status = 'SUCCESS' THEN 1 ELSE 0 END) * 100 / COUNT(*), 1) AS success_rate
                FROM shadow_service_usage
                WHERE used_at BETWEEN ? AND ?
                GROUP BY service_name
                ORDER BY total_usage DESC
                LIMIT 10
            `,
          range.params,
        ),
        pool.query(
          `
                SELECT COUNT(*) AS total_usage,
                       COUNT(DISTINCT source_app) AS source_apps,
                       COUNT(DISTINCT service_name) AS active_services,
                       SUM(CASE WHEN request_status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count
                FROM shadow_service_usage
                WHERE used_at BETWEEN ? AND ?
            `,
          range.params,
        ),
      ]);
    const totalReqs = errorRate[0].total || 0;
    const totalErrors = errorRate[0].errors || 0;
    const shadowTotal = shadowSummary[0]?.total_usage || 0;
    const shadowSuccess = shadowSummary[0]?.success_count || 0;
    res.render("dashboard", {
      ...base,
      section: "analytics",
      serviceChart: {
        labels: serviceChart.map((r) => r.label),
        data: serviceChart.map((r) => Number(r.total)),
      },
      timelineChart: {
        labels: timelineChart.map((r) => r.label),
        data: timelineChart.map((r) => Number(r.total)),
      },
      errorRatePercent:
        totalReqs > 0 ? ((totalErrors / totalReqs) * 100).toFixed(1) : "0.0",
      totalRequests: totalReqs,
      shadowTotalUsage: shadowTotal,
      shadowSuccessRate:
        shadowTotal > 0 ? ((shadowSuccess / shadowTotal) * 100).toFixed(1) : "0.0",
      shadowSourceAppCount: shadowSummary[0]?.source_apps || 0,
      shadowActiveServiceCount: shadowSummary[0]?.active_services || 0,
      sourceUsage,
      serviceEffectiveness,
      topConsumers,
      dateStart: range.start,
      dateEnd: range.end,
    });
  } catch (err) {
    console.error("[ANALYTICS]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "analytics",
      serviceChart: { labels: [], data: [] },
      timelineChart: { labels: [], data: [] },
      errorRatePercent: "0.0",
      totalRequests: 0,
      shadowTotalUsage: 0,
      shadowSuccessRate: "0.0",
      shadowSourceAppCount: 0,
      shadowActiveServiceCount: 0,
      sourceUsage: [],
      serviceEffectiveness: [],
      topConsumers: [],
      dateStart: "",
      dateEnd: "",
    });
  }
});

app.get("/dashboard/employees", ...dashboardAuth, async (req, res) => {
  try {
    const [base, [employees], [summaryRows]] = await Promise.all([
      dashboardBase(req),
      pool.query("SELECT * FROM employees ORDER BY employee_code ASC"),
      pool.query(`
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_count,
                       SUM(CASE WHEN role = 'operator' THEN 1 ELSE 0 END) AS operator_count,
                       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count
                FROM employees
            `),
    ]);
    const employeeSummary = summaryRows[0] || {};
    res.render("dashboard", {
      ...base,
      section: "employees",
      employees,
      employeeSummary,
    });
  } catch (err) {
    console.error("[EMPLOYEES]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "employees",
      employees: [],
      employeeSummary: {},
    });
  }
});

app.get("/dashboard/analytics/export", ...dashboardAuth, async (req, res) => {
  try {
    const range = getDateRange(req.query, 14);
    const [rows] = await pool.query(
      `
            SELECT s.nama_service AS service,
                   COUNT(r.id) AS total_requests,
                   SUM(CASE WHEN r.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_requests,
                   SUM(CASE WHEN r.status = 'ERROR' THEN 1 ELSE 0 END) AS error_requests,
                   MAX(r.timestamp) AS last_activity
            FROM api_services s
            LEFT JOIN request_logs r ON r.service_tujuan = s.nama_service
                AND r.timestamp BETWEEN ? AND ?
            GROUP BY s.id, s.nama_service
            ORDER BY s.id ASC
        `,
      range.params,
    );
    return sendCsv(
      res,
      `analytics_${range.start}_${range.end}.csv`,
      [
        { key: "service", label: "Service" },
        { key: "total_requests", label: "Total Requests" },
        { key: "success_requests", label: "Success" },
        { key: "error_requests", label: "Error" },
        { key: "last_activity", label: "Last Activity" },
      ],
      rows,
    );
  } catch (err) {
    console.error("[EXPORT ANALYTICS]", err.message);
    res.status(500).send("Gagal export analytics");
  }
});

// 7. Request Logs
app.get("/dashboard/logs", ...dashboardAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;
    const filterService = req.query.service || "";
    const filterStatus = req.query.status || "";
    const filterSearch = req.query.search || "";
    const range = getDateRange(req.query, 30);

    let where = "timestamp BETWEEN ? AND ?";
    const params = [...range.params];
    if (filterService) {
      where += " AND service_tujuan = ?";
      params.push(filterService);
    }
    if (filterStatus) {
      where += " AND status = ?";
      params.push(filterStatus);
    }
    if (filterSearch) {
      where += " AND (user_id LIKE ? OR url_tujuan LIKE ?)";
      params.push(`%${filterSearch}%`, `%${filterSearch}%`);
    }

    const [base, [countResult], [logs], [services]] = await Promise.all([
      dashboardBase(req),
      pool.query(
        `SELECT COUNT(*) AS total FROM request_logs WHERE ${where}`,
        params,
      ),
      pool.query(
        `SELECT * FROM request_logs WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, perPage, offset],
      ),
      pool.query(
        "SELECT DISTINCT nama_service FROM api_services ORDER BY nama_service ASC",
      ),
    ]);
    const totalLogs = countResult[0].total;
    res.render("dashboard", {
      ...base,
      section: "logs",
      logs,
      totalLogs,
      page,
      perPage,
      totalPages: Math.ceil(totalLogs / perPage),
      filterService,
      filterStatus,
      filterSearch,
      dateStart: range.start,
      dateEnd: range.end,
      serviceNames: services.map((s) => s.nama_service),
    });
  } catch (err) {
    console.error("[LOGS]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "logs",
      logs: [],
      totalLogs: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
      filterService: "",
      filterStatus: "",
      filterSearch: "",
      dateStart: "",
      dateEnd: "",
      serviceNames: [],
    });
  }
});

// 7b. Export Request Logs
app.get("/dashboard/logs/export", ...dashboardAuth, async (req, res) => {
  try {
    const filterService = req.query.service || "";
    const filterStatus = req.query.status || "";
    const filterSearch = req.query.search || "";
    const range = getDateRange(req.query, 30);
    let where = "timestamp BETWEEN ? AND ?";
    const params = [...range.params];
    if (filterService) {
      where += " AND service_tujuan = ?";
      params.push(filterService);
    }
    if (filterStatus) {
      where += " AND status = ?";
      params.push(filterStatus);
    }
    if (filterSearch) {
      where += " AND (user_id LIKE ? OR url_tujuan LIKE ?)";
      params.push(`%${filterSearch}%`, `%${filterSearch}%`);
    }

    const [logs] = await pool.query(
      `SELECT id, waktu, timestamp, ip, metode, url_tujuan, user_id, service_tujuan, status, response_status, mode
             FROM request_logs WHERE ${where} ORDER BY id DESC`,
      params,
    );
    return sendCsv(
      res,
      `request_logs_${range.start}_${range.end}.csv`,
      [
        { key: "id", label: "ID" },
        { key: "waktu", label: "Waktu" },
        { key: "ip", label: "IP" },
        { key: "metode", label: "Method" },
        { key: "url_tujuan", label: "URL" },
        { key: "user_id", label: "User" },
        { key: "service_tujuan", label: "Service" },
        { key: "status", label: "Status" },
        { key: "response_status", label: "HTTP Code" },
        { key: "mode", label: "Mode" },
      ],
      logs,
    );
  } catch (err) {
    console.error("[EXPORT LOGS]", err.message);
    res.status(500).send("Gagal export logs");
  }
});

// 8. Users (admin only)
app.get("/dashboard/users", ...adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 10;
    const offset = (page - 1) * perPage;
    const filterSearch = req.query.search || "";

    let where = "1=1";
    const params = [];
    if (filterSearch) {
      where += " AND username LIKE ?";
      params.push(`%${filterSearch}%`);
    }

    const [base, [countResult], [users]] = await Promise.all([
      dashboardBase(req),
      pool.query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params),
      pool.query(
        `SELECT id, username, role, created_at FROM users WHERE ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, perPage, offset],
      ),
    ]);

    const totalUsers = countResult[0].total || 0;
    res.render("dashboard", {
      ...base,
      section: "users",
      users,
      page,
      perPage,
      totalPages: Math.ceil(totalUsers / perPage),
      filterSearch,
    });
  } catch (err) {
    console.error("[USERS]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "users",
      users: [],
      page: 1,
      totalPages: 0,
      filterSearch: "",
    });
  }
});

// 9. Revenue (admin only)
app.get("/dashboard/revenue", ...adminOnly, async (req, res) => {
  try {
    const range = getDateRange(req.query, 30);
    const [base, [revenueTotal], [revenueChart], [revenueByService]] =
      await Promise.all([
        dashboardBase(req),
        pool.query(
          "SELECT COALESCE(SUM(nominal_fee), 0) AS total FROM revenue_logs WHERE waktu BETWEEN ? AND ?",
          range.params,
        ),
        pool.query(
          `
                SELECT DATE_FORMAT(waktu, '%Y-%m-%d') AS label, SUM(nominal_fee) AS total
                FROM revenue_logs
                WHERE waktu BETWEEN ? AND ?
                GROUP BY DATE(waktu), DATE_FORMAT(waktu, '%Y-%m-%d')
                ORDER BY DATE(waktu) ASC
            `,
          range.params,
        ),
        pool.query(
          `
                SELECT s.nama_service AS service,
                       COALESCE(SUM(rv.nominal_fee), 0) AS total_fee,
                       COUNT(rv.id) AS transactions
                FROM api_services s
                LEFT JOIN request_logs r ON r.service_tujuan = s.nama_service
                LEFT JOIN revenue_logs rv ON rv.request_id = r.id
                    AND rv.waktu BETWEEN ? AND ?
                GROUP BY s.id, s.nama_service
                ORDER BY s.id ASC
            `,
          range.params,
        ),
      ]);
    res.render("dashboard", {
      ...base,
      section: "revenue",
      totalRevenue: parseFloat(revenueTotal[0].total),
      revenueChart: {
        labels: revenueChart.map((r) => r.label),
        data: revenueChart.map((r) => Number(r.total)),
      },
      revenueByService,
      dateStart: range.start,
      dateEnd: range.end,
    });
  } catch (err) {
    console.error("[REVENUE]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "revenue",
      totalRevenue: 0,
      revenueChart: { labels: [], data: [] },
      revenueByService: [],
      dateStart: "",
      dateEnd: "",
    });
  }
});

// 9b. Export Revenue
app.get("/dashboard/revenue/export", ...adminOnly, async (req, res) => {
  try {
    const range = getDateRange(req.query, 30);
    const [revenues] = await pool.query(
      `
            SELECT rv.id, rv.request_id, rv.nominal_fee, rv.waktu, r.service_tujuan
            FROM revenue_logs rv
            LEFT JOIN request_logs r ON rv.request_id = r.id
            WHERE rv.waktu BETWEEN ? AND ?
            ORDER BY rv.id DESC
        `,
      range.params,
    );
    return sendCsv(
      res,
      `revenue_logs_${range.start}_${range.end}.csv`,
      [
        { key: "id", label: "ID" },
        { key: "request_id", label: "Request ID" },
        { key: "service_tujuan", label: "Service" },
        { key: "nominal_fee", label: "Nominal Fee" },
        { key: "waktu", label: "Waktu" },
      ],
      revenues,
    );
  } catch (err) {
    console.error("[EXPORT REVENUE]", err.message);
    res.status(500).send("Gagal export revenue");
  }
});

// ============================================================
//  CLIENT PORTAL & TOOLS
// ============================================================

app.get(
  "/client-portal",
  requireAuth,
  requireRole(["admin", "operator", "user"]),
  (req, res) => {
    res.render("client_portal", {
      currentUser: req.sessionUser,
      allSessions: res.locals.allSessions || {},
      activeRole: req.sessionUser.role,
    });
  },
);

app.get("/download-docs", (req, res) => {
  const file = path.join(
    __dirname,
    "public",
    "Panduan_Integrasi_API_Update.pdf",
  );
  res.download(file, (err) => {
    if (err) {
      console.error("File dokumentasi tidak ditemukan!");
      res.status(404).send("File dokumentasi sedang disiapkan.");
    }
  });
});

app.post(
  "/generate-test-token",
  requireAuth,
  requireRole(["admin", "operator", "user"]),
  (req, res) => {
    const canCustomizeIdentity = ["admin", "operator"].includes(
      req.sessionUser.role,
    );
    const requestedUserId = String(req.body.user_id || "").trim();
    const requestedName = String(req.body.name || "").trim();
    const requestedNpm = String(req.body.npm || "").trim();

    const userId =
      canCustomizeIdentity && requestedUserId
        ? requestedUserId
        : String(req.sessionUser.id);
    const name =
      canCustomizeIdentity && requestedName
        ? requestedName
        : req.sessionUser.username;
    const npm = canCustomizeIdentity && requestedNpm ? requestedNpm : userId;

    const payload = {
      user_id: userId,
      name,
      npm,
      role: req.sessionUser.role,
      issued_by: String(req.sessionUser.id),
      generated_at: new Date().toISOString(),
    };
    const token = issueApiToken(payload, "1d");
    res.json({
      status: "success",
      message: "Token API berhasil dibuat (berlaku 24 jam)",
      token,
      payload,
    });
  },
);

app.post(
  "/api/tokens/revoke",
  requireAuth,
  requireRole(["admin", "operator", "user"]),
  async (req, res) => {
    const rawToken = String(req.body.token || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const reason = String(req.body.reason || "manual_revocation").slice(0, 255);

    if (!rawToken) {
      return res
        .status(400)
        .json({ status: "error", message: "Token API wajib diisi" });
    }

    try {
      const decoded = verifyApiTokenForRevocation(rawToken);
      const isPrivileged = ["admin", "operator"].includes(req.sessionUser.role);
      const ownerIds = new Set(
        [decoded.issued_by, decoded.user_id, decoded.sub]
          .filter(Boolean)
          .map((value) => String(value)),
      );

      if (!isPrivileged && !ownerIds.has(String(req.sessionUser.id))) {
        return res.status(403).json({
          status: "error",
          message: "User hanya dapat mencabut token miliknya sendiri",
        });
      }

      await revokeApiToken(decoded, req.sessionUser.id, reason);
      await logAudit(
        req.sessionUser.id,
        req.sessionUser.username,
        "REVOKE_API_TOKEN",
        "revoked_api_tokens",
        `jti: ${decoded.jti}; sub: ${decoded.sub || "-"}`,
        req.ip,
      );

      return res.json({
        status: "success",
        message: "Token API berhasil dicabut",
        token_jti: decoded.jti,
        expires_at: new Date(decoded.exp * 1000).toISOString(),
      });
    } catch (err) {
      return res.status(400).json({
        status: "error",
        message: "Token API tidak valid atau tidak dapat dicabut",
        detail: err.message,
      });
    }
  },
);

// ============================================================
//  API — Status & Info (public / auth)
// ============================================================

app.get("/api/status", async (req, res) => {
  try {
    const [countResult] = await pool.query(
      "SELECT COUNT(*) AS total FROM request_logs",
    );
    const [services] = await pool.query(
      "SELECT nama_service, status_aktif FROM api_services ORDER BY nama_service ASC",
    );
    res.json({
      status: "online",
      application: "API Gateway / Integrator",
      kelompok: 7,
      version: "3.0.0",
      uptime: Math.floor(process.uptime()) + "s",
      total_requests: countResult[0].total,
      registered_services: services.length,
      active_services: services.filter((s) => s.status_aktif).length,
      fee_gateway: `${getGatewayFeePercent()}%`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal query database" });
  }
});

app.get("/api/logs", ...dashboardAuth, async (req, res) => {
  try {
    const requestedLimit = parseInt(req.query.limit, 10) || 50;
    const limit = Math.min(Math.max(requestedLimit, 1), 200);
    const [rows] = await pool.query(
      "SELECT * FROM request_logs ORDER BY id DESC LIMIT ?",
      [limit],
    );
    const [countResult] = await pool.query(
      "SELECT COUNT(*) AS total FROM request_logs",
    );
    res.json({ status: "success", total: countResult[0].total, data: rows });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal membaca log" });
  }
});

// ============================================================
//  CRUD API — Services (admin only, kecuali GET)
// ============================================================

app.get("/api/services", ...dashboardAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM api_services ORDER BY nama_service ASC",
    );
    res.json({ status: "success", data: rows });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal membaca service" });
  }
});

app.post("/api/services", ...adminOnly, async (req, res) => {
  const { nama_service, url_tujuan, health_path, status_aktif } = req.body;
  if (!nama_service || !url_tujuan) {
    return res.status(400).json({
      status: "error",
      message: "nama_service dan url_tujuan wajib diisi",
    });
  }
  const urlSafety = await assertSafeHttpUrl(url_tujuan);
  if (!urlSafety.ok) {
    return res.status(400).json({
      status: "error",
      message: urlSafety.reason,
    });
  }
  try {
    const serviceName = normalizeServiceName(nama_service);
    const [existing] = await pool.query(
      "SELECT id FROM api_services WHERE nama_service = ?",
      [serviceName],
    );
    if (existing.length > 0) {
      return res.status(409).json({
        status: "error",
        message: `Service "${serviceName}" sudah terdaftar`,
      });
    }
    const [result] = await pool.query(
      "INSERT INTO api_services (nama_service, url_tujuan, health_path, status_aktif) VALUES (?, ?, ?, ?)",
      [
        serviceName,
        url_tujuan,
        normalizeHealthPath(health_path),
        status_aktif !== undefined ? status_aktif : 1,
      ],
    );
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "CREATE_SERVICE",
      "api_services",
      `Service: ${serviceName}`,
      req.ip,
    );
    res.json({
      status: "success",
      message: "Service berhasil ditambahkan",
      id: result.insertId,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Gagal menambah service",
      detail: err.message,
    });
  }
});

app.put("/api/services/:id", ...adminOnly, async (req, res) => {
  const { id } = req.params;
  const { nama_service, url_tujuan, health_path, status_aktif } = req.body;
  try {
    const fields = [];
    const values = [];
    if (nama_service !== undefined) {
      fields.push("nama_service = ?");
      values.push(normalizeServiceName(nama_service));
    }
    if (url_tujuan !== undefined) {
      const urlSafety = await assertSafeHttpUrl(url_tujuan);
      if (!urlSafety.ok) {
        return res.status(400).json({
          status: "error",
          message: urlSafety.reason,
        });
      }
      fields.push("url_tujuan = ?");
      values.push(url_tujuan);
    }
    if (health_path !== undefined) {
      fields.push("health_path = ?");
      values.push(normalizeHealthPath(health_path));
    }
    if (status_aktif !== undefined) {
      fields.push("status_aktif = ?");
      values.push(status_aktif ? 1 : 0);
    }
    if (fields.length === 0)
      return res
        .status(400)
        .json({ status: "error", message: "Tidak ada field yang diubah" });
    values.push(id);
    await pool.query(
      `UPDATE api_services SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "UPDATE_SERVICE",
      "api_services",
      `ID: ${id}; fields: ${fields.join(", ")}`,
      req.ip,
    );
    res.json({ status: "success", message: "Service berhasil diupdate" });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal update service" });
  }
});

app.post("/api/services/:id/test", ...dashboardAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT nama_service, url_tujuan, health_path FROM api_services WHERE id = ? LIMIT 1",
      [req.params.id],
    );
    const service = rows[0];
    if (!service)
      return res
        .status(404)
        .json({ status: "error", message: "Service tidak ditemukan" });

    const healthUrl = joinUrl(service.url_tujuan, service.health_path || "/");
    const urlSafety = await assertSafeHttpUrl(healthUrl);
    if (!urlSafety.ok) {
      return res.status(400).json({
        status: "error",
        message: "Health check URL ditolak oleh proteksi SSRF",
        detail: urlSafety.reason,
      });
    }
    const started = Date.now();
    try {
      const response = await axios.get(healthUrl, {
        timeout: 4000,
        validateStatus: () => true,
        maxRedirects: 0,
        ...safeAxiosNetworkOptions(),
      });
      const latency = Date.now() - started;
      const status =
        response.status >= 200 && response.status < 400 ? "Online" : "Down";
      global.serviceHealth[service.nama_service] = status;
      await pool.query(
        "INSERT INTO service_health_logs (service_name, status) VALUES (?, ?)",
        [service.nama_service, status],
      );
      await logAudit(
        req.sessionUser.id,
        req.sessionUser.username,
        "TEST_SERVICE",
        "api_services",
        `Service: ${service.nama_service}; status: ${status}; latency: ${latency}ms`,
        req.ip,
      );
      return res.json({
        status: "success",
        service: service.nama_service,
        health_url: healthUrl,
        health_status: status,
        http_status: response.status,
        latency_ms: latency,
      });
    } catch (err) {
      global.serviceHealth[service.nama_service] = "Down";
      await pool.query(
        "INSERT INTO service_health_logs (service_name, status) VALUES (?, ?)",
        [service.nama_service, "Down"],
      );
      return res.status(502).json({
        status: "error",
        service: service.nama_service,
        health_url: healthUrl,
        health_status: "Down",
        message: err.message,
      });
    }
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal test service" });
  }
});

app.delete("/api/services/:id", ...adminOnly, async (req, res) => {
  try {
    const [[service]] = await pool.query(
      "SELECT nama_service FROM api_services WHERE id = ? LIMIT 1",
      [req.params.id],
    );
    const [result] = await pool.query("DELETE FROM api_services WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0)
      return res
        .status(404)
        .json({ status: "error", message: "Service tidak ditemukan" });
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "DELETE_SERVICE",
      "api_services",
      `ID: ${req.params.id}; service: ${service?.nama_service || "-"}`,
      req.ip,
    );
    res.json({ status: "success", message: "Service berhasil dihapus" });
  } catch (err) {
    res
      .status(500)
      .json({ status: "error", message: "Gagal menghapus service" });
  }
});

// ============================================================
//  CRUD API — Users (admin only)
// ============================================================

app.get("/api/users", ...adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, username, role, created_at FROM users ORDER BY id ASC",
    );
    res.json({ status: "success", data: rows });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal membaca users" });
  }
});

app.post("/api/users", ...adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password)
    return res
      .status(400)
      .json({ status: "error", message: "Username dan password wajib diisi" });
  if (!["admin", "operator", "user"].includes(role))
    return res.status(400).json({
      status: "error",
      message: "Role harus admin, operator, atau user",
    });
  if (password.length < MIN_PASSWORD_LENGTH)
    return res.status(400).json({
      status: "error",
      message: `Password minimal ${MIN_PASSWORD_LENGTH} karakter`,
    });
  try {
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE username = ?",
      [username],
    );
    if (existing.length > 0)
      return res.status(409).json({
        status: "error",
        message: `Username "${username}" sudah digunakan`,
      });
    const hash = createPasswordHash(password);
    const [result] = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      [username, hash, role],
    );
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "CREATE_USER",
      "users",
      `Username: ${username}; role: ${role}`,
      req.ip,
    );
    res.json({
      status: "success",
      message: "User berhasil dibuat",
      id: result.insertId,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal membuat user" });
  }
});

app.put("/api/users/:id", ...adminOnly, async (req, res) => {
  const { id } = req.params;
  const { role, password } = req.body;
  try {
    const fields = [];
    const values = [];
    if (role && ["admin", "operator", "user"].includes(role)) {
      fields.push("role = ?");
      values.push(role);
    }
    if (password) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
          status: "error",
          message: `Password minimal ${MIN_PASSWORD_LENGTH} karakter`,
        });
      }
      fields.push("password_hash = ?");
      values.push(createPasswordHash(password));
    }
    if (fields.length === 0)
      return res
        .status(400)
        .json({ status: "error", message: "Tidak ada field yang diubah" });
    values.push(id);
    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "UPDATE_USER",
      "users",
      `ID: ${id}; fields: ${fields.join(", ")}`,
      req.ip,
    );
    res.json({ status: "success", message: "User berhasil diupdate" });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal update user" });
  }
});

app.delete("/api/users/:id", ...adminOnly, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.sessionUser.id) {
    return res
      .status(400)
      .json({ status: "error", message: "Tidak bisa menghapus akun sendiri" });
  }
  try {
    const [[user]] = await pool.query(
      "SELECT username FROM users WHERE id = ? LIMIT 1",
      [id],
    );
    const [result] = await pool.query("DELETE FROM users WHERE id = ?", [id]);
    if (result.affectedRows === 0)
      return res
        .status(404)
        .json({ status: "error", message: "User tidak ditemukan" });
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "DELETE_USER",
      "users",
      `ID: ${id}; username: ${user?.username || "-"}`,
      req.ip,
    );
    res.json({ status: "success", message: "User berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal menghapus user" });
  }
});

// ============================================================
//  DEMO SIMULATE
// ============================================================

app.post(
  "/api/demo/simulate",
  requireAuth,
  requireRole(["admin", "operator", "user"]),
  async (req, res) => {
    const token = String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    let user = {
      user_id: String(req.sessionUser.id),
      name: req.sessionUser.username,
    };
    try {
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          issuer: process.env.JWT_ISSUER || "rpl-integrator",
          audience: process.env.JWT_API_AUDIENCE || "integrator-api",
        });
        if (decoded.type === "api_token") user = decoded;
      }
    } catch (e) {
      user = {
        user_id: String(req.sessionUser.id),
        name: req.sessionUser.username,
      };
    }
    const service = req.body.service || "smartbank";
    const endpoint = req.body.endpoint || "pembayaran_transaksi";
    const parsedAmount =
      req.body.amount !== undefined
        ? Number.parseFloat(req.body.amount)
        : 50000;
    const amount = Number.isFinite(parsedAmount) ? parsedAmount : 50000;
    if (amount < 0) {
      return res
        .status(400)
        .json({ status: "error", message: "Amount tidak boleh negatif" });
    }
    const feePercent = getGatewayFeePercent();
    const gatewayFee = Math.round(amount * (feePercent / 100));
    const serviceResponses = {
      smartbank: {
        transaction_id: `TXN-${Date.now()}`,
        saldo_sebelum: 500000,
        saldo_sesudah: 500000 - amount,
        status_pembayaran: "berhasil",
      },
      marketplace: {
        order_id: `ORD-${Date.now()}`,
        items: [{ nama: "Produk UMKM", qty: 1, harga: amount }],
        status_order: "diproses",
      },
      pos: {
        invoice_id: `INV-${Date.now()}`,
        kasir: "Kasir-01",
        total: amount,
        metode: "digital",
      },
      supplierhub: {
        po_id: `PO-${Date.now()}`,
        bahan: "Bahan Baku A",
        qty_kg: 10,
        total: amount,
      },
      logistikita: {
        shipping_id: `SHP-${Date.now()}`,
        asal: "Bandung",
        tujuan: "Jakarta",
        ongkir: amount,
        estimasi: "2-3 hari",
      },
      umkm_insight: {
        report_id: `RPT-${Date.now()}`,
        total_transaksi: 150,
        omzet_bulan: 7500000,
        profit_margin: "23%",
      },
    };
    try {
      const [result] = await pool.query(
        `INSERT INTO request_logs (waktu, timestamp, ip, metode, url_tujuan, user_id, service_tujuan, status, response_status, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          new Date().toLocaleString("id-ID"),
          new Date(),
          req.ip || "::1",
          "POST",
          `/integrator/${service}/${endpoint}`,
          user.user_id || user.npm || user.username || "demo",
          service,
          "SUCCESS",
          200,
          "DEMO",
        ],
      );
      if (amount > 0 && gatewayFee > 0) {
        await pool.query(
          "INSERT INTO revenue_logs (request_id, nominal_fee, waktu) VALUES (?, ?, ?)",
          [result.insertId, gatewayFee, new Date()],
        );
      }
      await pool.query(
        `INSERT INTO shadow_service_usage
           (request_log_id, source_app, service_name, endpoint, consumer_id, request_method, request_status, response_code, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          result.insertId,
          req.headers["x-source-app"] || req.headers["x-consumer-app"] || "demo_simulator",
          service,
          `/integrator/${service}/${endpoint}`,
          user.user_id || user.npm || user.username || "demo",
          "POST",
          "SUCCESS",
          200,
        ],
      );
      res.json({
        status: "success",
        mode: "DEMO_SIMULASI",
        message: `Simulasi request ke ${service}/${endpoint} berhasil`,
        integrator_info: {
          service_tujuan: service,
          endpoint,
          fee_percent: `${feePercent}%`,
          transaction_amount: amount,
          fee_terpotong: gatewayFee,
          fee_status: amount > 0 ? "tercatat" : "tidak_ada_amount",
          forwarded_to: `http://localhost:300X/${service}/${endpoint}`,
        },
        data: serviceResponses[service] || serviceResponses.smartbank,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        message: "Gagal simpan log simulasi",
        detail: err.message,
      });
    }
  },
);

app.post("/api/demo/seed-data", ...adminOnly, async (req, res) => {
  const services = [
    "smartbank",
    "marketplace",
    "pos",
    "supplierhub",
    "logistikita",
    "umkm_insight",
  ];
  const statuses = ["SUCCESS", "SUCCESS", "SUCCESS", "ERROR"];
  const methods = ["GET", "POST", "POST", "PUT"];
  const users = [
    "714240061",
    "operator-demo",
    "client-umkm-01",
    "client-umkm-02",
  ];
  const now = Date.now();
  let logsInserted = 0;
  let revenueInserted = 0;

  try {
    for (let day = 0; day < 10; day++) {
      for (const [index, service] of services.entries()) {
        const totalRows = 2 + ((day + index) % 4);
        for (let i = 0; i < totalRows; i++) {
          const timestamp = new Date(
            now -
              day * 24 * 60 * 60 * 1000 -
              i * 36 * 60 * 1000 -
              index * 7 * 60 * 1000,
          );
          const status = statuses[(day + i + index) % statuses.length];
          const method = methods[(i + index) % methods.length];
          const userId = users[(day + i + index) % users.length];
          const amount = 25000 + (day + 1) * 7500 + index * 5000 + i * 3500;
          const fee = Math.round(amount * (getGatewayFeePercent() / 100));
          const endpoint =
            service === "smartbank"
              ? "pembayaran_transaksi"
              : service === "umkm_insight"
                ? "report"
                : "sync";

          const [result] = await pool.query(
            `INSERT INTO request_logs (waktu, timestamp, ip, metode, url_tujuan, user_id, service_tujuan, status, response_status, mode)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              timestamp.toLocaleString("id-ID"),
              timestamp,
              `192.168.1.${20 + index}`,
              method,
              `/integrator/${service}/${endpoint}`,
              userId,
              service,
              status,
              status === "SUCCESS" ? 200 : 502,
              "DEMO_SEED",
            ],
          );
          logsInserted++;

          if (status === "SUCCESS" && amount > 0 && fee > 0) {
            await pool.query(
              "INSERT INTO revenue_logs (request_id, nominal_fee, waktu) VALUES (?, ?, ?)",
              [result.insertId, fee, timestamp],
            );
            revenueInserted++;
          }
          await pool.query(
            `INSERT INTO shadow_service_usage
               (request_log_id, source_app, service_name, endpoint, consumer_id, request_method, request_status, response_code, used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              result.insertId,
              ["web_umkm", "mobile_pos", "finance_portal", "integration_console"][
                (day + i + index) % 4
              ],
              service,
              `/integrator/${service}/${endpoint}`,
              userId,
              method,
              status,
              status === "SUCCESS" ? 200 : 502,
              timestamp,
            ],
          );
        }
      }
    }

    await pool.query(`
            INSERT INTO system_alerts (severity, source, title, message, is_resolved, resolved_at)
            VALUES
                ('warning', 'demo:latency', 'Latency Spike Marketplace', 'Demo alert: request marketplace sempat melambat pada jam sibuk.', 0, NULL),
                ('info', 'demo:recovery', 'SmartBank Recovered', 'Demo alert resolved: SmartBank kembali normal setelah health check berikutnya.', 1, NOW())
        `);
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "SEED_DEMO_DATA",
      "request_logs",
      `Logs: ${logsInserted}; Revenue rows: ${revenueInserted}`,
      req.ip,
    );

    res.json({
      status: "success",
      message: "Demo data berhasil dibuat",
      logs_inserted: logsInserted,
      revenue_inserted: revenueInserted,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Gagal seed demo data",
      detail: err.message,
    });
  }
});

// ============================================================
//  FITUR BARU: API KEY MANAGEMENT
// ============================================================

function normalizeApiKeyScopes(scopes) {
  const rawScopes = Array.isArray(scopes)
    ? scopes
    : String(scopes || "proxy:*").split(/[\s,]+/);
  const allowedPattern =
    /^(\*|proxy:\*|proxy:[a-z0-9_\-]+|routing:read|validation:read)$/;
  const normalized = [
    ...new Set(
      rawScopes
        .map((scope) => String(scope).trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const valid = normalized.filter((scope) => allowedPattern.test(scope));
  return valid.length ? valid.join(",") : "proxy:*";
}

// Daftar API key milik user yang sedang login
app.get(
  "/api/keys",
  requireAuth,
  requireRole(["admin", "operator", "user"]),
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT ak.id, ak.key_name, ak.api_key_prefix, ak.daily_limit, ak.scopes, ak.is_active, ak.last_used, ak.created_at,
                            COALESCE(aku.request_count, 0) AS usage_today
             FROM api_keys ak
             LEFT JOIN api_key_usage aku ON aku.api_key_id = ak.id AND aku.usage_date = CURDATE()
             WHERE ak.user_id = ?
             ORDER BY ak.id DESC`,
        [req.sessionUser.id],
      );
      res.json({ status: "success", data: rows });
    } catch (err) {
      res
        .status(500)
        .json({ status: "error", message: "Gagal membaca API keys" });
    }
  },
);

// Generate API key baru
app.post(
  "/api/keys",
  requireAuth,
  requireRole(["admin", "operator", "user"]),
  async (req, res) => {
    const { key_name, daily_limit, scopes } = req.body;
    if (!key_name || key_name.trim().length < 3) {
      return res
        .status(400)
        .json({ status: "error", message: "Nama key minimal 3 karakter" });
    }
    const normalizedDailyLimit = Math.min(
      Math.max(parseInt(daily_limit, 10) || 1000, 1),
      100000,
    );
    const normalizedScopes = normalizeApiKeyScopes(scopes);
    try {
      // Cek maksimal 5 API key per user
      const [countResult] = await pool.query(
        "SELECT COUNT(*) AS total FROM api_keys WHERE user_id = ? AND is_active = 1",
        [req.sessionUser.id],
      );
      if (countResult[0].total >= 5) {
        return res.status(400).json({
          status: "error",
          message: "Maksimal 5 API key aktif per user",
        });
      }
      // Generate API key: igw_ + 32 random hex chars
      const rawKey = "igw_" + crypto.randomBytes(16).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 12) + "...";
      await pool.query(
        "INSERT INTO api_keys (user_id, key_name, api_key_hash, api_key_prefix, daily_limit, scopes) VALUES (?, ?, ?, ?, ?, ?)",
        [
          req.sessionUser.id,
          key_name.trim(),
          keyHash,
          keyPrefix,
          normalizedDailyLimit,
          normalizedScopes,
        ],
      );
      await logAudit(
        req.sessionUser.id,
        req.sessionUser.username,
        "CREATE_API_KEY",
        "api_keys",
        `Key: ${key_name}; daily_limit: ${normalizedDailyLimit}; scopes: ${normalizedScopes}`,
        req.ip,
      );
      res.json({
        status: "success",
        message:
          "API Key berhasil dibuat. Salin sekarang — tidak akan ditampilkan lagi!",
        api_key: rawKey,
        key_prefix: keyPrefix,
        daily_limit: normalizedDailyLimit,
        scopes: normalizedScopes,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        message: "Gagal membuat API key",
        detail: err.message,
      });
    }
  },
);

// Revoke/nonaktifkan API key
app.delete(
  "/api/keys/:id",
  requireAuth,
  requireRole(["admin", "operator", "user"]),
  async (req, res) => {
    try {
      const [result] = await pool.query(
        "UPDATE api_keys SET is_active = 0 WHERE id = ? AND user_id = ?",
        [req.params.id, req.sessionUser.id],
      );
      if (result.affectedRows === 0)
        return res
          .status(404)
          .json({ status: "error", message: "API Key tidak ditemukan" });
      await logAudit(
        req.sessionUser.id,
        req.sessionUser.username,
        "REVOKE_API_KEY",
        "api_keys",
        `Key ID: ${req.params.id}`,
        req.ip,
      );
      res.json({
        status: "success",
        message: "API Key berhasil dinonaktifkan",
      });
    } catch (err) {
      res
        .status(500)
        .json({ status: "error", message: "Gagal menonaktifkan API key" });
    }
  },
);

// Dashboard: API Keys section
app.get("/dashboard/apikeys", ...adminOnly, async (req, res) => {
  try {
    const [base, [keys]] = await Promise.all([
      dashboardBase(req),
      pool.query(
        `SELECT ak.id, ak.key_name, ak.api_key_prefix, ak.daily_limit, ak.scopes, ak.is_active, ak.last_used, ak.created_at,
                                u.username, COALESCE(aku.request_count, 0) AS usage_today
                 FROM api_keys ak
                 JOIN users u ON ak.user_id = u.id
                 LEFT JOIN api_key_usage aku ON aku.api_key_id = ak.id AND aku.usage_date = CURDATE()
                 ORDER BY ak.id DESC LIMIT 100`,
      ),
    ]);
    res.render("dashboard", { ...base, section: "apikeys", apiKeys: keys });
  } catch (err) {
    console.error("[APIKEYS]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", { ...base, section: "apikeys", apiKeys: [] });
  }
});

// ============================================================
//  FITUR BARU: RESET PASSWORD (admin only)
// ============================================================

app.post("/api/users/:id/reset-password", ...adminOnly, async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;
  if (!new_password || new_password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      status: "error",
      message: `Password baru minimal ${MIN_PASSWORD_LENGTH} karakter`,
    });
  }
  try {
    const [userRows] = await pool.query(
      "SELECT username FROM users WHERE id = ?",
      [id],
    );
    if (!userRows.length)
      return res
        .status(404)
        .json({ status: "error", message: "User tidak ditemukan" });
    const hash = createPasswordHash(new_password);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
      hash,
      id,
    ]);
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "RESET_PASSWORD",
      "users",
      `Target user: ${userRows[0].username}`,
      req.ip,
    );
    res.json({
      status: "success",
      message: `Password user "${userRows[0].username}" berhasil direset`,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal reset password" });
  }
});

// ============================================================
//  FITUR BARU: AUDIT LOG
// ============================================================

app.get("/dashboard/audit", ...adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;
    const filterAction = req.query.action || "";
    const range = getDateRange(req.query, 30);

    let where = "created_at BETWEEN ? AND ?";
    const params = [...range.params];
    if (filterAction) {
      where += " AND action = ?";
      params.push(filterAction);
    }

    const [base, [countResult], [logs]] = await Promise.all([
      dashboardBase(req),
      pool.query(
        `SELECT COUNT(*) AS total FROM audit_logs WHERE ${where}`,
        params,
      ),
      pool.query(
        `SELECT * FROM audit_logs WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, perPage, offset],
      ),
    ]);
    const total = countResult[0].total;
    res.render("dashboard", {
      ...base,
      section: "audit",
      auditLogs: logs,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      total,
      filterAction,
      dateStart: range.start,
      dateEnd: range.end,
    });
  } catch (err) {
    console.error("[AUDIT]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "audit",
      auditLogs: [],
      page: 1,
      totalPages: 0,
      total: 0,
      filterAction: "",
      dateStart: "",
      dateEnd: "",
    });
  }
});

app.get("/dashboard/audit/export", ...adminOnly, async (req, res) => {
  try {
    const filterAction = req.query.action || "";
    const range = getDateRange(req.query, 30);
    let where = "created_at BETWEEN ? AND ?";
    const params = [...range.params];
    if (filterAction) {
      where += " AND action = ?";
      params.push(filterAction);
    }
    const [logs] = await pool.query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY id DESC`,
      params,
    );
    return sendCsv(
      res,
      `audit_logs_${range.start}_${range.end}.csv`,
      [
        { key: "id", label: "ID" },
        { key: "created_at", label: "Waktu" },
        { key: "username", label: "User" },
        { key: "action", label: "Aksi" },
        { key: "resource", label: "Resource" },
        { key: "detail", label: "Detail" },
        { key: "ip", label: "IP" },
      ],
      logs,
    );
  } catch (err) {
    console.error("[EXPORT AUDIT]", err.message);
    res.status(500).send("Gagal export audit");
  }
});

// ============================================================
//  FITUR BARU: SERVICE HEALTH HISTORY
// ============================================================

app.get("/dashboard/health-history", ...dashboardAuth, async (req, res) => {
  try {
    const range = getDateRange(req.query, 1);
    const [base, [healthLogs], [services]] = await Promise.all([
      dashboardBase(req),
      pool.query(
        `
                SELECT service_name,
                       DATE_FORMAT(checked_at, '%m/%d %H:%i') AS label,
                       status, checked_at
                FROM service_health_logs
                WHERE checked_at BETWEEN ? AND ?
                ORDER BY checked_at ASC
            `,
        range.params,
      ),
      pool.query(
        "SELECT nama_service FROM api_services ORDER BY nama_service ASC",
      ),
    ]);
    // Ringkasan per service: berapa kali Online vs Down
    const summary = {};
    services.forEach((s) => {
      summary[s.nama_service] = { online: 0, down: 0 };
    });
    healthLogs.forEach((log) => {
      if (summary[log.service_name]) {
        if (log.status === "Online") summary[log.service_name].online++;
        else summary[log.service_name].down++;
      }
    });
    res.render("dashboard", {
      ...base,
      section: "health_history",
      healthLogs,
      summary,
      services: services.map((s) => s.nama_service),
      dateStart: range.start,
      dateEnd: range.end,
    });
  } catch (err) {
    console.error("[HEALTH HISTORY]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "health_history",
      healthLogs: [],
      summary: {},
      services: [],
      dateStart: "",
      dateEnd: "",
    });
  }
});

app.get("/dashboard/alerts", ...dashboardAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;
    const status = req.query.status || "open";
    let where = "1=1";
    const params = [];
    if (status === "open") where += " AND is_resolved = 0";
    if (status === "resolved") where += " AND is_resolved = 1";
    const [base, [countResult], [alerts]] = await Promise.all([
      dashboardBase(req),
      pool.query(
        `SELECT COUNT(*) AS total FROM system_alerts WHERE ${where}`,
        params,
      ),
      pool.query(
        `SELECT * FROM system_alerts WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, perPage, offset],
      ),
    ]);
    const total = countResult[0].total || 0;
    res.render("dashboard", {
      ...base,
      section: "alerts",
      alerts,
      alertStatus: status,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      total,
    });
  } catch (err) {
    console.error("[ALERTS]", err.message);
    const base = await dashboardBase(req);
    res.render("dashboard", {
      ...base,
      section: "alerts",
      alerts: [],
      alertStatus: "open",
      page: 1,
      perPage: 20,
      totalPages: 0,
      total: 0,
    });
  }
});

app.get("/dashboard/architecture", ...dashboardAuth, async (req, res) => {
  const [base, [services]] = await Promise.all([
    dashboardBase(req),
    pool.query("SELECT * FROM api_services ORDER BY id ASC"),
  ]);
  const modules = [
    {
      name: "Authentication",
      icon: "shield-check",
      desc: "Login dashboard, JWT session, role admin/operator/user, dan API key.",
    },
    {
      name: "Gateway Proxy",
      icon: "route",
      desc: "Dynamic routing dari tabel api_services ke service tujuan.",
    },
    {
      name: "Observability",
      icon: "activity",
      desc: "Request logs, analytics, health history, alerts, dan audit trail.",
    },
    {
      name: "Revenue Ledger",
      icon: "coins",
      desc: "Pencatatan fee terpisah di revenue_logs agar metadata request tetap bersih.",
    },
    {
      name: "Security Layer",
      icon: "lock",
      desc: "Helmet, rate limit, CSRF, API key daily quota, dan role-based access control.",
    },
    {
      name: "Deployment",
      icon: "box",
      desc: "Dockerfile dan docker-compose untuk gateway + MySQL.",
    },
  ];
  const flows = [
    "Client mengirim request ke /integrator/:service/:path dengan Bearer JWT atau API Key.",
    "Logger membuat request_logs dengan status awal PENDING.",
    "Auth middleware memvalidasi JWT/API Key dan menempelkan identitas user.",
    "Rate limiter mengecek batas per user dan kuota harian API Key.",
    "Gateway membaca api_services untuk menentukan target URL aktif.",
    "Jika amount > 0, gateway menghitung fee dan mencoba debit SmartBank.",
    "Request diteruskan ke service tujuan, lalu response dan status dicatat.",
    "Dashboard membaca request_logs, revenue_logs, audit_logs, service_health_logs, dan system_alerts.",
  ];
  res.render("dashboard", {
    ...base,
    section: "architecture",
    services,
    modules,
    flows,
  });
});

app.post("/api/alerts/:id/resolve", ...dashboardAuth, async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE system_alerts SET is_resolved = 1, resolved_at = NOW() WHERE id = ?",
      [req.params.id],
    );
    if (result.affectedRows === 0)
      return res
        .status(404)
        .json({ status: "error", message: "Alert tidak ditemukan" });
    await logAudit(
      req.sessionUser.id,
      req.sessionUser.username,
      "RESOLVE_ALERT",
      "system_alerts",
      `Alert ID: ${req.params.id}`,
      req.ip,
    );
    res.json({ status: "success", message: "Alert ditandai selesai" });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal resolve alert" });
  }
});

app.get("/dashboard/docs", ...dashboardAuth, async (req, res) => {
  const [base, [services]] = await Promise.all([
    dashboardBase(req),
    pool.query("SELECT * FROM api_services ORDER BY nama_service ASC"),
  ]);
  const docs = [
    {
      method: "GET",
      path: "/api/status",
      auth: "Public",
      desc: "Status gateway dan jumlah service aktif.",
    },
    {
      method: "POST",
      path: "/generate-test-token",
      auth: "Login",
      desc: "Generate JWT demo untuk simulator.",
    },
    {
      method: "GET",
      path: "/integrator/routing_api",
      auth: "Bearer JWT/API Key",
      desc: "Melihat routing service aktif.",
    },
    {
      method: "GET",
      path: "/integrator/validasi_request",
      auth: "Bearer JWT/API Key",
      desc: "Validasi token gateway.",
    },
    {
      method: "POST",
      path: "/api/tokens/revoke",
      auth: "Login + CSRF",
      desc: "Mencabut API JWT yang memiliki jti sebelum masa berlakunya habis.",
    },
    {
      method: "ANY",
      path: "/integrator/:service/:path",
      auth: "Bearer JWT/API Key",
      desc: "Proxy request ke service tujuan dinamis.",
    },
    {
      method: "GET",
      path: "/dashboard/logs/export",
      auth: "Admin/Operator",
      desc: "Export request log sesuai filter.",
    },
    {
      method: "GET",
      path: "/dashboard/revenue/export",
      auth: "Admin",
      desc: "Export revenue log sesuai filter.",
    },
    {
      method: "POST",
      path: "/api/demo/seed-data",
      auth: "Admin",
      desc: "Membuat data demo untuk grafik, revenue, logs, dan alerts.",
    },
    {
      method: "POST",
      path: "/api/alerts/:id/resolve",
      auth: "Admin/Operator",
      desc: "Menandai system alert sebagai resolved.",
    },
  ];
  res.render("dashboard", { ...base, section: "docs", docs, services });
});

// ============================================================
//  FITUR BARU: BATCH IMPORT SERVICES (CSV)
// ============================================================

app.post(
  "/api/services/import",
  ...adminOnly,
  upload.single("csv_file"),
  async (req, res) => {
    if (!req.file)
      return res
        .status(400)
        .json({ status: "error", message: "File CSV wajib diupload" });
    try {
      const text = req.file.buffer.toString("utf-8");
      const rows = parseCsvRows(text);
      // Skip header row if exists
      const dataRows = rows[0]?.[0]?.toLowerCase().includes("nama_service")
        ? rows.slice(1)
        : rows;

      let imported = 0;
      let skipped = 0;
      const errors = [];
      for (const cols of dataRows) {
        const [nama, url, healthPathRaw, statusRawMaybe] = cols;
        if (!nama || !url) {
          skipped++;
          continue;
        }
        const urlSafety = await assertSafeHttpUrl(url);
        if (!urlSafety.ok) {
          skipped++;
          errors.push(`${nama}: ${urlSafety.reason}`);
          continue;
        }
        const hasHealthPath =
          healthPathRaw && !["0", "1"].includes(healthPathRaw);
        const healthPath = hasHealthPath ? healthPathRaw : "/";
        const statusRaw = hasHealthPath ? statusRawMaybe : healthPathRaw;
        const status = statusRaw === "0" ? 0 : 1;
        try {
          await pool.query(
            "INSERT INTO api_services (nama_service, url_tujuan, health_path, status_aktif) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE url_tujuan = VALUES(url_tujuan), health_path = VALUES(health_path), status_aktif = VALUES(status_aktif)",
            [
              normalizeServiceName(nama),
              url,
              normalizeHealthPath(healthPath),
              status,
            ],
          );
          imported++;
        } catch (e) {
          errors.push(`${nama}: ${e.message}`);
          skipped++;
        }
      }
      await logAudit(
        req.sessionUser.id,
        req.sessionUser.username,
        "IMPORT_SERVICES",
        "api_services",
        `Imported: ${imported}, Skipped: ${skipped}`,
        req.ip,
      );
      res.json({
        status: "success",
        message: `Import selesai: ${imported} service berhasil, ${skipped} dilewati`,
        imported,
        skipped,
        errors,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        message: "Gagal proses CSV",
        detail: err.message,
      });
    }
  },
);

// ============================================================
//  GATEWAY PROXY
// ============================================================

app.use(
  "/integrator",
  apiLimiter,
  loggerMiddleware,
  validateApiToken,
  rateLimitPerUser,
  gatewayRoutes,
);

// ============================================================
//  404 HANDLER
// ============================================================

app.use((req, res) => {
  const safeOriginalUrl = escapeHtml(req.originalUrl);
  if (req.accepts("html")) {
    return res.status(404).send(`
            <!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>404 - Halaman Tidak Ditemukan</title>
            <style>body{font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
            .box{text-align:center;padding:40px;}.code{font-size:96px;font-weight:800;color:#6366f1;margin:0;}.msg{font-size:18px;color:#94a3b8;margin:16px 0 32px;}
            a{color:#6366f1;text-decoration:none;padding:12px 24px;border:1px solid #6366f1;border-radius:8px;font-weight:600;}
            a:hover{background:#6366f1;color:#fff;}</style></head>
            <body><div class="box"><p class="code">404</p><p class="msg">Halaman <strong>${safeOriginalUrl}</strong> tidak ditemukan.</p>
            <a href="/">Kembali ke Beranda</a></div></body></html>
        `);
  }
  res.status(404).json({
    status: "error",
    message: `Route ${req.originalUrl} tidak ditemukan`,
  });
});

// ============================================================
//  GLOBAL ERROR HANDLER
// ============================================================

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.stack || err.message);
  if (req.accepts("html")) {
    return res.status(500).send(`
            <!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>500 - Server Error</title>
            <style>body{font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
            .box{text-align:center;padding:40px;}.code{font-size:96px;font-weight:800;color:#ef4444;margin:0;}.msg{font-size:18px;color:#94a3b8;margin:16px 0 32px;}
            a{color:#6366f1;text-decoration:none;padding:12px 24px;border:1px solid #6366f1;border-radius:8px;font-weight:600;}
            a:hover{background:#6366f1;color:#fff;}</style></head>
            <body><div class="box"><p class="code">500</p><p class="msg">Terjadi kesalahan pada server. Silakan coba lagi.</p>
            <a href="/">Kembali ke Beranda</a></div></body></html>
        `);
  }
  res.status(500).json({
    status: "error",
    message: "Terjadi kesalahan internal pada server",
    ...(process.env.NODE_ENV !== "production" && { detail: err.message }),
  });
});

// ============================================================
//  START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
const HEALTH_FAILURE_THRESHOLD = Math.max(
  Number.parseInt(process.env.HEALTH_FAILURE_THRESHOLD, 10) || 2,
  1,
);
const INSECURE_JWT_SECRETS = new Set([
  "change_this_secret_for_production",
  "integrator_kelompok7_secret_key_2026",
  "secret",
  "jwt_secret",
]);

function validateRuntimeConfig() {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret) {
    throw new Error("JWT_SECRET wajib diset sebelum server dijalankan");
  }

  if (secret.length < 32) {
    const message = "JWT_SECRET sebaiknya minimal 32 karakter";
    if (isProduction) throw new Error(message);
    console.warn(`[CONFIG] ${message}`);
  }

  if (isProduction && INSECURE_JWT_SECRETS.has(secret)) {
    throw new Error("JWT_SECRET production masih memakai nilai contoh/default");
  }
}

async function runHealthCheck() {
  try {
    const [services] = await pool.query(
      "SELECT nama_service, url_tujuan, health_path, status_aktif FROM api_services WHERE status_aktif = 1",
    );
    for (const s of services) {
      let probeStatus = "Online";
      const healthUrl = joinUrl(s.url_tujuan, s.health_path || "/");
      const urlSafety = await assertSafeHttpUrl(healthUrl);
      if (!urlSafety.ok) {
        probeStatus = "Down";
      } else {
        try {
          const response = await axios.get(healthUrl, {
            timeout: 3000,
            validateStatus: () => true,
            maxRedirects: 0,
            ...safeAxiosNetworkOptions(),
          });
          if (response.status < 200 || response.status >= 400)
            probeStatus = "Down";
        } catch (err) {
          if (
            err.code === "ECONNREFUSED" ||
            err.code === "ECONNABORTED" ||
            err.message.includes("timeout")
          ) {
            probeStatus = "Down";
          }
        }
      }

      if (probeStatus === "Down") {
        global.serviceHealthFailures[s.nama_service] =
          (global.serviceHealthFailures[s.nama_service] || 0) + 1;
      } else {
        global.serviceHealthFailures[s.nama_service] = 0;
      }

      const status =
        global.serviceHealthFailures[s.nama_service] >= HEALTH_FAILURE_THRESHOLD
          ? "Down"
          : "Online";
      global.serviceHealth[s.nama_service] = status;
      pool
        .query(
          "INSERT INTO service_health_logs (service_name, status) VALUES (?, ?)",
          [s.nama_service, status],
        )
        .catch(() => {});
      if (status === "Down") {
        pool
          .query(
            `
                    INSERT INTO system_alerts (severity, source, title, message)
                    SELECT 'critical', ?, ?, ?
                    WHERE NOT EXISTS (
                        SELECT 1 FROM system_alerts
                        WHERE source = ? AND is_resolved = 0
                    )
                `,
            [
              `service:${s.nama_service}`,
              `Service ${s.nama_service} Down`,
              `Health check gagal untuk ${healthUrl}`,
              `service:${s.nama_service}`,
            ],
          )
          .catch(() => {});
      } else {
        pool
          .query(
            "UPDATE system_alerts SET is_resolved = 1, resolved_at = NOW() WHERE source = ? AND is_resolved = 0",
            [`service:${s.nama_service}`],
          )
          .catch(() => {});
      }
    }
    pool
      .query(
        "DELETE FROM service_health_logs WHERE checked_at < DATE_SUB(NOW(), INTERVAL 7 DAY)",
      )
      .catch(() => {});
  } catch (e) {
    console.error("[HEALTH CHECK]", e.message);
  }
}

async function startServer() {
  validateRuntimeConfig();
  await initDatabase();
  return app.listen(PORT, () => {
    console.log("=================================================");
    console.log("   API GATEWAY / INTEGRATOR - Kelompok 7        ");
    console.log("=================================================");
    console.log(`   Landing Page : http://localhost:${PORT}`);
    console.log(`   Login        : http://localhost:${PORT}/login`);
    console.log(`   Dashboard    : http://localhost:${PORT}/dashboard`);
    console.log(`   Client Portal: http://localhost:${PORT}/client-portal`);
    console.log(`   API Status   : http://localhost:${PORT}/api/status`);
    console.log("=================================================");

    // Start health check every 1 minute
    runHealthCheck();
    healthCheckInterval = setInterval(runHealthCheck, 60000);
    healthCheckInterval.unref?.();
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Gagal menjalankan server:", err.message);
    process.exit(1);
  });
}

module.exports = { app, startServer };
