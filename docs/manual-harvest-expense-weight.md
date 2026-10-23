# Berat manual untuk pengeluaran panen

`Total Overall Weight` diisi manual memakai berat setelah potongan yang menjadi dasar upah panen. Kolom baru dimulai kosong; saat mengedit, berat yang tersimpan ditampilkan kembali. Mengubah 1st/2nd Weight tidak menimpa isian manual.

Perhitungan:

- Total upah = Total Overall Weight × upah per kg, dibulatkan ke dua angka desimal.
- Total pengeluaran = total upah + ongkos supir.
- Draft belum memotong saldo. Publikasi dan edit yang masih diperbolehkan memperbarui jurnal serta cash secara atomik.

Contoh: 1st Weight 10.000 kg, 2nd Weight 4.000 kg, berat manual setelah potongan 5.880 kg, upah Rp250/kg dan ongkos supir Rp450.000 menghasilkan upah Rp1.470.000 serta total pengeluaran Rp1.920.000.

Berat manual wajib lebih dari nol, maksimal 1.000.000 kg, maksimal dua angka desimal dan tidak melebihi selisih timbangan. Nilai upah dan total biaya tetap dihitung database, bukan diterima dari client. Masa edit tujuh hari, MFA, ownership, versi catatan dan idempotency key tetap berlaku.

## Migrasi dan kompatibilitas

Terapkan `supabase/migrations/202610230001_manual_harvest_expense_weight.sql` sebelum merilis aplikasi yang mengirim berat manual. Migrasi mengubah `overall_weight` menjadi kolom input biasa sambil mempertahankan nilai lama, lalu menggunakan kolom tersebut untuk generated column `labor_cost` dan `total_expense`. Riwayat biaya, jurnal, saldo dan waktu publikasi lama tidak diubah.

RPC publik tetap melalui MFA; implementasi privat mempertahankan izin sebelumnya. Untuk kompatibilitas rollout, INSERT dari client lama yang tidak mengirim berat masih memakai selisih timbangan; UPDATE tanpa berat mempertahankan berat manual yang sudah tersimpan. Formulir dan API baru mewajibkan berat eksplisit. Buka ulang halaman setelah deployment untuk mengambil formulir terbaru.

Pada proyek Supabase yang terhubung, migrasi telah diterapkan pada 23 Oktober 2026 setelah dry-run transaksi rollback dan pemeriksaan hash seluruh 21 tabel public. Data finansial dan izin RPC/MFA identik sebelum/sesudah. Tidak ada catatan pengeluaran panen lama pada saat penerapan live; preservasi catatan lama yang sudah berisi data juga diuji melalui regresi migrasi.

## Validasi

112 tes regresi lulus, build/typecheck produksi berhasil, dan audit dependency melaporkan nol kerentanan. Tes tambahan memeriksa berat setelah potongan, nominal desimal, draft/publikasi/edit, preservasi data sebelum migrasi, retry identik dan key konflik, versi usang, ownership, MFA, penguncian tujuh hari, serta formulir yang mempertahankan input manual.
