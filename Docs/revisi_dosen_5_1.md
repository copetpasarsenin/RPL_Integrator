# 5.1 Kebutuhan Fungsional Tambahan Berdasarkan Evaluasi Dosen

Dokumen ini melengkapi dokumentasi RPL Integrator berdasarkan evaluasi dosen. Fokus revisi adalah pembuktian endpoint, demo login satu klik, data karyawan, tabel shadow, dan diagram efektivitas penggunaan service.

| Kode | Kebutuhan | Implementasi |
|------|-----------|--------------|
| FR-17 Endpoint Verification | Endpoint utama harus diverifikasi dan didokumentasikan. | Endpoint yang tersedia dicatat pada tabel endpoint di bawah. |
| FR-18 One-Click Demo Login | Demo login tidak boleh mewajibkan input username/password. | Halaman `/login` memiliki tombol `Login sebagai Admin`, `Login sebagai Operator`, dan `Login sebagai User`. |
| FR-19 Employee Demo Data | Repository harus memiliki data karyawan. | Tabel `employees` dibuat otomatis dan diisi data EMP001 sampai EMP005. |
| FR-20 Shadow Table | Sistem harus memiliki shadow table. | Tabel `shadow_service_usage` menyimpan penggunaan service dari gateway dan simulasi demo. |
| FR-21 Usage Analytics Diagram | Data aplikasi pengguna service harus ditampilkan sebagai diagram efektivitas. | Dashboard analytics menampilkan `Penggunaan Berdasarkan Aplikasi Sumber` dan `Efektivitas Penggunaan Service`. |
| FR-22 GitHub Repository Evidence | Bukti revisi harus tersedia di repository. | Schema database, seed data, route, view, dan dokumentasi berada di repository ini. |

## Endpoint yang Tersedia

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/login` | Menampilkan halaman login. |
| POST | `/login` | Memproses login manual dan login demo satu klik. |
| GET | `/dashboard` | Menampilkan ringkasan dashboard untuk admin/operator. |
| GET | `/dashboard/analytics` | Menampilkan analytics, aplikasi sumber, dan efektivitas service. |
| GET | `/dashboard/employees` | Menampilkan data karyawan demo. |
| GET | `/api/status` | Menampilkan status gateway dan service. |
| GET | `/api/services` | Menampilkan daftar service untuk user dashboard. |
| GET | `/api/logs` | Menampilkan log request untuk user dashboard. |
| GET | `/api/keys` | Menampilkan API key milik user yang login. |
| POST | `/api/demo/simulate` | Membuat simulasi request demo. |
| POST | `/api/demo/seed-data` | Membuat data demo log, revenue, shadow usage, dan alert. |
| GET | `/integrator/:service` | Meneruskan request GET ke service aktif. |
| ALL | `/integrator/:service/:path` | Meneruskan request dinamis ke path service tujuan. |

## Akun Demo

| Role | Username | Password | Cara Demo |
|------|----------|----------|-----------|
| Admin | `admin` | `admin123` | Klik `Login sebagai Admin` di halaman login. |
| Operator | `operator` | `operator123` | Klik `Login sebagai Operator` di halaman login. |
| User | `user` | `user123` | Klik `Login sebagai User` di halaman login. |

Catatan: akun demo hanya digunakan untuk pengujian dan presentasi.

## Data Karyawan dan Tabel Shadow

Tabel `employees` berisi data demo berikut: EMP001 Admin Demo, EMP002 Operator Demo, EMP003 User Demo, EMP004 Finance Staff, dan EMP005 Integration Staff. Data ini dibuat otomatis saat inisialisasi database dan aman dijalankan berulang karena memakai `ON DUPLICATE KEY UPDATE`.

Tabel `shadow_service_usage` mencatat penggunaan service dengan kolom `source_app`, `service_name`, `endpoint`, `consumer_id`, `request_method`, `request_status`, `response_code`, dan `used_at`. Gateway mencatat data ini pada request sukses maupun error. Jika pencatatan shadow gagal, response gateway tetap dikirim agar layanan utama tidak terganggu.

## Dashboard Analytics dan Diagram Efektivitas

Halaman `/dashboard/analytics` menampilkan ringkasan total request, tingkat error, total penggunaan dari tabel shadow, jumlah aplikasi sumber, chart `Penggunaan Berdasarkan Aplikasi Sumber`, tabel `Konsumen Teratas`, dan tabel `Efektivitas Penggunaan Service`. Tabel efektivitas menampilkan service, total penggunaan, jumlah sukses, jumlah error, dan tingkat sukses.

## Langkah Demo untuk Dosen

1. Jalankan server dengan `node server.js` setelah database MySQL tersedia.
2. Buka `http://localhost:3000/login`.
3. Klik `Login sebagai Admin` tanpa mengetik username atau password.
4. Buka menu `Data Karyawan` untuk menunjukkan data EMP001 sampai EMP005.
5. Buka dashboard utama dan klik `Buat Data Demo` untuk mengisi log, revenue, alert, dan shadow usage.
6. Buka menu `Analitik` untuk menunjukkan chart aplikasi sumber dan tabel efektivitas penggunaan service.
7. Buka `Dokumentasi API` atau endpoint `/api/status` untuk memperlihatkan endpoint gateway yang aktif.
