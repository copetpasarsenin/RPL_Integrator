const express = require('express');
const router = express.Router();
const axios = require('axios');
const { pool } = require('../config/database');

// === Fee Gateway sesuai Doc6 Aturan No.10: 0.5% dari setiap transaksi ===
const GATEWAY_FEE_PERCENT = parseFloat(process.env.GATEWAY_FEE_PERCENT) || 0.5;

// === Mapping Service sesuai Doc1 & Doc3: Semua 6 aplikasi ekosistem ===
const SERVICE_MAP = {
    smartbank:    process.env.SMARTBANK_URL,
    marketplace:  process.env.MARKETPLACE_URL,
    pos:          process.env.POS_URL,
    supplierhub:  process.env.SUPPLIERHUB_URL,
    logistikita:  process.env.LOGISTIKITA_URL,
    umkm_insight: process.env.UMKM_INSIGHT_URL,
};

// ============================================================
// FITUR 1 — Routing API (Doc2: /integrator/routing_api)
// Deskripsi: Routing request antar service
// ============================================================
router.get('/routing_api', (req, res) => {
    const services = Object.keys(SERVICE_MAP).map(name => ({
        service: name,
        url: SERVICE_MAP[name] || 'Belum dikonfigurasi',
        status: SERVICE_MAP[name] ? 'Terdaftar' : 'Tidak tersedia'
    }));

    res.json({
        status: 'success',
        message: 'Daftar routing service yang terdaftar di gateway',
        data: {
            total_services: services.length,
            fee_gateway: `${GATEWAY_FEE_PERCENT}%`,
            services
        }
    });
});

// ============================================================
// FITUR 2 — Validasi Request (Doc2: /integrator/validasi_request)
// Deskripsi: Validasi token JWT
// ============================================================
router.get('/validasi_request', (req, res) => {
    res.json({
        status: 'success',
        message: 'Token JWT tervalidasi',
        data: {
            user: req.user,
            token_valid: true,
            validated_at: new Date().toLocaleString("id-ID")
        }
    });
});

// ============================================================
// FITUR 3 — Logging (Doc2: /integrator/logging)
// Deskripsi: Mencatat request — menampilkan log dari MySQL
// ============================================================
router.get('/logging', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM request_logs ORDER BY id DESC LIMIT 50'
        );
        res.json({
            status: 'success',
            message: 'Log aktivitas gateway',
            data: {
                total_logs: rows.length,
                logs: rows
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca log', detail: err.message });
    }
});

// ============================================================
// FITUR 4 — Biaya Layanan Integrasi (Doc2: /integrator/biaya_layanan_integrasi)
// Deskripsi: Info biaya service per request antar aplikasi
// ============================================================
router.get('/biaya_layanan_integrasi', async (req, res) => {
    try {
        const [countResult] = await pool.query('SELECT COUNT(*) AS total FROM request_logs');
        const [feeResult] = await pool.query('SELECT COALESCE(SUM(fee_terpotong), 0) AS total_fee FROM request_logs');

        res.json({
            status: 'success',
            message: 'Informasi biaya layanan integrasi',
            data: {
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                total_transaksi: countResult[0].total,
                total_pendapatan_fee: parseFloat(feeResult[0].total_fee),
                keterangan: `Fee ${GATEWAY_FEE_PERCENT}% dipotong otomatis dari setiap transaksi yang melewati gateway`
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca data biaya', detail: err.message });
    }
});

// ============================================================
// ORCHESTRATOR — Dynamic Routing ke semua service
// Meneruskan request ke service tujuan (Doc3 & Doc4 Aturan 5)
// ============================================================
router.all('/:service/{*path}', async (req, res) => {
    const { service } = req.params;
    const targetBaseUrl = SERVICE_MAP[service];

    if (!targetBaseUrl) {
        return res.status(404).json({
            status: 'error',
            message: `Service "${service}" tidak terdaftar di gateway`,
            available_services: Object.keys(SERVICE_MAP)
        });
    }

    // Ambil path setelah /integrator/{service}/
    // Express v5: named wildcard param
    const forwardPath = Array.isArray(req.params.path) ? req.params.path.join('/') : (req.params.path || '');

    // === Hitung Fee Gateway: 0.5% dari amount (Doc6 Aturan 10) ===
    const transactionAmount = parseFloat(req.body?.amount) || 0;
    const gatewayFee = Math.round(transactionAmount * (GATEWAY_FEE_PERCENT / 100));
    let feeStatus = 'tidak_ada_amount';

    try {
        // Potong fee ke SmartBank jika ada amount (Doc4 Aturan 3 & 9)
        if (transactionAmount > 0 && gatewayFee > 0) {
            try {
                await axios.post(`${SERVICE_MAP.smartbank}/smartbank/pembayaran_transaksi`, {
                    user_id: req.body?.user_id || req.user?.user_id,
                    amount: gatewayFee,
                    parameter: "Biaya Layanan Integrasi (Gateway Fee 0.5%)",
                    source: "integrator",
                    original_amount: transactionAmount
                });
                feeStatus = 'terpotong';
            } catch (feeError) {
                feeStatus = 'gagal_potong';
                console.log(`[FEE] Gagal potong fee Rp ${gatewayFee} — SmartBank offline/error`);
            }
        }

        // Update log entry dengan fee info (MySQL)
        if (req.logId) {
            await pool.query(
                `UPDATE request_logs SET fee_terpotong = ?, fee_status = ?, service_tujuan = ?, status = 'FORWARDED' WHERE id = ?`,
                [feeStatus === 'terpotong' ? gatewayFee : 0, feeStatus, service, req.logId]
            );
        }

        // === Forward Request ke service tujuan (Doc4 Aturan 5) ===
        const response = await axios({
            method: req.method,
            url: `${targetBaseUrl}/${forwardPath}`,
            data: req.body,
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Authorization': req.headers['authorization'] || ''
            },
            timeout: 10000
        });

        // Update status di log (MySQL)
        if (req.logId) {
            await pool.query(
                'UPDATE request_logs SET status = ?, response_status = ? WHERE id = ?',
                ['SUCCESS', response.status, req.logId]
            );
        }

        res.json({
            status: 'success',
            integrator_info: {
                service_tujuan: service,
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                transaction_amount: transactionAmount,
                fee_terpotong: gatewayFee,
                fee_status: feeStatus,
                forwarded_to: `${targetBaseUrl}/${forwardPath}`
            },
            data: response.data
        });

    } catch (error) {
        // Update status di log (MySQL)
        if (req.logId) {
            await pool.query(
                'UPDATE request_logs SET status = ?, response_status = ? WHERE id = ?',
                ['ERROR', error.response?.status || 500, req.logId]
            );
        }

        res.status(error.response?.status || 502).json({
            status: 'error',
            message: `Gagal meneruskan request ke ${service}`,
            integrator_info: {
                service_tujuan: service,
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                fee_terpotong: gatewayFee,
                fee_status: feeStatus
            },
            error_detail: error.message
        });
    }
});

// Fallback untuk /:service tanpa sub-path
router.all('/:service', async (req, res) => {
    const { service } = req.params;
    const targetBaseUrl = SERVICE_MAP[service];

    if (!targetBaseUrl) {
        return res.status(404).json({
            status: 'error',
            message: `Service "${service}" tidak terdaftar di gateway`,
            available_services: Object.keys(SERVICE_MAP)
        });
    }

    const transactionAmount = parseFloat(req.body?.amount) || 0;
    const gatewayFee = Math.round(transactionAmount * (GATEWAY_FEE_PERCENT / 100));
    let feeStatus = 'tidak_ada_amount';

    try {
        if (transactionAmount > 0 && gatewayFee > 0) {
            try {
                await axios.post(`${SERVICE_MAP.smartbank}/smartbank/pembayaran_transaksi`, {
                    user_id: req.body?.user_id || req.user?.user_id,
                    amount: gatewayFee,
                    parameter: "Biaya Layanan Integrasi (Gateway Fee 0.5%)",
                    source: "integrator",
                    original_amount: transactionAmount
                });
                feeStatus = 'terpotong';
            } catch (feeError) {
                feeStatus = 'gagal_potong';
                console.log(`[FEE] Gagal potong fee Rp ${gatewayFee} — SmartBank offline/error`);
            }
        }

        // Update log (MySQL)
        if (req.logId) {
            await pool.query(
                `UPDATE request_logs SET fee_terpotong = ?, fee_status = ?, service_tujuan = ?, status = 'FORWARDED' WHERE id = ?`,
                [feeStatus === 'terpotong' ? gatewayFee : 0, feeStatus, service, req.logId]
            );
        }

        const response = await axios({
            method: req.method,
            url: targetBaseUrl,
            data: req.body,
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Authorization': req.headers['authorization'] || ''
            },
            timeout: 10000
        });

        if (req.logId) {
            await pool.query(
                'UPDATE request_logs SET status = ?, response_status = ? WHERE id = ?',
                ['SUCCESS', response.status, req.logId]
            );
        }

        res.json({
            status: 'success',
            integrator_info: {
                service_tujuan: service,
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                transaction_amount: transactionAmount,
                fee_terpotong: gatewayFee,
                fee_status: feeStatus,
                forwarded_to: targetBaseUrl
            },
            data: response.data
        });

    } catch (error) {
        if (req.logId) {
            await pool.query(
                'UPDATE request_logs SET status = ?, response_status = ? WHERE id = ?',
                ['ERROR', error.response?.status || 500, req.logId]
            );
        }

        res.status(error.response?.status || 502).json({
            status: 'error',
            message: `Gagal meneruskan request ke ${service}`,
            integrator_info: {
                service_tujuan: service,
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                fee_terpotong: gatewayFee,
                fee_status: feeStatus
            },
            error_detail: error.message
        });
    }
});

module.exports = router;