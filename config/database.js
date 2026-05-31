const crypto = require('crypto');
const mysql = require('mysql2/promise');

/**
 * Hash password menggunakan scrypt — digunakan saat seeding user default.
 * Fungsi canonical ada di middleware/auth.js (createPasswordHash).
 */
function passwordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rpl_integrator',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function dropColumnIfExists(tableName, columnName) {
    const [columns] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (columns.length > 0) {
        await pool.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``);
    }
}

async function addIndexIfMissing(tableName, indexName, sql) {
    const [indexes] = await pool.query(
        `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`,
        [indexName]
    );
    if (indexes.length === 0) {
        await pool.query(sql);
    }
}

async function addColumnIfMissing(tableName, columnName, sql) {
    const [columns] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (columns.length === 0) {
        await pool.query(sql);
    }
}

async function seedApiServices() {
    const services = [
        ['smartbank', process.env.SMARTBANK_URL || 'http://localhost:3001', '/', 1],
        ['marketplace', process.env.MARKETPLACE_URL || 'http://localhost:3002', '/', 1],
        ['pos', process.env.POS_URL || 'http://localhost:3003', '/', 1],
        ['supplierhub', process.env.SUPPLIERHUB_URL || 'http://localhost:3004', '/', 1],
        ['logistikita', process.env.LOGISTIKITA_URL || 'http://localhost:3005', '/', 1],
        ['umkm_insight', process.env.UMKM_INSIGHT_URL || 'http://localhost:3006', '/', 1]
    ];

    for (const service of services) {
        await pool.query(
            `INSERT INTO api_services (nama_service, url_tujuan, health_path, status_aktif)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE url_tujuan = VALUES(url_tujuan)`,
            service
        );
    }
}

async function seedUsers() {
    const users = [
        ['admin', passwordHash('admin123'), 'admin'],
        ['operator', passwordHash('operator123'), 'operator'],
        ['user', passwordHash('user123'), 'user']
    ];

    for (const user of users) {
        await pool.query(
            `INSERT IGNORE INTO users (username, password_hash, role)
             VALUES (?, ?, ?)`,
            user
        );
    }
}

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('admin', 'operator', 'user') NOT NULL DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_role (role)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_services (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nama_service VARCHAR(100) NOT NULL UNIQUE,
                url_tujuan VARCHAR(500) NOT NULL,
                health_path VARCHAR(255) NOT NULL DEFAULT '/',
                status_aktif TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status_aktif (status_aktif)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        await addColumnIfMissing('api_services', 'health_path', "ALTER TABLE api_services ADD COLUMN health_path VARCHAR(255) NOT NULL DEFAULT '/' AFTER url_tujuan");

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
                mode VARCHAR(20) DEFAULT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await dropColumnIfExists('request_logs', 'fee_terpotong');
        await dropColumnIfExists('request_logs', 'fee_status');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS revenue_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                request_id INT NULL,
                nominal_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
                waktu DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_request_id (request_id),
                INDEX idx_waktu (waktu),
                CONSTRAINT fk_revenue_request
                    FOREIGN KEY (request_id) REFERENCES request_logs(id)
                    ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await addIndexIfMissing('request_logs', 'idx_status', 'CREATE INDEX idx_status ON request_logs (status)');
        await addIndexIfMissing('request_logs', 'idx_service', 'CREATE INDEX idx_service ON request_logs (service_tujuan)');
        await addIndexIfMissing('request_logs', 'idx_timestamp', 'CREATE INDEX idx_timestamp ON request_logs (timestamp)');

        // ── Fitur Baru: API Key Management ─────────────────────────────
        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                key_name VARCHAR(100) NOT NULL,
                api_key_hash VARCHAR(255) NOT NULL UNIQUE,
                api_key_prefix VARCHAR(20) NOT NULL,
                daily_limit INT NOT NULL DEFAULT 1000,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                last_used DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_apikey_user (user_id),
                INDEX idx_apikey_prefix (api_key_prefix)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        await addColumnIfMissing('api_keys', 'daily_limit', 'ALTER TABLE api_keys ADD COLUMN daily_limit INT NOT NULL DEFAULT 1000 AFTER api_key_prefix');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_key_usage (
                id INT AUTO_INCREMENT PRIMARY KEY,
                api_key_id INT NOT NULL,
                usage_date DATE NOT NULL,
                request_count INT NOT NULL DEFAULT 0,
                last_request_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_api_key_usage_day (api_key_id, usage_date),
                INDEX idx_usage_date (usage_date),
                CONSTRAINT fk_usage_api_key
                    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // ── Fitur Baru: Audit Log Admin ─────────────────────────────────
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                username VARCHAR(100),
                action VARCHAR(50) NOT NULL,
                resource VARCHAR(100),
                detail TEXT,
                ip VARCHAR(50),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_audit_user (user_id),
                INDEX idx_audit_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // ── Fitur Baru: Service Health History ─────────────────────────
        await pool.query(`
            CREATE TABLE IF NOT EXISTS service_health_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                service_name VARCHAR(100) NOT NULL,
                status VARCHAR(20) NOT NULL,
                checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_health_service (service_name),
                INDEX idx_health_checked (checked_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_alerts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                severity ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'warning',
                source VARCHAR(100) NOT NULL,
                title VARCHAR(150) NOT NULL,
                message TEXT,
                is_resolved TINYINT(1) NOT NULL DEFAULT 0,
                resolved_at DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_alert_resolved (is_resolved),
                INDEX idx_alert_created (created_at),
                INDEX idx_alert_source (source)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await seedApiServices();
        await seedUsers();

        console.log('   Database MySQL terhubung & tabel siap');
    } catch (error) {
        console.error('   Gagal koneksi/inisialisasi MySQL:', error.message);
        console.error('   Pastikan Laragon MySQL sudah running dan database "rpl_integrator" sudah dibuat.');
        process.exit(1);
    }
}

module.exports = { pool, initDatabase };
