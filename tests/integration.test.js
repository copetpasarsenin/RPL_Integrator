const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "integration-test-secret-with-32-characters";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "rpl-integrator";
process.env.JWT_SESSION_AUDIENCE =
  process.env.JWT_SESSION_AUDIENCE || "integrator-dashboard";
process.env.JWT_API_AUDIENCE = process.env.JWT_API_AUDIENCE || "integrator-api";
process.env.USER_RATE_MAX = "1000";
process.env.USER_RATE_WINDOW_MS = "60000";
process.env.PROXY_TIMEOUT_MS = "2000";
process.env.FEE_TIMEOUT_MS = "2000";
process.env.FORWARD_AUTHORIZATION_TO_SERVICES = "false";

const express = require("express");
const jwt = require("jsonwebtoken");
const { app: dashboardApp } = require("../server");
const { pool } = require("../config/database");
const {
  ACTIVE_COOKIE,
  ROLE_COOKIES,
  issueApiToken,
  issueSessionToken,
  validateApiToken,
} = require("../middleware/auth");
const { CSRF_COOKIE } = require("../middleware/csrf");
const rateLimitPerUser = require("../middleware/rateLimitPerUser");
const gatewayRoutes = require("../routes/gateway");
const { isSafeHttpUrlSync } = require("../utils/urlSafety");

function installPoolMock(t, { query, getConnection } = {}) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;

  pool.query = query || (async () => [[]]);
  pool.getConnection =
    getConnection ||
    (async () => {
      throw new Error("Unexpected pool.getConnection call");
    });

  t.after(() => {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  });
}

function createIntegratorApp() {
  global.serviceHealth = {};
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/integrator", validateApiToken, rateLimitPerUser, gatewayRoutes);
  return app;
}

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function listenHttp(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

test("gateway auth accepts API tokens and rejects dashboard session tokens", async (t) => {
  installPoolMock(t);
  const { server, baseUrl } = await listen(createIntegratorApp());
  t.after(() => closeServer(server));

  const apiToken = issueApiToken(
    { user_id: "api-user-1", name: "API User", role: "user" },
    "1h",
  );
  const accepted = await fetch(`${baseUrl}/integrator/validasi_request`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });
  assert.equal(accepted.status, 200);
  const acceptedBody = await readJson(accepted);
  assert.equal(acceptedBody.status, "success");
  assert.equal(acceptedBody.data.token_valid, true);
  assert.equal(acceptedBody.data.user.type, "api_token");
  assert.equal(acceptedBody.data.user.user_id, "api-user-1");

  const sessionToken = issueSessionToken({
    id: 7,
    username: "dashboard-user",
    role: "user",
  });
  const rejected = await fetch(`${baseUrl}/integrator/validasi_request`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Accept: "application/json",
    },
  });
  assert.equal(rejected.status, 403);
  const rejectedBody = await readJson(rejected);
  assert.match(
    rejectedBody.message,
    /Token API tidak valid|Token bukan API token/,
  );

  const missing = await fetch(`${baseUrl}/integrator/validasi_request`, {
    headers: { Accept: "application/json" },
  });
  assert.equal(missing.status, 401);
});

test("normal users cannot spoof generated API token identity", async (t) => {
  installPoolMock(t, {
    query: async (sql, params) => {
      if (String(sql).includes("FROM revoked_session_tokens")) {
        return [[]];
      }
      if (
        String(sql).includes(
          "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
        )
      ) {
        assert.deepEqual(params, [42]);
        return [[{ id: 42, username: "real-user", role: "user" }]];
      }
      throw new Error(`Unexpected SQL in token generation test: ${sql}`);
    },
  });
  const { server, baseUrl } = await listen(dashboardApp);
  t.after(() => closeServer(server));

  const sessionToken = issueSessionToken({
    id: 42,
    username: "real-user",
    role: "user",
  });
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const response = await fetch(`${baseUrl}/generate-test-token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      Cookie: cookieHeader({
        [ROLE_COOKIES.user]: sessionToken,
        [ACTIVE_COOKIE]: "user",
        [CSRF_COOKIE]: csrfToken,
      }),
    },
    body: JSON.stringify({
      user_id: "spoofed-user",
      name: "Spoofed Name",
      npm: "spoofed-npm",
    }),
  });

  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.status, "success");
  assert.equal(body.payload.user_id, "42");
  assert.equal(body.payload.name, "real-user");
  assert.equal(body.payload.npm, "42");
  assert.equal(body.payload.role, "user");
  assert.equal(body.payload.issued_by, "42");

  const decoded = jwt.verify(body.token, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_API_AUDIENCE,
  });
  assert.equal(decoded.type, "api_token");
  assert.equal(decoded.user_id, "42");
  assert.equal(decoded.name, "real-user");
  assert.equal(decoded.npm, "42");
});

test("dashboard users can revoke their own API tokens", async (t) => {
  const apiToken = issueApiToken(
    { user_id: "42", name: "real-user", issued_by: "42", role: "user" },
    "1h",
  );
  const decoded = jwt.verify(apiToken, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_API_AUDIENCE,
  });

  let revokedJti = null;
  installPoolMock(t, {
    query: async (sql, params) => {
      const statement = String(sql);
      if (statement.includes("FROM revoked_session_tokens")) {
        return [[]];
      }
      if (
        statement.includes(
          "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
        )
      ) {
        assert.deepEqual(params, [42]);
        return [[{ id: 42, username: "real-user", role: "user" }]];
      }
      if (statement.includes("INSERT INTO revoked_api_tokens")) {
        revokedJti = params[0];
        assert.equal(params[0], decoded.jti);
        assert.equal(params[1], decoded.sub);
        assert.equal(params[3], 42);
        assert.equal(params[4], "compromised");
        return [{ affectedRows: 1 }];
      }
      if (statement.includes("DELETE FROM revoked_api_tokens")) {
        return [{ affectedRows: 0 }];
      }
      if (statement.includes("INSERT INTO audit_logs")) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in token revoke test: ${sql}`);
    },
  });

  const { server, baseUrl } = await listen(dashboardApp);
  t.after(() => closeServer(server));

  const sessionToken = issueSessionToken({
    id: 42,
    username: "real-user",
    role: "user",
  });
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const response = await fetch(`${baseUrl}/api/tokens/revoke`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      Cookie: cookieHeader({
        [ROLE_COOKIES.user]: sessionToken,
        [ACTIVE_COOKIE]: "user",
        [CSRF_COOKIE]: csrfToken,
      }),
    },
    body: JSON.stringify({ token: apiToken, reason: "compromised" }),
  });

  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.status, "success");
  assert.equal(body.token_jti, decoded.jti);
  assert.equal(revokedJti, decoded.jti);
});

test("revoked API tokens are rejected by gateway auth", async (t) => {
  const apiToken = issueApiToken(
    { user_id: "revoked-user", name: "Revoked User", role: "user" },
    "1h",
  );
  const decoded = jwt.verify(apiToken, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_API_AUDIENCE,
  });

  installPoolMock(t, {
    query: async (sql, params) => {
      if (String(sql).includes("FROM revoked_api_tokens")) {
        assert.deepEqual(params, [decoded.jti]);
        return [[{ id: 1 }]];
      }
      return [[]];
    },
  });

  const { server, baseUrl } = await listen(createIntegratorApp());
  t.after(() => closeServer(server));

  const response = await fetch(`${baseUrl}/integrator/validasi_request`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });

  assert.equal(response.status, 403);
  const body = await readJson(response);
  assert.match(body.message, /sudah dicabut/);
});

test("service URL safety blocks private targets in production", async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowPrivate = process.env.ALLOW_PRIVATE_SERVICE_URLS;
  process.env.NODE_ENV = "production";
  process.env.ALLOW_PRIVATE_SERVICE_URLS = "false";
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowPrivate === undefined)
      delete process.env.ALLOW_PRIVATE_SERVICE_URLS;
    else process.env.ALLOW_PRIVATE_SERVICE_URLS = originalAllowPrivate;
  });

  assert.equal(isSafeHttpUrlSync("http://127.0.0.1:3001").ok, false);

  installPoolMock(t, {
    query: async (sql, params) => {
      const statement = String(sql);
      if (statement.includes("FROM revoked_api_tokens")) return [[]];
      if (
        statement.includes("FROM api_services") &&
        statement.includes("WHERE nama_service = ?")
      ) {
        return [
          [
            {
              id: 1,
              nama_service: params[0],
              url_tujuan: "http://127.0.0.1:3001",
              health_path: "/",
              status_aktif: 1,
            },
          ],
        ];
      }
      return [[]];
    },
  });

  const { server, baseUrl } = await listen(createIntegratorApp());
  t.after(() => closeServer(server));
  const apiToken = issueApiToken(
    { user_id: "ssrf-user", username: "ssrf-user", role: "user" },
    "1h",
  );

  const response = await fetch(`${baseUrl}/integrator/internal-service/ping`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });

  assert.equal(response.status, 502);
  const body = await readJson(response);
  assert.match(body.message, /target URL tidak aman/);
});

test("API key daily quota is enforced with usage headers", async (t) => {
  const rawKey = "igw_" + crypto.randomBytes(16).toString("hex");
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const apiKey = {
    id: 55,
    user_id: 99,
    key_name: "quota-test",
    daily_limit: 1,
    is_active: 1,
  };
  let usedToday = 0;

  installPoolMock(t, {
    query: async (sql, params) => {
      const statement = String(sql);
      if (statement.includes("FROM api_keys WHERE api_key_hash = ?")) {
        assert.equal(params[0], keyHash);
        return [[apiKey]];
      }
      if (statement.includes("UPDATE api_keys SET last_used = NOW()")) {
        assert.deepEqual(params, [apiKey.id]);
        return [{ affectedRows: 1 }];
      }
      if (
        statement.includes("SELECT id, username, role FROM users WHERE id = ?")
      ) {
        assert.deepEqual(params, [apiKey.user_id]);
        return [[{ id: 99, username: "quota-user", role: "user" }]];
      }
      throw new Error(`Unexpected SQL in quota test: ${sql}`);
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      query: async (sql, params) => {
        const statement = String(sql);
        if (statement.includes("FROM api_key_usage")) {
          assert.deepEqual(params, [apiKey.id]);
          return [usedToday > 0 ? [{ request_count: usedToday }] : []];
        }
        if (statement.includes("INSERT INTO api_key_usage")) {
          assert.deepEqual(params, [apiKey.id]);
          usedToday = 1;
          return [{ affectedRows: 1 }];
        }
        if (statement.includes("UPDATE api_key_usage")) {
          assert.deepEqual(params, [apiKey.id]);
          usedToday += 1;
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected connection SQL in quota test: ${sql}`);
      },
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
  });

  const { server, baseUrl } = await listen(createIntegratorApp());
  t.after(() => closeServer(server));

  const first = await fetch(`${baseUrl}/integrator/validasi_request`, {
    headers: { Authorization: `ApiKey ${rawKey}`, Accept: "application/json" },
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-ratelimit-daily-limit"), "1");
  assert.equal(first.headers.get("x-ratelimit-daily-remaining"), "0");
  const firstBody = await readJson(first);
  assert.equal(firstBody.data.user.auth_method, "api_key");
  assert.equal(firstBody.data.user.api_key_id, apiKey.id);

  const second = await fetch(`${baseUrl}/integrator/validasi_request`, {
    headers: { Authorization: `ApiKey ${rawKey}`, Accept: "application/json" },
  });
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("x-ratelimit-daily-limit"), "1");
  assert.equal(second.headers.get("x-ratelimit-daily-remaining"), "0");
  const secondBody = await readJson(second);
  assert.equal(secondBody.api_key_id, apiKey.id);
  assert.equal(secondBody.used_today, 1);
  assert.equal(secondBody.daily_limit, 1);
});

test("API key proxy scopes are enforced per service", async (t) => {
  const rawKey = "igw_" + crypto.randomBytes(16).toString("hex");
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const apiKey = {
    id: 77,
    user_id: 101,
    key_name: "scoped-key",
    daily_limit: 100,
    scopes: "proxy:marketplace",
    is_active: 1,
  };

  installPoolMock(t, {
    query: async (sql, params) => {
      const statement = String(sql);
      if (statement.includes("FROM api_keys WHERE api_key_hash = ?")) {
        assert.equal(params[0], keyHash);
        return [[apiKey]];
      }
      if (statement.includes("UPDATE api_keys SET last_used = NOW()")) {
        return [{ affectedRows: 1 }];
      }
      if (
        statement.includes("SELECT id, username, role FROM users WHERE id = ?")
      ) {
        return [
          [{ id: apiKey.user_id, username: "scoped-user", role: "user" }],
        ];
      }
      if (
        statement.includes("FROM api_services") &&
        statement.includes("WHERE nama_service = ?")
      ) {
        return [
          [
            {
              id: 1,
              nama_service: params[0],
              url_tujuan: "https://api.example.com",
              health_path: "/",
              status_aktif: 1,
            },
          ],
        ];
      }
      return [[]];
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      query: async (sql, params) => {
        if (String(sql).includes("FROM api_key_usage")) return [[]];
        if (String(sql).includes("INSERT INTO api_key_usage")) {
          assert.deepEqual(params, [apiKey.id]);
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
      },
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
  });

  const { server, baseUrl } = await listen(createIntegratorApp());
  t.after(() => closeServer(server));

  const response = await fetch(`${baseUrl}/integrator/orders/payments`, {
    method: "POST",
    headers: {
      Authorization: `ApiKey ${rawKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: 0 }),
  });

  assert.equal(response.status, 403);
  const body = await readJson(response);
  assert.match(body.message, /proxy:orders/);
});

test("gateway idempotency replays completed responses", async (t) => {
  let downstreamHits = 0;
  const downstream = await listenHttp((req, res) => {
    downstreamHits += 1;
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ transaction_id: "txn-idem-1" }));
    });
  });
  t.after(() => closeServer(downstream.server));

  let storedIdempotency = null;
  installPoolMock(t, {
    query: async (sql, params) => {
      const statement = String(sql);
      if (statement.includes("FROM revoked_api_tokens")) return [[]];
      if (
        statement.includes("FROM api_services") &&
        statement.includes("WHERE nama_service = ?")
      ) {
        return [
          [
            {
              id: 1,
              nama_service: params[0],
              url_tujuan: downstream.baseUrl,
              health_path: "/",
              status_aktif: 1,
            },
          ],
        ];
      }
      if (statement.includes("FROM gateway_idempotency_keys")) {
        return [storedIdempotency ? [storedIdempotency] : []];
      }
      if (statement.includes("INSERT INTO gateway_idempotency_keys")) {
        storedIdempotency = {
          status: "PROCESSING",
          response_status: null,
          response_body: null,
          request_hash: params[2],
        };
        return [{ affectedRows: 1 }];
      }
      if (statement.includes("UPDATE gateway_idempotency_keys")) {
        storedIdempotency.status = params[0];
        storedIdempotency.response_status = params[1];
        storedIdempotency.response_body = params[2];
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  });

  const { server, baseUrl } = await listen(createIntegratorApp());
  t.after(() => closeServer(server));
  const apiToken = issueApiToken(
    { user_id: "idem-user", username: "idem-user", role: "user" },
    "1h",
  );
  const request = () =>
    fetch(`${baseUrl}/integrator/orders/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "same-operation",
      },
      body: JSON.stringify({ amount: 0, item: "kopi" }),
    });

  const first = await request();
  assert.equal(first.status, 200);
  const firstBody = await readJson(first);
  assert.equal(firstBody.data.transaction_id, "txn-idem-1");

  const second = await request();
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-idempotency-replayed"), "true");
  const secondBody = await readJson(second);
  assert.equal(secondBody.data.transaction_id, "txn-idem-1");
  assert.equal(downstreamHits, 1);
});

test("gateway proxy validates amount, preserves status, query strings, and strips Authorization", async (t) => {
  const receivedRequests = [];
  const downstream = await listenHttp((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      receivedRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      res.writeHead(418, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ downstream: "teapot", path: req.url }));
    });
  });
  t.after(() => closeServer(downstream.server));

  installPoolMock(t, {
    query: async (sql, params) => {
      const statement = String(sql);
      if (
        statement.includes("FROM api_services") &&
        statement.includes("WHERE nama_service = ?")
      ) {
        return [
          [
            {
              id: 1,
              nama_service: params[0],
              url_tujuan: downstream.baseUrl,
              health_path: "/",
              status_aktif: 1,
            },
          ],
        ];
      }
      if (statement.includes("INSERT INTO revenue_logs")) {
        throw new Error(
          "Revenue must not be recorded for failed downstream calls",
        );
      }
      return [[]];
    },
  });

  const { server, baseUrl } = await listen(createIntegratorApp());
  t.after(() => closeServer(server));
  const apiToken = issueApiToken(
    { user_id: "proxy-user", username: "proxy-user", role: "user" },
    "1h",
  );

  const invalidAmount = await fetch(`${baseUrl}/integrator/orders/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: -1 }),
  });
  assert.equal(invalidAmount.status, 400);
  const invalidAmountBody = await readJson(invalidAmount);
  assert.match(invalidAmountBody.message, /Amount tidak valid/);
  assert.equal(receivedRequests.length, 0);

  const proxied = await fetch(
    `${baseUrl}/integrator/orders/api/v1/payments?foo=bar&foo=baz&encoded=a%20b`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-123",
      },
      body: JSON.stringify({ amount: 0, item: "kopi" }),
    },
  );

  assert.equal(proxied.status, 418);
  const proxiedBody = await readJson(proxied);
  assert.equal(proxiedBody.status, "error");
  assert.equal(proxiedBody.integrator_info.downstream_status, 418);
  assert.equal(proxiedBody.integrator_info.service_tujuan, "orders");
  assert.equal(proxiedBody.data.downstream, "teapot");

  assert.equal(receivedRequests.length, 1);
  const downstreamRequest = receivedRequests[0];
  assert.equal(downstreamRequest.method, "POST");
  assert.equal(
    downstreamRequest.url,
    "/api/v1/payments?foo=bar&foo=baz&encoded=a+b",
  );
  assert.equal(downstreamRequest.headers.authorization, undefined);
  assert.equal(downstreamRequest.headers["idempotency-key"], "idem-123");
  assert.equal(downstreamRequest.headers["x-integrator-user-id"], "proxy-user");
  assert.deepEqual(JSON.parse(downstreamRequest.body), {
    amount: 0,
    item: "kopi",
  });
});
