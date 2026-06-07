const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");

// Per-role cookie names — memungkinkan login multi-tab bersamaan
const ROLE_COOKIES = {
  admin: "gw_admin",
  operator: "gw_operator",
  user: "gw_user",
};
const ACTIVE_COOKIE = "gw_active";

// Legacy cookie name (for backward compat)
const SESSION_COOKIE = "gateway_session";

const JWT_ISSUER = process.env.JWT_ISSUER || "rpl-integrator";
const SESSION_AUDIENCE =
  process.env.JWT_SESSION_AUDIENCE || "integrator-dashboard";
const API_AUDIENCE = process.env.JWT_API_AUDIENCE || "integrator-api";

function jwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET belum dikonfigurasi");
  }
  return process.env.JWT_SECRET;
}

function signJwt(payload, options = {}) {
  return jwt.sign(payload, jwtSecret(), {
    issuer: JWT_ISSUER,
    ...options,
  });
}

function verifyJwt(token, audience) {
  return jwt.verify(token, jwtSecret(), {
    issuer: JWT_ISSUER,
    audience,
  });
}

function rejectAuth(req, res, statusCode, message) {
  if (req.accepts("html")) return res.redirect("/login");
  return res.status(statusCode).json({ status: "error", message });
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith("scrypt:")) return false;

  const [, salt, hash] = storedHash.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");

  return (
    stored.length === candidate.length &&
    crypto.timingSafeEqual(stored, candidate)
  );
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const target = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!target) return null;

  return decodeURIComponent(target.substring(name.length + 1));
}

function issueSessionToken(user) {
  return signJwt(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      type: "dashboard_session",
    },
    {
      expiresIn: "8h",
      audience: SESSION_AUDIENCE,
      subject: String(user.id),
      jwtid: crypto.randomUUID(),
    },
  );
}

function issueApiToken(payload, expiresIn = "1d") {
  const { jti, sub, type, ...claims } = payload;
  const subject = String(payload.user_id || payload.id || sub || "api-user");
  return signJwt(
    {
      ...claims,
      type: "api_token",
    },
    {
      expiresIn,
      audience: API_AUDIENCE,
      subject,
      jwtid: jti || crypto.randomUUID(),
    },
  );
}

function mysqlDateTimeFromEpochSeconds(epochSeconds) {
  return new Date(epochSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function assertRevocableJwt(decoded, expectedType, label) {
  if (decoded.type !== expectedType) {
    throw new Error(`Token bukan ${label}`);
  }
  if (!decoded.jti) {
    throw new Error(
      `Token ${label} tidak memiliki jti sehingga tidak dapat dicabut`,
    );
  }
  if (!decoded.exp) {
    throw new Error(`Token ${label} tidak memiliki expiry`);
  }
  return decoded;
}

function verifyApiTokenForRevocation(token) {
  return assertRevocableJwt(
    verifyJwt(token, API_AUDIENCE),
    "api_token",
    "API token",
  );
}

function verifySessionTokenForRevocation(token) {
  return assertRevocableJwt(
    verifyJwt(token, SESSION_AUDIENCE),
    "dashboard_session",
    "session dashboard",
  );
}

async function isApiTokenRevoked(decoded) {
  if (!decoded?.jti) return false;
  const [rows] = await pool.query(
    "SELECT id FROM revoked_api_tokens WHERE token_jti = ? AND expires_at > NOW() LIMIT 1",
    [decoded.jti],
  );
  return rows.length > 0;
}

async function revokeApiToken(decoded, revokedBy, reason) {
  if (!decoded?.jti || !decoded?.exp) {
    throw new Error(
      "Token API tidak dapat dicabut karena metadata tidak lengkap",
    );
  }
  await pool.query(
    `INSERT INTO revoked_api_tokens (token_jti, subject, expires_at, revoked_by, reason)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE revoked_by = VALUES(revoked_by), reason = VALUES(reason)`,
    [
      decoded.jti,
      decoded.sub || null,
      mysqlDateTimeFromEpochSeconds(decoded.exp),
      revokedBy || null,
      reason || null,
    ],
  );
  await pool
    .query("DELETE FROM revoked_api_tokens WHERE expires_at <= NOW()")
    .catch(() => {});
}

async function isSessionTokenRevoked(decoded) {
  if (!decoded?.jti) return false;
  const [rows] = await pool.query(
    "SELECT id FROM revoked_session_tokens WHERE token_jti = ? AND expires_at > NOW() LIMIT 1",
    [decoded.jti],
  );
  return rows.length > 0;
}

async function revokeSessionToken(decoded, revokedBy, reason) {
  if (!decoded?.jti || !decoded?.exp) {
    throw new Error(
      "Session tidak dapat dicabut karena metadata tidak lengkap",
    );
  }
  await pool.query(
    `INSERT INTO revoked_session_tokens (token_jti, user_id, expires_at, revoked_by, reason)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE revoked_by = VALUES(revoked_by), reason = VALUES(reason)`,
    [
      decoded.jti,
      decoded.sub || decoded.id || null,
      mysqlDateTimeFromEpochSeconds(decoded.exp),
      revokedBy || decoded.id || null,
      reason || null,
    ],
  );
  await pool
    .query("DELETE FROM revoked_session_tokens WHERE expires_at <= NOW()")
    .catch(() => {});
}

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000,
});

/**
 * Set session cookie untuk role tertentu.
 * Cookie lama untuk role lain TIDAK dihapus — agar bisa multi-login.
 */
function setSessionCookie(res, token, role) {
  const roleCookie = ROLE_COOKIES[role];
  if (roleCookie) {
    res.cookie(roleCookie, token, cookieOpts());
  }
  // Set active role. This is not secret, but it does not need to be readable by JS.
  res.cookie(ACTIVE_COOKIE, role, cookieOpts());
  // Legacy fallback
  res.cookie(SESSION_COOKIE, token, cookieOpts());
}

/**
 * Hapus session cookie untuk role tertentu.
 */
function clearSessionCookie(res, role) {
  if (role && ROLE_COOKIES[role]) {
    res.clearCookie(ROLE_COOKIES[role]);
  }
  res.clearCookie(SESSION_COOKIE);
  res.clearCookie(ACTIVE_COOKIE);
}

/**
 * Hapus SEMUA session cookies (logout all).
 */
function clearAllSessionCookies(res) {
  Object.values(ROLE_COOKIES).forEach((name) => res.clearCookie(name));
  res.clearCookie(SESSION_COOKIE);
  res.clearCookie(ACTIVE_COOKIE);
}

/**
 * Ambil semua session yang aktif dari cookies.
 */
function getSessionTokens(req) {
  const tokens = {};
  for (const [role, cookieName] of Object.entries(ROLE_COOKIES)) {
    const token = getCookie(req, cookieName);
    if (token) tokens[role] = token;
  }
  const legacyToken = getCookie(req, SESSION_COOKIE);
  if (legacyToken) tokens.legacy = legacyToken;
  return tokens;
}

function getAllSessions(req) {
  const sessions = {};
  for (const [role, token] of Object.entries(getSessionTokens(req))) {
    if (role === "legacy") continue;
    try {
      const decoded = verifyJwt(token, SESSION_AUDIENCE);
      if (decoded.type === "dashboard_session") {
        sessions[role] = {
          id: decoded.id,
          username: decoded.username,
          role: decoded.role,
        };
      }
    } catch (_) {
      // Token expired/invalid — abaikan
    }
  }
  return sessions;
}

async function requireAuth(req, res, next) {
  const requestedRole = req.query.as || getCookie(req, ACTIVE_COOKIE);

  let token = null;

  if (requestedRole && ROLE_COOKIES[requestedRole]) {
    token = getCookie(req, ROLE_COOKIES[requestedRole]);
  }

  if (!token) {
    for (const [, cookieName] of Object.entries(ROLE_COOKIES)) {
      const t = getCookie(req, cookieName);
      if (t) {
        token = t;
        break;
      }
    }
  }

  if (!token) token = getCookie(req, SESSION_COOKIE);

  if (!token) {
    const bearerToken = extractAuthorizationToken(req);
    if (bearerToken) token = bearerToken;
  }

  if (!token) {
    return rejectAuth(req, res, 401, "Login diperlukan");
  }

  try {
    const decoded = verifyJwt(token, SESSION_AUDIENCE);
    if (decoded.type !== "dashboard_session") {
      return rejectAuth(
        req,
        res,
        401,
        "Token ini bukan session token. Gunakan login untuk akses dashboard.",
      );
    }

    if (await isSessionTokenRevoked(decoded)) {
      return rejectAuth(req, res, 401, "Session sudah dicabut");
    }

    const [rows] = await pool.query(
      "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
      [decoded.id],
    );
    const user = rows[0];
    if (!user) {
      return rejectAuth(
        req,
        res,
        401,
        "Session tidak valid karena user tidak ditemukan",
      );
    }

    req.sessionUser = {
      id: user.id,
      username: user.username,
      role: user.role,
    };
    res.locals.currentUser = req.sessionUser;
    res.locals.allSessions = getAllSessions(req);
    res.locals.activeRole = user.role;
    next();
  } catch (err) {
    return rejectAuth(
      req,
      res,
      401,
      "Session tidak valid atau sudah kadaluwarsa",
    );
  }
}

function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.sessionUser || !allowedRoles.includes(req.sessionUser.role)) {
      if (req.accepts("html")) {
        return res.status(403).send("Akses ditolak: role tidak memiliki izin.");
      }
      return res.status(403).json({
        status: "error",
        message: "Role tidak memiliki izin untuk mengakses resource ini",
      });
    }
    next();
  };
}

function extractAuthorizationToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader) return null;

  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
  if (authHeader.startsWith("ApiKey ")) return authHeader.slice(7).trim();
  if (authHeader.startsWith("igw_")) return authHeader;

  const [, token] = authHeader.split(/\s+/, 2);
  return token || null;
}

/**
 * Middleware gateway: menerima JWT Bearer ATAU API Key (prefix igw_).
 * API Key di-hash dengan SHA-256 dan dicocokkan dengan database.
 */
async function validateApiToken(req, res, next) {
  const token = extractAuthorizationToken(req);

  if (!token) {
    return res.status(401).json({
      status: "error",
      message:
        "Token JWT atau API Key diperlukan. Header: Authorization: Bearer <token>, ApiKey igw_<apikey>, atau igw_<apikey>",
    });
  }

  // Cek apakah ini API Key (dimulai dengan igw_)
  if (token.startsWith("igw_")) {
    try {
      const keyHash = crypto.createHash("sha256").update(token).digest("hex");
      const [rows] = await pool.query(
        "SELECT id, user_id, key_name, daily_limit, scopes, is_active FROM api_keys WHERE api_key_hash = ? LIMIT 1",
        [keyHash],
      );
      const apiKey = rows[0];
      if (!apiKey || !apiKey.is_active) {
        return res.status(403).json({
          status: "error",
          message: "API Key tidak valid atau sudah dinonaktifkan",
        });
      }
      // Update last_used
      pool
        .query("UPDATE api_keys SET last_used = NOW() WHERE id = ?", [
          apiKey.id,
        ])
        .catch(() => {});

      // Ambil info user untuk req.user
      const [userRows] = await pool.query(
        "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
        [apiKey.user_id],
      );
      const user = userRows[0];
      if (!user) {
        return res.status(403).json({
          status: "error",
          message: "Pemilik API Key tidak ditemukan atau sudah dihapus",
        });
      }
      req.user = {
        user_id: String(apiKey.user_id),
        username: user.username,
        role: user.role,
        auth_method: "api_key",
        api_key_id: apiKey.id,
        key_name: apiKey.key_name,
      };
      req.apiKey = {
        id: apiKey.id,
        user_id: apiKey.user_id,
        key_name: apiKey.key_name,
        daily_limit: apiKey.daily_limit || 1000,
        scopes: apiKey.scopes || "proxy:*",
      };

      // Update log dengan user_id
      if (req.logId) {
        pool
          .query("UPDATE request_logs SET user_id = ? WHERE id = ?", [
            String(apiKey.user_id),
            req.logId,
          ])
          .catch(() => {});
      }
      return next();
    } catch (err) {
      return res
        .status(500)
        .json({ status: "error", message: "Gagal validasi API Key" });
    }
  }

  // Fallback: validasi JWT API. Dashboard session token tidak boleh dipakai sebagai API token.
  try {
    let decoded;
    try {
      decoded = verifyJwt(token, API_AUDIENCE);
    } catch (err) {
      if (process.env.ALLOW_LEGACY_API_JWT === "true") {
        decoded = jwt.verify(token, jwtSecret());
      } else {
        throw err;
      }
    }

    if (
      decoded.type !== "api_token" &&
      process.env.ALLOW_LEGACY_API_JWT !== "true"
    ) {
      return res.status(403).json({
        status: "error",
        message:
          "Token bukan API token. Generate token API baru dari Client Portal atau gunakan API Key.",
      });
    }

    if (decoded.type === "api_token" && (await isApiTokenRevoked(decoded))) {
      return res.status(403).json({
        status: "error",
        message: "Token API sudah dicabut",
      });
    }

    req.user = decoded;

    if (req.logId) {
      pool
        .query("UPDATE request_logs SET user_id = ? WHERE id = ?", [
          decoded.user_id ||
            decoded.npm ||
            decoded.username ||
            decoded.sub ||
            "unknown",
          req.logId,
        ])
        .catch(() => {});
    }
    next();
  } catch (err) {
    return res.status(403).json({
      status: "error",
      message: "Token API tidak valid atau sudah kadaluwarsa",
    });
  }
}

/**
 * Helper: Catat aksi admin ke tabel audit_logs.
 */
async function logAudit(userId, username, action, resource, detail, ip) {
  try {
    await pool.query(
      "INSERT INTO audit_logs (user_id, username, action, resource, detail, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, username, action, resource, detail || null, ip || null],
    );
  } catch (err) {
    console.error("[AUDIT] Gagal simpan audit log:", err.message);
  }
}

module.exports = {
  SESSION_COOKIE,
  ROLE_COOKIES,
  ACTIVE_COOKIE,
  createPasswordHash,
  verifyPassword,
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
  requireAuth,
  requireRole,
  validateApiToken,
  logAudit,
};
