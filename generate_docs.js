const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ImageRun } = require('docx');
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, 'Docs', 'images');
function getImg(name) {
    const p = path.join(imgDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function imgParagraph(name, w, h) {
    const buf = getImg(name);
    if (!buf) return new Paragraph({ children: [new TextRun({ text: `[Gambar: ${name}]`, italics: true, color: '888888' })] });
    return new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: buf, transformation: { width: w, height: h }, type: 'png' })] });
}

const b = (t) => new TextRun({ text: t, bold: true, font: 'Calibri', size: 22 });
const n = (t) => new TextRun({ text: t, font: 'Calibri', size: 22 });
const heading = (t, level) => new Paragraph({ heading: level, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: t, bold: true, font: 'Calibri' })] });
const para = (t) => new Paragraph({ spacing: { after: 100 }, children: [n(t)] });
const bullet = (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [n(t)] });
const bulletBold = (title, desc) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [b(title), n(desc)] });

function makeCell(text, opts = {}) {
    return new TableCell({
        width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
        children: [new Paragraph({ children: [opts.bold ? b(text) : n(text)] })],
        shading: opts.shading ? { fill: opts.shading } : undefined,
    });
}
function headerRow(cells) {
    return new TableRow({ children: cells.map(c => makeCell(c, { bold: true, shading: '1a237e' })) });
}
function dataRow(cells) {
    return new TableRow({ children: cells.map(c => makeCell(c)) });
}

const doc = new Document({
    creator: 'Kelompok 7',
    title: 'Dokumentasi API Gateway Integrator (MySQL Laragon Edition)',
    sections: [{
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
        children: [
            // COVER
            new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DOKUMENTASI LENGKAP', bold: true, font: 'Calibri', size: 48 })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'API Gateway / Integrator', bold: true, font: 'Calibri', size: 40, color: '1565C0' })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MySQL & Laragon Edition', bold: true, font: 'Calibri', size: 24, color: '2E7D32' })] }),
            new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [n('Tugas Besar RPL 2 — D4 Teknik Informatika')] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [n('Universitas Logistik dan Bisnis Internasional (ULBI)')] }),
            new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [b('Kelompok 7')] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [n('Zidan Hairra Ramadhan — 714240061')] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [n('Richard Firmansya')] }),
            new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [n('Dosen: M. Yusril Helmi Setyawan, S.Kom., M.Kom.')] }),
            new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [n('Mei 2026')] }),

            // BAB 1
            heading('BAB 1 — DESKRIPSI APLIKASI', HeadingLevel.HEADING_1),
            para('API Gateway / Integrator adalah middleware orchestrator yang menjadi pintu masuk tunggal (single entry point) untuk semua komunikasi antar 6 aplikasi dalam ekosistem ekonomi UMKM.'),
            para('Sistem ini bertanggung jawab atas 4 fungsi utama:'),
            bullet('Routing API — Meneruskan request ke service yang dituju'),
            bullet('Validasi JWT — Memastikan setiap request memiliki token yang valid'),
            bullet('Logging — Mencatat semua aktivitas request untuk audit ke database MySQL'),
            bullet('Fee 0.5% — Memotong biaya layanan dari setiap transaksi'),
            new Table({ rows: [
                headerRow(['Aspek', 'Detail']),
                dataRow(['Peran', 'Middleware / Orchestrator']),
                dataRow(['Tech Stack', 'Node.js + Express v5 + EJS + JWT + MySQL (Laragon)']),
                dataRow(['Port', '3000']),
                dataRow(['Fee Gateway', '0.5% dari amount transaksi']),
                dataRow(['Service Terhubung', '6 aplikasi ekosistem UMKM']),
            ]}),

            // BAB 2
            heading('BAB 2 — FITUR UTAMA', HeadingLevel.HEADING_1),
            new Table({ rows: [
                headerRow(['No', 'Fitur', 'Endpoint', 'Deskripsi']),
                dataRow(['1', 'Routing API', 'GET /integrator/routing_api', 'Daftar 6 service terdaftar']),
                dataRow(['2', 'Validasi Request', 'GET /integrator/validasi_request', 'Validasi token JWT']),
                dataRow(['3', 'Logging', 'GET /integrator/logging', '50 log request terakhir (dari MySQL)']),
                dataRow(['4', 'Biaya Layanan', 'GET /integrator/biaya_layanan_integrasi', 'Info fee dan total pendapatan']),
                dataRow(['5', 'Demo Simulasi', 'POST /api/demo/simulate', 'Simulasi sukses untuk presentasi']),
                dataRow(['6', 'Forward Request', 'ALL /integrator/:service/*', 'Forward ke service tujuan']),
                dataRow(['7', 'Generate Token', 'POST /generate-test-token', 'Buat JWT token test']),
                dataRow(['8', 'Health Check', 'GET /api/status', 'Status sistem dan koneksi database']),
            ]}),

            // BAB 3
            heading('BAB 3 — ARSITEKTUR SISTEM', HeadingLevel.HEADING_1),
            para('Arsitektur menggunakan pola API Gateway / Middleware Orchestrator:'),
            bullet('Semua request dari 6 aplikasi masuk melalui Gateway (port 3000)'),
            bullet('Request melewati pipeline: Logger → JWT Auth → Fee Calculator → Router'),
            bullet('Gateway mencatat log transaksi secara permanen ke MySQL (Laragon)'),
            bullet('Gateway meneruskan request ke service tujuan dan mengembalikan response'),
            para('6 Service Ekosistem yang terhubung:'),
            new Table({ rows: [
                headerRow(['No', 'Service', 'Kelompok', 'Port', 'Deskripsi']),
                dataRow(['1', 'SmartBank', 'Kelompok 1', '3001', 'Core Banking']),
                dataRow(['2', 'Marketplace', 'Kelompok 2', '3002', 'PasarKita']),
                dataRow(['3', 'POS', 'Kelompok 3', '3003', 'WarungPOS']),
                dataRow(['4', 'SupplierHub', 'Kelompok 4', '3004', 'Supply Chain']),
                dataRow(['5', 'LogistiKita', 'Kelompok 5', '3005', 'Pengiriman']),
                dataRow(['6', 'UMKM Insight', 'Kelompok 6', '3006', 'Analytics']),
            ]}),

            // BAB 4
            heading('BAB 4 — FLOW PROSES (IPO)', HeadingLevel.HEADING_1),
            heading('4.1 Flow Utama — Forward Request', HeadingLevel.HEADING_2),
            new Table({ rows: [
                headerRow(['Tahap', 'Input', 'Proses', 'Output']),
                dataRow(['1', 'HTTP Request + Auth header', 'Logger mencatat IP, method, URL awal ke MySQL', 'Log entry status PENDING']),
                dataRow(['2', 'Authorization: Bearer <token>', 'JWT Auth memvalidasi token dan update user_id', 'User identity verified di log']),
                dataRow(['3', 'Body: {amount: 50000}', 'Hitung fee: 50000 × 0.5% = 250', 'Fee = Rp 250']),
                dataRow(['4', 'Fee amount', 'POST ke SmartBank untuk debit', 'Fee terpotong/gagal']),
                dataRow(['5', 'Request + headers', 'Forward ke service tujuan', 'Response dari service']),
                dataRow(['6', 'Response data', 'Gabungkan integrator_info + data, update log status', 'Final JSON response & log SUCCESS/ERROR']),
            ]}),
            heading('4.2 Flow Demo — Simulasi Presentasi', HeadingLevel.HEADING_2),
            para('Mode demo mensimulasikan seluruh flow tanpa perlu service lain berjalan:'),
            bullet('Client POST ke /api/demo/simulate dengan service, endpoint, dan amount'),
            bullet('Gateway menghitung fee 0.5% dan menyimpannya langsung ke database MySQL'),
            bullet('Response sukses dengan data realistis dikembalikan'),
            bullet('Dashboard menampilkan fee dan traffic dengan membaca database MySQL secara real-time'),

            // BAB 5
            heading('BAB 5 — API ENDPOINT', HeadingLevel.HEADING_1),
            heading('5.1 Endpoint Publik (Tanpa Auth)', HeadingLevel.HEADING_2),
            new Table({ rows: [
                headerRow(['Method', 'URL', 'Deskripsi']),
                dataRow(['GET', '/', 'Landing page']),
                dataRow(['GET', '/dashboard', 'Dashboard admin']),
                dataRow(['GET', '/client-portal', 'Client portal + simulator']),
                dataRow(['POST', '/generate-test-token', 'Generate JWT token']),
                dataRow(['GET', '/api/status', 'Health check']),
                dataRow(['GET', '/api/logs', 'Audit log publik (dari MySQL)']),
                dataRow(['POST', '/api/demo/simulate', 'Demo simulasi sukses']),
            ]}),
            heading('5.2 Endpoint Gateway (Wajib JWT)', HeadingLevel.HEADING_2),
            new Table({ rows: [
                headerRow(['Method', 'URL', 'Deskripsi']),
                dataRow(['GET', '/integrator/routing_api', 'Daftar routing']),
                dataRow(['GET', '/integrator/validasi_request', 'Validasi token']),
                dataRow(['GET', '/integrator/logging', 'Lihat log (dari MySQL)']),
                dataRow(['GET', '/integrator/biaya_layanan_integrasi', 'Info biaya']),
                dataRow(['ALL', '/integrator/:service/{*path}', 'Forward ke service']),
            ]}),

            // BAB 6
            heading('BAB 6 — INTEGRASI SMARTBANK', HeadingLevel.HEADING_1),
            para('Gateway terintegrasi dengan SmartBank untuk pemotongan fee otomatis setiap transaksi:'),
            bullet('Gateway hitung fee = amount × 0.5%'),
            bullet('POST ke SmartBank/pembayaran_transaksi dengan amount = fee'),
            bullet('Jika SmartBank online → fee terpotong'),
            bullet('Jika SmartBank offline → fee gagal, request tetap diteruskan'),
            new Table({ rows: [
                headerRow(['Konfigurasi', 'Nilai']),
                dataRow(['SmartBank URL', 'http://localhost:3001']),
                dataRow(['Fee Endpoint', 'POST /smartbank/pembayaran_transaksi']),
                dataRow(['Fee Percent', '0.5%']),
            ]}),

            // BAB 7
            heading('BAB 7 — DESAIN DATABASE (MYSQL)', HeadingLevel.HEADING_1),
            para('Aplikasi menggunakan database MySQL yang di-host menggunakan Laragon. Database bernama rpl_integrator dengan tabel request_logs.'),
            new Table({ rows: [
                headerRow(['Field', 'Tipe', 'Deskripsi']),
                dataRow(['id', 'INT', 'Primary Key, Auto-increment']),
                dataRow(['waktu', 'VARCHAR(100)', 'Waktu lokal Indonesia saat request masuk']),
                dataRow(['timestamp', 'DATETIME', 'Timestamp sistem standar']),
                dataRow(['ip', 'VARCHAR(50)', 'IP address pengirim']),
                dataRow(['metode', 'VARCHAR(10)', 'HTTP method (GET/POST/PUT/DELETE)']),
                dataRow(['url_tujuan', 'VARCHAR(500)', 'URL path lengkap tujuan']),
                dataRow(['user_id', 'VARCHAR(100)', 'User ID dari decoded JWT token']),
                dataRow(['service_tujuan', 'VARCHAR(100)', 'Nama service target']),
                dataRow(['status', 'VARCHAR(20)', 'PENDING / SUCCESS / ERROR / FORWARDED']),
                dataRow(['response_status', 'INT', 'HTTP response status code']),
                dataRow(['fee_terpotong', 'DECIMAL(12,2)', 'Nominal fee dalam Rupiah']),
                dataRow(['fee_status', 'VARCHAR(50)', 'terpotong / gagal_potong / tidak_ada_amount']),
                dataRow(['mode', 'VARCHAR(20)', 'null atau DEMO']),
            ]}),

            // BAB 8
            heading('BAB 8 — MEKANISME FEE', HeadingLevel.HEADING_1),
            para('Fee Gateway = 0.5% dari setiap transaksi yang melewati gateway.'),
            new Table({ rows: [
                headerRow(['Amount Transaksi', 'Fee (0.5%)', 'Keterangan']),
                dataRow(['Rp 10.000', 'Rp 50', 'Transaksi kecil']),
                dataRow(['Rp 50.000', 'Rp 250', 'Transaksi sedang']),
                dataRow(['Rp 100.000', 'Rp 500', 'Transaksi besar']),
                dataRow(['Rp 1.000.000', 'Rp 5.000', 'Transaksi premium']),
            ]}),

            // BAB 9
            heading('BAB 9 — TAMPILAN ANTARMUKA (UI)', HeadingLevel.HEADING_1),
            heading('9.1 Landing Page (/)', HeadingLevel.HEADING_2),
            para('Halaman utama dengan hero section, 4 feature cards, dan grid 6 aplikasi ekosistem.'),
            imgParagraph('landing_page.png', 550, 520),
            heading('9.2 Dashboard Admin (/dashboard)', HeadingLevel.HEADING_2),
            para('Dashboard dengan 4 stat cards (Revenue, Traffic, Sukses, Error) dan tabel audit log lengkap.'),
            imgParagraph('dashboard.png', 580, 270),
            heading('9.3 Client Portal (/client-portal)', HeadingLevel.HEADING_2),
            para('Portal untuk generate token JWT dan menguji API ke 6 aplikasi.'),
            imgParagraph('client_portal.png', 580, 270),

            // BAB 10
            heading('BAB 10 — PENGUJIAN FITUR', HeadingLevel.HEADING_1),
            new Table({ rows: [
                headerRow(['No', 'Test Case', 'Input', 'Expected', 'Hasil']),
                dataRow(['1', 'Landing page load', 'GET /', 'HTML dengan hero + features', 'PASS']),
                dataRow(['2', 'Dashboard load', 'GET /dashboard', 'Stats + log dari MySQL', 'PASS']),
                dataRow(['3', 'Client portal load', 'GET /client-portal', 'Form token + simulator', 'PASS']),
                dataRow(['4', 'Generate token', 'POST /generate-test-token', 'JWT token valid 24 jam', 'PASS']),
                dataRow(['5', 'Request tanpa token', 'POST /integrator/smartbank/test', '401 Unauthorized', 'PASS']),
                dataRow(['6', 'Token invalid', 'Bearer xxx', '403 Forbidden', 'PASS']),
                dataRow(['7', 'Service tidak ada', '/integrator/unknown/test', '404 Not Found', 'PASS']),
                dataRow(['8', 'Demo SmartBank', '/api/demo/simulate {smartbank}', 'Sukses + fee 250 + database update', 'PASS']),
                dataRow(['9', 'Demo Marketplace', '/api/demo/simulate {marketplace}', 'Sukses + order_id', 'PASS']),
                dataRow(['10', 'Demo POS', '/api/demo/simulate {pos}', 'Sukses + invoice_id', 'PASS']),
                dataRow(['11', 'Demo SupplierHub', '/api/demo/simulate {supplierhub}', 'Sukses + po_id', 'PASS']),
                dataRow(['12', 'Demo LogistiKita', '/api/demo/simulate {logistikita}', 'Sukses + shipping_id', 'PASS']),
                dataRow(['13', 'Demo UMKM Insight', '/api/demo/simulate {umkm_insight}', 'Sukses + report_id', 'PASS']),
                dataRow(['14', 'Fee preview update', 'Ubah amount jadi 100000', 'Fee = Rp 500', 'PASS']),
                dataRow(['15', 'Dashboard revenue', 'Setelah 3x demo', 'Rp 750 tercatat di MySQL', 'PASS']),
            ]}),

            // BAB 11
            heading('BAB 11 — KENDALA & SOLUSI', HeadingLevel.HEADING_1),
            new Table({ rows: [
                headerRow(['No', 'Kendala', 'Solusi']),
                dataRow(['1', 'Service kelompok lain belum berjalan', 'Buat mode Demo/Simulasi yang selalu sukses']),
                dataRow(['2', 'Express v5 wildcard syntax berubah', 'Migrasi ke {*path} syntax']),
                dataRow(['3', 'Fee awalnya flat Rp 500', 'Ubah ke perhitungan 0.5% dari amount']),
                dataRow(['4', 'Log hilang saat server restart', 'Migrasi database ke MySQL menggunakan Laragon']),
                dataRow(['5', 'MySQL Laragon path terpisah', 'Hubungkan dengan setting default tanpa password']),
            ]}),

            // BAB 12
            heading('BAB 12 — STRUKTUR PROJECT', HeadingLevel.HEADING_1),
            new Table({ rows: [
                headerRow(['File/Folder', 'Deskripsi']),
                dataRow(['.env', 'Environment variables (termasuk DB host, user, password, name)']),
                dataRow(['server.js', 'Entry point + routes + inisialisasi & koneksi DB']),
                dataRow(['package.json', 'Dependencies (express, jwt, axios, ejs, mysql2)']),
                dataRow(['config/database.js', 'Setup connection pool MySQL + Auto DDL']),
                dataRow(['config/init.sql', 'Script SQL manual inisialisasi database']),
                dataRow(['middleware/auth.js', 'JWT validation middleware (update log user_id)']),
                dataRow(['middleware/logger.js', 'Request logging middleware (simpan log awal)']),
                dataRow(['routes/gateway.js', 'Routing + fee + forwarding + update status log']),
                dataRow(['views/index.ejs', 'Landing page']),
                dataRow(['views/dashboard.ejs', 'Dashboard admin (stats & logs dari MySQL)']),
                dataRow(['views/client_portal.ejs', 'Client portal']),
            ]}),

            // BAB 13
            heading('BAB 13 — CARA MENJALANKAN', HeadingLevel.HEADING_1),
            para('1. Pastikan service MySQL di Laragon sudah berjalan.'),
            para('2. Install dependencies: npm install'),
            para('3. Jalankan server: node server.js'),
            para('4. Buka browser: http://localhost:3000'),
            heading('Untuk Presentasi:', HeadingLevel.HEADING_2),
            bullet('Buka /client-portal'),
            bullet('Klik Generate untuk membuat token'),
            bullet('Pilih aplikasi tujuan dan isi amount'),
            bullet('Klik "Demo (Simulasi Sukses)" untuk response sukses + fee'),
            bullet('Buka /dashboard untuk lihat log dan statistik secara real-time dari MySQL'),
        ]
    }]
});

(async () => {
    const buffer = await Packer.toBuffer(doc);
    const outPath = path.join(__dirname, 'Docs', 'Dokumentasi_API_Gateway_Integrator.docx');
    fs.writeFileSync(outPath, buffer);
    console.log('Word document created:', outPath);
})();
