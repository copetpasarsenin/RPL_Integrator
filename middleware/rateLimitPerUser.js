/**
 * Per-User Rate Limiter (In-Memory Sliding Window)
 * Membatasi jumlah request berdasarkan user_id dari JWT token.
 * Default: 30 request per menit per user.
 */

const { pool } = require('../config/database');

const userRequestMap = new Map(); // user_id -> [timestamp, ...]

const WINDOW_MS = parseInt(process.env.USER_RATE_WINDOW_MS) || 60 * 1000; // 1 menit
const MAX_REQUESTS = parseInt(process.env.USER_RATE_MAX) || 30;

// Bersihkan entry lama setiap 5 menit untuk mencegah memory leak
setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamps] of userRequestMap.entries()) {
        const valid = timestamps.filter(t => now - t < WINDOW_MS);
        if (valid.length === 0) {
            userRequestMap.delete(userId);
        } else {
            userRequestMap.set(userId, valid);
        }
    }
}, 5 * 60 * 1000);

/**
 * Middleware — dipasang SETELAH validateApiToken agar req.user sudah tersedia.
 */
async function enforceApiKeyDailyQuota(req, res) {
    if (!req.apiKey?.id) return true;

    const dailyLimit = Number(req.apiKey.daily_limit) || 1000;
    const [rows] = await pool.query(
        'SELECT request_count FROM api_key_usage WHERE api_key_id = ? AND usage_date = CURDATE() LIMIT 1',
        [req.apiKey.id]
    );
    const usedToday = rows[0]?.request_count || 0;

    res.setHeader('X-RateLimit-Daily-Limit', String(dailyLimit));
    res.setHeader('X-RateLimit-Daily-Remaining', String(Math.max(dailyLimit - usedToday - 1, 0)));

    if (usedToday >= dailyLimit) {
        res.status(429).json({
            status: 'error',
            message: `Kuota harian API Key terlampaui. Maksimal ${dailyLimit} request per hari.`,
            api_key_id: req.apiKey.id,
            used_today: usedToday,
            daily_limit: dailyLimit
        });
        return false;
    }

    await pool.query(`
        INSERT INTO api_key_usage (api_key_id, usage_date, request_count, last_request_at)
        VALUES (?, CURDATE(), 1, NOW())
        ON DUPLICATE KEY UPDATE
            request_count = request_count + 1,
            last_request_at = NOW()
    `, [req.apiKey.id]);

    return true;
}

async function rateLimitPerUser(req, res, next) {
    const userId = req.user?.user_id || req.user?.npm || req.user?.username;

    // Kalau tidak ada user_id (tidak terautentikasi), skip — biarkan auth middleware yang handle
    if (!userId) return next();

    const now = Date.now();
    const timestamps = (userRequestMap.get(userId) || []).filter(t => now - t < WINDOW_MS);

    if (timestamps.length >= MAX_REQUESTS) {
        const retryAfter = Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000);
        return res.status(429).json({
            status: 'error',
            message: `Rate limit per-user terlampaui. Maksimal ${MAX_REQUESTS} request per menit.`,
            retry_after_seconds: retryAfter,
            user_id: userId
        });
    }

    timestamps.push(now);
    userRequestMap.set(userId, timestamps);

    try {
        const allowed = await enforceApiKeyDailyQuota(req, res);
        if (!allowed) return;
        next();
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: 'Gagal memeriksa kuota API Key'
        });
    }
}

module.exports = rateLimitPerUser;
