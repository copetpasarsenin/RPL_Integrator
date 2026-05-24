/**
 * =============================================================
 * Konfigurasi Database MySQL — via Laragon
 * =============================================================
 * Menggunakan mysql2 dengan promise-based API (pool).
 * Koneksi pool agar efisien untuk multiple concurrent requests.
 * =============================================================
 */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rpl_integrator',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * Inisialisasi database: buat tabel jika belum ada
 */
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS request_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                waktu VARCHAR(100),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                ip VARCHAR(50),
                metode VARCHAR(10),
                url_tujuan VARCHAR(500),
                user_id VARCHAR(100),
                service_tujuan VARCHAR(100),
                status VARCHAR(20) DEFAULT 'PENDING',
                response_status INT,
                fee_terpotong DECIMAL(12,2) DEFAULT 0,
                fee_status VARCHAR(50),
                mode VARCHAR(20) DEFAULT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('   ✅ Database MySQL terhubung & tabel siap');
    } catch (error) {
        console.error('   ❌ Gagal koneksi ke MySQL:', error.message);
        console.error('   💡 Pastikan Laragon MySQL sudah running dan database "rpl_integrator" sudah dibuat.');
        process.exit(1);
    }
}

module.exports = { pool, initDatabase };
