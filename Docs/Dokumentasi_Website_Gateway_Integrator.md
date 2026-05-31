# Dokumentasi Website Gateway Integrator

## 1. Ringkasan Aplikasi

Gateway Integrator adalah website dashboard dan API gateway berbasis Node.js, Express, EJS, dan MySQL. Website ini berfungsi sebagai pusat akses untuk memantau request API, mengelola autentikasi pengguna, melihat statistik layanan, menjalankan simulasi request, serta mencatat pendapatan gateway dari transaksi yang berhasil.

Aplikasi ini dirancang sebagai middleware antara client dan beberapa service dalam ekosistem UMKM, seperti SmartBank, Marketplace, POS, SupplierHub, LogistiKita, dan UMKM Insight.

Dashboard menggunakan arsitektur multi-section yang terinspirasi dari Kong Konnect, dengan sidebar navigasi dan halaman terpisah untuk setiap modul. Sistem juga dilengkapi dengan fitur CRUD untuk manajemen service dan user, serta audit trail untuk log dan pendapatan.

## 2. Tujuan Website

Website ini dibuat untuk:

- Menyediakan halaman login dan registrasi dengan pembagian role pengguna.
- Menampilkan dashboard statistik API dengan arsitektur multi-section (9 halaman).
- Menyediakan CRUD (Create, Read, Update, Delete) untuk manajemen service API.
- Menyediakan CRUD untuk manajemen user dan role.
- Menyediakan client portal untuk generate token dan simulasi request API.
- Memisahkan log traffic request dari pencatatan pendapatan (audit trail).
- Menggunakan tabel database `api_services` sebagai sumber routing service.
- Menerapkan keamanan berlapis: rate limiting, Helmet security headers, dan JWT session.
- Memberikan tampilan UI yang modern, premium, dan responsif dengan animasi micro-interaction.

## 3. Teknologi yang Digunakan

| Komponen | Teknologi |
|---|---|
| Backend | Node.js, Express.js |
| View Engine | EJS |
| Database | MySQL |
| Database Driver | mysql2 (promise-based) |
| HTTP Client | Axios |
| Authentication | JWT + HTTP-only cookie (scrypt hash) |
| API Token | JWT Bearer Token |
| UI Chart | Chart.js |
| UI Icon | Lucide Icons |
| Font | Google Fonts (Inter) |
| Styling | CSS custom theme (Kong Konnect style) |
| Security | Helmet, express-rate-limit |

### 3.1 Konfigurasi Environment (`.env`)

Aplikasi menggunakan file `.env` di root project untuk menyimpan konfigurasi sensitif dan parameter runtime. Berikut penjelasan setiap variabel:

| Variabel | Nilai Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server Express |
| `JWT_SECRET` | `integrator_kelompok7_secret_key_2026` | Secret key untuk signing JWT session dan API token |
| `SMARTBANK_URL` | `http://localhost:3001` | Base URL service SmartBank |
| `MARKETPLACE_URL` | `http://localhost:3002` | Base URL service Marketplace |
| `POS_URL` | `http://localhost:3003` | Base URL service POS |
| `SUPPLIERHUB_URL` | `http://localhost:3004` | Base URL service SupplierHub |
| `LOGISTIKITA_URL` | `http://192.168.18.94:3005` | Base URL service LogistiKita (IP jaringan lokal) |
| `UMKM_INSIGHT_URL` | `http://localhost:3006` | Base URL service UMKM Insight |
| `GATEWAY_FEE_PERCENT` | `0.5` | Persentase fee gateway dari setiap transaksi (0.5%) |
| `DB_HOST` | `localhost` | Host database MySQL (Laragon) |
| `DB_PORT` | `3306` | Port database MySQL |
| `DB_USER` | `root` | Username database MySQL |
| `DB_PASSWORD` | *(kosong)* | Password database MySQL (default Laragon tanpa password) |
| `DB_NAME` | `rpl_integrator` | Nama database yang digunakan |

**Catatan:** Pada konfigurasi lokal Laragon, MySQL menggunakan user `root` tanpa password. Untuk deployment production, pastikan menggunakan password yang aman dan `JWT_SECRET` yang lebih panjang.

## 4. Role Pengguna

Website memiliki tiga role utama:

| Role | Hak Akses |
|---|---|
| Admin | Akses penuh: dashboard overview, services (CRUD), routes, consumers, plugins, analytics, request logs (filter + pagination), revenue, user management (CRUD), client portal |
| Operator | Dashboard overview, services (read), routes, consumers, plugins, analytics, request logs (filter + pagination), client portal. Tidak dapat melihat revenue dan user management |
| User | Hanya dapat mengakses client portal untuk generate token dan simulasi request API |

Pembatasan role dilakukan melalui middleware `requireAuth` dan `requireRole`.

## 5. Struktur Halaman Website

### 5.1 Landing Page

URL:

```text
GET /
```

Landing page adalah halaman pembuka aplikasi. Halaman ini menampilkan identitas aplikasi, deskripsi singkat Gateway Integrator, dan tombol menuju login, registrasi, atau status API.

Fitur utama:

- Menampilkan nama aplikasi Gateway Integrator.
- Menjelaskan fungsi utama gateway.
- Menampilkan highlight fitur seperti validasi JWT, dynamic routing, revenue ledger, dan dashboard statistik.
- Menyediakan tombol Login Dashboard, Daftar Akun, dan Cek Status API.
- Animasi entrance stagger pada elemen hero dan feature cards.

### 5.2 Login Page

URL:

```text
GET /login
POST /login
```

Halaman login digunakan untuk autentikasi pengguna website. Setelah login berhasil, pengguna akan diarahkan sesuai role.

Alur login:

1. Pengguna mengisi username dan password.
2. Server mencari user di tabel `users`.
3. Password diverifikasi menggunakan hash scrypt.
4. Jika valid, server membuat session token JWT (tipe `dashboard_session`).
5. Token disimpan dalam HTTP-only cookie.
6. Admin dan Operator diarahkan ke `/dashboard`, User diarahkan ke `/client-portal`.

Akun awal:

| Username | Password | Role |
|---|---|---|
| admin | admin123 | admin |
| operator | operator123 | operator |
| user | user123 | user |

Rate limiting: Maksimal 10 percobaan login per menit per IP.

### 5.3 Register Page

URL:

```text
GET /register
POST /register
```

Halaman registrasi untuk membuat akun baru. User baru otomatis mendapat role `user`.

Fitur:

- Validasi username minimal 3 karakter.
- Validasi password minimal 6 karakter.
- Konfirmasi password harus cocok.
- Pengecekan username duplikat.
- Rate limiting sama dengan login (10 request/menit).
- Setelah berhasil, tampil pesan sukses dengan link ke halaman login.

### 5.4 Dashboard (Multi-Section)

Dashboard menggunakan arsitektur multi-section dengan sidebar navigasi ala Kong Konnect. Setiap section memiliki route sendiri dan menampilkan data spesifik.

**Catatan Teknis — Penanganan Data Session:**

Dashboard mendukung fitur multi-session (login beberapa role sekaligus). Data session (`allSessions` dan `activeRole`) diteruskan ke template melalui helper `dashboardBase(req, res)` di `server.js`, yang secara eksplisit membaca `res.locals.allSessions` dan `res.locals.activeRole` dari middleware `requireAuth`. Di sisi template `dashboard.ejs`, digunakan *safe check* (`typeof allSessions !== 'undefined'`) untuk menghindari `ReferenceError` jika variabel belum terdefinisi, serta alias `_activeRole` dengan fallback ke `currentUser.role`. Pendekatan ini memastikan data session selalu tersedia tanpa bergantung pada *implicit merging* `res.locals` oleh Express.

#### 5.4.1 Gateway Overview

URL: `GET /dashboard`

Halaman utama dashboard yang menampilkan ringkasan status gateway.

- Status gateway online/offline dengan indikator berkedip.
- Uptime server.
- Stat cards: Active Services, Total Requests (dengan success rate), Consumers, dan Revenue (admin only).
- Grafik traffic 7 hari terakhir (Chart.js line chart).
- Tabel recent activity (5 log terbaru).

#### 5.4.2 Services

URL: `GET /dashboard/services`

Menampilkan daftar semua API service yang terdaftar di gateway. Admin memiliki akses CRUD penuh.

| Fitur | Admin | Operator |
|---|---|---|
| Melihat daftar service | Ya | Ya |
| Membuat service baru | Ya | Tidak |
| Mengedit service | Ya | Tidak |
| Menghapus service | Ya | Tidak |

Informasi yang ditampilkan per service:
- ID, nama service, target URL, status aktif/nonaktif.
- Total requests dan waktu aktivitas terakhir.

CRUD melalui modal dialog:
- **Create**: Tombol "+ New Service" membuka form nama service, target URL, dan status.
- **Update**: Tombol edit pada setiap baris service.
- **Delete**: Tombol delete dengan konfirmasi dialog.

#### 5.4.3 Routes

URL: `GET /dashboard/routes`

Menampilkan peta routing otomatis berdasarkan service yang terdaftar. Setiap service memiliki pola:

```text
Gateway Pattern: /integrator/{nama_service}/{path}
Target Rule:     {url_tujuan}/{path}
Auth:            JWT Bearer
```

#### 5.4.4 Consumers

URL: `GET /dashboard/consumers`

Menampilkan daftar consumer (pengguna API) yang terdeteksi dari traffic log. Data otomatis diekstrak dari `request_logs`.

Informasi: user_id, total requests, first seen, last seen.

#### 5.4.5 Plugins

URL: `GET /dashboard/plugins`

Menampilkan plugin middleware yang aktif di gateway dalam bentuk card view:

| Plugin | Fungsi | Konfigurasi |
|---|---|---|
| JWT Authentication | Validasi token API | Algorithm: HS256, Expiry: 24h |
| Rate Limiting | Pembatasan request | Login: 10/menit, API: 60/menit |
| Request Logger | Pencatatan traffic | Target: MySQL request_logs |
| Helmet Security | HTTP security headers | CSP: disabled, XSS: enabled |

#### 5.4.6 Analytics

URL: `GET /dashboard/analytics`

Halaman analisis performa dan traffic gateway.

- Stat cards: Total Requests, Error Rate, Top Consumer.
- Grafik bar chart: Requests per Service.
- Grafik line chart: Traffic Timeline 14 hari.
- Tabel: Top 10 Consumers berdasarkan jumlah request.

#### 5.4.7 Request Logs

URL: `GET /dashboard/logs`

Menampilkan seluruh log traffic gateway. Data bersifat **read-only** untuk menjaga integritas audit trail.

Fitur:
- Filter berdasarkan service dan status (SUCCESS, ERROR, PENDING).
- Search berdasarkan user_id atau URL.
- Pagination (20 log per halaman).
- Informasi: ID, waktu, IP, method, service, URL, user, status.

**Penting:** Tidak ada fitur Edit atau Delete pada log. Ini demi keamanan rekam jejak (audit trail).

#### 5.4.8 User Management (Admin Only)

URL: `GET /dashboard/users`

Halaman manajemen user hanya dapat diakses oleh admin.

CRUD:
- **Create**: Tombol "+ New User" membuka form username, password, dan role.
- **Read**: Menampilkan daftar semua user dengan ID, username, role, dan tanggal pembuatan.
- **Update**: Tombol edit untuk mengubah role atau reset password. Password lama tidak perlu diketahui.
- **Delete**: Tombol delete dengan konfirmasi. Admin tidak dapat menghapus akunnya sendiri (self-delete protection).

#### 5.4.9 Revenue (Admin Only)

URL: `GET /dashboard/revenue`

Halaman pendapatan gateway hanya dapat diakses oleh admin. Data bersifat **read-only** untuk menjaga integritas audit trail.

- Stat card: Total Pendapatan Gateway.
- Grafik line chart: Pendapatan per Hari.
- Tabel breakdown: Pendapatan per Service (total fee dan jumlah transaksi).

**Penting:** Tidak ada fitur Edit atau Delete pada data revenue. Ini demi keamanan rekam jejak (audit trail).

### 5.5 Client Portal

URL:

```text
GET /client-portal
```

Client Portal dapat diakses oleh admin, operator, dan user. Halaman ini digunakan untuk membuat token API dan melakukan simulasi request.

Fitur utama:

- Generate JWT Bearer token.
- Quick test endpoint internal gateway.
- Simulasi API ke enam service.
- Preview fee gateway secara real-time.
- Mode demo simulasi sukses.
- Mode live request ke service asli.
- Panduan integrasi API.

### 5.6 System Status

URL:

```text
GET /api/status
```

Endpoint publik untuk melihat status aplikasi gateway. Response berisi: status server, uptime, jumlah request, jumlah service terdaftar, jumlah service aktif, fee gateway, dan timestamp.

## 6. Alur Navigasi Website

```mermaid
flowchart TD
    A["Landing Page /"] --> B["Login /login"]
    A --> R["Register /register"]
    R --> B
    B --> C{"Role User"}
    C -->|Admin| D["Dashboard /dashboard"]
    C -->|Operator| E["Dashboard /dashboard"]
    C -->|User| F["Client Portal /client-portal"]
    D --> D1["Services /dashboard/services"]
    D --> D2["Routes /dashboard/routes"]
    D --> D3["Consumers /dashboard/consumers"]
    D --> D4["Plugins /dashboard/plugins"]
    D --> D5["Analytics /dashboard/analytics"]
    D --> D6["Request Logs /dashboard/logs"]
    D --> D7["User Management /dashboard/users"]
    D --> D8["Revenue /dashboard/revenue"]
    E --> D1
    E --> D2
    E --> D3
    E --> D4
    E --> D5
    E --> D6
    D --> F
    E --> F
    F --> G["Generate API Token"]
    F --> H["Demo / Live API Request"]
```

## 7. Alur Autentikasi Website

```mermaid
sequenceDiagram
    participant User
    participant Website
    participant Database

    User->>Website: Submit username dan password
    Website->>Database: Query user berdasarkan username
    Database-->>Website: Data user dan password_hash
    Website->>Website: Verifikasi password scrypt
    Website->>Website: Buat JWT session (type: dashboard_session)
    Website-->>User: Set HTTP-only cookie dan redirect
```

## 8. Alur API Gateway

```mermaid
sequenceDiagram
    participant Client
    participant Gateway
    participant Database
    participant Service

    Client->>Gateway: Request /integrator/:service/:path + Bearer Token
    Gateway->>Database: Insert request_logs status PENDING
    Gateway->>Gateway: Validasi JWT token
    Gateway->>Database: Query api_services berdasarkan nama service
    Gateway->>Service: Forward request ke url_tujuan
    Service-->>Gateway: Response service
    Gateway->>Database: Update request_logs status SUCCESS/ERROR
    Gateway->>Database: Jika sukses dan amount > 0, insert revenue_logs
    Gateway-->>Client: Response JSON
```

## 9. Desain Database

### 9.1 Tabel users

Tabel `users` menyimpan akun website.

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT | Primary key, auto increment |
| username | VARCHAR(100) | Username unik |
| password_hash | VARCHAR(255) | Hash password menggunakan scrypt |
| role | ENUM | admin, operator, user |
| created_at | DATETIME | Waktu pembuatan akun |

### 9.2 Tabel api_services

Tabel `api_services` menyimpan daftar service tujuan gateway.

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT | Primary key, auto increment |
| nama_service | VARCHAR(100) | Nama service, misalnya smartbank |
| url_tujuan | VARCHAR(500) | Base URL service tujuan |
| status_aktif | TINYINT | 1 aktif, 0 nonaktif |
| created_at | DATETIME | Waktu data dibuat |
| updated_at | DATETIME | Waktu data diperbarui |

### 9.3 Tabel request_logs

Tabel `request_logs` hanya menyimpan metadata request API.

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT | Primary key, auto increment |
| waktu | VARCHAR(100) | Waktu request format lokal |
| timestamp | DATETIME | Timestamp request |
| ip | VARCHAR(50) | IP client |
| metode | VARCHAR(10) | HTTP method |
| url_tujuan | VARCHAR(500) | URL request gateway |
| user_id | VARCHAR(100) | User dari token |
| service_tujuan | VARCHAR(100) | Nama service tujuan |
| status | VARCHAR(20) | PENDING, FORWARDED, SUCCESS, ERROR |
| response_status | INT | HTTP status response |
| mode | VARCHAR(20) | DEMO atau NULL |

### 9.4 Tabel revenue_logs

Tabel `revenue_logs` menyimpan pencatatan fee atau pendapatan gateway.

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT | Primary key, auto increment |
| request_id | INT | Relasi ke request_logs |
| nominal_fee | DECIMAL(12,2) | Nominal fee gateway |
| waktu | DATETIME | Waktu pencatatan pendapatan |

## 10. Pemisahan Request Log dan Revenue Log

Sebelum upgrade, fee disimpan langsung di tabel `request_logs`. Setelah upgrade, pencatatan dipisahkan:

- `request_logs` fokus pada metadata traffic API.
- `revenue_logs` fokus pada pencatatan uang atau fee.

Keuntungan desain ini:

- Struktur database lebih rapi.
- Statistik traffic dan statistik pendapatan tidak tercampur.
- Revenue dapat diaudit secara terpisah.
- Query dashboard lebih jelas.
- Cocok untuk pengembangan fitur laporan keuangan.

**Audit Trail**: Data pada tabel `request_logs` dan `revenue_logs` hanya memiliki operasi Create dan Read melalui UI. Tidak ada fitur Update atau Delete yang disediakan demi menjaga integritas data rekam jejak.

## 11. Dynamic Service Routing

Gateway tidak lagi mengambil routing service dari konfigurasi hardcode. Service tujuan dibaca dari tabel `api_services`.

Contoh data service:

| nama_service | url_tujuan | status_aktif |
|---|---|---|
| smartbank | http://localhost:3001 | 1 |
| marketplace | http://localhost:3002 | 1 |
| pos | http://localhost:3003 | 1 |
| supplierhub | http://localhost:3004 | 1 |
| logistikita | http://192.168.18.94:3005 | 1 |
| umkm_insight | http://localhost:3006 | 1 |

Contoh route:

```text
/integrator/smartbank/pembayaran_transaksi
```

Gateway akan:

1. Membaca `smartbank` dari parameter URL.
2. Query `api_services` untuk mendapatkan `url_tujuan`.
3. Jika `status_aktif = 0`, menolak request dengan status 503 Service Unavailable.
4. Forward request ke service tujuan menggunakan Axios.
5. Mencatat hasil request ke `request_logs`.
6. Jika sukses dan amount > 0, mencatat fee ke `revenue_logs`.

## 12. Statistik dan Grafik Dashboard

Dashboard menggunakan Chart.js untuk menampilkan data statistik.

Grafik yang tersedia:

| Halaman | Grafik | Tipe | Sumber Data |
|---|---|---|---|
| Overview | Traffic 7 Hari Terakhir | Line Chart | request_logs |
| Analytics | Requests per Service | Bar Chart | request_logs + api_services |
| Analytics | Traffic Timeline 14 Hari | Line Chart | request_logs |
| Revenue | Pendapatan per Hari | Line Chart | revenue_logs |

Operator tidak melihat halaman Revenue karena data keuangan hanya ditampilkan untuk admin.

## 13. Endpoint Website dan API

### 13.1 Endpoint Website (Halaman)

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| GET | / | Publik | Landing page |
| GET | /login | Publik | Halaman login |
| POST | /login | Publik | Proses login |
| GET | /register | Publik | Halaman registrasi |
| POST | /register | Publik | Proses registrasi |
| POST | /logout | Login | Logout dan hapus cookie |
| GET | /dashboard | Admin, Operator | Gateway Overview |
| GET | /dashboard/services | Admin, Operator | Daftar service |
| GET | /dashboard/routes | Admin, Operator | Peta routing |
| GET | /dashboard/consumers | Admin, Operator | Daftar consumers |
| GET | /dashboard/plugins | Admin, Operator | Plugin middleware |
| GET | /dashboard/analytics | Admin, Operator | Analisis traffic |
| GET | /dashboard/logs | Admin, Operator | Request logs + filter |
| GET | /dashboard/users | Admin | User management |
| GET | /dashboard/revenue | Admin | Pendapatan gateway |
| GET | /client-portal | Semua role | Client portal |

### 13.2 Endpoint API CRUD (Admin Only)

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | /api/services | Daftar semua service |
| POST | /api/services | Tambah service baru |
| PUT | /api/services/:id | Edit service (url, status) |
| DELETE | /api/services/:id | Hapus service |
| GET | /api/users | Daftar semua user |
| POST | /api/users | Tambah user baru |
| PUT | /api/users/:id | Edit role / reset password |
| DELETE | /api/users/:id | Hapus user |

### 13.3 Endpoint API Internal

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| GET | /api/status | Publik | Status server |
| GET | /api/logs | Admin, Operator | Log dalam format JSON |
| POST | /api/demo/simulate | Semua role | Simulasi demo |
| POST | /generate-test-token | Semua role | Generate token API |

### 13.4 Endpoint API Gateway

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| ALL | /integrator/:service/:path | JWT Bearer | Forward ke service |
| ALL | /integrator/:service | JWT Bearer | Forward ke service (tanpa sub-path) |
| GET | /integrator/routing_api | JWT Bearer | Info routing |
| GET | /integrator/validasi_request | JWT Bearer | Info validasi |
| GET | /integrator/logging | JWT Bearer | Info logging |
| GET | /integrator/biaya_layanan_integrasi | JWT Bearer | Info fee |

## 14. Contoh Penggunaan Client Portal

### Generate Token

1. Login ke website.
2. Buka halaman Client Portal.
3. Isi User ID dan Nama.
4. Klik tombol Generate.
5. Token akan muncul di input token dan bisa disalin.

### Demo Simulasi

1. Pilih service tujuan.
2. Isi amount transaksi.
3. Klik Demo Simulasi Sukses.
4. Website akan menampilkan response JSON simulasi.
5. Request tercatat ke `request_logs`.
6. Jika amount lebih dari 0, fee tercatat ke `revenue_logs`.

### Live Request

1. Pilih endpoint service tujuan.
2. Pastikan service downstream berjalan.
3. Isi token dan amount.
4. Klik Live Request.
5. Gateway akan meneruskan request ke service asli.

## 15. Keamanan

Fitur keamanan yang diterapkan:

- Login menggunakan password hash scrypt dengan salt random.
- Session disimpan dalam HTTP-only cookie (tidak bisa diakses oleh JavaScript).
- Session token JWT menggunakan tipe `dashboard_session` untuk mencegah token API digunakan untuk akses dashboard.
- Proteksi halaman menggunakan middleware `requireAuth`.
- Pembatasan role menggunakan middleware `requireRole`.
- Endpoint gateway memerlukan JWT Bearer token.
- Token API memiliki masa berlaku 24 jam.
- Rate limiting: Login 10 request/menit, API gateway 60 request/menit.
- Helmet security headers aktif (XSS protection, HSTS, X-Frame-Options, dll).
- Self-delete protection: Admin tidak bisa menghapus akunnya sendiri.
- Audit trail: Log dan revenue tidak bisa diedit atau dihapus melalui UI.
- Error message tidak mengekspos detail internal (stack trace, SQL error).

## 16. Struktur File Website

```text
RPL_Integrator-main/
├── server.js                  # Entry point + semua route
├── .env                       # Konfigurasi environment
├── package.json               # Dependency Node.js
├── config/
│   ├── database.js            # Koneksi MySQL + auto-create tabel
│   └── init.sql               # SQL initialization script
├── middleware/
│   ├── auth.js                # requireAuth, requireRole, validateApiToken, password hash
│   └── logger.js              # Middleware pencatat request ke database
├── routes/
│   └── gateway.js             # Logic forward request ke service tujuan
├── views/
│   ├── index.ejs              # Landing page
│   ├── login.ejs              # Halaman login
│   ├── register.ejs           # Halaman registrasi
│   ├── dashboard.ejs          # Dashboard multi-section (9 halaman)
│   └── client_portal.ejs      # Client portal
├── public/
│   └── css/
│       └── kong-theme.css     # Stylesheet global + animasi
└── Docs/
    └── Dokumentasi_Website_Gateway_Integrator.md
```

## 17. Cara Menjalankan Website

### 17.1 Install Dependency

```bash
npm install
```

### 17.2 Pastikan MySQL Berjalan

Pastikan MySQL di Laragon sudah aktif dan database `rpl_integrator` tersedia. Aplikasi akan membuat tabel yang diperlukan saat server dijalankan.

### 17.3 Konfigurasi Environment

Buat file `.env` di root project:

```env
PORT=3000
JWT_SECRET=integrator_kelompok7_secret_key_2026

# URL Service Ekosistem UMKM
SMARTBANK_URL=http://localhost:3001
MARKETPLACE_URL=http://localhost:3002
POS_URL=http://localhost:3003
SUPPLIERHUB_URL=http://localhost:3004
LOGISTIKITA_URL=http://192.168.18.94:3005
UMKM_INSIGHT_URL=http://localhost:3006

# Fee Gateway (Doc6: 0.5% dari setiap transaksi)
GATEWAY_FEE_PERCENT=0.5

# Konfigurasi Database MySQL (Laragon)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=rpl_integrator
```

### 17.4 Jalankan Server

```bash
node server.js
```

### 17.5 Akses Website

```text
Landing Page  : http://localhost:3000
Register      : http://localhost:3000/register
Login Page    : http://localhost:3000/login
Dashboard     : http://localhost:3000/dashboard
Client Portal : http://localhost:3000/client-portal
API Status    : http://localhost:3000/api/status
```

## 18. Panduan Integrasi dengan Aplikasi Lain

### 18.1 Konsep Integrasi

Gateway Integrator berfungsi sebagai middleware sentral (API Gateway) yang menjembatani komunikasi antara client application dan service backend UMKM. Semua service tidak perlu saling mengenal satu sama lain — cukup terhubung melalui gateway.

```text
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Client     │────>│  Gateway         │────>│  SmartBank   │
│   App        │     │  Integrator      │────>│  Marketplace │
│   (Frontend) │     │  (Port 3000)     │────>│  POS         │
│              │<────│                  │────>│  SupplierHub │
└──────────────┘     └──────────────────┘     │  LogistiKita │
                                              │  UMKM Insight│
                                              └──────────────┘
```

### 18.2 Integrasi Secara Lokal (Localhost)

#### Langkah 1: Daftarkan Service di Gateway

Setiap service UMKM harus didaftarkan terlebih dahulu di gateway melalui dashboard admin:

1. Login sebagai admin di `http://localhost:3000/login`.
2. Buka menu **Services** di sidebar.
3. Klik **+ New Service**.
4. Isi nama service (contoh: `smartbank`) dan target URL (contoh: `http://localhost:3001`).
5. Pastikan status **Active**.
6. Simpan.

Atau menggunakan API:

```bash
curl -X POST http://localhost:3000/api/services \
  -H "Content-Type: application/json" \
  -H "Cookie: gateway_session=<token_admin>" \
  -d '{
    "nama_service": "smartbank",
    "url_tujuan": "http://localhost:3001",
    "status_aktif": 1
  }'
```

#### Langkah 2: Jalankan Semua Service

Setiap service harus berjalan di port masing-masing:

```bash
# Terminal 1 - Gateway Integrator
cd RPL_Integrator-main && node server.js
# Berjalan di port 3000

# Terminal 2 - SmartBank
cd SmartBank && node server.js
# Berjalan di port 3001

# Terminal 3 - Marketplace
cd Marketplace && node server.js
# Berjalan di port 3002

# Terminal 4 - POS
cd POS && node server.js
# Berjalan di port 3003

# Terminal 5 - SupplierHub
cd SupplierHub && node server.js
# Berjalan di port 3004

# Terminal 6 - LogistiKita
cd LogistiKita && node server.js
# Berjalan di port 3005

# Terminal 7 - UMKM Insight
cd UMKMInsight && node server.js
# Berjalan di port 3006
```

#### Langkah 3: Dapatkan Token API

Generate token melalui Client Portal atau API:

```bash
curl -X POST http://localhost:3000/generate-test-token \
  -H "Cookie: gateway_session=<token_session>" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "714240061", "name": "Mahasiswa"}'
```

Response:

```json
{
  "status": "success",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI...",
  "payload": {
    "user_id": "714240061",
    "name": "Mahasiswa",
    "role": "admin"
  }
}
```

#### Langkah 4: Kirim Request Melalui Gateway

Semua request ke service harus melalui gateway dengan format:

```text
[METHOD] http://localhost:3000/integrator/{nama_service}/{path}
Header: Authorization: Bearer <token>
```

Contoh request ke SmartBank:

```bash
# Contoh GET
curl http://localhost:3000/integrator/smartbank/saldo \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI..."

# Contoh POST
curl -X POST http://localhost:3000/integrator/smartbank/pembayaran_transaksi \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI..." \
  -H "Content-Type: application/json" \
  -d '{"jumlah": 100000, "tujuan": "PLN"}'
```

Contoh request ke service lain:

```bash
# Marketplace
curl http://localhost:3000/integrator/marketplace/produk \
  -H "Authorization: Bearer <token>"

# POS
curl -X POST http://localhost:3000/integrator/pos/transaksi \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"nama": "Kopi", "harga": 15000}]}'

# SupplierHub
curl http://localhost:3000/integrator/supplierhub/stok \
  -H "Authorization: Bearer <token>"

# LogistiKita
curl http://localhost:3000/integrator/logistikita/tracking/12345 \
  -H "Authorization: Bearer <token>"

# UMKM Insight
curl http://localhost:3000/integrator/umkm_insight/laporan \
  -H "Authorization: Bearer <token>"
```

#### Langkah 5: Integrasi dari Aplikasi Frontend/Backend

Contoh integrasi dari aplikasi JavaScript (Node.js):

```javascript
const axios = require('axios');

const GATEWAY_URL = 'http://localhost:3000';
const API_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI...'; // Token dari gateway

// Request ke SmartBank melalui gateway
async function cekSaldo() {
    const response = await axios.get(`${GATEWAY_URL}/integrator/smartbank/saldo`, {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    });
    console.log(response.data);
}

// Request ke Marketplace melalui gateway
async function lihatProduk() {
    const response = await axios.get(`${GATEWAY_URL}/integrator/marketplace/produk`, {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    });
    console.log(response.data);
}
```

Contoh integrasi dari PHP/Laravel:

```php
<?php
$gatewayUrl = 'http://localhost:3000';
$token = 'eyJhbGciOiJIUzI1NiIsInR5cCI...';

// Menggunakan cURL
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, "$gatewayUrl/integrator/smartbank/saldo");
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $token",
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true);
print_r($data);
```

Contoh integrasi dari Python:

```python
import requests

GATEWAY_URL = 'http://localhost:3000'
TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI...'

headers = {
    'Authorization': f'Bearer {TOKEN}',
    'Content-Type': 'application/json'
}

# Request ke SmartBank
response = requests.get(f'{GATEWAY_URL}/integrator/smartbank/saldo', headers=headers)
print(response.json())

# Request POST ke POS
data = {'items': [{'nama': 'Kopi', 'harga': 15000}]}
response = requests.post(f'{GATEWAY_URL}/integrator/pos/transaksi', json=data, headers=headers)
print(response.json())
```

### 18.3 Integrasi Secara Online (Hosting/Deployment)

#### Opsi 1: Menggunakan Railway.app (Gratis/Murah)

Railway menyediakan hosting Node.js + MySQL gratis.

**Langkah deployment Gateway:**

1. Push kode ke repository GitHub.

2. Buat akun di [railway.app](https://railway.app).

3. Klik "New Project" → "Deploy from GitHub repo".

4. Pilih repository Gateway Integrator.

5. Tambahkan service MySQL:
   - Klik "New" → "Database" → "Add MySQL".
   - Railway otomatis membuat database.

6. Set environment variables di Railway:
   ```
   PORT=3000
   JWT_SECRET=integrator_kelompok7_secret_key_2026
   DB_HOST=<dari railway mysql>
   DB_PORT=<dari railway mysql>
   DB_USER=<dari railway mysql>
   DB_PASSWORD=<dari railway mysql>
   DB_NAME=railway
   GATEWAY_FEE_PERCENT=0.5
   SMARTBANK_URL=https://smartbank-production.up.railway.app
   MARKETPLACE_URL=https://marketplace-production.up.railway.app
   POS_URL=https://pos-production.up.railway.app
   SUPPLIERHUB_URL=https://supplierhub-production.up.railway.app
   LOGISTIKITA_URL=https://logistikita-production.up.railway.app
   UMKM_INSIGHT_URL=https://umkminsight-production.up.railway.app
   ```

7. Railway akan otomatis deploy. URL gateway akan tersedia, misal:
   ```
   https://gateway-integrator-production.up.railway.app
   ```

8. Deploy setiap service UMKM dengan cara yang sama, masing-masing di project Railway terpisah.

**Langkah deployment setiap service:**

1. Push kode service ke GitHub (terpisah per repository).
2. Di Railway, buat project baru untuk setiap service.
3. Deploy dari GitHub.
4. Catat URL public setiap service.
5. Update `SMARTBANK_URL`, `MARKETPLACE_URL`, dll di environment gateway dengan URL Railway masing-masing.

#### Opsi 2: Menggunakan VPS (DigitalOcean/Linode/AWS EC2)

Untuk deployment di VPS:

1. **Setup server:**

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install MySQL
sudo apt install -y mysql-server
sudo mysql_secure_installation

# Install PM2 (process manager)
sudo npm install -g pm2
```

2. **Clone dan setup gateway:**

```bash
git clone https://github.com/username/RPL_Integrator.git
cd RPL_Integrator
npm install
```

3. **Buat database:**

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE rpl_integrator;
CREATE USER 'gateway_user'@'localhost' IDENTIFIED BY 'password_kuat';
GRANT ALL PRIVILEGES ON rpl_integrator.* TO 'gateway_user'@'localhost';
FLUSH PRIVILEGES;
```

4. **Konfigurasi .env untuk production:**

```env
PORT=3000
NODE_ENV=production
JWT_SECRET=ganti_dengan_secret_key_yang_aman_dan_panjang

DB_HOST=localhost
DB_PORT=3306
DB_USER=gateway_user
DB_PASSWORD=password_kuat
DB_NAME=rpl_integrator

GATEWAY_FEE_PERCENT=0.5

# Jika semua service di satu VPS:
SMARTBANK_URL=http://localhost:3001
MARKETPLACE_URL=http://localhost:3002
POS_URL=http://localhost:3003
SUPPLIERHUB_URL=http://localhost:3004
LOGISTIKITA_URL=http://localhost:3005
UMKM_INSIGHT_URL=http://localhost:3006

# Jika service di VPS berbeda:
# SMARTBANK_URL=https://smartbank.contoh.com
# MARKETPLACE_URL=https://marketplace.contoh.com
```

5. **Jalankan dengan PM2:**

```bash
# Gateway
pm2 start server.js --name gateway -- --port 3000

# SmartBank (di folder lain)
pm2 start server.js --name smartbank -- --port 3001

# Service lainnya...
pm2 start server.js --name marketplace -- --port 3002
pm2 start server.js --name pos -- --port 3003

# Auto-restart saat reboot
pm2 startup
pm2 save
```

6. **Setup Nginx reverse proxy:**

```nginx
server {
    listen 80;
    server_name gateway.contoh.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

7. **Aktifkan HTTPS dengan Certbot:**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d gateway.contoh.com
```

#### Opsi 3: Menggunakan Vercel + PlanetScale (Serverless)

Tidak disarankan untuk aplikasi ini karena Vercel tidak mendukung Express.js secara penuh. Gunakan Railway atau VPS.

### 18.4 Perbedaan Konfigurasi Lokal vs Online

| Aspek | Lokal | Online |
|---|---|---|
| URL Gateway | http://localhost:3000 | https://gateway.contoh.com |
| URL Service | http://localhost:3001-3006 | https://smartbank.contoh.com, dll |
| Database | Laragon MySQL (localhost) | MySQL di Railway/VPS |
| JWT Secret | Secret sederhana | Secret panjang dan aman |
| HTTPS | Tidak perlu | Wajib (Certbot/Railway otomatis) |
| Process Manager | `node server.js` (manual) | PM2 (auto-restart) |
| Cookie Secure | false | true (NODE_ENV=production) |

### 18.5 Cara Integrasi dari Aplikasi UMKM Partner

Setiap aplikasi UMKM yang ingin terhubung ke gateway harus mengikuti langkah ini:

1. **Daftarkan service** melalui admin dashboard atau API `/api/services`.
2. **Buat akun user** di halaman registrasi atau melalui admin dashboard.
3. **Generate token API** melalui Client Portal atau endpoint `/generate-test-token`.
4. **Kirim request** dengan format:

```
[METHOD] {GATEWAY_URL}/integrator/{nama_service}/{path}
Header: Authorization: Bearer {token}
Header: Content-Type: application/json (jika POST/PUT)
Body: JSON data (jika POST/PUT)
```

5. **Handle response** — semua response dari gateway berbentuk JSON:

```json
// Sukses
{
    "status": "success",
    "data": { ... }
}

// Error
{
    "status": "error",
    "message": "Deskripsi error"
}
```

## 19. Kelebihan Website Setelah Upgrade

Website ini sudah memiliki beberapa aspek kompleks yang dapat ditunjukkan saat presentasi:

- Memiliki halaman registrasi publik untuk pembuatan akun baru.
- Memiliki autentikasi login dengan session JWT dan token type validation.
- Memiliki role admin, operator, dan user dengan hak akses yang berbeda.
- Memiliki dashboard multi-section (9 halaman) dengan arsitektur ala Kong Konnect.
- Memiliki CRUD penuh untuk service API melalui dashboard admin.
- Memiliki CRUD penuh untuk user management melalui dashboard admin.
- Memiliki dynamic routing service berbasis database.
- Memiliki pemisahan traffic logs dan revenue logs (audit trail).
- Memiliki dashboard statistik dan analytics berbasis Chart.js dengan multiple chart types.
- Memiliki filter dan pagination pada halaman Request Logs.
- Memiliki halaman Plugins yang menampilkan middleware aktif.
- Memiliki halaman Consumers yang otomatis diisi dari traffic log.
- Memiliki client portal untuk generate token dan simulasi API.
- Memiliki middleware auth, role guard, rate limiter, helmet, logger, dan gateway routing.
- Memiliki UI premium dengan animasi micro-interaction: entrance stagger, hover lift, glow pulse, dan smooth transitions.
- Memiliki responsive design untuk mobile dan desktop.

## 20. Kesimpulan

Gateway Integrator bukan hanya halaman dashboard biasa, tetapi sistem API gateway lengkap yang memiliki registrasi publik, autentikasi multi-role, dashboard multi-section ala Kong Konnect, CRUD service dan user management, dynamic service routing, logging, revenue tracking, audit trail, dan visualisasi data. Dengan arsitektur keamanan berlapis (scrypt, JWT session type, rate limiting, Helmet) dan pemisahan tabel `request_logs` dan `revenue_logs`, sistem ini siap digunakan sebagai middleware sentral dalam ekosistem UMKM dan dapat di-deploy baik secara lokal maupun di platform hosting online.
