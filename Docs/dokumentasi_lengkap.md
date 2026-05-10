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
| **Tech Stack** | Node.js + Express v5 + EJS + JWT |
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

Aplikasi menggunakan **in-memory storage** (array global):

```javascript
global.requestLogs[] = {
  id: Number,              // Auto-increment
  waktu: String,           // Waktu lokal Indonesia
  timestamp: String,       // ISO 8601
  ip: String,              // IP address pengirim
  metode: String,          // HTTP method
  url_tujuan: String,      // URL path lengkap
  user_id: String,         // Dari decoded JWT
  service_tujuan: String,  // Nama service target
  status: String,          // PENDING / SUCCESS / ERROR
  response_status: Number, // HTTP status code
  fee_terpotong: Number,   // Fee dalam Rupiah
  fee_status: String,      // terpotong / gagal_potong
  mode: String             // null atau "DEMO"
}
```

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
├── .env                     # Environment variables
├── server.js                # Entry point + routes + demo endpoint
├── package.json             # Dependencies
├── middleware/
│   ├── auth.js              # JWT validation middleware
│   └── logger.js            # Request logging middleware
├── routes/
│   └── gateway.js           # Routing + fee + forwarding + 4 endpoints
├── views/
│   ├── index.ejs            # Landing page
│   ├── dashboard.ejs        # Dashboard admin (stats + log)
│   └── client_portal.ejs    # Client portal (token + demo/live)
├── public/
│   └── Panduan_*.pdf        # Dokumentasi PDF
└── Docs/
    ├── Doc1-Doc6            # Spesifikasi dari dosen
    └── dokumentasi_lengkap.md  # Dokumentasi ini
```

---

## 🔧 Cara Menjalankan

```bash
# 1. Install dependencies
npm install

# 2. Jalankan server
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
