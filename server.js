require('dotenv').config();

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { pool, initDatabase } = require('./config/database');
const loggerMiddleware = require('./middleware/logger');
const {
    validateApiToken,
    verifyPassword,
    issueSessionToken,
    setSessionCookie,
    clearSessionCookie,
    requireAuth,
    requireRole
} = require('./middleware/auth');
const gatewayRoutes = require('./routes/gateway');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// Security headers
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// Rate limiting
const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { status: 'error', message: 'Terlalu banyak percobaan login. Coba lagi setelah 1 menit.' },
    standardHeaders: true,
    legacyHeaders: false
});
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { status: 'error', message: 'Terlalu banyak request. Coba lagi setelah 1 menit.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    try {
        const [rows] = await pool.query(
            'SELECT id, username, password_hash, role FROM users WHERE username = ? LIMIT 1',
            [username]
        );
        const user = rows[0];

        if (!user || !verifyPassword(password, user.password_hash)) {
            return res.status(401).render('login', { error: 'Username atau password salah.' });
        }

        const token = issueSessionToken(user);
        setSessionCookie(res, token);

        return res.redirect(user.role === 'user' ? '/client-portal' : '/dashboard');
    } catch (err) {
        console.error('[LOGIN] Error:', err.message);
        return res.status(500).render('login', { error: 'Login gagal karena masalah server.' });
    }
});

app.post('/logout', (req, res) => {
    clearSessionCookie(res);
    res.redirect('/login');
});

app.get('/dashboard', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
    const canViewRevenue = req.sessionUser.role === 'admin';

    try {
        // Paralelisasi query untuk performa optimal
        const [
            [logs],
            [requestCount],
            [revenueResult],
            [successResult],
            [errorResult],
            [services],
            [requestChartRows],
            [revenueChartRows]
        ] = await Promise.all([
            pool.query('SELECT * FROM request_logs ORDER BY id DESC LIMIT 100'),
            pool.query('SELECT COUNT(*) AS total FROM request_logs'),
            pool.query('SELECT COALESCE(SUM(nominal_fee), 0) AS total FROM revenue_logs'),
            pool.query("SELECT COUNT(*) AS total FROM request_logs WHERE status = 'SUCCESS'"),
            pool.query("SELECT COUNT(*) AS total FROM request_logs WHERE status = 'ERROR'"),
            pool.query('SELECT * FROM api_services ORDER BY nama_service ASC'),
            pool.query(`
                SELECT s.nama_service AS label, COUNT(r.id) AS total
                FROM api_services s
                LEFT JOIN request_logs r ON r.service_tujuan = s.nama_service
                GROUP BY s.nama_service
                ORDER BY total DESC
            `),
            pool.query(`
                SELECT DATE_FORMAT(waktu, '%Y-%m-%d') AS label, SUM(nominal_fee) AS total
                FROM revenue_logs
                GROUP BY DATE(waktu), DATE_FORMAT(waktu, '%Y-%m-%d')
                ORDER BY DATE(waktu) ASC
                LIMIT 14
            `)
        ]);

        res.render('dashboard', {
            logs,
            services,
            totalRevenue: parseFloat(revenueResult[0].total),
            totalRequests: requestCount[0].total,
            totalSuccess: successResult[0].total,
            totalError: errorResult[0].total,
            requestChart: {
                labels: requestChartRows.map(row => row.label),
                data: requestChartRows.map(row => Number(row.total))
            },
            revenueChart: {
                labels: revenueChartRows.map(row => row.label),
                data: revenueChartRows.map(row => Number(row.total))
            },
            canViewRevenue
        });
    } catch (err) {
        console.error('[DASHBOARD] Error:', err.message);
        res.render('dashboard', {
            logs: [],
            services: [],
            totalRevenue: 0,
            totalRequests: 0,
            totalSuccess: 0,
            totalError: 0,
            requestChart: { labels: [], data: [] },
            revenueChart: { labels: [], data: [] },
            canViewRevenue
        });
    }
});

app.get('/client-portal', requireAuth, requireRole(['admin', 'operator', 'user']), (req, res) => {
    res.render('client_portal');
});

app.get('/download-docs', (req, res) => {
    const file = path.join(__dirname, 'public', 'Panduan_Integrasi_API_Update.pdf');
    res.download(file, (err) => {
        if (err) {
            console.error('File dokumentasi tidak ditemukan!');
            res.status(404).send('File dokumentasi sedang disiapkan.');
        }
    });
});

app.post('/generate-test-token', requireAuth, requireRole(['admin', 'operator', 'user']), (req, res) => {
    const payload = {
        user_id: req.body.user_id || String(req.sessionUser.id),
        name: req.body.name || req.sessionUser.username,
        npm: req.body.npm || req.body.user_id || String(req.sessionUser.id),
        role: req.sessionUser.role,
        generated_at: new Date().toISOString()
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({
        status: 'success',
        message: 'Token berhasil dibuat (berlaku 24 jam)',
        token,
        payload
    });
});

// GET /generate-test-token dihapus — token hanya boleh dibuat via POST

app.get('/api/status', async (req, res) => {
    try {
        const [countResult] = await pool.query('SELECT COUNT(*) AS total FROM request_logs');
        const [services] = await pool.query('SELECT nama_service, status_aktif FROM api_services ORDER BY nama_service ASC');

        res.json({
            status: 'online',
            application: 'API Gateway / Integrator',
            kelompok: 7,
            version: '3.0.0',
            uptime: Math.floor(process.uptime()) + 's',
            total_requests: countResult[0].total,
            registered_services: services.length,
            active_services: services.filter(s => s.status_aktif).length,
            fee_gateway: `${process.env.GATEWAY_FEE_PERCENT || 0.5}%`,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal query database' });
    }
});

app.get('/api/logs', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 50;
        const [rows] = await pool.query('SELECT * FROM request_logs ORDER BY id DESC LIMIT ?', [limit]);
        const [countResult] = await pool.query('SELECT COUNT(*) AS total FROM request_logs');

        res.json({
            status: 'success',
            total: countResult[0].total,
            data: rows
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca log', detail: err.message });
    }
});

app.get('/api/services', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM api_services ORDER BY nama_service ASC');
        res.json({ status: 'success', data: rows });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca service', detail: err.message });
    }
});

app.post('/api/demo/simulate', requireAuth, requireRole(['admin', 'operator', 'user']), async (req, res) => {
    const token = (req.headers.authorization || '').split(' ')[1];
    let user = { user_id: String(req.sessionUser.id), name: req.sessionUser.username };

    try {
        if (token) user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        user = { user_id: String(req.sessionUser.id), name: req.sessionUser.username };
    }

    const service = req.body.service || 'smartbank';
    const endpoint = req.body.endpoint || 'pembayaran_transaksi';
    const amount = req.body.amount !== undefined && !Number.isNaN(parseFloat(req.body.amount)) ? parseFloat(req.body.amount) : 50000;
    const feePercent = parseFloat(process.env.GATEWAY_FEE_PERCENT) || 0.5;
    const gatewayFee = Math.round(amount * (feePercent / 100));
    const feeStatus = amount > 0 ? 'tercatat' : 'tidak_ada_amount';

    const serviceResponses = {
        smartbank: { transaction_id: `TXN-${Date.now()}`, saldo_sebelum: 500000, saldo_sesudah: 500000 - amount, status_pembayaran: 'berhasil' },
        marketplace: { order_id: `ORD-${Date.now()}`, items: [{ nama: 'Produk UMKM', qty: 1, harga: amount }], status_order: 'diproses' },
        pos: { invoice_id: `INV-${Date.now()}`, kasir: 'Kasir-01', total: amount, metode: 'digital' },
        supplierhub: { po_id: `PO-${Date.now()}`, bahan: 'Bahan Baku A', qty_kg: 10, total: amount },
        logistikita: { shipping_id: `SHP-${Date.now()}`, asal: 'Bandung', tujuan: 'Jakarta', ongkir: amount, estimasi: '2-3 hari' },
        umkm_insight: { report_id: `RPT-${Date.now()}`, total_transaksi: 150, omzet_bulan: 7500000, profit_margin: '23%' }
    };

    try {
        const [result] = await pool.query(
            `INSERT INTO request_logs (waktu, timestamp, ip, metode, url_tujuan, user_id, service_tujuan, status, response_status, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                new Date().toLocaleString('id-ID'),
                new Date(),
                req.ip || '::1',
                'POST',
                `/integrator/${service}/${endpoint}`,
                user.user_id || user.npm || user.username || 'demo',
                service,
                'SUCCESS',
                200,
                'DEMO'
            ]
        );

        if (amount > 0 && gatewayFee > 0) {
            await pool.query(
                `INSERT INTO revenue_logs (request_id, nominal_fee, waktu)
                 VALUES (?, ?, ?)`,
                [result.insertId, gatewayFee, new Date()]
            );
        }

        res.json({
            status: 'success',
            mode: 'DEMO_SIMULASI',
            message: `Simulasi request ke ${service}/${endpoint} berhasil`,
            integrator_info: {
                service_tujuan: service,
                endpoint,
                fee_percent: `${feePercent}%`,
                transaction_amount: amount,
                fee_terpotong: gatewayFee,
                fee_status: feeStatus,
                forwarded_to: `http://localhost:300X/${service}/${endpoint}`
            },
            data: serviceResponses[service] || serviceResponses.smartbank
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal simpan log simulasi', detail: err.message });
    }
});

app.use('/integrator', apiLimiter, loggerMiddleware, validateApiToken, gatewayRoutes);

const PORT = process.env.PORT || 3000;

async function startServer() {
    await initDatabase();

    app.listen(PORT, () => {
        console.log('=================================================');
        console.log('   API GATEWAY / INTEGRATOR - Kelompok 7        ');
        console.log('=================================================');
        console.log(`   Landing Page : http://localhost:${PORT}`);
        console.log(`   Login        : http://localhost:${PORT}/login`);
        console.log(`   Dashboard    : http://localhost:${PORT}/dashboard`);
        console.log(`   Client Portal: http://localhost:${PORT}/client-portal`);
        console.log(`   API Status   : http://localhost:${PORT}/api/status`);
        console.log('=================================================');
    });
}

startServer().catch(err => {
    console.error('Gagal menjalankan server:', err.message);
    process.exit(1);
});
