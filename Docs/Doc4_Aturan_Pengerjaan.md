                
ATURAN PENGERJAAN TUGAS BESAR				
SKEMA TUGAS BESAR MATA KULIAH RPL 2				
Dosen	M. Yusril Helmi Setyawan, S.Kom., M.Kom.			
                
No	Aturan	Deskripsi	Implikasi ke Mahasiswa	Contoh Implementasi
1	Setiap fitur = 1 node sistem	Setiap fitur pada tabel kebutuhan fungsional direpresentasikan sebagai node dalam sistem	Mahasiswa memahami bahwa setiap fitur adalah unit implementasi nyata	Fitur checkout → node 'checkout' di Marketplace
2	Alur = Input → Proses → Output	Semua fitur harus mengikuti pola IPO (Input-Proses-Output)	Mahasiswa berpikir sistematis saat membangun API	Input: product_id → Proses: hitung total → Output: payment request
3	Semua output transaksi = payment request	Setiap transaksi harus menghasilkan request ke sistem pembayaran	Tidak ada transaksi langsung tanpa sistem bank	POS → /pay → SmartBank
4	SmartBank sebagai pusat kontrol	Semua transaksi keuangan hanya diproses oleh SmartBank	Mencegah manipulasi saldo oleh aplikasi lain	Marketplace tidak boleh update saldo langsung
5	Wajib melalui API Gateway	Semua komunikasi antar aplikasi harus melalui gateway	Menjamin keamanan dan konsistensi sistem	Marketplace → Gateway → SmartBank
6	Validasi & Logging wajib	Setiap request harus divalidasi dan dicatat	Mahasiswa memahami pentingnya middleware	JWT validation + logging request
7	Analytics hanya membaca data	Analytics tidak boleh mengubah data transaksi	Memisahkan sistem operasional dan analisis	Dashboard hanya read dari ledger
8	Tidak ada uang dibuat bebas	Semua uang harus berasal dari sistem bank	Mahasiswa memahami konsep money supply	Saldo hanya berubah lewat SmartBank
9	Semua layanan berbayar	Setiap fitur memiliki fee atau biaya layanan	Mahasiswa memahami monetisasi sistem	Marketplace fee 2%, Logistics fee
10	Setiap endpoint = kontrak sistem	Endpoint API harus jelas dan konsisten	Mahasiswa memahami pentingnya API contract	POST /marketplace/checkout
