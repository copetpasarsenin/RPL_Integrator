/**
 * =============================================================
 * API GATEWAY / INTEGRATOR — Server Utama
 * =============================================================
 * Kelompok 7 — Tugas Besar RPL 2
 * Dosen: M. Yusril Helmi Setyawan, S.Kom., M.Kom.
 * D4 Teknik Informatika — ULBI
 * 
 * Peran: Middleware/Orchestrator yang menjadi pintu masuk 
 *        semua request antar aplikasi dalam ekosistem UMKM.
 * 
 * Fitur Utama (Doc2):
 * 1. Routing API        — Routing request antar 6 service
 * 2. Validasi Request   — Validasi token JWT
 * 3. Logging            — Mencatat seluruh request ke MySQL
 * 4. Biaya Layanan      — Fee 0.5% per transaksi (Doc6)
 * 
 * Database: MySQL (via Laragon)
 * =============================================================
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken'); 
const { pool, initDatabase } = require('./config/database');
const loggerMiddleware = require('./middleware/logger');
const validateRequest = require('./middleware/auth');
const gatewayRoutes = require('./routes/gateway');

const app = express();

// Konfigurasi View Engine EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
// Folder public untuk file statis (PDF, Gambar, CSS)
app.use(express.static('public'));

// --- 1. ROUTE HALAMAN UTAMA (LANDING PAGE) ---
app.get('/', (req, res) => {
    res.render('index');
});

// --- 2. ROUTE ANTARMUKA PENGGUNA LAINNYA ---

// Dashboard Admin — menampilkan log dan revenue sesuai Doc6
app.get('/dashboard', async (req, res) => {
    try {
        const [logs] = await pool.query('SELECT * FROM request_logs ORDER BY id DESC LIMIT 100');
        const [revenueResult] = await pool.query('SELECT COALESCE(SUM(fee_terpotong), 0) AS total FROM request_logs');
        const [successResult] = await pool.query("SELECT COUNT(*) AS total FROM request_logs WHERE status = 'SUCCESS'");
        const [errorResult] = await pool.query("SELECT COUNT(*) AS total FROM request_logs WHERE status = 'ERROR'");

        const totalRevenue = parseFloat(revenueResult[0].total);
        const totalSuccess = successResult[0].total;
        const totalError = errorResult[0].total;

        res.render('dashboard', { 
            logs: logs.reverse(),
            totalRevenue: totalRevenue,
            totalSuccess: totalSuccess,
            totalError: totalError
        });
    } catch (err) {
        console.error('[DASHBOARD] Error:', err.message);
        res.render('dashboard', {
            logs: [],
            totalRevenue: 0,
            totalSuccess: 0,
            totalError: 0
        });
    }
});

// Client Portal (Halaman ambil token & simulator)
app.get('/client-portal', (req, res) => {
    res.render('client_portal');
});

// Rute Download Dokumentasi
app.get('/download-docs', (req, res) => {
    const file = path.join(__dirname, 'public', 'Panduan_Integrasi_API_Update.pdf');
    res.download(file, (err) => {
        if (err) {
            console.error("File dokumentasi tidak ditemukan!");
            res.status(404).send("File dokumentasi sedang disiapkan.");
        }
    });
});

// --- 3. API ENDPOINT GENERATE TOKEN ---
// Token bisa di-generate dengan custom user_id dan name
app.post('/generate-test-token', (req, res) => {
    const payload = { 
        user_id: req.body.user_id || "714240061", 
        name: req.body.name || "Test User",
        npm: req.body.npm || req.body.user_id || "714240061",
        role: req.body.role || "client",
        generated_at: new Date().toISOString()
    };
    
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ 
        status: 'success',
        message: 'Token berhasil dibuat (berlaku 24 jam)',
        token: token,
        payload: payload
    });
});

// Backward compatibility: GET juga bisa
app.get('/generate-test-token', (req, res) => {
    const payload = { 
        user_id: req.query.user_id || "714240061", 
        name: req.query.name || "Test User",
        npm: req.query.npm || req.query.user_id || "714240061",
        role: req.query.role || "client",
        generated_at: new Date().toISOString()
    };
    
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ 
        status: 'success',
        message: 'Token berhasil dibuat (berlaku 24 jam)',
        token: token,
        payload: payload
    });
});

// --- 4. API ENDPOINT STATUS/HEALTH ---
app.get('/api/status', async (req, res) => {
    try {
        const [countResult] = await pool.query('SELECT COUNT(*) AS total FROM request_logs');
        const [revenueResult] = await pool.query('SELECT COALESCE(SUM(fee_terpotong), 0) AS total FROM request_logs');

        res.json({
            status: 'online',
            application: 'API Gateway / Integrator',
            kelompok: 7,
            version: '2.0.0',
            database: 'MySQL (Laragon)',
            uptime: process.uptime(),
            total_requests: countResult[0].total,
            total_revenue: parseFloat(revenueResult[0].total),
            fee_gateway: '0.5%',
            services: ['smartbank', 'marketplace', 'pos', 'supplierhub', 'logistikita', 'umkm_insight'],
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal query database', detail: err.message });
    }
});

// --- 5. API ENDPOINT LOGS (publik, tanpa auth) ---
app.get('/api/logs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
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

// --- 6. DEMO / SIMULASI MODE (untuk presentasi) ---
// Endpoint ini mensimulasikan response sukses lengkap dengan fee,
// tanpa perlu service lain berjalan.
app.post('/api/demo/simulate', async (req, res) => {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    let user = { user_id: 'demo_user', name: 'Demo User' };
    
    try {
        if (token) user = jwt.verify(token, process.env.JWT_SECRET);
    } catch(e) { /* gunakan default */ }

    const service = req.body.service || 'smartbank';
    const endpoint = req.body.endpoint || 'pembayaran_transaksi';
    const amount = parseFloat(req.body.amount) || 50000;
    const feePercent = parseFloat(process.env.GATEWAY_FEE_PERCENT) || 0.5;
    const gatewayFee = Math.round(amount * (feePercent / 100));

    // Simulasi data response dari service tujuan
    const serviceResponses = {
        smartbank: { transaction_id: 'TXN-' + Date.now(), saldo_sebelum: 500000, saldo_sesudah: 500000 - amount, status_pembayaran: 'berhasil' },
        marketplace: { order_id: 'ORD-' + Date.now(), items: [{nama: 'Produk UMKM', qty: 1, harga: amount}], status_order: 'diproses' },
        pos: { invoice_id: 'INV-' + Date.now(), kasir: 'Kasir-01', total: amount, metode: 'digital' },
        supplierhub: { po_id: 'PO-' + Date.now(), bahan: 'Bahan Baku A', qty_kg: 10, total: amount },
        logistikita: { shipping_id: 'SHP-' + Date.now(), asal: 'Bandung', tujuan: 'Jakarta', ongkir: amount, estimasi: '2-3 hari' },
        umkm_insight: { report_id: 'RPT-' + Date.now(), total_transaksi: 150, omzet_bulan: 7500000, profit_margin: '23%' }
    };

    try {
        // Catat ke MySQL (seperti request asli)
        const [result] = await pool.query(
            `INSERT INTO request_logs (waktu, timestamp, ip, metode, url_tujuan, user_id, service_tujuan, status, response_status, fee_terpotong, fee_status, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                new Date().toLocaleString("id-ID"),
                new Date(),
                req.ip || '::1',
                'POST',
                `/integrator/${service}/${endpoint}`,
                user.user_id || user.npm || 'demo',
                service,
                'SUCCESS',
                200,
                gatewayFee,
                'terpotong',
                'DEMO'
            ]
        );

        res.json({
            status: 'success',
            mode: 'DEMO_SIMULASI',
            message: `Simulasi request ke ${service}/${endpoint} berhasil`,
            integrator_info: {
                service_tujuan: service,
                endpoint: endpoint,
                fee_percent: `${feePercent}%`,
                transaction_amount: amount,
                fee_terpotong: gatewayFee,
                fee_status: 'terpotong',
                forwarded_to: `http://localhost:300X/${service}/${endpoint}`
            },
            data: serviceResponses[service] || serviceResponses.smartbank
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal simpan log simulasi', detail: err.message });
    }
});

// --- 7. MIDDLEWARE & ORCHESTRATOR ---
// Semua request ke /integrator/* melewati: Logger → Auth → Gateway
app.use('/integrator', loggerMiddleware, validateRequest, gatewayRoutes);

// Menjalankan Server (dengan inisialisasi database)
const PORT = process.env.PORT || 3000;

async function startServer() {
    // Inisialisasi database terlebih dahulu
    await initDatabase();

    app.listen(PORT, () => {
        console.log(`=================================================`);
        console.log(`   API GATEWAY / INTEGRATOR — Kelompok 7         `);
        console.log(`   Tugas Besar RPL 2 — ULBI                     `);
        console.log(`=================================================`);
        console.log(`   💾 Database    : MySQL (Laragon)              `);
        console.log(`   🌐 Landing Page : http://localhost:${PORT}        `);
        console.log(`   📊 Dashboard    : http://localhost:${PORT}/dashboard`);
        console.log(`   🔑 Client Portal: http://localhost:${PORT}/client-portal`);
        console.log(`   📡 API Status   : http://localhost:${PORT}/api/status`);
        console.log(`=================================================`);
        console.log(`   Fee Gateway: ${process.env.GATEWAY_FEE_PERCENT || 0.5}% per transaksi`);
        console.log(`=================================================`);
    });
}

startServer().catch(err => {
    console.error('Gagal menjalankan server:', err.message);
    process.exit(1);
});