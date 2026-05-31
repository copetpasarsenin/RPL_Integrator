const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Per-role cookie names — memungkinkan login multi-tab bersamaan
const ROLE_COOKIES = {
    admin: 'gw_admin',
    operator: 'gw_operator',
    user: 'gw_user'
};
const ACTIVE_COOKIE = 'gw_active';

// Legacy cookie name (for backward compat)
const SESSION_COOKIE = 'gateway_session';

function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.startsWith('scrypt:')) return false;

    const [, salt, hash] = storedHash.split(':');
    const candidate = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(hash, 'hex');

    return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function getCookie(req, name) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';').map(cookie => cookie.trim());
    const target = cookies.find(cookie => cookie.startsWith(`${name}=`));
    if (!target) return null;

    return decodeURIComponent(target.substring(name.length + 1));
}

function issueSessionToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role,
            type: 'dashboard_session'
        },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
}

const cookieOpts = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
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
    // Set active role
    res.cookie(ACTIVE_COOKIE, role, { ...cookieOpts(), httpOnly: false });
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
    Object.values(ROLE_COOKIES).forEach(name => res.clearCookie(name));
    res.clearCookie(SESSION_COOKIE);
    res.clearCookie(ACTIVE_COOKIE);
}

/**
 * Ambil semua session yang aktif dari cookies.
 */
function getAllSessions(req) {
    const sessions = {};
    for (const [role, cookieName] of Object.entries(ROLE_COOKIES)) {
        const token = getCookie(req, cookieName);
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                if (decoded.type === 'dashboard_session') {
                    sessions[role] = {
                        id: decoded.id,
                        username: decoded.username,
                        role: decoded.role
                    };
                }
            } catch (_) {
                // Token expired/invalid — abaikan
            }
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
            if (t) { token = t; break; }
        }
    }

    if (!token) token = getCookie(req, SESSION_COOKIE);

    if (!token) {
        const bearerToken = (req.headers.authorization || '').split(' ')[1];
        if (bearerToken) token = bearerToken;
    }

    if (!token) {
        if (req.accepts('html')) return res.redirect('/login');
        return res.status(401).json({ status: 'error', message: 'Login diperlukan' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type && decoded.type !== 'dashboard_session') {
            if (req.accepts('html')) return res.redirect('/login');
            return res.status(401).json({ status: 'error', message: 'Token ini bukan session token. Gunakan login untuk akses dashboard.' });
        }
        req.sessionUser = {
            id: decoded.id,
            username: decoded.username,
            role: decoded.role
        };
        res.locals.currentUser = req.sessionUser;
        res.locals.allSessions = getAllSessions(req);
        res.locals.activeRole = decoded.role;
        next();
    } catch (err) {
        if (req.accepts('html')) return res.redirect('/login');
        return res.status(401).json({ status: 'error', message: 'Session tidak valid atau sudah kadaluwarsa' });
    }
}

function requireRole(roles) {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    return (req, res, next) => {
        if (!req.sessionUser || !allowedRoles.includes(req.sessionUser.role)) {
            if (req.accepts('html')) {
                return res.status(403).send('Akses ditolak: role tidak memiliki izin.');
            }
            return res.status(403).json({
                status: 'error',
                message: 'Role tidak memiliki izin untuk mengakses resource ini'
            });
        }
        next();
    };
}

/**
 * Middleware gateway: menerima JWT Bearer ATAU API Key (prefix igw_).
 * API Key di-hash dengan SHA-256 dan dicocokkan dengan database.
 */
async function validateApiToken(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            status: 'error',
            message: 'Token JWT atau API Key diperlukan. Header: Authorization: Bearer <token> atau igw_<apikey>'
        });
    }

    // Cek apakah ini API Key (dimulai dengan igw_)
    if (token.startsWith('igw_')) {
        try {
            const keyHash = crypto.createHash('sha256').update(token).digest('hex');
            const [rows] = await pool.query(
                'SELECT id, user_id, key_name, daily_limit, is_active FROM api_keys WHERE api_key_hash = ? LIMIT 1',
                [keyHash]
            );
            const apiKey = rows[0];
            if (!apiKey || !apiKey.is_active) {
                return res.status(403).json({
                    status: 'error',
                    message: 'API Key tidak valid atau sudah dinonaktifkan'
                });
            }
            // Update last_used
            pool.query('UPDATE api_keys SET last_used = NOW() WHERE id = ?', [apiKey.id]).catch(() => {});

            // Ambil info user untuk req.user
            const [userRows] = await pool.query('SELECT id, username, role FROM users WHERE id = ? LIMIT 1', [apiKey.user_id]);
            const user = userRows[0];
            req.user = {
                user_id: String(apiKey.user_id),
                username: user?.username || 'api_key_user',
                role: user?.role || 'user',
                auth_method: 'api_key',
                api_key_id: apiKey.id,
                key_name: apiKey.key_name
            };
            req.apiKey = {
                id: apiKey.id,
                user_id: apiKey.user_id,
                key_name: apiKey.key_name,
                daily_limit: apiKey.daily_limit || 1000
            };

            // Update log dengan user_id
            if (req.logId) {
                pool.query('UPDATE request_logs SET user_id = ? WHERE id = ?',
                    [String(apiKey.user_id), req.logId]).catch(() => {});
            }
            return next();
        } catch (err) {
            return res.status(500).json({ status: 'error', message: 'Gagal validasi API Key' });
        }
    }

    // Fallback: validasi JWT biasa
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;

        if (req.logId) {
            pool.query(
                'UPDATE request_logs SET user_id = ? WHERE id = ?',
                [decoded.user_id || decoded.npm || decoded.username || 'unknown', req.logId]
            ).catch(() => {});
        }
        next();
    } catch (err) {
        return res.status(403).json({
            status: 'error',
            message: 'Token tidak valid atau sudah kadaluwarsa'
        });
    }
}

/**
 * Helper: Catat aksi admin ke tabel audit_logs.
 */
async function logAudit(userId, username, action, resource, detail, ip) {
    try {
        await pool.query(
            'INSERT INTO audit_logs (user_id, username, action, resource, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, username, action, resource, detail || null, ip || null]
        );
    } catch (err) {
        console.error('[AUDIT] Gagal simpan audit log:', err.message);
    }
}

module.exports = {
    SESSION_COOKIE,
    ROLE_COOKIES,
    ACTIVE_COOKIE,
    createPasswordHash,
    verifyPassword,
    issueSessionToken,
    setSessionCookie,
    clearSessionCookie,
    clearAllSessionCookies,
    getAllSessions,
    requireAuth,
    requireRole,
    validateApiToken,
    logAudit
};
