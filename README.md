# RPL Integrator - API Gateway Integrator

RPL Integrator adalah aplikasi Node.js Express + EJS + MySQL yang berperan sebagai API Gateway untuk routing service, autentikasi, logging request, API key, dashboard monitoring, dan analytics penggunaan service.

## Cara Menjalankan

1. Buat database MySQL bernama `rpl_integrator`.
2. Salin konfigurasi environment sesuai kebutuhan, terutama `JWT_SECRET`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, dan `DB_NAME`.
3. Jalankan instalasi dan server:

```bash
npm install
npm start
```

Saat server berjalan, `config/database.js` akan membuat tabel yang belum ada dan melakukan seed data demo secara idempotent.

## Akun Demo Satu Klik

Halaman `GET /login` menyediakan tombol demo tanpa mengetik username/password:

| Tombol | Username | Password | Arah Setelah Login |
|---|---|---|---|
| Login sebagai Admin | `admin` | `admin123` | `/dashboard` |
| Login sebagai Operator | `operator` | `operator123` | `/dashboard` |
| Login sebagai User | `user` | `user123` | `/client-portal` |

Catatan UI: Akun demo hanya digunakan untuk pengujian dan presentasi.

## Endpoint Terverifikasi

Endpoint berikut tersedia pada implementasi saat ini:

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| GET | `/login` | Publik | Menampilkan halaman login dan tombol demo. |
| POST | `/login` | Publik | Login manual atau satu klik dengan `demo_role`. |
| GET | `/dashboard` | Admin/Operator | Ringkasan gateway. |
| GET | `/dashboard/analytics` | Admin/Operator | Grafik traffic, aplikasi sumber, konsumen teratas, dan efektivitas service. |
| GET | `/dashboard/employees` | Admin/Operator | Tabel data karyawan demo. |
| GET | `/api/status` | Publik | Status gateway dan service aktif. |
| GET | `/api/services` | Admin/Operator | Daftar service gateway. |
| GET | `/api/logs` | Admin/Operator | Request log terbaru. |
| GET | `/api/keys` | Login | Daftar API key user yang sedang login. |
| POST | `/api/demo/simulate` | Login | Simulasi request untuk demo. |
| POST | `/api/demo/seed-data` | Admin | Seed traffic, revenue, alert, dan shadow usage demo. |
| GET | `/integrator/:service` | Bearer JWT/API Key | Proxy ke root service tujuan. |
| ALL | `/integrator/:service/:path` | Bearer JWT/API Key | Proxy ke path service tujuan. |

## Data Karyawan Demo

Repository berisi definisi seed data karyawan di `config/database.js` dan `config/init.sql`. Tabel `employees` dibuat otomatis dengan kolom `id`, `employee_code`, `name`, `role`, `department`, `email`, `phone`, `status`, `created_at`, dan `updated_at`.

Data demo yang disediakan:

| Kode | Nama | Role | Departemen |
|---|---|---|---|
| EMP001 | Admin Demo | Admin | IT Integrator |
| EMP002 | Operator Demo | Operator | Operasional Gateway |
| EMP003 | User Demo | User | Client UMKM |
| EMP004 | Finance Staff | Finance | Keuangan |
| EMP005 | Integration Staff | Integration Staff | Integrasi Service |

## Tabel Shadow

Tabel `shadow_service_usage` mencatat jejak penggunaan service tanpa mengubah perilaku `request_logs`. Tabel ini menyimpan `request_log_id`, `source_app`, `service_name`, `endpoint`, `consumer_id`, `request_method`, `request_status`, `response_code`, dan `used_at`.

Gateway mengisi `source_app` dari header `x-source-app` atau `x-consumer-app`, lalu memakai nilai cadangan `unknown_app`. `consumer_id` diambil dari token user, body/query `user_id`, atau nilai cadangan `anonymous`. Kegagalan insert tabel shadow tidak menghentikan response gateway.

## 5.1 Kebutuhan Fungsional Tambahan Berdasarkan Evaluasi Dosen

| ID | Kebutuhan | Implementasi |
|---|---|---|
| FR-17 Endpoint Verification | Sistem harus menyediakan dokumentasi endpoint aktual yang tersedia. | Endpoint terverifikasi dicatat di README dan menu Dokumentasi API dashboard. |
| FR-18 One-Click Demo Login | Demo login harus bisa dilakukan tanpa mengetik username/password. | Tombol `Login sebagai Admin`, `Login sebagai Operator`, dan `Login sebagai User` pada `/login`. |
| FR-19 Employee Demo Data | Repository harus memuat data karyawan. | Tabel `employees`, seed EMP001 sampai EMP005, dan halaman `/dashboard/employees`. |
| FR-20 Shadow Table | Sistem harus memiliki tabel shadow untuk jejak penggunaan service. | Tabel `shadow_service_usage` dibuat idempotent dan diisi dari gateway. |
| FR-21 Usage Analytics Diagram | Data aplikasi pengguna service harus tampil sebagai diagram efektivitas. | `/dashboard/analytics` menampilkan grafik aplikasi sumber dan bagian `Efektivitas Penggunaan Service`. |
| FR-22 GitHub Repository Evidence | Repository harus menjadi bukti implementasi data, endpoint, dan revisi. | README, `config/init.sql`, `config/database.js`, dan dashboard berisi bukti implementasi. |

## Cara Demo Kepada Dosen

1. Jalankan aplikasi dan buka `http://localhost:3000/login`.
2. Klik `Login sebagai Admin`.
3. Buka menu `Data Karyawan` untuk menunjukkan seed data EMP001 sampai EMP005.
4. Klik `Seed Demo Data` di dashboard untuk membuat data grafik demo.
5. Buka `Analitik` dan tunjukkan bagian `Efektivitas Penggunaan Service` serta grafik penggunaan berdasarkan aplikasi sumber.
6. Buka `Dokumentasi API` untuk menunjukkan endpoint yang tersedia.
7. Uji gateway dengan header `x-source-app` atau `x-consumer-app` agar record baru masuk ke `shadow_service_usage`.
