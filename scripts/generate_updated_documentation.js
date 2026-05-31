const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
} = require('docx');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'Docs', 'Dokumentasi_Website_Gateway_Integrator.docx');
const imageDir = path.join(root, 'Docs', 'images');

const colors = {
    blue: '2E74B5',
    dark: '0B2545',
    gray: '555555',
    lightBlue: 'E8EEF5',
    border: 'DADCE0',
    green: '1F7A3B',
    red: '9B1C1C'
};

function tr(text, options = {}) {
    return new TextRun({
        text,
        font: 'Calibri',
        size: options.size || 22,
        bold: options.bold || false,
        italics: options.italics || false,
        color: options.color || '000000'
    });
}

function p(text, options = {}) {
    return new Paragraph({
        spacing: { after: options.after ?? 120, before: options.before ?? 0 },
        alignment: options.align || AlignmentType.LEFT,
        children: [tr(text, options)]
    });
}

function h(text, level) {
    const size = level === HeadingLevel.HEADING_1 ? 32 : level === HeadingLevel.HEADING_2 ? 26 : 24;
    return new Paragraph({
        heading: level,
        spacing: { before: level === HeadingLevel.HEADING_1 ? 320 : 220, after: 120 },
        children: [tr(text, { size, bold: true, color: level === HeadingLevel.HEADING_3 ? '1F4D78' : colors.blue })]
    });
}

function bullet(text) {
    return new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80 },
        children: [tr(text)]
    });
}

function code(text) {
    return new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text, font: 'Consolas', size: 19, color: colors.dark })]
    });
}

function cell(text, options = {}) {
    return new TableCell({
        width: { size: options.width || 1800, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        shading: options.header ? { fill: colors.lightBlue } : undefined,
        borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: colors.border },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: colors.border },
            left: { style: BorderStyle.SINGLE, size: 1, color: colors.border },
            right: { style: BorderStyle.SINGLE, size: 1, color: colors.border }
        },
        children: [
            new Paragraph({
                alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
                children: [tr(String(text), { bold: options.header || options.bold, size: options.size || 20, color: options.header ? colors.dark : '000000' })]
            })
        ]
    });
}

function table(headers, rows, widths) {
    return new Table({
        width: { size: 9360, type: WidthType.DXA },
        rows: [
            new TableRow({ tableHeader: true, children: headers.map((header, i) => cell(header, { header: true, width: widths[i] })) }),
            ...rows.map(row => new TableRow({ children: row.map((value, i) => cell(value, { width: widths[i] })) }))
        ]
    });
}

function img(name, width, height) {
    const file = path.join(imageDir, name);
    if (!fs.existsSync(file)) {
        return p(`Gambar ${name} tidak ditemukan.`, { italics: true, color: colors.gray });
    }
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 160 },
        children: [new ImageRun({ data: fs.readFileSync(file), transformation: { width, height }, type: 'png' })]
    });
}

function callout(title, body) {
    return new Table({
        width: { size: 9360, type: WidthType.DXA },
        rows: [new TableRow({
            children: [new TableCell({
                width: { size: 9360, type: WidthType.DXA },
                margins: { top: 160, bottom: 160, left: 180, right: 180 },
                shading: { fill: 'F4F6F9' },
                borders: {
                    top: { style: BorderStyle.SINGLE, size: 1, color: colors.border },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: colors.border },
                    left: { style: BorderStyle.SINGLE, size: 1, color: colors.border },
                    right: { style: BorderStyle.SINGLE, size: 1, color: colors.border }
                },
                children: [
                    p(title, { bold: true, color: colors.dark, after: 60 }),
                    p(body, { after: 0 })
                ]
            })]
        })]
    });
}

const featureRows = [
    ['Auth & Role', 'Login dashboard, JWT session, Admin/Operator/User, role guard'],
    ['Dynamic Gateway', 'Routing service dari tabel api_services, bukan hardcode env'],
    ['Revenue Ledger', 'Fee terpisah di revenue_logs dan request metadata tetap di request_logs'],
    ['API Key Management', 'Generate/revoke key, daily limit, usage tracking api_key_usage'],
    ['Security', 'Helmet, login limiter, API limiter, per-user limiter, CSRF protection'],
    ['Monitoring', 'Analytics, request logs, revenue chart, health history, system alerts'],
    ['Admin Tools', 'CRUD service, CRUD user, reset password, import CSV, seed demo data'],
    ['Deployment', 'Dockerfile, docker-compose MySQL + gateway, .env.example']
];

const schemaRows = [
    ['users', 'Akun login dan role pengguna'],
    ['api_services', 'Daftar service, target URL, health path, status aktif'],
    ['request_logs', 'Metadata traffic API: IP, method, URL, user, service, status'],
    ['revenue_logs', 'Ledger pendapatan/fee yang mengacu ke request_logs'],
    ['api_keys', 'API key hashed, prefix, status, daily limit, last used'],
    ['api_key_usage', 'Counter pemakaian API key per hari'],
    ['audit_logs', 'Riwayat aksi admin/operator'],
    ['service_health_logs', 'Histori status Online/Down service'],
    ['system_alerts', 'Incident feed service down, latency, recovery, dan alert operasional']
];

const endpointRows = [
    ['GET', '/dashboard', 'Admin/Operator', 'Gateway overview, chart, alert aktif, seed demo data'],
    ['GET', '/dashboard/architecture', 'Admin/Operator', 'Peta modul, request flow, dan service topology'],
    ['GET', '/dashboard/docs', 'Admin/Operator', 'Dokumentasi API langsung di website'],
    ['POST', '/api/demo/seed-data', 'Admin', 'Membuat data demo untuk grafik, logs, revenue, dan alert'],
    ['POST', '/api/services/:id/test', 'Admin/Operator', 'Test connection berdasarkan health_path'],
    ['POST', '/api/alerts/:id/resolve', 'Admin/Operator', 'Resolve system alert'],
    ['ANY', '/integrator/:service/:path', 'Bearer JWT/API Key', 'Proxy request ke service tujuan dinamis']
];

const flowRows = [
    ['1', 'Client request', 'Client mengirim request ke /integrator/:service/:path dengan Bearer JWT/API Key'],
    ['2', 'Request logger', 'Gateway mencatat log awal ke request_logs dengan status PENDING'],
    ['3', 'Authentication', 'JWT/API Key divalidasi, user_id ditempel ke request log'],
    ['4', 'Rate limit', 'Cek batas request per user dan kuota harian API key'],
    ['5', 'Dynamic route lookup', 'Gateway membaca api_services untuk target URL dan status aktif'],
    ['6', 'Fee handling', 'Jika amount > 0, gateway menghitung fee dan mencoba debit SmartBank'],
    ['7', 'Proxy', 'Request diteruskan ke service tujuan dan response dikembalikan ke client'],
    ['8', 'Observability', 'Status request, revenue, audit, health, dan alert tersedia di dashboard']
];

const erdRows = [
    ['users 1..n api_keys', 'Satu user dapat memiliki beberapa API key'],
    ['api_keys 1..n api_key_usage', 'Satu API key memiliki counter pemakaian per tanggal'],
    ['api_services 1..n request_logs', 'Service menjadi label tujuan pada traffic log'],
    ['request_logs 1..0/1 revenue_logs', 'Transaksi sukses dengan fee memiliki revenue log'],
    ['users 1..n audit_logs', 'Aksi admin/operator dicatat sebagai audit trail'],
    ['api_services 1..n service_health_logs', 'Setiap health check menghasilkan riwayat status'],
    ['service_health_logs -> system_alerts', 'Status Down dapat menghasilkan alert aktif']
];

const doc = new Document({
    creator: 'Kelompok 7',
    title: 'Dokumentasi Website Gateway Integrator',
    description: 'Dokumentasi teknis API Gateway Integrator Node.js Express MySQL',
    styles: {
        default: {
            document: {
                run: { font: 'Calibri', size: 22, color: '000000' },
                paragraph: { spacing: { after: 120 }, alignment: AlignmentType.LEFT }
            }
        }
    },
    sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [
            new Paragraph({ spacing: { before: 1800, after: 120 }, alignment: AlignmentType.CENTER, children: [tr('DOKUMENTASI WEBSITE', { bold: true, size: 46, color: colors.dark })] }),
            new Paragraph({ spacing: { after: 180 }, alignment: AlignmentType.CENTER, children: [tr('Gateway Integrator API Platform', { bold: true, size: 36, color: colors.blue })] }),
            new Paragraph({ spacing: { after: 360 }, alignment: AlignmentType.CENTER, children: [tr('Node.js / Express / EJS / MySQL', { size: 24, color: colors.gray })] }),
            callout('Ringkasan', 'Dokumen ini disesuaikan dengan kode terbaru di repository. Sistem sudah mencakup autentikasi role, API gateway dinamis, revenue ledger, API key quota, audit trail, health monitoring, alerting, export, Docker, dan automated test.'),
            p('Kelompok 7 - RPL 2 - D4 Teknik Informatika ULBI', { align: AlignmentType.CENTER, before: 360, color: colors.gray }),
            p('Tanggal update: 1 Juni 2026', { align: AlignmentType.CENTER, color: colors.gray }),

            h('1. Deskripsi Sistem', HeadingLevel.HEADING_1),
            p('Gateway Integrator adalah aplikasi API Gateway sederhana namun lengkap untuk menghubungkan beberapa service ekosistem UMKM melalui satu pintu masuk. Aplikasi menangani autentikasi, routing, logging, pencatatan revenue, monitoring, dan administrasi service.'),
            ...[
                'Admin dapat mengelola user, service, API key, revenue, audit log, alert, dan dokumentasi.',
                'Operator dapat memonitor traffic, analytics, service health, logs, dan alert tanpa melihat revenue sensitif.',
                'User dapat memakai client portal untuk generate token dan simulasi request API.'
            ].map(bullet),

            h('2. Fitur Utama', HeadingLevel.HEADING_1),
            table(['Fitur', 'Keterangan'], featureRows, [2400, 6960]),

            h('3. Arsitektur Website', HeadingLevel.HEADING_1),
            p('Arsitektur sistem mengikuti pola middleware/API Gateway. Dashboard EJS dipakai untuk kontrol operasional, sementara endpoint /integrator menjadi entry point API untuk client eksternal.'),
            table(['Layer', 'Komponen'], [
                ['Presentation', 'EJS views: login, dashboard, client portal, register, landing page'],
                ['Controller/API', 'server.js dan routes/gateway.js'],
                ['Middleware', 'auth, csrf, logger, rateLimitPerUser, helmet, express-rate-limit'],
                ['Database', 'MySQL: users, api_services, request_logs, revenue_logs, api_keys, audit_logs, health, alerts'],
                ['External Services', 'SmartBank, Marketplace, POS, SupplierHub, LogistiKita, UMKM Insight']
            ], [2400, 6960]),

            h('4. Flow Request API Gateway', HeadingLevel.HEADING_1),
            table(['No', 'Tahap', 'Penjelasan'], flowRows, [700, 2100, 6560]),

            h('5. ERD dan Relasi Database', HeadingLevel.HEADING_1),
            p('Relasi database dibuat untuk memisahkan metadata request, pendapatan, autentikasi, audit, dan monitoring. Pemisahan ini membuat query dashboard lebih rapi dan data keuangan tidak bercampur dengan traffic log.'),
            table(['Relasi', 'Keterangan'], erdRows, [3000, 6360]),
            table(['Tabel', 'Fungsi'], schemaRows, [2400, 6960]),

            h('6. Modul Dashboard', HeadingLevel.HEADING_1),
            table(['Menu', 'Fungsi'], [
                ['Gateway Overview', 'Ringkasan traffic, revenue, consumer, activity, dan active alerts'],
                ['Services', 'CRUD service, search, health path, test connection, import CSV'],
                ['Routes', 'Daftar route dinamis /integrator/:service/{path}'],
                ['Consumers', 'Daftar user_id/API consumer dari request log'],
                ['Plugins', 'Daftar middleware aktif dan konfigurasi operasional'],
                ['Analytics', 'Grafik request per service, timeline, error rate, top consumer, export'],
                ['Request Logs', 'Filter, search, pagination, dan export traffic log'],
                ['Revenue', 'Total revenue, grafik pendapatan, breakdown per service, export'],
                ['API Keys', 'Generate/revoke key, daily quota, usage today'],
                ['Audit Log', 'Aksi admin/operator dengan filter dan export'],
                ['Health History', 'Riwayat status online/down service'],
                ['System Alerts', 'Incident feed otomatis dan manual resolve'],
                ['Architecture', 'Peta modul, request flow, dan topology service'],
                ['API Docs', 'Referensi endpoint dan route dinamis di dalam website']
            ], [2600, 6760]),

            h('7. API Endpoint Penting', HeadingLevel.HEADING_1),
            table(['Method', 'Endpoint', 'Auth', 'Fungsi'], endpointRows, [850, 3000, 1800, 3710]),

            h('8. Security dan Reliability', HeadingLevel.HEADING_1),
            ...[
                'Password menggunakan scrypt hash dengan salt.',
                'Dashboard session memakai JWT cookie per role.',
                'CSRF token diterapkan pada form dan fetch mutation dashboard/client portal.',
                'API Gateway menerima JWT Bearer atau API Key dengan hash SHA-256.',
                'Rate limit global, login limiter, per-user limiter, dan API key daily quota aktif.',
                'Audit trail mencatat aksi penting admin/operator.',
                'Health monitor membuat system alert saat service down.'
            ].map(bullet),

            h('9. Deployment dan Operasional', HeadingLevel.HEADING_1),
            p('Aplikasi dapat dijalankan lokal dengan Node.js atau melalui Docker Compose. Docker Compose menjalankan MySQL 8.4 dan gateway dalam dua service terpisah.'),
            code('npm install'),
            code('npm run check'),
            code('npm test'),
            code('npm start'),
            code('docker compose up --build'),

            h('10. Screenshot Website', HeadingLevel.HEADING_1),
            p('Berikut contoh tampilan halaman dokumentasi/API Docs pada dashboard terbaru.'),
            img('dashboard_docs_verify.png', 560, 315),

            h('11. Strategi Demo di Depan Dosen', HeadingLevel.HEADING_1),
            ...[
                'Login sebagai admin/admin123.',
                'Buka Gateway Overview dan klik Seed Demo Data agar grafik, revenue, logs, dan alerts terisi.',
                'Tunjukkan Services untuk membuktikan service dinamis dari database dan tombol Test Connection.',
                'Tunjukkan Analytics, Revenue, Request Logs, Audit Log, dan System Alerts.',
                'Buka Architecture untuk menjelaskan flow request dan modul sistem.',
                'Buka API Docs untuk menunjukkan dokumentasi endpoint langsung di website.',
                'Jalankan npm test untuk menunjukkan ada automated test.'
            ].map(bullet),

            h('12. Kesimpulan', HeadingLevel.HEADING_1),
            p('Gateway Integrator sudah berkembang dari API gateway sederhana menjadi mini API management platform. Sistem memiliki autentikasi role, service registry dinamis, revenue ledger, API key quota, observability, alerting, security protection, dokumentasi internal, Docker deployment, dan automated testing.')
        ]
    }]
});

Packer.toBuffer(doc).then(buffer => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
    console.log(outPath);
});
