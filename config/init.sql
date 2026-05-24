-- =============================================================
-- SQL Inisialisasi Database — RPL Integrator (Kelompok 7)
-- =============================================================
-- Jalankan script ini di HeidiSQL (Laragon) atau MySQL CLI:
--   mysql -u root < config/init.sql
-- =============================================================

CREATE DATABASE IF NOT EXISTS rpl_integrator
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE rpl_integrator;

CREATE TABLE IF NOT EXISTS request_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    waktu VARCHAR(100) COMMENT 'Waktu request (format lokal id-ID)',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp ISO',
    ip VARCHAR(50) COMMENT 'IP address pengirim',
    metode VARCHAR(10) COMMENT 'HTTP method (GET/POST/PUT/DELETE)',
    url_tujuan VARCHAR(500) COMMENT 'URL endpoint tujuan',
    user_id VARCHAR(100) COMMENT 'User ID dari JWT token',
    service_tujuan VARCHAR(100) COMMENT 'Nama service tujuan',
    status VARCHAR(20) DEFAULT 'PENDING' COMMENT 'Status request (PENDING/SUCCESS/ERROR/FORWARDED)',
    response_status INT COMMENT 'HTTP response status code',
    fee_terpotong DECIMAL(12,2) DEFAULT 0 COMMENT 'Fee gateway yang terpotong (Rp)',
    fee_status VARCHAR(50) COMMENT 'Status pemotongan fee',
    mode VARCHAR(20) DEFAULT NULL COMMENT 'Mode request (DEMO/NULL)',
    INDEX idx_status (status),
    INDEX idx_service (service_tujuan),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
