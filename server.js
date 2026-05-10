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
 * 3. Logging            — Mencatat seluruh request
 * 4. Biaya Layanan      — Fee 0.5% per transaksi (Doc6)
 * =============================================================
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken'); 
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

// Variabel Global untuk menyimpan Log
global.requestLogs = []; 

// --- 1. ROUTE HALAMAN UTAMA (LANDING PAGE) ---
app.get('/', (req, res) => {
    res.render('index');
});

// --- 2. ROUTE ANTARMUKA PENGGUNA LAINNYA ---

// Dashboard Admin — menampilkan log dan revenue sesuai Doc6
app.get('/dashboard', (req, res) => {
    // Hitung total revenue dari fee yang benar-benar terpotong (Doc6: 0.5%)
    const totalRevenue = global.requestLogs.reduce((sum, log) => sum + (log.fee_terpotong || 0), 0);
    const totalSuccess = global.requestLogs.filter(log => log.status === 'SUCCESS').length;
    const totalError = global.requestLogs.filter(log => log.status === 'ERROR').length;

    res.render('dashboard', { 
        logs: global.requestLogs,
        totalRevenue: totalRevenue,
        totalSuccess: totalSuccess,
        totalError: totalError
    });
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
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        application: 'API Gateway / Integrator',
        kelompok: 7,
        version: '2.0.0',
        uptime: process.uptime(),
        total_requests: global.requestLogs.length,
        total_revenue: global.requestLogs.reduce((sum, log) => sum + (log.fee_terpotong || 0), 0),
        fee_gateway: '0.5%',
        services: ['smartbank', 'marketplace', 'pos', 'supplierhub', 'logistikita', 'umkm_insight'],
        timestamp: new Date().toISOString()
    });
});

// --- 5. API ENDPOINT LOGS (publik, tanpa auth) ---
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        status: 'success',
        total: global.requestLogs.length,
        data: global.requestLogs.slice(-limit).reverse()
    });
});

// --- 6. DEMO / SIMULASI MODE (untuk presentasi) ---
// Endpoint ini mensimulasikan response sukses lengkap dengan fee,
// tanpa perlu service lain berjalan.
app.post('/api/demo/simulate', (req, res) => {
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

    // Catat ke log global (seperti request asli)
    const logEntry = {
        id: global.requestLogs.length + 1,
        waktu: new Date().toLocaleString("id-ID"),
        timestamp: new Date().toISOString(),
        ip: req.ip || '::1',
        metode: 'POST',
        url_tujuan: `/integrator/${service}/${endpoint}`,
        user_id: user.user_id || user.npm || 'demo',
        service_tujuan: service,
        status: 'SUCCESS',
        response_status: 200,
        fee_terpotong: gatewayFee,
        fee_status: 'terpotong',
        mode: 'DEMO'
    };
    global.requestLogs.push(logEntry);

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
});

// --- 7. MIDDLEWARE & ORCHESTRATOR ---
// Semua request ke /integrator/* melewati: Logger → Auth → Gateway
app.use('/integrator', loggerMiddleware, validateRequest, gatewayRoutes);

// Menjalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`   API GATEWAY / INTEGRATOR — Kelompok 7         `);
    console.log(`   Tugas Besar RPL 2 — ULBI                     `);
    console.log(`=================================================`);
    console.log(`   🌐 Landing Page : http://localhost:${PORT}        `);
    console.log(`   📊 Dashboard    : http://localhost:${PORT}/dashboard`);
    console.log(`   🔑 Client Portal: http://localhost:${PORT}/client-portal`);
    console.log(`   📡 API Status   : http://localhost:${PORT}/api/status`);
    console.log(`=================================================`);
    console.log(`   Fee Gateway: ${process.env.GATEWAY_FEE_PERCENT || 0.5}% per transaksi`);
    console.log(`=================================================`);
});