-- =============================================================
-- SQL Inisialisasi Database - RPL Integrator (Kelompok 7)
-- =============================================================
-- Jalankan script ini di HeidiSQL (Laragon) atau MySQL CLI:
--   mysql -u root < config/init.sql
-- =============================================================

CREATE DATABASE IF NOT EXISTS rpl_integrator
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE rpl_integrator;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'operator', 'user') NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS request_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    waktu VARCHAR(100) COMMENT 'Waktu request format lokal id-ID',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp request',
    ip VARCHAR(50) COMMENT 'IP address pengirim',
    metode VARCHAR(10) COMMENT 'HTTP method',
    url_tujuan VARCHAR(500) COMMENT 'URL endpoint gateway',
    user_id VARCHAR(100) COMMENT 'User ID dari token',
    service_tujuan VARCHAR(100) COMMENT 'Nama service tujuan',
    status VARCHAR(20) DEFAULT 'PENDING' COMMENT 'PENDING/SUCCESS/ERROR/FORWARDED',
    response_status INT COMMENT 'HTTP response status code',
    mode VARCHAR(20) DEFAULT NULL COMMENT 'Mode request DEMO/NULL',
    INDEX idx_status (status),
    INDEX idx_service (service_tujuan),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS service_health_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    service_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_health_service (service_name),
    INDEX idx_health_checked (checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

INSERT INTO api_services (nama_service, url_tujuan, health_path, status_aktif) VALUES
    ('smartbank', 'http://localhost:3001', '/', 1),
    ('marketplace', 'http://localhost:3002', '/', 1),
    ('pos', 'http://localhost:3003', '/', 1),
    ('supplierhub', 'http://localhost:3004', '/', 1),
    ('logistikita', 'http://localhost:3005', '/', 1),
    ('umkm_insight', 'http://localhost:3006', '/', 1)
ON DUPLICATE KEY UPDATE
    url_tujuan = VALUES(url_tujuan),
    health_path = VALUES(health_path),
    status_aktif = VALUES(status_aktif);

-- Default password seeded by server.js initDatabase:
-- admin/admin123, operator/operator123, user/user123.
-- Hash dibuat dengan scrypt saat aplikasi pertama kali berjalan.
