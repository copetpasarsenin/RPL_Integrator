/**
 * Per-User Rate Limiter (In-Memory Sliding Window)
 * Membatasi jumlah request berdasarkan user_id dari JWT token.
 * Default: 30 request per menit per user.
 */

const { pool } = require("../config/database");

const userRequestMap = new Map(); // user_id -> [timestamp, ...]

const WINDOW_MS = parseInt(process.env.USER_RATE_WINDOW_MS) || 60 * 1000; // 1 menit
const MAX_REQUESTS = parseInt(process.env.USER_RATE_MAX) || 30;
const USER_RATE_BACKEND = String(
  process.env.USER_RATE_BACKEND || "memory",
).toLowerCase();

// Bersihkan entry lama setiap 5 menit untuk mencegah memory leak
const cleanupTimer = setInterval(
  () => {
    const now = Date.now();
    for (const [userId, timestamps] of userRequestMap.entries()) {
      const valid = timestamps.filter((t) => now - t < WINDOW_MS);
      if (valid.length === 0) {
        userRequestMap.delete(userId);
      } else {
        userRequestMap.set(userId, valid);
      }
    }
  },
  5 * 60 * 1000,
);
cleanupTimer.unref?.();

/**
 * Middleware — dipasang SETELAH validateApiToken agar req.user sudah tersedia.
 */
async function enforceApiKeyDailyQuota(req, res) {
  if (!req.apiKey?.id) return true;

  const dailyLimit = Number(req.apiKey.daily_limit) || 1000;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT request_count FROM api_key_usage WHERE api_key_id = ? AND usage_date = CURDATE() LIMIT 1 FOR UPDATE",
      [req.apiKey.id],
    );
    const usedToday = rows[0]?.request_count || 0;

    res.setHeader("X-RateLimit-Daily-Limit", String(dailyLimit));
    res.setHeader(
      "X-RateLimit-Daily-Remaining",
      String(Math.max(dailyLimit - usedToday - 1, 0)),
    );

    if (usedToday >= dailyLimit) {
      await conn.rollback();
      res.status(429).json({
        status: "error",
        message: `Kuota harian API Key terlampaui. Maksimal ${dailyLimit} request per hari.`,
        api_key_id: req.apiKey.id,
        used_today: usedToday,
        daily_limit: dailyLimit,
      });
      return false;
    }

    if (rows.length === 0) {
      await conn.query(
        "INSERT INTO api_key_usage (api_key_id, usage_date, request_count, last_request_at) VALUES (?, CURDATE(), 1, NOW())",
        [req.apiKey.id],
      );
    } else {
      await conn.query(
        "UPDATE api_key_usage SET request_count = request_count + 1, last_request_at = NOW() WHERE api_key_id = ? AND usage_date = CURDATE()",
        [req.apiKey.id],
      );
    }

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function enforceDbUserRateLimit(userId, res) {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const retryAfter = Math.ceil((windowStart + WINDOW_MS - now) / 1000);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT request_count FROM api_rate_limits WHERE user_key = ? AND window_start = ? LIMIT 1 FOR UPDATE",
      [String(userId), windowStart],
    );
    const currentCount = rows[0]?.request_count || 0;

    res.setHeader("X-RateLimit-Limit", String(MAX_REQUESTS));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(MAX_REQUESTS - currentCount - 1, 0)),
    );
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil((windowStart + WINDOW_MS) / 1000)),
    );

    if (currentCount >= MAX_REQUESTS) {
      await conn.rollback();
      return {
        allowed: false,
        retryAfter,
      };
    }

    if (rows.length === 0) {
      await conn.query(
        "INSERT INTO api_rate_limits (user_key, window_start, request_count) VALUES (?, ?, 1)",
        [String(userId), windowStart],
      );
    } else {
      await conn.query(
        "UPDATE api_rate_limits SET request_count = request_count + 1 WHERE user_key = ? AND window_start = ?",
        [String(userId), windowStart],
      );
    }

    await conn.commit();
    return { allowed: true };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
    pool
      .query(
        "DELETE FROM api_rate_limits WHERE updated_at < DATE_SUB(NOW(), INTERVAL 1 DAY)",
      )
      .catch(() => {});
  }
}

function enforceMemoryUserRateLimit(userId, res) {
  const now = Date.now();
  const timestamps = (userRequestMap.get(userId) || []).filter(
    (t) => now - t < WINDOW_MS,
  );

  res.setHeader("X-RateLimit-Limit", String(MAX_REQUESTS));
  res.setHeader(
    "X-RateLimit-Remaining",
    String(Math.max(MAX_REQUESTS - timestamps.length - 1, 0)),
  );

  if (timestamps.length >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  timestamps.push(now);
  userRequestMap.set(userId, timestamps);
  return { allowed: true };
}

async function rateLimitPerUser(req, res, next) {
  const userId = req.user?.user_id || req.user?.npm || req.user?.username;

  // Kalau tidak ada user_id (tidak terautentikasi), skip — biarkan auth middleware yang handle
  if (!userId) return next();

  try {
    const userRateResult =
      USER_RATE_BACKEND === "db"
        ? await enforceDbUserRateLimit(userId, res)
        : enforceMemoryUserRateLimit(userId, res);

    if (!userRateResult.allowed) {
      return res.status(429).json({
        status: "error",
        message: `Rate limit per-user terlampaui. Maksimal ${MAX_REQUESTS} request per menit.`,
        retry_after_seconds: userRateResult.retryAfter,
        user_id: userId,
      });
    }

    const allowed = await enforceApiKeyDailyQuota(req, res);
    if (!allowed) return;
    next();
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Gagal memeriksa rate limit atau kuota API Key",
    });
  }
}

module.exports = rateLimitPerUser;
