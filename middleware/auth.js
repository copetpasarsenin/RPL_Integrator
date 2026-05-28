const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

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

function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: 8 * 60 * 60 * 1000
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE);
}

async function requireAuth(req, res, next) {
    const cookieToken = getCookie(req, SESSION_COOKIE);
    const bearerToken = (req.headers.authorization || '').split(' ')[1];
    const token = cookieToken || bearerToken;

    if (!token) {
        if (req.accepts('html')) return res.redirect('/login');
        return res.status(401).json({ status: 'error', message: 'Login diperlukan' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.sessionUser = {
            id: decoded.id,
            username: decoded.username,
            role: decoded.role
        };
        res.locals.currentUser = req.sessionUser;
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
                message: 'Role tidak memiliki izin',
                allowed_roles: allowedRoles
            });
        }

        next();
    };
}

async function validateApiToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            status: 'error',
            message: 'Token JWT diperlukan. Sertakan header: Authorization: Bearer <token>'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;

        if (req.logId) {
            try {
                await pool.query(
                    'UPDATE request_logs SET user_id = ? WHERE id = ?',
                    [decoded.user_id || decoded.npm || decoded.username || 'unknown', req.logId]
                );
            } catch (err) {
                console.error('[AUTH] Gagal update user_id di log:', err.message);
            }
        }

        next();
    } catch (err) {
        return res.status(403).json({
            status: 'error',
            message: 'Token tidak valid atau sudah kadaluwarsa',
            detail: err.message
        });
    }
}

module.exports = {
    SESSION_COOKIE,
    createPasswordHash,
    verifyPassword,
    issueSessionToken,
    setSessionCookie,
    clearSessionCookie,
    requireAuth,
    requireRole,
    validateApiToken
};
