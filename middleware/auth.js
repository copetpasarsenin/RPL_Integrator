/**
 * Middleware Auth — Validasi JWT Token
 * Sesuai Doc2 (Fitur Validasi Request) dan Doc4 Aturan 6
 * 
 * Proses:
 * 1. Ambil token dari header Authorization: Bearer <token>
 * 2. Verifikasi token dengan JWT_SECRET
 * 3. Decode payload dan simpan di req.user
 * 4. Jika gagal → return 401/403
 */

const jwt = require('jsonwebtoken');

const validateRequest = (req, res, next) => {
    const authHeader = req.headers['authorization'];
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
        
        // Update log entry dengan user_id setelah token tervalidasi
        if (global.requestLogs && global.requestLogs.length > 0) {
            const currentLog = global.requestLogs[global.requestLogs.length - 1];
            if (currentLog) {
                currentLog.user_id = decoded.user_id || decoded.npm || 'unknown';
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
};

module.exports = validateRequest;