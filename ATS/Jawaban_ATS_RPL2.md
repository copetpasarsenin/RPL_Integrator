# JAWABAN ATS — RPL 2 (TI126L) T.A. 2025-2026
## Aplikasi: **API Gateway / Integrator** — Kelompok 7

---

## SOAL 1 — Nama & Deskripsi Aplikasi

**Nama:** API Gateway / Integrator

**Deskripsi:** API Gateway / Integrator adalah aplikasi **middleware/orchestrator** yang menjadi pintu masuk tunggal (single entry point) untuk seluruh komunikasi antar 6 aplikasi dalam ekosistem ekonomi UMKM digital. Dibangun dengan **Node.js + Express.js v5**, aplikasi ini mengemban 4 tanggung jawab utama sesuai Doc1–Doc6:

| # | Fitur | Endpoint | Implementasi |
|---|-------|----------|-------------|
| 1 | **Routing API** | `/integrator/routing_api` | Meneruskan request ke 6 service (SmartBank, Marketplace, POS, SupplierHub, LogistiKita, UMKM Insight) via `SERVICE_MAP` di `gateway.js` |
| 2 | **Validasi Request** | `/integrator/validasi_request` | Verifikasi JWT token di `auth.js` — menolak request tanpa/invalid token (401/403) |
| 3 | **Logging** | `/integrator/logging` | Mencatat setiap request (waktu, IP, user, endpoint, status, fee) di `logger.js` ke `global.requestLogs` |
| 4 | **Biaya Layanan** | `/integrator/biaya_layanan_integrasi` | Memotong fee **0.5%** dari setiap transaksi dan mengirimnya ke SmartBank (Doc6 Aturan 10) |

**Peran dalam ekosistem:** Gateway **tidak memproses business logic** transaksi — perannya murni sebagai middleware yang menjamin keamanan (JWT), auditabilitas (logging), konsistensi komunikasi (routing terpusat), dan monetisasi infrastruktur (fee 0.5%).

**Tech Stack:** Node.js, Express v5, EJS, jsonwebtoken, Axios, dotenv.

**Arsitektur file:**
```
server.js            → Entry point, route definitions, demo endpoint
middleware/auth.js   → JWT validation middleware
middleware/logger.js → Request logging middleware  
routes/gateway.js   → Core routing, fee calculation, request forwarding
views/*.ejs          → Landing page, Dashboard, Client Portal
```

---

## SOAL 2 — [Bobot 50] Transaksi End-to-End

### Contoh Interaksi: Marketplace → API Gateway → SmartBank (Checkout)

```
[Marketplace] → POST /integrator/smartbank/pembayaran_transaksi → [Gateway] → [SmartBank]
```

Semua request wajib melalui Gateway (Doc4 Aturan 5). Middleware chain:
```
Request → Logger (logger.js) → Auth/JWT (auth.js) → Gateway Router (gateway.js) → Service Tujuan
```

---

### 1) Input Utama yang Diterima

Dari `gateway.js` route `router.all('/:service/{*path}')`:

| Input | Sumber | Contoh |
|-------|--------|--------|
| `Authorization: Bearer <token>` | HTTP Header | JWT dari Marketplace |
| `:service` (path param) | URL `/integrator/:service/*` | `smartbank` |
| `{*path}` (wildcard) | URL setelah service name | `pembayaran_transaksi` |
| `amount` | Request body (`req.body`) | `50000` |
| `user_id` | Request body | `714240061` |
| HTTP Method | Request metadata | `POST`, `GET`, dll |
| `Content-Type` | HTTP Header | `application/json` |

Logger juga menangkap `req.ip` dan `req.originalUrl` secara otomatis di `logger.js`.

---

### 2) API yang Dipanggil ke Sistem Lain

Gateway memanggil **2 API** per transaksi:

**A. Pemotongan Fee ke SmartBank** (gateway.js line 119-125):
```javascript
await axios.post(`${SERVICE_MAP.smartbank}/smartbank/pembayaran_transaksi`, {
    user_id: req.body?.user_id || req.user?.user_id,
    amount: gatewayFee,  // 0.5% dari amount
    parameter: "Biaya Layanan Integrasi (Gateway Fee 0.5%)",
    source: "integrator",
    original_amount: transactionAmount
});
```

**B. Forward Request ke Service Tujuan** (gateway.js line 143-152):
```javascript
const response = await axios({
    method: req.method,
    url: `${targetBaseUrl}/${forwardPath}`,
    data: req.body,
    headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Authorization': req.headers['authorization'] || ''
    },
    timeout: 10000
});
```

**Service Map** (dari `.env` via `gateway.js`):
| Service | URL | Port |
|---------|-----|------|
| SmartBank | `http://localhost:3001` | 3001 |
| Marketplace | `http://localhost:3002` | 3002 |
| POS | `http://localhost:3003` | 3003 |
| SupplierHub | `http://localhost:3004` | 3004 |
| LogistiKita | `http://localhost:3005` | 3005 |
| UMKM Insight | `http://localhost:3006` | 3006 |

---

### 3) Data yang Dikirim dan Diterima

**DIKIRIM ke SmartBank (fee):**
```json
{
    "user_id": "714240061",
    "amount": 250,
    "parameter": "Biaya Layanan Integrasi (Gateway Fee 0.5%)",
    "source": "integrator",
    "original_amount": 50000
}
```

**DIKIRIM ke Service Tujuan:** Seluruh `req.body` + forwarded headers (`Authorization`, `Content-Type`).

**DITERIMA dan dikembalikan ke aplikasi asal:**
```json
{
    "status": "success",
    "integrator_info": {
        "service_tujuan": "smartbank",
        "fee_percent": "0.5%",
        "transaction_amount": 50000,
        "fee_terpotong": 250,
        "fee_status": "terpotong",
        "forwarded_to": "http://localhost:3001/pembayaran_transaksi"
    },
    "data": { "/* response asli dari service tujuan */" }
}
```

Gateway selalu membungkus response dengan `integrator_info` agar aplikasi asal tahu fee dan status forwarding.

---

### 4) Mekanisme Validasi JWT/Token

Diimplementasikan di `middleware/auth.js`:

**Alur:**
1. Ambil header `Authorization: Bearer <token>` → split untuk dapat token (line 15-16)
2. Jika **tidak ada token** → return `401 Unauthorized`
3. `jwt.verify(token, JWT_SECRET)` — verifikasi signature + expiry (line 26)
4. Jika **valid** → decode payload, simpan di `req.user`, update log dengan `user_id` (line 27-34)
5. Jika **invalid/expired** → return `403 Forbidden` + detail error

**Payload JWT yang di-generate** (`server.js` line 82-88):
```json
{
    "user_id": "714240061",
    "name": "Test User",
    "npm": "714240061",
    "role": "client",
    "generated_at": "2026-05-11T...",
    "iat": 1234567890,
    "exp": 1234654290
}
```
Token berlaku **24 jam** (`expiresIn: '1d'`), di-sign dengan `JWT_SECRET` dari `.env`.

**Catatan arsitektur:** Auth middleware hanya dipasang pada route `/integrator/*` via `app.use('/integrator', loggerMiddleware, validateRequest, gatewayRoutes)` — endpoint publik seperti `/api/status` dan `/generate-test-token` tidak memerlukan auth.

---

### 5) Risiko Inkonsistensi Data

| # | Risiko | Penyebab | Dampak Konkret |
|---|--------|----------|----------------|
| 1 | **Fee terpotong, forward gagal** | SmartBank berhasil debit fee, tapi service tujuan timeout/error | User kehilangan Rp 250 tanpa mendapat layanan |
| 2 | **Double fee** | Client retry karena timeout → fee dipotong 2x | User dirugikan secara finansial |
| 3 | **Data loss saat restart** | `global.requestLogs` disimpan in-memory (array JS) | Seluruh log + revenue record hilang saat server restart |
| 4 | **Race condition log** | Multiple concurrent request mengakses `requestLogs[length-1]` | Log entry bisa tertukar antar request |
| 5 | **Token replay attack** | JWT valid selama 24 jam, bisa digunakan berulang | Request tidak sah yang menggunakan token curian tetap lolos |
| 6 | **Inkonsistensi antar service** | Gateway forward ke Marketplace (stok berkurang) tapi SmartBank belum konfirmasi pembayaran | Stok berkurang tanpa pembayaran terkonfirmasi |

---

### 6) Dampak Jika Aplikasi Lain Gagal

| Aplikasi Gagal | Dampak pada Gateway | Kode yang Terlibat |
|----------------|--------------------|--------------------|
| **SmartBank down** | Fee gagal dipotong (`feeStatus = 'gagal_potong'`), tapi **request tetap di-forward** karena try-catch terpisah (gateway.js line 118-131). Potensi transaksi tanpa fee. | `catch(feeError) { feeStatus='gagal_potong' }` |
| **Marketplace/POS/SupplierHub/LogistiKita down** | Gateway return **502 Bad Gateway**. Log mencatat `status: 'ERROR'`. User mendapat error message jelas. | `res.status(error.response?.status \|\| 502)` |
| **UMKM Insight down** | Dampak minimal — UMKM Insight bersifat read-only (Doc4 Aturan 7). Gateway tetap return error response. | Same error handler |
| **Semua service down** | Gateway sendiri tetap online (landing page, dashboard, client portal tetap bisa diakses). Hanya request forwarding yang gagal. | Static routes di `server.js` independen |

---

### 7) Strategi agar Sistem Tetap Robust

| # | Strategi | Implementasi Aktual | Manfaat |
|---|----------|---------------------|---------|
| 1 | **Fail-safe fee handling** | Try-catch terpisah untuk fee dan forward (gateway.js line 118-131 vs 143-152) | Fee gagal tidak menghentikan transaksi utama |
| 2 | **Timeout protection** | `timeout: 10000` pada Axios request | Mencegah request hanging yang menghabiskan resource |
| 3 | **Comprehensive logging** | Setiap request dicatat lifecycle: PENDING → FORWARDED → SUCCESS/ERROR | Audit trail untuk debugging cascade failure |
| 4 | **Graceful error response** | Selalu return JSON terstruktur: `{status, message, integrator_info, error_detail}` | Client tahu persis apa yang gagal |
| 5 | **Middleware separation** | Logger, Auth, Gateway masing-masing file terpisah | Kegagalan satu layer tidak mempengaruhi layer lain |
| 6 | **Centralized config** | `SERVICE_MAP` dari env variables (`.env`) | Mudah update URL tanpa ubah kode saat service dipindah |
| 7 | **Demo/Fallback mode** | Endpoint `/api/demo/simulate` (server.js line 147-204) | Sistem tetap bisa demo meskipun semua service down |

**Strategi tambahan yang ideal:**
- **Circuit Breaker:** Setelah N kegagalan berturut ke satu service, langsung return error tanpa mencoba (hemat resource)
- **Idempotency Key:** Cegah double transaction dengan memeriksa `transaction_id` unik per request
- **Saga Pattern:** Jika fee sudah terpotong tapi forward gagal, kirim compensating transaction (rollback fee)
- **Persistent Storage:** Pindahkan log dari in-memory ke database/Redis agar survive restart

---

## SOAL 3 — [Bobot 50] Analisis Kondisi Lonjakan Transaksi

### Kondisi:
1. SmartBank delay validasi pembayaran
2. Marketplace tetap menerima checkout
3. SupplierHub stok terbatas
4. LogistiKita delay sinkronisasi ongkir

---

### Bagian A: Respons Gateway terhadap 6 Kriteria

#### 1) Transaksi Ekonomi Tetap Konsisten

**Masalah:** SmartBank delay → fee gateway juga delay → forward ke service menunggu.

**Respons Gateway saat ini:**
- Timeout 10 detik di Axios mencegah hanging selamanya
- Fee dan forward dijalankan **sekuensial** (fee dulu → forward), menjamin urutan benar

**Solusi ideal:**
- Implementasi **transaction queue** (RabbitMQ/Redis Queue) — saat SmartBank delay, request disimpan ke queue dan diproses secara async (eventual consistency)
- Tambah **retry mechanism** dengan exponential backoff: 1 detik → 2 detik → 4 detik
- Gunakan **idempotency key** per transaksi agar retry tidak menghasilkan duplikat

#### 2) Tidak Terjadi Double Transaction

**Masalah:** SmartBank delay → user klik checkout ulang → request duplikat masuk gateway.

**Perlindungan saat ini:**
- Setiap log punya `id` auto-increment (`logger.js` line 16)
- Response selalu dikembalikan dengan status lengkap

**Solusi ideal:**
- **Idempotency middleware**: periksa hash(`user_id` + `service` + `endpoint` + `amount` + `timestamp_window`). Jika duplikat dalam 30 detik → tolak dengan `409 Conflict`
- **Distributed lock**: saat `user_id=714240061` sedang diproses ke SmartBank, request kedua dari user yang sama langsung ditolak
- Doc6 Aturan 15 sudah mengatur **cooldown 10-30 detik** antar transaksi — Gateway seharusnya meng-enforce ini

#### 3) Tidak Terjadi Pengurangan Stok Palsu

**Masalah:** Marketplace checkout → Gateway forward ke SupplierHub (stok dikurangi) → SmartBank belum konfirmasi pembayaran → stok sudah berkurang tanpa bayar.

**Peran Gateway:**
- Saat ini Gateway memotong fee **sebelum** forward (gateway.js line 117-131). Jika SmartBank delay, fee juga delay, tapi forward tetap bisa terjadi.

**Solusi ideal:**
- **Saga Pattern** yang diorkestrasi Gateway:
  1. Step 1: Reservasi stok (SupplierHub) → status "RESERVED"
  2. Step 2: Pembayaran (SmartBank) → status "PAID"
  3. Step 3: Konfirmasi (SupplierHub) → status "CONFIRMED"
  4. Jika Step 2 gagal → **Compensating Transaction**: Gateway kirim rollback ke SupplierHub untuk kembalikan stok
- Gateway menambahkan field `transaction_state` di log untuk tracking step mana yang sudah selesai

#### 4) Sistem Tetap Scalable

**Implementasi saat ini:**
- **Stateless request handling** — setiap request independen, tidak ada session
- `SERVICE_MAP` menggunakan env variables, mudah dipindah ke load balancer
- Express.js event-driven, non-blocking I/O — cocok untuk high concurrency

**Solusi untuk handle lonjakan:**
- **Horizontal scaling**: Deploy multiple Gateway instance di belakang Nginx/HAProxy load balancer
- **Pindahkan `global.requestLogs` ke Redis** — shared state antar instance
- **Rate limiting per user**: Enforce Doc6 Aturan 16 (max 10 transaksi/hari) dan Aturan 15 (cooldown 10-30 detik)
- **Connection pooling** pada Axios untuk reuse TCP connection ke downstream service

#### 5) User Tetap Mendapatkan Feedback yang Jelas

**Implementasi saat ini — sudah baik:**
- Setiap response punya `status`, `message`, `integrator_info` (gateway.js line 160-171)
- Error response menyertakan `error_detail` (gateway.js line 190)
- Dashboard real-time (`/dashboard`) menampilkan stats + log
- Client Portal (`/client-portal`) punya response viewer dengan color-coding: hijau=sukses, merah=error, kuning=pending

**Contoh error response saat SmartBank delay:**
```json
{
    "status": "error",
    "message": "Gagal meneruskan request ke smartbank",
    "integrator_info": {
        "fee_percent": "0.5%",
        "fee_status": "gagal_potong"
    },
    "error_detail": "timeout of 10000ms exceeded"
}
```

**Peningkatan:**
- Tambah `estimated_retry_time` dan `queue_position` dalam response saat lonjakan
- Implementasi WebSocket untuk push notification status transaksi real-time

#### 6) Ekosistem Tidak Mengalami "Cascade Failure"

**Masalah:** SmartBank delay → Gateway timeout per request → semua service yang butuh SmartBank ikut stuck → pool connection habis → Gateway ikut down → seluruh ekosistem lumpuh.

**Perlindungan saat ini:**
- **Isolated error handling**: Fee punya try-catch sendiri, terpisah dari forward (gateway.js line 118-131 vs 143-152) — kegagalan fee tidak menghentikan forwarding
- **Timeout 10 detik** mencegah thread blocking permanen
- Middleware chain **independen**: Logger tetap jalan meski Auth gagal

**Solusi ideal anti-cascade:**

| Pattern | Cara Kerja | Manfaat |
|---------|-----------|---------|
| **Circuit Breaker** | Setelah 5 kegagalan ke SmartBank → "buka circuit" → 30 detik langsung return error tanpa connect | Hemat resource, cegah domino effect |
| **Bulkhead** | Thread pool terpisah per service — SmartBank punya max 10 concurrent, Marketplace 10 | Kegagalan SmartBank tidak habiskan semua connection |
| **Timeout + Fallback** | Jika timeout → return cached/default response | User tetap dapat feedback |
| **Backpressure** | Jika queue penuh → tolak request baru dengan `503 Service Unavailable` | Server tidak overload |

---

### Bagian B: Analisis Komponen, Endpoint, Log, dan Prinsip Desain

#### 1) Komponen Paling Kritis

| Prioritas | Komponen | File | Alasan |
|-----------|----------|------|--------|
| **🔴 1** | JWT Auth Middleware | `middleware/auth.js` | Tanpa ini, request tidak sah bisa masuk ke seluruh ekosistem — gerbang keamanan utama |
| **🔴 2** | Fee Calculator + Sender | `routes/gateway.js` (line 110-131) | Salah hitung = revenue hilang atau user dirugikan. Sumber pendapatan gateway. |
| **🟡 3** | Request Forwarder | `routes/gateway.js` (line 143-152) | Core function — tanpa ini gateway tidak bisa meneruskan request |
| **🟡 4** | Logger Middleware | `middleware/logger.js` | Audit trail — tanpa ini tidak bisa debug masalah dan tidak ada data untuk dashboard |

#### 2) Endpoint yang Harus Diprioritaskan

| Prioritas | Endpoint | Alasan |
|-----------|----------|--------|
| **🔴 Kritis** | `ALL /integrator/:service/{*path}` | Core orchestrator — semua transaksi ekosistem melewati sini |
| **🔴 Kritis** | `POST /generate-test-token` | Tanpa token, tidak ada yang bisa akses gateway sama sekali |
| **🟡 Penting** | `GET /api/status` | Health check — harus selalu available untuk monitoring |
| **🟢 Normal** | `GET /integrator/biaya_layanan_integrasi` | Transparansi fee — penting untuk audit tapi bukan blocking |

Saat lonjakan: **prioritaskan forward request** (endpoint 1) dan **nonaktifkan atau rate-limit** endpoint non-kritis seperti `/integrator/logging` dan `/api/logs`.

#### 3) Log yang Wajib Dicatat

Implementasi saat ini di `logger.js` + update di `gateway.js`:

| # | Field | Tujuan | Kritis saat Lonjakan? |
|---|-------|--------|-----------------------|
| 1 | `waktu` + `timestamp` | Kronologi audit | ✅ Ya — untuk korelasi timeline |
| 2 | `ip` | Identifikasi sumber, deteksi abuse | ✅ Ya — deteksi DDoS |
| 3 | `metode` + `url_tujuan` | Mengetahui operasi yang dilakukan | ✅ Ya |
| 4 | `user_id` | Akuntabilitas per user | ✅ Ya — deteksi user spam |
| 5 | `service_tujuan` | Service mana yang dipanggil | ✅ Ya — identifikasi service bottleneck |
| 6 | `status` (PENDING→SUCCESS/ERROR) | Monitoring keberhasilan | ✅ Ya |
| 7 | `fee_terpotong` + `fee_status` | Audit keuangan | ✅ Ya — jangan sampai fee hilang |
| 8 | `response_status` (HTTP code) | Debugging | ✅ Ya |

**Log tambahan yang kritis saat lonjakan:**
- **Response time** (latency per request) — deteksi service mana yang lambat
- **Queue depth** — berapa request menunggu
- **Circuit breaker state** (open/closed/half-open) — status per service
- **Memory usage** — `global.requestLogs` bisa membengkak

#### 4) Penerapan Clean Architecture & SOLID

##### Clean Architecture — Separasi Layer

Proyek sudah menerapkan separasi layer:

```
┌──────────────────────────────────────────────┐
│  Presentation Layer    │  views/*.ejs         │  Dashboard, Client Portal, Landing
├────────────────────────┼─────────────────────┤
│  Application Layer     │  server.js           │  Route definitions, orchestration
├────────────────────────┼─────────────────────┤
│  Domain/Business Layer │  routes/gateway.js   │  Fee calculation, routing logic
├────────────────────────┼─────────────────────┤
│  Infrastructure Layer  │  middleware/*.js      │  JWT validation, logging, Axios
└────────────────────────┴─────────────────────┘
```

Setiap layer **independen** — perubahan di Presentation (UI) tidak mempengaruhi Business Logic (fee calculation), dan sebaliknya. Ini crucial saat lonjakan: kita bisa optimize satu layer tanpa merusak yang lain.

##### Prinsip SOLID — Penerapan dan Manfaat saat Lonjakan

| Prinsip | Penerapan di Kode | Manfaat saat Lonjakan |
|---------|------------------|----------------------|
| **S — Single Responsibility** | `logger.js` hanya mencatat log. `auth.js` hanya validasi JWT. `gateway.js` hanya routing+fee. Masing-masing 1 file = 1 tanggung jawab. | Jika logging jadi bottleneck saat lonjakan, kita bisa **optimize atau disable logger saja** tanpa mempengaruhi auth dan routing. Debug jadi lebih cepat karena tahu persis file mana yang bermasalah. |
| **O — Open/Closed** | `SERVICE_MAP` menggunakan env variables — menambah service baru **cukup tambah di `.env`** tanpa ubah kode `gateway.js`. Demo mode bisa ditambah tanpa ubah live mode. | Saat lonjakan, bisa **menambah service replica** atau mengubah URL ke load balancer hanya dengan update `.env` — zero code change, zero downtime. |
| **L — Liskov Substitution** | Semua 6 service di `SERVICE_MAP` diperlakukan **identik** oleh gateway — `router.all('/:service/{*path}')`. Bisa diganti/swap tanpa ubah logic routing. | Service yang down bisa **diganti dengan fallback/mock service** tanpa mengubah gateway. Misalnya SmartBank delay → arahkan ke SmartBank replica. |
| **I — Interface Segregation** | Endpoint terpisah: `/routing_api`, `/validasi_request`, `/logging`, `/biaya_layanan_integrasi`. Client hanya akses yang dibutuhkan. API publik (`/api/status`) terpisah dari API protected (`/integrator/*`). | Saat lonjakan, **rate-limit endpoint non-kritis** (`/logging`, `/api/logs`) tanpa mengganggu endpoint kritis (forwarding). Setiap endpoint bisa di-scale independen. |
| **D — Dependency Inversion** | Gateway bergantung pada **abstraksi** (`SERVICE_MAP` + env vars), bukan hard-coded URLs. Middleware di-inject via `app.use()`, bisa diganti tanpa ubah core. | Mudah **swap implementasi**: ganti in-memory log → Redis (tanpa ubah logger interface). Ganti Axios → fetch. Ganti JWT → OAuth2. Semua tanpa rewrite gateway. |

##### Contoh Konkret: SOLID Menyelesaikan Cascade Failure

Karena `auth.js` terpisah dari `gateway.js` (SRP), ketika SmartBank delay:

1. **Auth tetap cepat** — validasi JWT tidak tergantung SmartBank
2. Tambahkan **rate limiter** sebagai middleware baru tanpa ubah auth/gateway (OCP):
   ```javascript
   // Hanya tambah 1 middleware baru
   app.use('/integrator', loggerMiddleware, rateLimiter, validateRequest, gatewayRoutes);
   ```
3. Ganti `global.requestLogs` ke **Redis** tanpa ubah interface logger (DIP)
4. **Circuit breaker** bisa ditambah sebagai middleware terpisah (SRP + OCP)

##### Metodologi Pengembangan — Relevansi

Proyek menggunakan pendekatan **Agile/Iterative**:
- Dimulai dari MVP (routing dasar) → iterasi menambah logging → auth → fee → demo mode
- Setiap fitur di-commit independen dan bisa di-test mandiri
- Dokumentasi evolusi tercatat di `Docs/dokumentasi_lengkap.md`

##### Manajemen Proyek

- **Pembagian tugas** jelas per file: backend developer fokus di `server.js` + `gateway.js`, middleware developer di `auth.js` + `logger.js`
- **Risiko dikelola** dengan membuat Demo Mode (`/api/demo/simulate`) sebagai fallback saat service lain belum ready
- **Kendala & Solusi** didokumentasikan (11 kendala dan solusi tercatat di dokumentasi)

---

### Kesimpulan

API Gateway/Integrator sebagai **middleware sentral** ekosistem UMKM harus menerapkan **defensive programming** — mengasumsikan setiap service bisa gagal kapan saja. Dengan arsitektur modular yang sudah ada (middleware chain: Logger → Auth → Gateway, masing-masing mengikuti SRP), penambahan fitur resiliensi seperti circuit breaker, rate limiter, idempotency check, dan persistent storage bisa dilakukan secara **incremental** tanpa restrukturisasi total — inilah kekuatan penerapan Clean Architecture dan prinsip SOLID dalam menangani kondisi lonjakan transaksi pada ekosistem terdistribusi.
