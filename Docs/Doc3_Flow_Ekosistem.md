# ALUR KERJA DAN INTEGRASI — API GATEWAY / INTEGRATOR
**Skema Tugas Besar Mata Kuliah RPL 2**
Dosen: M. Yusril Helmi Setyawan, S.Kom., M.Kom.

---

### Alur Sistem (Input → Proses → Output)
Sesuai dengan ketentuan umum ekosistem, aplikasi API Gateway / Integrator bertugas menjadi jalur utama (middleware) untuk semua aplikasi:

1. **Penerimaan Request (Input):** Menerima request masuk dari berbagai aplikasi (seperti Marketplace, POS, SupplierHub) yang memiliki tujuan tertentu (misal: checkout, request payment).
2. **Eksekusi Gateway (Proses):** - Melakukan **Validasi Request** (seperti validasi token JWT) untuk memastikan keamanan.
   - Melakukan **Logging** untuk mencatat jejak request.
   - Melakukan **Routing API** (meneruskan request) ke aplikasi tujuan (terutama ke SmartBank untuk transaksi keuangan).
3. **Pengembalian Respon (Output):** Mengembalikan respon sukses/gagal dari aplikasi tujuan kembali ke aplikasi asal (forward response).

**Catatan Integrasi Penting:** Semua komunikasi antar aplikasi dalam ekosistem wajib melalui API Gateway.