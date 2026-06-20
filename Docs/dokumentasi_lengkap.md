# 📘 Dokumentasi Lengkap — API Gateway / Integrator

**Kelompok 7 — Tugas Besar RPL 2**  
Dosen: M. Yusril Helmi Setyawan, S.Kom., M.Kom. | D4 Teknik Informatika — ULBI

---

## 1. Deskripsi Aplikasi

API Gateway / Integrator adalah **middleware orchestrator** yang menjadi pintu masuk tunggal untuk semua komunikasi antar 6 aplikasi dalam ekosistem ekonomi UMKM.

| Aspek | Detail |
|-------|--------|
| **Peran** | Middleware/Orchestrator — penjaga keamanan dan konsistensi |
| **Tanggung Jawab** | Routing API, Validasi JWT, Logging, Fee 0.5% |
| **Tech Stack** | Node.js + Express v5 + EJS + JWT + MySQL (Laragon) |
| **Port** | 3000 |

### Stakeholder

- **Admin Integrator** — Monitor traffic & revenue via Dashboard
- **Kelompok Lain (1-6)** — Menggunakan gateway untuk komunikasi antar service
- **Dosen** — Menilai implementasi sesuai spesifikasi

---

## 2. Use Case / Fitur Utama

Ada 4 fitur utama + 1 fitur demo:

| # | Fitur | Endpoint | Deskripsi |
|---|-------|----------|-----------|
| 1 | **Routing API** | `GET /integrator/routing_api` | Menampilkan daftar 6 service terdaftar |
| 2 | **Validasi Request** | `GET /integrator/validasi_request` | Memvalidasi token JWT dan menampilkan payload |
| 3 | **Logging** | `GET /integrator/logging` | Menampilkan 50 log request terakhir |
| 4 | **Biaya Layanan** | `GET /integrator/biaya_layanan_integrasi` | Info fee 0.5% dan total pendapatan |
| 5 | **Demo Simulasi** | `POST /api/demo/simulate` | Simulasi request sukses (untuk presentasi) |

**Fitur Orchestrator:**

- Dynamic routing ke semua service: `ALL /integrator/:service/{*path}`
- Token generator: `POST /generate-test-token`
- Health check: `GET /api/status`
- Public logs: `GET /api/logs`

---

## 3. Diagram Arsitektur

```
┌──────────────────────────────────────────────────────┐
│            API Gateway / Integrator (Port 3000)       │
│                                                       │
│   ┌─────────┐  ┌──────────┐  ┌────────────────────┐  │
│   │ Logger  │→ │ JWT Auth │→ │ Router/Orchestrator│  │
│   │Middleware│  │Middleware│  │  + Fee Calculator  │  │
│   └─────────┘  └──────────┘  └────────────────────┘  │
└───────────────────────┬──────────────────────────────┘
                        │ Forward request
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────┴────┐   ┌──────┴──────┐  ┌─────┴─────┐
   │SmartBank│   │ Marketplace │  │    POS    │
   │  :3001  │   │    :3002    │  │   :3003   │
   └─────────┘   └─────────────┘  └───────────┘
        │               │               │
   ┌────┴────┐   ┌──────┴──────┐  ┌─────┴─────┐
   │Supplier │   │ LogistiKita │  │   UMKM    │
   │  Hub    │   │    :3005    │  │  Insight  │
   │  :3004  │   └─────────────┘  │   :3006   │
   └─────────┘                    └───────────┘
```

---

## 4. Flow Proses (Input → Proses → Output)

### A. Flow Utama — Forward Request

```
INPUT                         PROSES                           OUTPUT
─────                         ──────                           ──────
Request + Auth header   →  1. Logger mencatat request       → Response JSON
+ Body {user_id, amount} → 2. Auth validasi JWT token       → + integrator_info
                         → 3. Hitung fee 0.5% dari amount   → + fee_terpotong
                         → 4. Potong fee ke SmartBank       → + data service
                         → 5. Forward ke service tujuan     →
                         → 6. Return response               →
```

### B. Flow Demo — Simulasi Presentasi

```
INPUT                         PROSES                           OUTPUT
─────                         ──────                           ──────
POST /api/demo/simulate  → 1. Parse service & amount        → Response sukses
+ {service, endpoint,    → 2. Hitung fee 0.5%               → + fee_terpotong
    amount}              → 3. Catat ke log global            → + data simulasi
                         → 4. Generate fake response         → + tercatat di dashboard
```

### C. Flow per Fitur

| Fitur | Input | Proses | Output |
|-------|-------|--------|--------|
| Routing API | JWT token | Validasi → list services | 6 service + URL |
| Validasi Request | JWT token | Verify → decode | User info + valid |
| Logging | JWT token | Validasi → ambil log | 50 log terakhir |
| Biaya Layanan | JWT token | Validasi → sum fee | Total revenue |
| Demo Simulasi | service + amount | Hitung fee → log → fake response | Sukses + fee |

---

## 5. API Endpoint

### A. Endpoint Publik (Tanpa Auth)

| Method | URL | Deskripsi |
|--------|-----|-----------|
| `GET` | `/` | Landing page |
| `GET` | `/dashboard` | Dashboard admin |
| `GET` | `/client-portal` | Client portal + simulator |
| `GET` | `/download-docs` | Download dokumentasi PDF |
| `POST` | `/generate-test-token` | Generate JWT token |
| `GET` | `/generate-test-token` | Generate JWT (backward compat) |
| `GET` | `/api/status` | Health check system |
| `GET` | `/api/logs` | Audit log publik |
| `POST` | `/api/demo/simulate` | **Simulasi sukses (presentasi)** |

### B. Endpoint Gateway (Wajib JWT Auth)

| Method | URL | Deskripsi |
|--------|-----|-----------|
| `GET` | `/integrator/routing_api` | Daftar routing service |
| `GET` | `/integrator/validasi_request` | Validasi token |
| `GET` | `/integrator/logging` | Lihat log gateway |
| `GET` | `/integrator/biaya_layanan_integrasi` | Info biaya layanan |
| `ALL` | `/integrator/:service/{*path}` | Forward ke service |
| `ALL` | `/integrator/:service` | Forward ke service root |

### C. Contoh Request & Response

### 5.1 Kebutuhan Fungsional Tambahan Berdasarkan Evaluasi Dosen

Sub-bab ini menyesuaikan SRS agar sesuai dengan aplikasi **RPL Integrator**, bukan PointMarket Psychometric Questionnaire. Fokus revisi adalah endpoint gateway, login demo, data karyawan, shadow table, dan diagram efektivitas penggunaan service.

| ID | Kebutuhan Fungsional | Implementasi pada RPL Integrator |
|---|---|---|
| FR-17 Endpoint Verification | Sistem harus mendokumentasikan endpoint yang benar-benar tersedia. | Endpoint diverifikasi dari `server.js` dan `routes/gateway.js`, lalu dicatat di README dan menu Dokumentasi API dashboard. |
| FR-18 One-Click Demo Login | Demo login harus dapat dilakukan tanpa mengetik username/password. | Halaman `/login` menyediakan tombol `Login sebagai Admin`, `Login sebagai Operator`, dan `Login sebagai User`. |
| FR-19 Employee Demo Data | Repository GitHub harus memuat data karyawan. | Tabel `employees` dibuat otomatis dan diisi EMP001 sampai EMP005 melalui `config/database.js` dan `config/init.sql`. |
| FR-20 Shadow Table | Sistem harus memiliki shadow table untuk mencatat jejak penggunaan service. | Tabel `shadow_service_usage` menyimpan source app, service, endpoint, consumer, status, response code, dan waktu penggunaan. |
| FR-21 Usage Analytics Diagram | Data dari aplikasi pengguna service harus tampil sebagai diagram penggunaan/efektivitas. | Dashboard analitik menampilkan grafik penggunaan berdasarkan aplikasi sumber dan bagian `Efektivitas Penggunaan Service`. |
| FR-22 GitHub Repository Evidence | Repository harus menjadi bukti implementasi revisi dosen. | README, schema SQL, seed database, route dashboard, dan view dashboard memuat bukti revisi. |

Endpoint yang telah diverifikasi tersedia:

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| GET | `/login` | Publik | Halaman login manual dan demo satu klik. |
| POST | `/login` | Publik | Proses login manual atau `demo_role`. |
| GET | `/dashboard` | Admin/Operator | Ringkasan operasional gateway. |
| GET | `/dashboard/analytics` | Admin/Operator | Analitik traffic, consumer, aplikasi sumber, dan efektivitas service. |
| GET | `/dashboard/employees` | Admin/Operator | Tabel data karyawan demo. |
| GET | `/api/status` | Publik | Status gateway dan service aktif. |
| GET | `/api/services` | Admin/Operator | Daftar service. |
| GET | `/api/logs` | Admin/Operator | Log request terbaru. |
| GET | `/api/keys` | Login | Daftar API key user aktif. |
| POST | `/api/demo/simulate` | Login | Simulasi request demo. |
| POST | `/api/demo/seed-data` | Admin | Seed data demo untuk grafik dan shadow table. |
| GET | `/integrator/:service` | Bearer JWT/API Key | Proxy ke root service. |
| ALL | `/integrator/:service/:path` | Bearer JWT/API Key | Proxy ke path service. |

Data karyawan demo yang tersedia di repository:

| Kode | Nama | Role | Departemen |
|---|---|---|---|
| EMP001 | Admin Demo | Admin | IT Integrator |
| EMP002 | Operator Demo | Operator | Operasional Gateway |
| EMP003 | User Demo | User | Client UMKM |
| EMP004 | Finance Staff | Finance | Keuangan |
| EMP005 | Integration Staff | Integration Staff | Integrasi Service |

Langkah demo revisi kepada dosen:

1. Buka `/login`, lalu klik `Login sebagai Admin`.
2. Buka `/dashboard/employees` untuk menunjukkan data karyawan demo.
3. Klik `Seed Demo Data` dari dashboard agar data analytics terisi.
4. Buka `/dashboard/analytics` dan tunjukkan `Efektivitas Penggunaan Service`.
5. Buka `/dashboard/docs` atau README untuk menunjukkan endpoint yang sudah diverifikasi.

**Live Request:**
```http
POST /integrator/smartbank/pembayaran_transaksi
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{"user_id": "714240061", "amount": 50000, "parameter": "Pembayaran"}
```

**Demo Request (untuk presentasi):**
```http
POST /api/demo/simulate
Content-Type: application/json

{"service": "smartbank", "endpoint": "pembayaran_transaksi", "amount": 50000}
```

**Response Demo:**
```json
{
  "status": "success",
  "mode": "DEMO_SIMULASI",
  "message": "Simulasi request ke smartbank/pembayaran_transaksi berhasil",
  "integrator_info": {
    "service_tujuan": "smartbank",
    "fee_percent": "0.5%",
    "transaction_amount": 50000,
    "fee_terpotong": 250,
    "fee_status": "terpotong"
  },
  "data": {
    "transaction_id": "TXN-1234567890",
    "saldo_sebelum": 500000,
    "saldo_sesudah": 450000,
    "status_pembayaran": "berhasil"
  }
}
```

---

## 6. Integrasi SmartBank

Gateway terintegrasi ke SmartBank untuk pemotongan fee otomatis:

1. Gateway hitung fee = amount × 0.5%
2. Gateway POST ke `SmartBank/pembayaran_transaksi`
3. Jika SmartBank online → fee terpotong
4. Jika SmartBank offline → fee gagal (request tetap diteruskan)

| Konfigurasi | Nilai |
|-------------|-------|
| SmartBank URL | `http://localhost:3001` |
| Fee Endpoint | `POST /smartbank/pembayaran_transaksi` |
| Fee Percent | 0.5% |

---

## 7. Desain Database

Aplikasi menggunakan database **MySQL** yang di-host menggunakan **Laragon**. Database yang digunakan bernama `rpl_integrator` dengan tabel `request_logs` untuk menyimpan seluruh riwayat transaksi gateway secara permanen (persisten).

### Skema Tabel `request_logs`

| Kolom | Tipe Data | Atribut | Keterangan |
|---|---|---|---|
| `id` | `INT` | `PRIMARY KEY`, `AUTO_INCREMENT` | ID unik log |
| `waktu` | `VARCHAR(100)` | | Format waktu lokal (`id-ID`) saat request masuk |
| `timestamp` | `DATETIME` | `DEFAULT CURRENT_TIMESTAMP` | Timestamp standar untuk sorting/filtering |
| `ip` | `VARCHAR(50)` | | IP address asal request |
| `metode` | `VARCHAR(10)` | | HTTP Method (`GET`, `POST`, `PUT`, `DELETE`) |
| `url_tujuan` | `VARCHAR(500)` | | Endpoint/URL tujuan request |
| `user_id` | `VARCHAR(100)` | | NPM atau User ID pengirim dari JWT payload |
| `service_tujuan`| `VARCHAR(100)`| | Nama service ekosistem target |
| `status` | `VARCHAR(20)` | `DEFAULT 'PENDING'` | Status request (`PENDING`, `SUCCESS`, `ERROR`, `FORWARDED`) |
| `response_status`| `INT` | | HTTP Status Code dari service tujuan |
| `fee_terpotong` | `DECIMAL(12,2)` | `DEFAULT 0` | Fee gateway (0.5% dari nominal transaksi) dalam Rupiah |
| `fee_status` | `VARCHAR(50)` | | Status potong fee (`terpotong`, `gagal_potong`, `tidak_ada_amount`) |
| `mode` | `VARCHAR(20)` | `DEFAULT NULL` | Mode testing (`DEMO` jika via simulator, `NULL` jika request asli) |

> [!NOTE]
> Tabel ini telah dioptimalkan menggunakan indexing pada kolom `status`, `service_tujuan`, dan `timestamp` untuk mempercepat query statistik pada dashboard admin.


---

## 8. Mekanisme Transaksi & Fee

Fee Gateway = **0.5%** dari setiap transaksi.

### Alur Fee

```
Client kirim request (amount: Rp 50.000)
  → Gateway hitung: 50.000 × 0.5% = Rp 250
  → POST ke SmartBank (debit Rp 250)
  → Forward request ke service tujuan
  → Revenue gateway +Rp 250
```

### Contoh Perhitungan

| Amount | Fee (0.5%) |
|--------|-----------|
| Rp 10.000 | Rp 50 |
| Rp 50.000 | Rp 250 |
| Rp 100.000 | Rp 500 |
| Rp 1.000.000 | Rp 5.000 |

---

## 9. UI — Tampilan Antarmuka

Aplikasi memiliki 3 halaman utama:

### Landing Page (`/`)
- Hero section dengan judul dan deskripsi
- 4 feature cards: Validasi JWT, Logging, Routing, Fee
- Grid 6 aplikasi ekosistem

### Dashboard Admin (`/dashboard`)
- 4 stat cards: Pendapatan Fee, Total Traffic, Sukses, Error
- Tabel audit log: Waktu, IP, User, Metode, Endpoint, Status, Fee

### Client Portal (`/client-portal`)
- Generate token dengan custom User ID dan Nama
- API Simulator dengan dropdown 6 aplikasi + 8 endpoint
- **Dua mode testing:**
  - 🎬 **Demo (Simulasi Sukses)** — selalu berhasil, fee tercatat
  - ⚡ **Live Request** — request ke service asli
- Fee preview real-time (berubah saat amount diubah)
- Quick Test 4 endpoint internal Integrator
- Panduan integrasi untuk kelompok lain

---

## 10. Skenario Pengujian

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| 1 | Request tanpa token | 401 Unauthorized | ✅ |
| 2 | Token invalid | 403 Forbidden | ✅ |
| 3 | Service tidak terdaftar | 404 Not Found | ✅ |
| 4 | Demo simulasi SmartBank | Sukses + fee Rp 250 | ✅ |
| 5 | Demo simulasi Marketplace | Sukses + data order | ✅ |
| 6 | Demo simulasi semua service | Sukses + fee tercatat | ✅ |
| 7 | Live request (service offline) | 502 Error | ✅ |
| 8 | Generate token custom user | Token valid 24 jam | ✅ |
| 9 | Dashboard update setelah demo | Fee + traffic tercatat | ✅ |
| 10 | Quick test routing_api | 6 services listed | ✅ |

---

## 11. Kendala & Solusi

| # | Kendala | Solusi |
|---|---------|--------|
| 1 | Service kelompok lain belum berjalan | Buat mode **Demo/Simulasi** yang selalu sukses |
| 2 | Express v5 wildcard syntax berubah | Migrasi ke `{*path}` syntax |
| 3 | Fee awalnya flat Rp 500 | Ubah ke perhitungan 0.5% dari amount |
| 4 | Hanya 2 service mapping | Tambah mapping untuk semua 6 service |
| 5 | Logger kurang data | Tambah IP, user_id, fee info |
| 6 | Revenue dashboard salah hitung | Hitung dari fee aktual yang tercatat |
| 7 | Dropdown tidak terlihat di dark mode | Tambah `color-scheme: dark` + styling option |
| 8 | Header forwarding bermasalah | Hanya forward Authorization dan Content-Type |

---

## 12. Dokumentasi Tim

| Anggota | NPM | Peran |
|---------|-----|-------|
| Zidan Hairra Ramadhan | 714240061 | Backend Developer |
| Richard Firmansya | - | Backend Developer |

---

## 📂 Struktur Project

```
RPL_Integrator-main/
├── .env                     # Environment variables (termasuk konfigurasi DB)
├── server.js                # Entry point + koneksi & inisialisasi DB + demo
├── package.json             # Dependencies (Express, EJS, JWT, mysql2)
├── config/
│   ├── database.js          # [NEW] Konfigurasi pool koneksi MySQL (mysql2)
│   └── init.sql             # [NEW] Script SQL inisialisasi database & tabel
├── middleware/
│   ├── auth.js              # JWT validation middleware (update log user_id)
│   └── logger.js            # Request logging middleware (simpan log awal)
├── routes/
│   └── gateway.js           # Routing + fee + forwarding + update status log
├── views/
│   ├── index.ejs            # Landing page
│   ├── dashboard.ejs        # Dashboard admin (query stats langsung dari DB)
│   └── client_portal.ejs    # Client portal (token + demo/live)
├── public/
│   └── Panduan_*.pdf        # Dokumentasi PDF
└── Docs/
    ├── Doc1-Doc6            # Spesifikasi dari dosen
    └── dokumentasi_lengkap.md  # Dokumentasi ini
```

---

## 🔧 Cara Menjalankan

### Persiapan Database (Laragon MySQL)
1. Buka aplikasi **Laragon** dan pastikan service **MySQL** sudah berjalan (klik **Start All**).
2. Buat database baru bernama `rpl_integrator`. Anda bisa membuatnya melalui **HeidiSQL** (bawaan Laragon) atau menjalankan perintah berikut di terminal:
   ```bash
   # Masuk ke MySQL Laragon dan buat database
   mysql -u root -e "CREATE DATABASE IF NOT EXISTS rpl_integrator CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   ```
3. Sesuaikan konfigurasi database pada file `.env` jika diperlukan (default: Host `localhost`, Port `3306`, User `root`, tanpa Password).

### Menjalankan Server
```bash
# 1. Install dependencies (termasuk driver mysql2)
npm install

# 2. Jalankan server
# Database dan tabel request_logs akan dibuat otomatis jika belum ada saat server start!
node server.js

# 3. Akses di browser
# Landing  : http://localhost:3000
# Dashboard: http://localhost:3000/dashboard
# Portal   : http://localhost:3000/client-portal
# Status   : http://localhost:3000/api/status
```

### Untuk Presentasi

1. Buka `/client-portal`
2. Klik **Generate** token
3. Pilih aplikasi tujuan & isi amount
4. Klik **🎬 Demo (Simulasi Sukses)** — akan menunjukkan response sukses + fee terpotong
5. Buka `/dashboard` — lihat fee tercatat di statistik dan tabel log
