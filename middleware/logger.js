/**
 * Middleware Logger — Mencatat setiap request yang masuk ke MySQL
 * Sesuai Doc3 (Logging) dan Doc4 Aturan 6 (Validasi & Logging wajib)
 * 
 * Data yang dicatat:
 * - Waktu request
 * - IP address pengirim
 * - HTTP method
 * - URL tujuan
 * - User ID (dari JWT token jika sudah tervalidasi)
 * - Status awal (PENDING, diupdate oleh gateway)
 */

const { pool } = require('../config/database');

const logger = async (req, res, next) => {
    const logEntry = {
        waktu: new Date().toLocaleString("id-ID"),
        timestamp: new Date(),
        ip: req.ip || req.socket?.remoteAddress || 'unknown',
        metode: req.method,
        url_tujuan: req.originalUrl,
        user_id: null,
        service_tujuan: null,
        status: "PENDING",
        response_status: null
    };

    try {
        // Simpan ke MySQL dan dapatkan ID yang di-generate
        const [result] = await pool.query(
            `INSERT INTO request_logs (waktu, timestamp, ip, metode, url_tujuan, user_id, service_tujuan, status, response_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [logEntry.waktu, logEntry.timestamp, logEntry.ip, logEntry.metode, logEntry.url_tujuan,
             logEntry.user_id, logEntry.service_tujuan, logEntry.status, logEntry.response_status]
        );

        // Simpan ID di request agar bisa diupdate oleh auth & gateway
        req.logId = result.insertId;

        // Update response status saat selesai
        res.on('finish', async () => {
            try {
                const finalStatus = res.statusCode < 400 ? 'SUCCESS' : 'ERROR';
                await pool.query(
                    `UPDATE request_logs SET response_status = ?, status = IF(status = 'PENDING', ?, status) WHERE id = ?`,
                    [res.statusCode, finalStatus, req.logId]
                );
            } catch (err) {
                console.error('[LOG] Gagal update status akhir:', err.message);
            }
        });

    } catch (err) {
        console.error('[LOG] Gagal simpan log ke MySQL:', err.message);
        // Tetap lanjutkan request meskipun logging gagal
    }

    console.log(`[LOG] #${req.logId || '?'} | ${logEntry.waktu} | ${logEntry.ip} | ${logEntry.metode} -> ${logEntry.url_tujuan}`);
    next();
};

module.exports = logger;
