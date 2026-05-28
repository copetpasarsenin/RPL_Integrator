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

INSERT INTO api_services (nama_service, url_tujuan, status_aktif) VALUES
    ('smartbank', 'http://localhost:3001', 1),
    ('marketplace', 'http://localhost:3002', 1),
    ('pos', 'http://localhost:3003', 1),
    ('supplierhub', 'http://localhost:3004', 1),
    ('logistikita', 'http://localhost:3005', 1),
    ('umkm_insight', 'http://localhost:3006', 1)
ON DUPLICATE KEY UPDATE
    url_tujuan = VALUES(url_tujuan),
    status_aktif = VALUES(status_aktif);

-- Default password seeded by server.js initDatabase:
-- admin/admin123, operator/operator123, user/user123.
-- Hash dibuat dengan scrypt saat aplikasi pertama kali berjalan.
