require('dotenv').config();

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { pool, initDatabase } = require('./config/database');
const loggerMiddleware = require('./middleware/logger');
const {
    validateApiToken,
    verifyPassword,
    createPasswordHash,
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

// ============================================================
//  PUBLIC ROUTES
// ============================================================

app.get('/', (req, res) => res.render('index'));

app.get('/login', (req, res) => res.render('login', { error: null }));

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

app.get('/register', (req, res) => res.render('register', { error: null, success: null }));

app.post('/register', loginLimiter, async (req, res) => {
    const { username, password, confirm_password } = req.body;
    if (!username || !password) {
        return res.render('register', { error: 'Username dan password wajib diisi.', success: null });
    }
    if (username.length < 3) {
        return res.render('register', { error: 'Username minimal 3 karakter.', success: null });
    }
    if (password.length < 6) {
        return res.render('register', { error: 'Password minimal 6 karakter.', success: null });
    }
    if (password !== confirm_password) {
        return res.render('register', { error: 'Konfirmasi password tidak cocok.', success: null });
    }
    try {
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            return res.render('register', { error: `Username "${username}" sudah digunakan.`, success: null });
        }
        const hash = createPasswordHash(password);
        await pool.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, 'user']);
        return res.render('register', { error: null, success: 'Akun berhasil dibuat! Silakan login.' });
    } catch (err) {
        console.error('[REGISTER] Error:', err.message);
        return res.render('register', { error: 'Registrasi gagal karena masalah server.', success: null });
    }
});

// ============================================================
//  DASHBOARD — Multi-section routes
// ============================================================

const dashboardAuth = [requireAuth, requireRole(['admin', 'operator'])];
const adminOnly = [requireAuth, requireRole(['admin'])];

// Helper: base data passed to every dashboard render
async function dashboardBase(req) {
    const [services] = await pool.query('SELECT * FROM api_services ORDER BY nama_service ASC');
    return {
        currentUser: req.sessionUser,
        canViewRevenue: req.sessionUser.role === 'admin',
        isAdmin: req.sessionUser.role === 'admin',
        serviceCount: services.length
    };
}

// 1. Overview
app.get('/dashboard', ...dashboardAuth, async (req, res) => {
    try {
        const [base, [reqCount], [successCount], [errorCount], [revenueSum],
               [services], [recentLogs], [consumers], [chartRows]] = await Promise.all([
            dashboardBase(req),
            pool.query('SELECT COUNT(*) AS total FROM request_logs'),
            pool.query("SELECT COUNT(*) AS total FROM request_logs WHERE status = 'SUCCESS'"),
            pool.query("SELECT COUNT(*) AS total FROM request_logs WHERE status = 'ERROR'"),
            pool.query('SELECT COALESCE(SUM(nominal_fee), 0) AS total FROM revenue_logs'),
            pool.query('SELECT * FROM api_services ORDER BY nama_service ASC'),
            pool.query('SELECT * FROM request_logs ORDER BY id DESC LIMIT 5'),
            pool.query('SELECT COUNT(DISTINCT user_id) AS total FROM request_logs WHERE user_id IS NOT NULL'),
            pool.query(`
                SELECT DATE_FORMAT(timestamp, '%m/%d') AS label, COUNT(*) AS total
                FROM request_logs
                WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(timestamp), DATE_FORMAT(timestamp, '%m/%d')
                ORDER BY DATE(timestamp) ASC
            `)
        ]);
        const totalReq = reqCount[0].total;
        const totalSuccess = successCount[0].total;
        res.render('dashboard', {
            ...base, section: 'overview',
            totalRequests: totalReq,
            totalSuccess,
            totalError: errorCount[0].total,
            successRate: totalReq > 0 ? ((totalSuccess / totalReq) * 100).toFixed(1) : '0.0',
            totalRevenue: parseFloat(revenueSum[0].total),
            totalConsumers: consumers[0].total,
            services,
            recentLogs,
            chartLabels: chartRows.map(r => r.label),
            chartData: chartRows.map(r => Number(r.total)),
            uptime: Math.floor(process.uptime())
        });
    } catch (err) {
        console.error('[DASHBOARD] Error:', err.message);
        const base = await dashboardBase(req);
        res.render('dashboard', {
            ...base, section: 'overview',
            totalRequests: 0, totalSuccess: 0, totalError: 0, successRate: '0.0',
            totalRevenue: 0, totalConsumers: 0, services: [], recentLogs: [],
            chartLabels: [], chartData: [], uptime: 0
        });
    }
});

// 2. Services
app.get('/dashboard/services', ...dashboardAuth, async (req, res) => {
    try {
        const [base, [services], [serviceStats]] = await Promise.all([
            dashboardBase(req),
            pool.query('SELECT * FROM api_services ORDER BY nama_service ASC'),
            pool.query(`
                SELECT s.id, s.nama_service, COUNT(r.id) AS total_requests,
                       MAX(r.timestamp) AS last_activity
                FROM api_services s
                LEFT JOIN request_logs r ON r.service_tujuan = s.nama_service
                GROUP BY s.id, s.nama_service
            `)
        ]);
        const statsMap = {};
        serviceStats.forEach(s => { statsMap[s.id] = s; });
        res.render('dashboard', { ...base, section: 'services', services, statsMap });
    } catch (err) {
        console.error('[SERVICES]', err.message);
        const base = await dashboardBase(req);
        res.render('dashboard', { ...base, section: 'services', services: [], statsMap: {} });
    }
});

// 3. Routes
app.get('/dashboard/routes', ...dashboardAuth, async (req, res) => {
    const [base, [services]] = await Promise.all([
        dashboardBase(req),
        pool.query('SELECT * FROM api_services ORDER BY nama_service ASC')
    ]);
    res.render('dashboard', { ...base, section: 'routes', services });
});

// 4. Consumers
app.get('/dashboard/consumers', ...dashboardAuth, async (req, res) => {
    try {
        const [base, [consumers]] = await Promise.all([
            dashboardBase(req),
            pool.query(`
                SELECT user_id, COUNT(*) AS total_requests,
                       MAX(timestamp) AS last_seen,
                       MIN(timestamp) AS first_seen
                FROM request_logs
                WHERE user_id IS NOT NULL AND user_id != ''
                GROUP BY user_id
                ORDER BY total_requests DESC
            `)
        ]);
        res.render('dashboard', { ...base, section: 'consumers', consumers });
    } catch (err) {
        console.error('[CONSUMERS]', err.message);
        const base = await dashboardBase(req);
        res.render('dashboard', { ...base, section: 'consumers', consumers: [] });
    }
});

// 5. Plugins
app.get('/dashboard/plugins', ...dashboardAuth, async (req, res) => {
    const base = await dashboardBase(req);
    const plugins = [
        { name: 'JWT Authentication', icon: 'shield-check', desc: 'Validasi token Bearer JWT pada setiap request API. Token berlaku 24 jam.', status: true, config: { algorithm: 'HS256', expiry: '24h', header: 'Authorization' } },
        { name: 'Rate Limiting', icon: 'gauge', desc: 'Batasi jumlah request per menit untuk mencegah abuse.', status: true, config: { login: '10 req/min', api: '60 req/min', window: '60 detik' } },
        { name: 'Request Logger', icon: 'clipboard-list', desc: 'Catat semua traffic gateway ke database MySQL untuk audit trail.', status: true, config: { storage: 'MySQL', table: 'request_logs', fields: 'ip, method, url, user_id, status' } },
        { name: 'Helmet Security', icon: 'hard-hat', desc: 'HTTP security headers otomatis: X-Frame-Options, X-Content-Type, dll.', status: true, config: { CSP: 'disabled', COEP: 'disabled', XFrame: 'SAMEORIGIN' } }
    ];
    res.render('dashboard', { ...base, section: 'plugins', plugins });
});

// 6. Analytics
app.get('/dashboard/analytics', ...dashboardAuth, async (req, res) => {
    try {
        const [base, [serviceChart], [timelineChart], [errorRate], [topConsumers]] = await Promise.all([
            dashboardBase(req),
            pool.query(`
                SELECT s.nama_service AS label, COUNT(r.id) AS total
                FROM api_services s
                LEFT JOIN request_logs r ON r.service_tujuan = s.nama_service
                GROUP BY s.nama_service ORDER BY total DESC
            `),
            pool.query(`
                SELECT DATE_FORMAT(timestamp, '%m/%d') AS label, COUNT(*) AS total
                FROM request_logs
                WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 14 DAY)
                GROUP BY DATE(timestamp), DATE_FORMAT(timestamp, '%m/%d')
                ORDER BY DATE(timestamp) ASC
            `),
            pool.query(`
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) AS errors
                FROM request_logs
            `),
            pool.query(`
                SELECT user_id, COUNT(*) AS total
                FROM request_logs WHERE user_id IS NOT NULL AND user_id != ''
                GROUP BY user_id ORDER BY total DESC LIMIT 5
            `)
        ]);
        const totalReqs = errorRate[0].total || 0;
        const totalErrors = errorRate[0].errors || 0;
        res.render('dashboard', {
            ...base, section: 'analytics',
            serviceChart: { labels: serviceChart.map(r => r.label), data: serviceChart.map(r => Number(r.total)) },
            timelineChart: { labels: timelineChart.map(r => r.label), data: timelineChart.map(r => Number(r.total)) },
            errorRatePercent: totalReqs > 0 ? ((totalErrors / totalReqs) * 100).toFixed(1) : '0.0',
            totalRequests: totalReqs,
            topConsumers
        });
    } catch (err) {
        console.error('[ANALYTICS]', err.message);
        const base = await dashboardBase(req);
        res.render('dashboard', {
            ...base, section: 'analytics',
            serviceChart: { labels: [], data: [] }, timelineChart: { labels: [], data: [] },
            errorRatePercent: '0.0', totalRequests: 0, topConsumers: []
        });
    }
});

// 7. Request Logs
app.get('/dashboard/logs', ...dashboardAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = 20;
        const offset = (page - 1) * perPage;
        const filterService = req.query.service || '';
        const filterStatus = req.query.status || '';
        const filterSearch = req.query.search || '';

        let where = '1=1';
        const params = [];
        if (filterService) { where += ' AND service_tujuan = ?'; params.push(filterService); }
        if (filterStatus) { where += ' AND status = ?'; params.push(filterStatus); }
        if (filterSearch) { where += ' AND (user_id LIKE ? OR url_tujuan LIKE ?)'; params.push(`%${filterSearch}%`, `%${filterSearch}%`); }

        const [base, [countResult], [logs], [services]] = await Promise.all([
            dashboardBase(req),
            pool.query(`SELECT COUNT(*) AS total FROM request_logs WHERE ${where}`, params),
            pool.query(`SELECT * FROM request_logs WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, perPage, offset]),
            pool.query('SELECT DISTINCT nama_service FROM api_services ORDER BY nama_service ASC')
        ]);
        const totalLogs = countResult[0].total;
        res.render('dashboard', {
            ...base, section: 'logs', logs,
            totalLogs, page, perPage,
            totalPages: Math.ceil(totalLogs / perPage),
            filterService, filterStatus, filterSearch,
            serviceNames: services.map(s => s.nama_service)
        });
    } catch (err) {
        console.error('[LOGS]', err.message);
        const base = await dashboardBase(req);
        res.render('dashboard', {
            ...base, section: 'logs', logs: [],
            totalLogs: 0, page: 1, perPage: 20, totalPages: 0,
            filterService: '', filterStatus: '', filterSearch: '', serviceNames: []
        });
    }
});

// 8. Users (admin only)
app.get('/dashboard/users', ...adminOnly, async (req, res) => {
    try {
        const [base, [users]] = await Promise.all([
            dashboardBase(req),
            pool.query('SELECT id, username, role, created_at FROM users ORDER BY id ASC')
        ]);
        res.render('dashboard', { ...base, section: 'users', users });
    } catch (err) {
        console.error('[USERS]', err.message);
        const base = await dashboardBase(req);
        res.render('dashboard', { ...base, section: 'users', users: [] });
    }
});

// 9. Revenue (admin only)
app.get('/dashboard/revenue', ...adminOnly, async (req, res) => {
    try {
        const [base, [revenueTotal], [revenueChart], [revenueByService]] = await Promise.all([
            dashboardBase(req),
            pool.query('SELECT COALESCE(SUM(nominal_fee), 0) AS total FROM revenue_logs'),
            pool.query(`
                SELECT DATE_FORMAT(waktu, '%Y-%m-%d') AS label, SUM(nominal_fee) AS total
                FROM revenue_logs GROUP BY DATE(waktu), DATE_FORMAT(waktu, '%Y-%m-%d')
                ORDER BY DATE(waktu) ASC LIMIT 14
            `),
            pool.query(`
                SELECT r.service_tujuan AS service, COALESCE(SUM(rv.nominal_fee), 0) AS total_fee, COUNT(rv.id) AS transactions
                FROM revenue_logs rv
                JOIN request_logs r ON rv.request_id = r.id
                GROUP BY r.service_tujuan ORDER BY total_fee DESC
            `)
        ]);
        res.render('dashboard', {
            ...base, section: 'revenue',
            totalRevenue: parseFloat(revenueTotal[0].total),
            revenueChart: { labels: revenueChart.map(r => r.label), data: revenueChart.map(r => Number(r.total)) },
            revenueByService
        });
    } catch (err) {
        console.error('[REVENUE]', err.message);
        const base = await dashboardBase(req);
        res.render('dashboard', {
            ...base, section: 'revenue',
            totalRevenue: 0, revenueChart: { labels: [], data: [] }, revenueByService: []
        });
    }
});

// ============================================================
//  CLIENT PORTAL & TOOLS
// ============================================================

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
    res.json({ status: 'success', message: 'Token berhasil dibuat (berlaku 24 jam)', token, payload });
});

// ============================================================
//  API — Status & Info (public / auth)
// ============================================================

app.get('/api/status', async (req, res) => {
    try {
        const [countResult] = await pool.query('SELECT COUNT(*) AS total FROM request_logs');
        const [services] = await pool.query('SELECT nama_service, status_aktif FROM api_services ORDER BY nama_service ASC');
        res.json({
            status: 'online', application: 'API Gateway / Integrator', kelompok: 7, version: '3.0.0',
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

app.get('/api/logs', ...dashboardAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 50;
        const [rows] = await pool.query('SELECT * FROM request_logs ORDER BY id DESC LIMIT ?', [limit]);
        const [countResult] = await pool.query('SELECT COUNT(*) AS total FROM request_logs');
        res.json({ status: 'success', total: countResult[0].total, data: rows });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca log' });
    }
});

// ============================================================
//  CRUD API — Services (admin only, kecuali GET)
// ============================================================

app.get('/api/services', ...dashboardAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM api_services ORDER BY nama_service ASC');
        res.json({ status: 'success', data: rows });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca service' });
    }
});

app.post('/api/services', ...adminOnly, async (req, res) => {
    const { nama_service, url_tujuan, status_aktif } = req.body;
    if (!nama_service || !url_tujuan) {
        return res.status(400).json({ status: 'error', message: 'nama_service dan url_tujuan wajib diisi' });
    }
    try {
        const [existing] = await pool.query('SELECT id FROM api_services WHERE nama_service = ?', [nama_service]);
        if (existing.length > 0) {
            return res.status(409).json({ status: 'error', message: `Service "${nama_service}" sudah terdaftar` });
        }
        const [result] = await pool.query(
            'INSERT INTO api_services (nama_service, url_tujuan, status_aktif) VALUES (?, ?, ?)',
            [nama_service.toLowerCase().replace(/\s+/g, '_'), url_tujuan, status_aktif !== undefined ? status_aktif : 1]
        );
        res.json({ status: 'success', message: 'Service berhasil ditambahkan', id: result.insertId });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal menambah service', detail: err.message });
    }
});

app.put('/api/services/:id', ...adminOnly, async (req, res) => {
    const { id } = req.params;
    const { nama_service, url_tujuan, status_aktif } = req.body;
    try {
        const fields = [];
        const values = [];
        if (nama_service !== undefined) { fields.push('nama_service = ?'); values.push(nama_service.toLowerCase().replace(/\s+/g, '_')); }
        if (url_tujuan !== undefined) { fields.push('url_tujuan = ?'); values.push(url_tujuan); }
        if (status_aktif !== undefined) { fields.push('status_aktif = ?'); values.push(status_aktif ? 1 : 0); }
        if (fields.length === 0) return res.status(400).json({ status: 'error', message: 'Tidak ada field yang diubah' });
        values.push(id);
        await pool.query(`UPDATE api_services SET ${fields.join(', ')} WHERE id = ?`, values);
        res.json({ status: 'success', message: 'Service berhasil diupdate' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal update service' });
    }
});

app.delete('/api/services/:id', ...adminOnly, async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM api_services WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Service tidak ditemukan' });
        res.json({ status: 'success', message: 'Service berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal menghapus service' });
    }
});

// ============================================================
//  CRUD API — Users (admin only)
// ============================================================

app.get('/api/users', ...adminOnly, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY id ASC');
        res.json({ status: 'success', data: rows });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membaca users' });
    }
});

app.post('/api/users', ...adminOnly, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ status: 'error', message: 'Username dan password wajib diisi' });
    if (!['admin', 'operator', 'user'].includes(role)) return res.status(400).json({ status: 'error', message: 'Role harus admin, operator, atau user' });
    try {
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) return res.status(409).json({ status: 'error', message: `Username "${username}" sudah digunakan` });
        const hash = createPasswordHash(password);
        const [result] = await pool.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role]);
        res.json({ status: 'success', message: 'User berhasil dibuat', id: result.insertId });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal membuat user' });
    }
});

app.put('/api/users/:id', ...adminOnly, async (req, res) => {
    const { id } = req.params;
    const { role, password } = req.body;
    try {
        const fields = [];
        const values = [];
        if (role && ['admin', 'operator', 'user'].includes(role)) { fields.push('role = ?'); values.push(role); }
        if (password) { fields.push('password_hash = ?'); values.push(createPasswordHash(password)); }
        if (fields.length === 0) return res.status(400).json({ status: 'error', message: 'Tidak ada field yang diubah' });
        values.push(id);
        await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
        res.json({ status: 'success', message: 'User berhasil diupdate' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal update user' });
    }
});

app.delete('/api/users/:id', ...adminOnly, async (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === req.sessionUser.id) {
        return res.status(400).json({ status: 'error', message: 'Tidak bisa menghapus akun sendiri' });
    }
    try {
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'User tidak ditemukan' });
        res.json({ status: 'success', message: 'User berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal menghapus user' });
    }
});

// ============================================================
//  DEMO SIMULATE
// ============================================================

app.post('/api/demo/simulate', requireAuth, requireRole(['admin', 'operator', 'user']), async (req, res) => {
    const token = (req.headers.authorization || '').split(' ')[1];
    let user = { user_id: String(req.sessionUser.id), name: req.sessionUser.username };
    try { if (token) user = jwt.verify(token, process.env.JWT_SECRET); } catch (e) {
        user = { user_id: String(req.sessionUser.id), name: req.sessionUser.username };
    }
    const service = req.body.service || 'smartbank';
    const endpoint = req.body.endpoint || 'pembayaran_transaksi';
    const amount = req.body.amount !== undefined && !Number.isNaN(parseFloat(req.body.amount)) ? parseFloat(req.body.amount) : 50000;
    const feePercent = parseFloat(process.env.GATEWAY_FEE_PERCENT) || 0.5;
    const gatewayFee = Math.round(amount * (feePercent / 100));
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
            [new Date().toLocaleString('id-ID'), new Date(), req.ip || '::1', 'POST',
             `/integrator/${service}/${endpoint}`, user.user_id || user.npm || user.username || 'demo',
             service, 'SUCCESS', 200, 'DEMO']
        );
        if (amount > 0 && gatewayFee > 0) {
            await pool.query('INSERT INTO revenue_logs (request_id, nominal_fee, waktu) VALUES (?, ?, ?)',
                [result.insertId, gatewayFee, new Date()]);
        }
        res.json({
            status: 'success', mode: 'DEMO_SIMULASI',
            message: `Simulasi request ke ${service}/${endpoint} berhasil`,
            integrator_info: {
                service_tujuan: service, endpoint,
                fee_percent: `${feePercent}%`, transaction_amount: amount,
                fee_terpotong: gatewayFee,
                fee_status: amount > 0 ? 'tercatat' : 'tidak_ada_amount',
                forwarded_to: `http://localhost:300X/${service}/${endpoint}`
            },
            data: serviceResponses[service] || serviceResponses.smartbank
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal simpan log simulasi', detail: err.message });
    }
});

// ============================================================
//  GATEWAY PROXY
// ============================================================

app.use('/integrator', apiLimiter, loggerMiddleware, validateApiToken, gatewayRoutes);

// ============================================================
//  START SERVER
// ============================================================

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
