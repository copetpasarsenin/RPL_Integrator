const express = require('express');
const router = express.Router();
const axios = require('axios');
const { pool } = require('../config/database');

const GATEWAY_FEE_PERCENT = parseFloat(process.env.GATEWAY_FEE_PERCENT) || 0.5;

function joinUrl(baseUrl, path = '') {
    const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
    const cleanPath = String(path || '').replace(/^\/+/, '');
    return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}

async function getActiveServices() {
    const [rows] = await pool.query(
        `SELECT id, nama_service, url_tujuan, health_path, status_aktif
         FROM api_services
         WHERE status_aktif = 1
         ORDER BY nama_service ASC`
    );

    return rows;
}

async function getActiveServiceByName(serviceName) {
    const [rows] = await pool.query(
        `SELECT id, nama_service, url_tujuan, health_path, status_aktif
         FROM api_services
         WHERE nama_service = ? AND status_aktif = 1
         LIMIT 1`,
        [serviceName]
    );

    return rows[0] || null;
}

async function updateRequestLog(logId, fields) {
    if (!logId) return;

    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;

    const setSql = entries.map(([key]) => `\`${key}\` = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    values.push(logId);

    await pool.query(`UPDATE request_logs SET ${setSql} WHERE id = ?`, values);
}

async function recordRevenue(requestId, nominalFee) {
    if (!requestId || nominalFee <= 0) return;

    await pool.query(
        `INSERT INTO revenue_logs (request_id, nominal_fee, waktu)
         VALUES (?, ?, ?)`,
        [requestId, nominalFee, new Date()]
    );
}

async function tryDebitGatewayFee(req, gatewayFee, transactionAmount) {
    if (transactionAmount <= 0 || gatewayFee <= 0) return 'tidak_ada_amount';

    const smartbank = await getActiveServiceByName('smartbank');
    if (!smartbank) return 'smartbank_tidak_aktif';

    try {
        await axios.post(joinUrl(smartbank.url_tujuan, 'smartbank/pembayaran_transaksi'), {
            user_id: req.body?.user_id || req.user?.user_id,
            amount: gatewayFee,
            parameter: 'Biaya Layanan Integrasi (Gateway Fee 0.5%)',
            source: 'integrator',
            original_amount: transactionAmount
        });

        return 'terpotong';
    } catch (feeError) {
        console.log(`[FEE] Gagal potong fee Rp ${gatewayFee} - SmartBank offline/error`);
        return 'gagal_potong';
    }
}

async function proxyToService(req, res, serviceName, forwardPath = '') {
    const targetService = await getActiveServiceByName(serviceName);

    if (!targetService) {
        const services = await getActiveServices();
        return res.status(404).json({
            status: 'error',
            message: `Service "${serviceName}" tidak terdaftar atau tidak aktif di gateway`,
            available_services: services.map(service => service.nama_service)
        });
    }

    // CIRCUIT BREAKER: Fast fail if health check marks it as Down
    if (global.serviceHealth && global.serviceHealth[serviceName] === 'Down') {
        await updateRequestLog(req.logId, {
            service_tujuan: serviceName,
            status: 'ERROR',
            response_status: 503
        });
        return res.status(503).json({
            status: 'error',
            message: `Service "${serviceName}" sedang mengalami gangguan (Offline). Circuit Breaker aktif, request ditolak.`,
            error_detail: 'Service Unavailable - Health Check Failed'
        });
    }

    const transactionAmount = parseFloat(req.body?.amount) || 0;
    const gatewayFee = Math.round(transactionAmount * (GATEWAY_FEE_PERCENT / 100));
    let feeStatus = 'tidak_ada_amount';

    try {
        feeStatus = await tryDebitGatewayFee(req, gatewayFee, transactionAmount);

        await updateRequestLog(req.logId, {
            service_tujuan: serviceName,
            status: 'FORWARDED'
        });

        const targetUrl = joinUrl(targetService.url_tujuan, forwardPath);
        console.log(`[PROXY] Forwarding ${req.method} to: ${targetUrl}`);
        
        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                Authorization: req.headers.authorization || ''
            },
            timeout: 10000
        });

        await updateRequestLog(req.logId, {
            status: 'SUCCESS',
            response_status: response.status
        });

        const recordedFee = feeStatus === 'terpotong' ? gatewayFee : 0;

        if (recordedFee > 0) {
            await recordRevenue(req.logId, gatewayFee);
        }

        return res.json({
            status: 'success',
            integrator_info: {
                service_tujuan: serviceName,
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                transaction_amount: transactionAmount,
                calculated_fee: gatewayFee,
                fee_terpotong: recordedFee,
                fee_status: feeStatus,
                forwarded_to: targetUrl
            },
            data: response.data
        });
    } catch (error) {
        await updateRequestLog(req.logId, {
            status: 'ERROR',
            response_status: error.response?.status || 500,
            service_tujuan: serviceName
        });

        return res.status(error.response?.status || 502).json({
            status: 'error',
            message: `Gagal meneruskan request ke ${serviceName}`,
            integrator_info: {
                service_tujuan: serviceName,
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                calculated_fee: gatewayFee,
                fee_terpotong: feeStatus === 'terpotong' ? gatewayFee : 0,
                fee_status: feeStatus
            },
            error_detail: error.message,
            target_response: error.response?.data || null
        });
    }
}

router.get('/routing_api', async (req, res) => {
    try {
        const services = await getActiveServices();

        res.json({
            status: 'success',
            message: 'Daftar routing service yang terdaftar di gateway',
            data: {
                total_services: services.length,
                fee_gateway: `${GATEWAY_FEE_PERCENT}%`,
                services: services.map(service => ({
                    service: service.nama_service,
                    url: service.url_tujuan,
                    health_path: service.health_path || '/',
                    status: service.status_aktif ? 'Aktif' : 'Nonaktif'
                }))
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca service', detail: err.message });
    }
});

router.get('/validasi_request', (req, res) => {
    res.json({
        status: 'success',
        message: 'Token JWT tervalidasi',
        data: {
            user: req.user,
            token_valid: true,
            validated_at: new Date().toLocaleString('id-ID')
        }
    });
});

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

router.get('/biaya_layanan_integrasi', async (req, res) => {
    try {
        const [countResult] = await pool.query('SELECT COUNT(*) AS total FROM revenue_logs');
        const [feeResult] = await pool.query('SELECT COALESCE(SUM(nominal_fee), 0) AS total_fee FROM revenue_logs');

        res.json({
            status: 'success',
            message: 'Informasi biaya layanan integrasi',
            data: {
                fee_percent: `${GATEWAY_FEE_PERCENT}%`,
                total_transaksi_berbayar: countResult[0].total,
                total_pendapatan_fee: parseFloat(feeResult[0].total_fee),
                keterangan: `Fee ${GATEWAY_FEE_PERCENT}% dicatat di revenue_logs untuk transaksi sukses dengan amount > 0`
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca data biaya', detail: err.message });
    }
});

router.all('/:service/{*path}', async (req, res) => {
    const { service } = req.params;
    const forwardPath = Array.isArray(req.params.path) ? req.params.path.join('/') : (req.params.path || '');
    return proxyToService(req, res, service, forwardPath);
});

router.all('/:service', async (req, res) => {
    return proxyToService(req, res, req.params.service);
});

module.exports = router;
