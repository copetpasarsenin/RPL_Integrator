const crypto = require("crypto");
const mysql = require("mysql2/promise");

/**
 * Hash password menggunakan scrypt — digunakan saat seeding user default.
 * Fungsi canonical ada di middleware/auth.js (createPasswordHash).
 */
function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "rpl_integrator",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function dropColumnIfExists(tableName, columnName) {
  const [columns] = await pool.query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    [columnName],
  );
  if (columns.length > 0) {
    await pool.query(
      `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``,
    );
  }
}

async function addIndexIfMissing(tableName, indexName, sql) {
  const [indexes] = await pool.query(
    `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`,
    [indexName],
  );
  if (indexes.length === 0) {
    await pool.query(sql);
  }
}

async function addColumnIfMissing(tableName, columnName, sql) {
  const [columns] = await pool.query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    [columnName],
  );
  if (columns.length === 0) {
    await pool.query(sql);
  }
}

async function addForeignKeyIfMissing(tableName, constraintName, sql) {
  const [constraints] = await pool.query(
    `SELECT CONSTRAINT_NAME
         FROM information_schema.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND CONSTRAINT_NAME = ?
           AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [tableName, constraintName],
  );
  if (constraints.length === 0) {
    await pool.query(sql);
  }
}

async function seedApiServices() {
  const services = [
    ["smartbank", process.env.SMARTBANK_URL || "http://localhost:3001", "/", 1],
    [
      "marketplace",
      process.env.MARKETPLACE_URL || "http://localhost:3002",
      "/",
      1,
    ],
    ["pos", process.env.POS_URL || "http://localhost:3003", "/", 1],
    [
      "supplierhub",
      process.env.SUPPLIERHUB_URL || "http://localhost:3004",
      "/",
      1,
    ],
    [
      "logistikita",
      process.env.LOGISTIKITA_URL || "http://localhost:3005",
      "/",
      1,
    ],
    [
      "umkm_insight",
      process.env.UMKM_INSIGHT_URL || "http://localhost:3006",
      "/",
      1,
    ],
  ];

  for (const service of services) {
    await pool.query(
      `INSERT INTO api_services (nama_service, url_tujuan, health_path, status_aktif)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE url_tujuan = VALUES(url_tujuan)`,
      service,
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
      user,
    );
  }
}

async function seedEmployees() {
  const employees = [
    [
      "EMP001",
      "Admin Demo",
      "Admin",
      "IT Integrator",
      "admin.demo@rpl-integrator.local",
      "081100000001",
      "active",
    ],
    [
      "EMP002",
      "Operator Demo",
      "Operator",
      "Operasional Gateway",
      "operator.demo@rpl-integrator.local",
      "081100000002",
      "active",
    ],
    [
      "EMP003",
      "User Demo",
      "User",
      "Client UMKM",
      "user.demo@rpl-integrator.local",
      "081100000003",
      "active",
    ],
    [
      "EMP004",
      "Finance Staff",
      "Finance",
      "Keuangan",
      "finance.staff@rpl-integrator.local",
      "081100000004",
      "active",
    ],
    [
      "EMP005",
      "Integration Staff",
      "Integration Staff",
      "Integrasi Service",
      "integration.staff@rpl-integrator.local",
      "081100000005",
      "active",
    ],
  ];

  for (const employee of employees) {
    await pool.query(
      `INSERT INTO employees (employee_code, name, role, department, email, phone, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                role = VALUES(role),
                department = VALUES(department),
                email = VALUES(email),
                phone = VALUES(phone),
                status = VALUES(status)`,
      employee,
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
            CREATE TABLE IF NOT EXISTS employees (
                id INT AUTO_INCREMENT PRIMARY KEY,
                employee_code VARCHAR(30) NOT NULL UNIQUE,
                name VARCHAR(150) NOT NULL,
                role VARCHAR(100) NOT NULL,
                department VARCHAR(120) NOT NULL,
                email VARCHAR(150) NOT NULL,
                phone VARCHAR(30),
                status VARCHAR(30) NOT NULL DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_employee_role (role),
                INDEX idx_employee_department (department),
                INDEX idx_employee_status (status)
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

    await addColumnIfMissing(
      "api_services",
      "health_path",
      "ALTER TABLE api_services ADD COLUMN health_path VARCHAR(255) NOT NULL DEFAULT '/' AFTER url_tujuan",
    );

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

    await pool.query(`
            CREATE TABLE IF NOT EXISTS shadow_service_usage (
                id INT AUTO_INCREMENT PRIMARY KEY,
                request_log_id INT NULL,
                source_app VARCHAR(120) NOT NULL DEFAULT 'unknown_app',
                service_name VARCHAR(100) NOT NULL,
                endpoint VARCHAR(500) NOT NULL,
                consumer_id VARCHAR(120) NOT NULL DEFAULT 'anonymous',
                request_method VARCHAR(10) NOT NULL,
                request_status VARCHAR(20) NOT NULL,
                response_code INT NULL,
                used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_shadow_source_app (source_app),
                INDEX idx_shadow_service_name (service_name),
                INDEX idx_shadow_consumer_id (consumer_id),
                INDEX idx_shadow_request_status (request_status),
                INDEX idx_shadow_used_at (used_at),
                INDEX idx_shadow_request_log_id (request_log_id),
                CONSTRAINT fk_shadow_request_log
                    FOREIGN KEY (request_log_id) REFERENCES request_logs(id)
                    ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

    if (process.env.ALLOW_DESTRUCTIVE_SCHEMA_CHANGES === "true") {
      await dropColumnIfExists("request_logs", "fee_terpotong");
      await dropColumnIfExists("request_logs", "fee_status");
    }

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

    await addIndexIfMissing(
      "request_logs",
      "idx_status",
      "CREATE INDEX idx_status ON request_logs (status)",
    );
    await addIndexIfMissing(
      "request_logs",
      "idx_service",
      "CREATE INDEX idx_service ON request_logs (service_tujuan)",
    );
    await addIndexIfMissing(
      "request_logs",
      "idx_timestamp",
      "CREATE INDEX idx_timestamp ON request_logs (timestamp)",
    );

    // ── Fitur Baru: API Key Management ─────────────────────────────
    await pool.query(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                key_name VARCHAR(100) NOT NULL,
                api_key_hash VARCHAR(255) NOT NULL UNIQUE,
                api_key_prefix VARCHAR(20) NOT NULL,
                daily_limit INT NOT NULL DEFAULT 1000,
                scopes VARCHAR(500) NOT NULL DEFAULT 'proxy:*',
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                last_used DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_apikey_user (user_id),
                INDEX idx_apikey_prefix (api_key_prefix),
                CONSTRAINT fk_api_keys_user
                    FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
    await addColumnIfMissing(
      "api_keys",
      "daily_limit",
      "ALTER TABLE api_keys ADD COLUMN daily_limit INT NOT NULL DEFAULT 1000 AFTER api_key_prefix",
    );
    await addColumnIfMissing(
      "api_keys",
      "scopes",
      "ALTER TABLE api_keys ADD COLUMN scopes VARCHAR(500) NOT NULL DEFAULT 'proxy:*' AFTER daily_limit",
    );
    await pool.query(
      "DELETE ak FROM api_keys ak LEFT JOIN users u ON u.id = ak.user_id WHERE u.id IS NULL",
    );
    await addForeignKeyIfMissing(
      "api_keys",
      "fk_api_keys_user",
      `ALTER TABLE api_keys
             ADD CONSTRAINT fk_api_keys_user
             FOREIGN KEY (user_id) REFERENCES users(id)
             ON DELETE CASCADE`,
    );

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

    await pool.query(`
            CREATE TABLE IF NOT EXISTS api_rate_limits (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_key VARCHAR(150) NOT NULL,
                window_start BIGINT NOT NULL,
                request_count INT NOT NULL DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_api_rate_limit_window (user_key, window_start),
                INDEX idx_rate_limit_updated (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

    await pool.query(`
            CREATE TABLE IF NOT EXISTS gateway_idempotency_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                key_hash CHAR(64) NOT NULL UNIQUE,
                idempotency_key VARCHAR(255) NOT NULL,
                request_hash CHAR(64) NOT NULL,
                user_id VARCHAR(100),
                method VARCHAR(10) NOT NULL,
                route_key VARCHAR(500) NOT NULL,
                status ENUM('PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PROCESSING',
                response_status INT NULL,
                response_body JSON NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                INDEX idx_idempotency_expires (expires_at),
                INDEX idx_idempotency_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

    await pool.query(`
            CREATE TABLE IF NOT EXISTS revoked_api_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token_jti VARCHAR(64) NOT NULL UNIQUE,
                subject VARCHAR(100),
                expires_at DATETIME NOT NULL,
                revoked_by INT NULL,
                reason VARCHAR(255),
                revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_revoked_expires (expires_at),
                INDEX idx_revoked_subject (subject),
                CONSTRAINT fk_revoked_api_tokens_user
                    FOREIGN KEY (revoked_by) REFERENCES users(id)
                    ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

    await pool.query(`
            CREATE TABLE IF NOT EXISTS revoked_session_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token_jti VARCHAR(64) NOT NULL UNIQUE,
                user_id INT NULL,
                expires_at DATETIME NOT NULL,
                revoked_by INT NULL,
                reason VARCHAR(255),
                revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_revoked_session_expires (expires_at),
                INDEX idx_revoked_session_user (user_id),
                CONSTRAINT fk_revoked_session_user
                    FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE SET NULL,
                CONSTRAINT fk_revoked_session_revoker
                    FOREIGN KEY (revoked_by) REFERENCES users(id)
                    ON DELETE SET NULL
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
    const isProduction = process.env.NODE_ENV === "production";
    if (process.env.SEED_DEFAULT_USERS === "true" || !isProduction) {
      await seedUsers();
    } else {
      console.log(
        "   Lewati seeding user default di production. Buat admin secara eksplisit.",
      );
    }
    await seedEmployees();

    console.log("   Database MySQL terhubung & tabel siap");
  } catch (error) {
    console.error("   Gagal koneksi/inisialisasi MySQL:", error.message);
    console.error(
      '   Pastikan Laragon MySQL sudah running dan database "rpl_integrator" sudah dibuat.',
    );
    process.exit(1);
  }
}

module.exports = { pool, initDatabase };
