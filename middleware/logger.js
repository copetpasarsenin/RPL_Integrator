/**
 * Middleware Logger — Mencatat setiap request yang masuk
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

const logger = (req, res, next) => {
    const logEntry = {
        id: global.requestLogs.length + 1,
        waktu: new Date().toLocaleString("id-ID"),
        timestamp: new Date().toISOString(),
        ip: req.ip || req.socket?.remoteAddress || 'unknown',
        metode: req.method,
        url_tujuan: req.originalUrl,
        user_id: null,
        service_tujuan: null,
        status: "PENDING",
        response_status: null,
        fee_terpotong: 0,
        fee_status: null
    };
    
    // Simpan ke memori global agar bisa dibaca oleh Dashboard UI
    if (global.requestLogs) {
        global.requestLogs.push(logEntry);
    }

    // Catat response status saat selesai
    res.on('finish', () => {
        logEntry.response_status = res.statusCode;
        if (logEntry.status === 'PENDING') {
            logEntry.status = res.statusCode < 400 ? 'SUCCESS' : 'ERROR';
        }
    });
    
    console.log(`[LOG] #${logEntry.id} | ${logEntry.waktu} | ${logEntry.ip} | ${logEntry.metode} -> ${logEntry.url_tujuan}`);
    next();
};

module.exports = logger;