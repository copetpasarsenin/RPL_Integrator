# RPL Integrator

**RPL Integrator** adalah aplikasi **API Gateway / Integrator** berbasis Node.js, Express.js, EJS, dan MySQL untuk mengelola routing layanan, autentikasi request, API key, monitoring dashboard, request logs, analytics, revenue/fee gateway, dan client portal dalam satu sistem terpusat.

Project ini disiapkan untuk kebutuhan pembelajaran, demo, evaluasi RPL, dan presentasi integrasi layanan dengan dukungan **Docker Desktop** agar aplikasi dan database dapat dijalankan secara konsisten tanpa bergantung pada Laragon atau MySQL lokal.

---

## Konteks Akademik

| Informasi | Keterangan |
|---|---|
| Mata Kuliah | [isi sesuai data] |
| Dosen Pengampu | [isi sesuai data] |
| Kelas | [isi sesuai data] |
| Semester/Tahun Akademik | [isi sesuai data] |
| Institusi | [isi sesuai data] |

---

## Tim Pengembang

| Nama | NPM/NIM | Role | Kontribusi |
|---|---|---|---|
| [Nama Anggota 1] | [NPM/NIM] | [Role] | [Kontribusi] |

> Lengkapi data tim dengan informasi asli sebelum pengumpulan. Jangan menggunakan nama, NPM/NIM, atau kontribusi yang belum terverifikasi.

---

## Daftar Isi

- [Konteks Akademik](#konteks-akademik)
- [Tim Pengembang](#tim-pengembang)
- [Tujuan Project](#tujuan-project)
- [Fitur Utama](#fitur-utama)
- [Tech Stack](#tech-stack)
- [Struktur Project](#struktur-project)
- [Menjalankan dengan Docker Desktop](#menjalankan-dengan-docker-desktop)
- [Menjalankan Manual Tanpa Docker](#menjalankan-manual-tanpa-docker)
- [Konfigurasi Environment](#konfigurasi-environment)
- [Akun Demo](#akun-demo)
- [URL Penting](#url-penting)
- [Endpoint Terverifikasi](#endpoint-terverifikasi)
- [API Key dan Autentikasi](#api-key-dan-autentikasi)
- [Catatan Docker](#catatan-docker)
- [Screenshots](#screenshots)
- [Troubleshooting](#troubleshooting)
- [Catatan Evaluasi](#catatan-evaluasi)
- [Testing / Validasi](#testing--validasi)

---

## Tujuan Project

RPL Integrator dibuat sebagai gateway terpusat untuk menghubungkan beberapa service demo melalui satu endpoint integrasi. Aplikasi ini membantu pengguna memahami cara kerja API gateway, validasi token, pencatatan request, monitoring kesehatan service, dan analisis penggunaan layanan.

Secara umum, project ini bertujuan untuk:

- Menyediakan pintu masuk tunggal untuk beberapa service backend.
- Menunjukkan konsep dynamic routing berdasarkan service yang terdaftar di database.
- Mencatat aktivitas request agar mudah dimonitor dan dievaluasi.
- Menyediakan dashboard admin/operator untuk observability gateway.
- Menyediakan client portal untuk simulasi integrasi dan pembuatan token/API key.
- Mendukung demo lokal dengan Docker Desktop dan MySQL container.

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| API Gateway / Integrator | Menerima request dari client lalu meneruskannya ke service tujuan melalui endpoint `/integrator`. |
| Dynamic Service Routing | Service aktif dibaca dari tabel `api_services`, sehingga routing dapat mengikuti data service yang tersedia. |
| Dashboard Monitoring | Dashboard untuk melihat ringkasan status gateway, service, traffic, logs, alert, user, dan menu operasional lain. |
| Request Logs | Setiap request gateway dicatat ke `request_logs` untuk kebutuhan audit dan monitoring. |
| API Keys | User dapat membuat API key berawalan `igw_` untuk akses gateway tanpa login dashboard. |
| Analytics | Grafik traffic, service usage, source app, top consumer, dan efektivitas service ditampilkan di dashboard menggunakan Chart.js. |
| Revenue/Fee Gateway | Transaksi sukses dengan nilai `amount` dapat dicatat ke `revenue_logs` berdasarkan persentase fee gateway. |
| Health Monitor & History | Service health check berjalan berkala dan riwayatnya disimpan di `service_health_logs`. |
| Client Portal | Portal untuk generate token, simulasi request, melihat contoh integrasi, dan mencoba akses gateway. |
| Demo Login | Halaman login menyediakan tombol demo satu klik untuk admin, operator, dan user. |
| Docker Desktop Support | Aplikasi dan MySQL dapat dijalankan dengan Docker Compose tanpa konfigurasi Laragon. |

---

## Tech Stack

| Komponen | Teknologi |
|---|---|
| Runtime | Node.js |
| Web Framework | Express.js |
| View Engine | EJS |
| Database | MySQL |
| Container | Docker Desktop, Docker Compose |
| HTTP Client | Axios |
| Autentikasi Token | JSON Web Token (`jsonwebtoken`) |
| Security Middleware | Helmet, CSRF middleware custom, rate limit |
| Chart Dashboard | Chart.js via CDN |

---

## Struktur Project

```text
RPL_Integrator/
├── config/
│   ├── database.js          # Koneksi DB, migrasi ringan, dan seed data demo
│   └── init.sql             # Inisialisasi schema untuk MySQL Docker
├── middleware/
│   ├── auth.js              # Session/JWT auth dan role guard
│   ├── csrf.js              # Proteksi CSRF untuk form/API internal
│   └── rateLimitPerUser.js  # Rate limit request gateway per user/API consumer
├── routes/
│   └── gateway.js           # Routing utama API gateway `/integrator`
├── tests/
│   └── *.test.js            # Test struktur dan integrasi aplikasi
├── utils/
│   └── urlSafety.js         # Helper validasi URL target service
├── views/
│   ├── dashboard.ejs        # Dashboard monitoring dan admin panel
│   ├── client_portal.ejs    # Portal client untuk demo integrasi
│   ├── login.ejs            # Login dan demo login satu klik
│   └── *.ejs                # View EJS lain
├── public/                  # Static asset dan dokumen publik
├── server.js                # Entry point Express app dan route utama
├── docker-compose.yml       # App + MySQL untuk Docker Desktop
├── Dockerfile               # Image aplikasi Node.js
├── .env.docker.example      # Template environment Docker lokal
└── package.json             # Script npm dan dependency project
```

Database utama yang dibuat otomatis antara lain `users`, `employees`, `api_services`, `request_logs`, `shadow_service_usage`, `revenue_logs`, `system_alerts`, `service_health_logs`, `api_keys`, `api_key_usage`, `audit_logs`, `revoked_api_tokens`, dan `revoked_session_tokens`.

---

## Menjalankan dengan Docker Desktop

Mode Docker adalah cara yang direkomendasikan untuk demo lokal karena aplikasi dan MySQL berjalan di container.

### Prasyarat

- Docker Desktop sudah terpasang.
- Docker Desktop sedang berjalan.
- Port `3000` belum digunakan aplikasi lain.

### Langkah Menjalankan

```bash
docker compose up --build -d
```

Setelah container aktif, buka:

```text
http://localhost:3000
```

Cek status API:

```bash
curl.exe http://localhost:3000/api/status
```

### Menghentikan Container

```bash
docker compose down
```

Perintah tersebut tidak menghapus data database karena MySQL disimpan di Docker volume.

### Reset Database Docker

Gunakan hanya jika ingin menghapus data MySQL container dan membuat ulang dari awal.

```bash
docker compose down -v
docker compose up --build -d
```

---

## Menjalankan Manual Tanpa Docker

Mode manual didukung selama Node.js dan MySQL tersedia di komputer lokal.

### Prasyarat

- Node.js terpasang.
- MySQL lokal aktif.
- Database `rpl_integrator` sudah dibuat.
- Environment lokal sudah disesuaikan, terutama konfigurasi database dan JWT.

### Langkah Menjalankan

```bash
npm install
npm start
```

Saat server berjalan, `config/database.js` akan membuat tabel yang belum ada dan melakukan seed data demo secara idempotent.

> Catatan: Jika menggunakan Laragon atau MySQL lokal lain, pastikan nilai `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, dan `DB_NAME` sesuai dengan environment lokal.

---

## Konfigurasi Environment

Template environment Docker tersedia di `.env.docker.example`. Untuk Docker Compose, nilai default juga sudah disiapkan di `docker-compose.yml`, sehingga demo lokal dapat berjalan tanpa menyalin `.env` lokal ke image Docker.

| Variabel | Keterangan | Contoh Docker |
|---|---|---|
| `PORT` | Port aplikasi Express. | `3000` |
| `NODE_ENV` | Mode runtime aplikasi. | `development` |
| `DB_HOST` | Host database. Pada Docker harus mengarah ke service MySQL Compose. | `mysql` |
| `DB_PORT` | Port MySQL. | `3306` |
| `DB_USER` | User database aplikasi. | `rpl_user` |
| `DB_PASSWORD` | Password database aplikasi. | `rpl_password` |
| `DB_NAME` | Nama database aplikasi. | `rpl_integrator` |
| `MYSQL_ROOT_PASSWORD` | Password root MySQL container. | `rpl_root_password` |
| `JWT_SECRET` | Secret JWT, minimal 32 karakter. | `rpl_integrator_...` |
| `JWT_ISSUER` | Issuer JWT. | `rpl-integrator` |
| `JWT_API_AUDIENCE` | Audience JWT untuk API gateway. | `integrator-api` |
| `SEED_DEFAULT_USERS` | Mengaktifkan seed user demo. | `true` |
| `TRUST_PROXY` | Pengaturan trust proxy Express. | `false` |
| `GATEWAY_FEE_PERCENT` | Persentase fee gateway. | `0.5` |
| `*_URL` | URL service upstream seperti SmartBank, Marketplace, POS, dan service demo lain. | `http://host.docker.internal:3001` |
| `USER_RATE_WINDOW_MS` | Window rate limit per user. | `60000` |
| `USER_RATE_MAX` | Maksimum request per window. | `30` |
| `PROXY_TIMEOUT_MS` | Timeout proxy ke service upstream dalam ms. | `10000` |

Untuk Docker Desktop, URL upstream default menggunakan `host.docker.internal` agar container dapat mengakses service yang berjalan di host komputer.

---

## Akun Demo

| Role | Username | Password | Arah Setelah Login |
|---|---|---|---|
| Admin | `admin` | `admin123` | `/dashboard` |
| Operator | `operator` | `operator123` | `/dashboard` |
| User | `user` | `user123` | `/client-portal` |

Halaman `/login` menyediakan tombol **Login sebagai Admin**, **Login sebagai Operator**, dan **Login sebagai User** untuk demo satu klik tanpa mengetik username/password.

---

## URL Penting

| Halaman/API | URL | Akses |
|---|---|---|
| Landing Page | `http://localhost:3000/` | Publik |
| Login | `http://localhost:3000/login` | Publik |
| Dashboard | `http://localhost:3000/dashboard` | Admin/Operator |
| Client Portal | `http://localhost:3000/client-portal` | Admin/Operator/User |
| API Status | `http://localhost:3000/api/status` | Publik |

---

## Endpoint Terverifikasi

Endpoint berikut terdeteksi dari implementasi saat ini.

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `GET` | `/` | Publik | Landing page aplikasi. |
| `GET` | `/login` | Publik | Halaman login dan tombol demo satu klik. |
| `POST` | `/login` | Publik | Login manual atau demo login dengan `demo_role`. |
| `POST` | `/logout` | Login | Logout session aktif. |
| `POST` | `/logout-all` | Login | Logout semua session role. |
| `GET` | `/register` | Publik | Form registrasi user. |
| `POST` | `/register` | Publik | Membuat user baru. |
| `GET` | `/dashboard` | Admin/Operator | Ringkasan gateway. |
| `GET` | `/dashboard/services` | Admin/Operator | Manajemen dan monitoring service. |
| `GET` | `/dashboard/routes` | Admin/Operator | Dokumentasi route integrator. |
| `GET` | `/dashboard/consumers` | Admin/Operator | Ringkasan consumer/source app. |
| `GET` | `/dashboard/employees` | Admin/Operator | Data karyawan demo. |
| `GET` | `/dashboard/plugins` | Admin/Operator | Informasi plugin/middleware gateway. |
| `GET` | `/dashboard/analytics` | Admin/Operator | Analytics traffic dan efektivitas service. |
| `GET` | `/dashboard/analytics/export` | Admin/Operator | Export data analytics. |
| `GET` | `/dashboard/logs` | Admin/Operator | Halaman log request. |
| `GET` | `/dashboard/logs/export` | Admin/Operator | Export request logs. |
| `GET` | `/dashboard/revenue` | Admin | Dashboard revenue/fee gateway. |
| `GET` | `/dashboard/revenue/export` | Admin | Export revenue logs. |
| `GET` | `/dashboard/users` | Admin | Manajemen user. |
| `GET` | `/dashboard/apikeys` | Admin | Halaman pengelolaan API key. |
| `GET` | `/dashboard/audit` | Admin | Audit log sistem. |
| `GET` | `/dashboard/audit/export` | Admin | Export audit log. |
| `GET` | `/dashboard/health-history` | Admin/Operator | Riwayat health check service. |
| `GET` | `/dashboard/alerts` | Admin/Operator | Alert sistem. |
| `GET` | `/dashboard/architecture` | Admin/Operator | Dokumentasi arsitektur gateway. |
| `GET` | `/dashboard/docs` | Admin/Operator | Dokumentasi API di dashboard. |
| `GET` | `/client-portal` | Login | Portal client untuk token dan simulasi request. |
| `GET` | `/download-docs` | Publik | Mengunduh dokumen panduan jika file tersedia. |
| `POST` | `/generate-test-token` | Login + CSRF | Generate JWT demo untuk request gateway. |
| `POST` | `/api/tokens/revoke` | Login + CSRF | Mencabut token API/JWT demo. |
| `GET` | `/api/status` | Publik | Status gateway dan service aktif. |
| `GET` | `/api/logs` | Admin/Operator | Data log request dalam format JSON. |
| `GET` | `/api/services` | Admin/Operator | Daftar service gateway. |
| `POST` | `/api/services` | Admin | Menambah service gateway. |
| `POST` | `/api/services/:id/test` | Admin/Operator | Test koneksi service. |
| `GET` | `/api/users` | Admin | Daftar user. |
| `POST` | `/api/users` | Admin | Menambah user. |
| `POST` | `/api/users/:id/reset-password` | Admin | Reset password user. |
| `GET` | `/api/keys` | Login | Daftar API key milik user login. |
| `POST` | `/api/keys` | Login + CSRF | Membuat API key baru. |
| `DELETE` | `/api/keys/:id` | Login + CSRF | Menonaktifkan API key. |
| `POST` | `/api/demo/simulate` | Login | Simulasi request integrasi. |
| `POST` | `/api/demo/seed-data` | Admin | Seed data demo untuk logs, revenue, alert, dan shadow usage. |
| `GET` | `/integrator/routing_api` | Bearer JWT/API Key | Daftar routing service aktif. |
| `GET` | `/integrator/validasi_request` | Bearer JWT/API Key | Validasi token gateway. |
| `GET` | `/integrator/logging` | Bearer JWT/API Key | Log aktivitas gateway. |
| `GET` | `/integrator/biaya_layanan_integrasi` | Bearer JWT/API Key | Informasi fee gateway. |
| `ALL` | `/integrator/:service` | Bearer JWT/API Key | Proxy request ke root service tujuan. |
| `ALL` | `/integrator/:service/:path` | Bearer JWT/API Key | Proxy request ke path service tujuan. |

---

## API Key dan Autentikasi

RPL Integrator menggunakan beberapa mekanisme autentikasi sesuai area aplikasi.

| Area | Mekanisme | Keterangan |
|---|---|---|
| Dashboard | Session cookie JWT | Digunakan setelah login melalui `/login`. |
| Client Portal | Session cookie JWT | User login dapat mengakses portal dan membuat token/API key. |
| API Gateway | Header `Authorization: Bearer <token>` | Token dapat berupa JWT demo atau API key. |
| API Key | Prefix `igw_` | API key dibuat dari menu API key dan dapat digunakan sebagai Bearer token. |
| Form/API Internal | CSRF token | Digunakan untuk aksi internal seperti generate token, tambah service, dan API key. |

Contoh header gateway:

```http
Authorization: Bearer <JWT_atau_API_KEY_igw>
```

Contoh request ke gateway:

```bash
curl.exe http://localhost:3000/integrator/routing_api `
  -H "Authorization: Bearer <TOKEN>"
```

Catatan penting:

- JWT demo dapat dibuat dari Client Portal atau endpoint `/generate-test-token` setelah login.
- API key aktif dibatasi maksimal 5 key per user.
- API key memiliki daily limit dan pencatatan usage harian.
- Token/API key yang tidak valid akan ditolak sebelum request diteruskan ke service tujuan.

---

## Catatan Docker

- Mode Docker tidak membutuhkan Laragon.
- MySQL berjalan di dalam container `rpl-integrator-mysql`.
- Aplikasi berjalan di container `rpl-integrator-app`.
- Data MySQL disimpan di Docker volume `mysql_data`.
- File `.env` lokal tidak perlu dan tidak boleh disalin ke Docker image.
- Konfigurasi Docker lokal dapat mengacu pada `.env.docker.example`.
- Service upstream yang berjalan di host dapat diakses container melalui `host.docker.internal`.

---

## Screenshots

Belum ada screenshot yang ditambahkan ke repository ini.

Screenshot untuk dokumentasi harus menggunakan tangkapan layar asli dari aplikasi yang berjalan lokal. Jika belum tersedia, biarkan bagian ini sebagai daftar kebutuhan dokumentasi.

| Tampilan | Screenshot |
|---|---|
| Landing Page | Tambahkan screenshot asli landing page. |
| Login | Tambahkan screenshot asli halaman login. |
| Dashboard | Tambahkan screenshot asli dashboard. |
| Services | Tambahkan screenshot asli halaman services. |
| Analytics | Tambahkan screenshot asli halaman analytics. |
| Revenue | Tambahkan screenshot asli halaman revenue. |
| Client Portal | Tambahkan screenshot asli client portal. |
| Dokumentasi API | Tambahkan screenshot asli dokumentasi API. |

> Jangan menambahkan screenshot palsu. Gunakan gambar asli dari aplikasi yang berjalan lokal.

---

## Troubleshooting

| Masalah | Penyebab Umum | Solusi |
|---|---|---|
| Docker Desktop tidak berjalan | Docker service belum aktif. | Buka Docker Desktop dan tunggu sampai status running, lalu jalankan ulang `docker compose up --build -d`. |
| Port `3000` tidak tersedia | Port digunakan aplikasi/container lain. | Hentikan aplikasi lain atau ubah mapping port di `docker-compose.yml`. |
| Database connection issue | Konfigurasi `DB_HOST`, user, password, atau container MySQL belum siap. | Untuk Docker gunakan `DB_HOST=mysql`; cek status dengan `docker compose ps`. |
| Login demo gagal | Seed user belum berjalan atau database belum siap. | Restart app container setelah MySQL healthy: `docker compose restart app`. |
| `/api/status` tidak merespons | Container app belum aktif atau build gagal. | Cek log dengan `docker compose logs app`. |
| Service upstream gagal dipanggil | Service tujuan tidak berjalan atau URL salah. | Sesuaikan URL service seperti `SMARTBANK_URL`, `MARKETPLACE_URL`, dan lainnya. |
| `.env` lokal terbawa ke Docker image | File `.env` lokal berisi konfigurasi host/Laragon. | Jangan copy `.env` lokal ke image; gunakan environment Compose atau `.env.docker.example` sebagai acuan. |

---

## Catatan Evaluasi

Beberapa kebutuhan tambahan yang sudah diakomodasi dalam implementasi dan dokumentasi:

| Kebutuhan | Implementasi |
|---|---|
| Endpoint verification | Endpoint aktual didokumentasikan pada tabel endpoint terverifikasi. |
| One-click demo login | Login demo admin, operator, dan user tersedia di halaman `/login`. |
| Employee demo data | Tabel `employees` dan seed data EMP001 sampai EMP005 tersedia untuk demo. |
| Shadow table | Tabel `shadow_service_usage` mencatat penggunaan service tambahan tanpa mengubah perilaku utama `request_logs`. |
| Docker Desktop support | App dan MySQL berjalan melalui Docker Compose dengan volume database persisten. |
| API status | Endpoint `/api/status` tersedia untuk cek status gateway dan service aktif. |

---

## Testing / Validasi

Validasi project dapat dilakukan secara bertahap sesuai kebutuhan review:

- `npm run check` digunakan untuk memvalidasi sintaks JavaScript pada file-file utama yang ditentukan di repository.
- `npm test` dapat digunakan jika test tersedia dan dikonfigurasi di repository.
- Validasi Docker dapat dilakukan dengan menjalankan aplikasi lalu mengecek endpoint status.

```bash
npm run check
npm test
docker compose up --build -d
curl.exe http://localhost:3000/api/status
```

Dokumentasi ini tidak menyatakan cakupan test detail kecuali sudah diverifikasi dari file test aktual. Perubahan dokumentasi juga tidak mengubah logic aplikasi, frontend UI, backend, Docker configuration, database schema, route, auth, atau perilaku API.
