# Audit Cash Flow — 8 Oktober 2026

Audit dilakukan sebelum Supabase dan server produksi dikonfigurasi. Masalah yang ditemukan telah diperbaiki secara lokal pada branch `codex/system-reliability-audit`. Perubahan sidebar dan ekspor dari pekerjaan sebelumnya tetap dipertahankan. Belum ada push, deployment, atau migrasi ke database remote dalam audit ini.

## Hasil verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Seluruh pengujian otomatis | 70 lulus, 0 gagal, 0 dilewati |
| Build backend dan frontend | Lulus pemeriksaan sintaks JavaScript, TypeScript, dan Vite |
| Audit dependency npm | 0 kerentanan terdeteksi setelah patch |
| Riwayat 50.000 catatan | Snapshot sekitar 343 ms, respons 13.419 byte, daftar maksimal 20 catatan |
| Saldo dan analisis | Cocok setelah edit nominal/tanggal, termasuk nilai uang di atas batas integer aman JavaScript |
| UI sembilan menu | Diperiksa pada lebar 320, 390, 768, dan 1440 px; tidak ada overflow halaman |
| Sidebar mobile | Terbuka melalui tombol, menutup setelah navigasi; menu sama dengan desktop |
| Browser setelah reload untuk QA | Tidak ada error console baru dalam pengujian navigasi/formulir |
| Bundle produksi | JavaScript sekitar 123,45 KB gzip; CSS sekitar 8,04 KB gzip |
| Health check | Pengujian jadwal tengah malam WITA, retry, pembatalan saat shutdown, dan pencegahan job bersamaan lulus |

Pengujian akhir menggunakan Node 24 yang tersedia pada runtime lokal dan memenuhi versi dependency. `.nvmrc` dan CI menetapkan Node 22. Shell default komputer masih menggunakan Node 21; gunakan versi yang didukung ketika menjalankan atau menyiapkan server.

Ukuran dan waktu snapshot adalah hasil fixture lokal PGlite, bukan ukuran maksimum semua kombinasi rincian atau kapasitas server produksi. Pengujian request yang bersamaan memakai antrean PGlite; pengujian PostgreSQL dengan beberapa koneksi dan beban nyata tetap diperlukan di staging. Tidak ada dasar untuk menjamin bebas error selamanya.

## Temuan dan perbaikan

### Konsistensi transaksi dan saldo

- Akun pemilik sebelumnya masih memiliki izin INSERT/UPDATE langsung ke tabel. Ini memungkinkan pemanggilan PostgREST melewati pemeriksaan versi API. Migrasi baru `202610080001_enforce_atomic_writes.sql` mencabut izin tulis langsung pada tabel panen, SPK, pengeluaran panen, dan rincian cash. Penyimpanan tetap melalui RPC `save_financial_record` yang memeriksa pemilik, versi, serta idempotency key. Pengujian memastikan tulis langsung ditolak dan RPC tetap berfungsi.
- Dua penyimpanan dengan key sama menghasilkan satu transaksi. Dua edit dari versi lama menghasilkan satu pemenang dan satu konflik, dengan saldo sesuai edit yang berhasil. Waktu publikasi awal tetap dipertahankan; database mengunci catatan tepat setelah 7 × 24 jam.
- Kartu Cash tersedia sebelumnya menampilkan arus bersih bulan terpilih. Sekarang kartu ini menunjukkan saldo keseluruhan, dengan keterangan “Saldo seluruh periode setelah pengeluaran dan alokasi”. Kartu lainnya tetap mengikuti filter. Uji browser menunjukkan cash Rp183.343.500 tetap sama ketika Agustus dipilih, sementara pendapatan Agustus menjadi Rp67.158.500. Ini data contoh.
- Cursor pagination kini direset ketika filter bulan berubah, sehingga halaman dari filter lama tidak menyembunyikan catatan pada filter baru.
- Notifikasi tab kini memiliki identitas pengirim. Tab yang menyimpan tidak membatalkan refresh saldonya sendiri akibat notifikasi tersebut. Jika BroadcastChannel diblokir browser, penyimpanan tetap berhasil; refresh saat fokus dan polling tetap tersedia.
- Refresh saat fokus dan polling tidak menumpuk ketika pembacaan sebelumnya masih berlangsung. Notifikasi dari tab lain tetap dapat menggantikan snapshot yang dimulai sebelum perubahan data.
- Inisialisasi sesi login yang lambat tidak dapat menimpa event login/logout yang lebih baru. Form autentikasi juga menolak submit ganda sebelum React memperbarui status tombol.
- Jika respons penyimpanan terputus, pesan meminta pengguna mengulang dengan isian yang sama dan memeriksa catatan sebelum membuat transaksi baru. Tidak ada retry mutation otomatis dengan key baru.

### Server dan keamanan

- Request Supabase untuk autentikasi dan query berbagi batas waktu 15 detik per request API. Tidak ada retry otomatis pada mutation. Jika koneksi terputus setelah database menyimpan, retry dengan key yang sama tetap terlindungi.
- Kegagalan jaringan autentikasi mengembalikan 503, sehingga tidak keliru dinyatakan sebagai sesi kedaluwarsa.
- Server membatasi waktu penerimaan header/body, memakai keep-alive pendek, dan memiliki batas shutdown. Scheduler berhenti saat shutdown.
- `TRUST_PROXY_HOPS` tersedia untuk konfigurasi proxy yang diketahui, dengan default 0. Nilai harus sesuai topologi deployment; jangan membiarkan jalur langsung yang melewati proxy terpercaya.
- GET `/api/harvests` dan `/api/cash-expenses` yang membaca seluruh riwayat sekaligus dinonaktifkan dengan 410 dan petunjuk memakai `/api/workspace`. POST/PATCH tidak berubah. UI sudah memakai snapshot berpaginasi.
- Dependency development `shell-quote` diperbarui dari 1.9.0 ke 1.11.0 melalui override karena `concurrently` mematok versi lama. Patch sesuai [advisory pengelola](https://github.com/advisories/GHSA-pqg4-j6r4-53mv). CI kini menjalankan audit dependency tingkat high/critical.

### UI dan alur penggunaan

- Ikon Tabungan menggunakan PiggyBank dan Target Investasi menggunakan Target; keduanya lebih mudah dibedakan dari kebun dan analisis.
- Tombol publikasi Pemasukan Lainnya kini benar-benar bertuliskan “Publikasikan pemasukan”.
- Filter bulan diberi nama aksesibel “Filter bulan transaksi”. Tombol ikon pada mobile memiliki area 44 × 44 px. Kartu rincian dapat membungkus nominal panjang agar tetap berada dalam layar.
- Dialog memiliki nama aksesibel, mengembalikan fokus, dan memulihkan pengaturan scroll setelah ditutup.
- Error boundary menampilkan cara memuat ulang jika rendering gagal, sehingga pengguna tidak hanya melihat layar kosong. Isian yang belum disimpan dijelaskan akan perlu diisi ulang.
- Ekspor SPK dan pengeluaran menunda pencabutan URL unduhan agar browser sempat membacanya. Isi CSV pengeluaran diuji terpisah dari data pendapatan SPK. Uji membuka file hasil unduhan pada browser produksi tetap diperlukan; pengujian lokal ini tidak mengklaim semua mekanisme unduhan browser sudah diverifikasi.

Formulir diuji dengan contoh 10.000 − 4.000 kg, potongan 120 kg = 2%, dan harga Rp3.000/kg → Rp17.640.000. Pengeluaran 6.000 kg × Rp250 + Rp450.000 → Rp1.950.000. Rincian pemasukan Rp1.500.000,25 + Rp250.000,75 → Rp1.750.001. Default kebun/lainnya dua rincian; Tabungan, investasi, dan pemasukan satu rincian. Pratinjau menolak penyimpanan sebagaimana mestinya.

## Batas aturan keuangan yang perlu dipahami

1. Draft tidak memengaruhi saldo. Publikasi memengaruhi saldo keseluruhan segera; tanggal transaksi menentukan periode laporan. Untuk rencana yang belum direalisasikan, gunakan draft. Transaksi bertanggal masa depan dapat membuat saldo keseluruhan berbeda dengan saldo akhir laporan periode berjalan.
2. Saldo awal saat ini diasumsikan Rp0 sebelum catatan pertama. Belum ada fitur saldo awal/rekening khusus.
3. Alokasi Tabungan/Target Investasi dan pengeluarannya adalah dua arus keluar terpisah sesuai aturan yang sebelumnya diminta. Alokasi Rp1.000.000 kemudian pengeluaran Rp250.000 mengurangi cash utama Rp1.250.000. Ini belum merupakan pemindahan uang antar rekening atau belanja dari saldo tabungan.
4. Uang final dihitung PostgreSQL NUMERIC dan total agregat dikirim sebagai teks. Grafik persentase memakai angka untuk visualisasi; nilai rupiah tetap ditampilkan dari nilai desimal final.
5. Catatan terkunci tidak dapat diedit atau dihapus. Mekanisme koreksi setelah tujuh hari belum disediakan; perlu fitur koreksi tersendiri bila diperlukan.

## Prioritas peningkatan berikutnya

| Prioritas | Peningkatan | Tujuan |
| --- | --- | --- |
| Sebelum penggunaan nyata | Backup terjadwal, uji restore, monitoring error/uptime, dan rekonsiliasi saldo | Memastikan data dapat dipulihkan dan kegagalan segera diketahui |
| Tinggi | Saldo awal serta akun cash/bank/tabungan dengan transfer antar akun | Membuat saldo aplikasi sesuai uang yang benar-benar tersedia dan memperjelas alokasi |
| Tinggi | Riwayat perubahan permanen dengan nilai sebelum/sesudah serta catatan koreksi | Memudahkan penelusuran perubahan sensitif dan koreksi catatan yang terkunci |
| Menengah | Target nilai dan tanggal, progress bar, serta sisa dana Tabungan/Target Investasi | Memperjelas kemajuan rencana dan dana yang belum digunakan |
| Menengah | Grafik komposisi pengeluaran per kategori dan anggaran bulanan | Memudahkan melihat kategori biaya terbesar dan penyimpangan anggaran |
| Menengah | Ekspor laporan seluruh periode melalui job bertahap dan bukti transaksi | Mendukung pemeriksaan arsip besar tanpa membebani request interaktif |

Peningkatan bisnis pada tabel ini adalah rekomendasi, belum diimplementasikan dalam audit. Aturan transfer, saldo awal, serta koreksi harus ditentukan sebelum implementasi agar tidak mengubah angka lama secara diam-diam.

## Verifikasi setelah Supabase dan server terhubung

1. Terapkan seluruh migrasi berurutan, termasuk migrasi audit baru, pada staging terlebih dahulu.
2. Uji dua akun nyata: login, logout, sesi kedaluwarsa, lupa password melalui SMTP, dan isolasi RLS.
3. Jalankan create/edit/publish seluruh kategori melalui browser → API → database, lalu cocokkan saldo dan analisis dengan catatan kontrol.
4. Uji dua tab/perangkat mengedit catatan yang sama, submit berulang, koneksi terputus setelah submit, dan batas tujuh hari menggunakan beberapa koneksi PostgreSQL.
5. Uji data realistis dengan banyak panen, SPK, dan rincian biaya; ukur p95 respons, CPU/RAM server, database, dan query plan. Jangan menjadikan angka fixture lokal sebagai kapasitas hosting.
6. Gunakan Node yang didukung, HTTPS, origin/proxy yang tepat, redirect pemulihan password, SPA fallback, serta proses backend yang selalu aktif untuk health check tengah malam WITA.
7. Pastikan backup bisa direstore, monitor eksternal dapat mendeteksi kegagalan, dan unduhan CSV bekerja pada browser yang benar-benar digunakan.

## Bukti tampilan

Screenshot lokal tersedia di `artifacts/screenshots/system-audit-desktop.png` dan `artifacts/screenshots/system-audit-mobile.png`. Data pada screenshot adalah data contoh, bukan database pengguna.
