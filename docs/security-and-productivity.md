# Keamanan, pengingat dan transaksi rutin

Fitur berada di branch `feature/finance-production-foundation`. Migrasi dan pengaturan Supabase harus diterapkan di staging sebelum data nyata digunakan.

## MFA melalui Authenticator

Menu **Keamanan akun** mendaftarkan TOTP melalui Supabase Auth: pindai QR atau gunakan kunci manual, kemudian verifikasi enam digit. Kunci tidak disimpan di tabel aplikasi atau log. Pengguna dapat menambahkan perangkat kedua dan memilih perangkat saat verifikasi login. Menghapus perangkat meminta kode baru dari perangkat tersebut; menghapus faktor terakhir menonaktifkan MFA.

Setelah faktor terverifikasi, sesi password saja (AAL1) tidak dapat membuka data keuangan. Frontend menunggu pemeriksaan faktor, API memeriksa klaim setelah token diverifikasi Supabase, RLS menolak baca langsung, dan RPC `SECURITY DEFINER` melakukan pemeriksaan MFA sebelum mengakses data. Fungsi lama disimpan privat tanpa hak execute pengguna. Proses pemeriksaan yang terlambat tidak dapat membuka halaman setelah unmount/perubahan sesi.

Terapkan `202610080006_mfa_access.sql` dan `202610080007_productivity_and_profit.sql`. Setelah `private_finance_files.sql`, terapkan `supabase/storage/mfa_storage_access.sql` untuk Storage. Kebijakan ini menjaga akses langsung ke bucket aplikasi; service/admin operasi tetap memakai akses server untuk backup. Pengujian Supabase nyata wajib mencakup pendaftaran, challenge, refresh, sign-out, unenroll dan akses langsung dengan token AAL1/AAL2. [Dokumentasi MFA Supabase](https://supabase.com/docs/guides/auth/auth-mfa/totp).

MFA bersifat pilihan sampai didaftarkan. Tidak ada kode pemulihan lokal yang melewati pemeriksaan. Perangkat hilang memerlukan pemulihan oleh pengelola Supabase setelah verifikasi identitas, dengan prosedur yang disiapkan sebelum penggunaan nyata. Reset password tidak otomatis menghapus MFA.

## Pengingat dalam aplikasi

- Anggaran bulan berjalan: peringatan saat pengeluaran mencapai 80%, dan peringatan kelebihan saat lebih dari 100%.
- Target Tabungan/Investasi: tampil bila sisa dana masih positif dan tenggat tinggal 14 hari, hari ini, atau sudah lewat.
- Template aktif: pengingat saat jadwal sudah tiba.

Pengingat mengikuti tanggal WITA dan snapshot database terbaru, tanpa membuat transaksi atau mengubah saldo. Anggaran pengingat selalu bulan berjalan walaupun filter laporan memilih bulan lain. Daftar ringkas menampilkan tiga item dan dapat diperluas. Pengiriman email/push eksternal belum dikonfigurasi.

## Template transaksi rutin

Menu **Template transaksi** mendukung kategori pengeluaran kebun/lainnya, pemasukan lainnya, alokasi dan belanja Tabungan/Investasi. Isian: nama, rincian keterangan/Rupiah, rekening, frekuensi mingguan/bulanan, tanggal berikutnya dan status aktif/jeda. Maksimal 100 template per pengguna; dapat diubah dengan pemeriksaan versi dan audit.

**Tinjau transaksi** tersedia ketika jadwal tiba dan membuka formulir yang telah terisi. Pengguna dapat mengubah nominal/tanggal/rekening. Checkbox publikasi selalu kosong. Menyimpan sebagai draft belum mengubah saldo; pengguna melanjutkan publikasi melalui menu transaksi terkait. Draft atau publikasi yang berhasil menggunakan satu jadwal dan memajukan tanggal berikutnya secara atomik. Jadwal terlewat diproses satu per satu; pengguna dapat mengubah tanggal template untuk menjeda atau melewati jadwal.

Kunci retry, versi template, dan keunikan `(template_id, scheduled_date)` mencegah duplikasi antar tab. Pembuatan catatan dan perubahan jadwal berada dalam transaksi yang sama. Bulanan mempertahankan tanggal acuan: 31 Januari → 28/29 Februari → 31 Maret. Tidak ada scheduler yang mempublikasikan transaksi rutin secara otomatis.

## Keuntungan per panen

Pada **Analisis keuangan**, tabel keuntungan memakai seluruh SPK dan pengeluaran yang dipublikasikan dalam masing-masing kelompok panen, termasuk catatan di luar halaman SPK saat ini. Daftar panen memakai pagination yang sudah ada, maksimal 20 per halaman.

- Keuntungan = pendapatan SPK − pengeluaran panen − biaya kebun yang dialokasikan.
- Biaya/kg = total biaya tersebut ÷ berat bersih SPK yang dibayar. Berat nol menampilkan `—`.
- Margin = keuntungan ÷ pendapatan × 100%. Pendapatan nol menampilkan `—`.

**Atur biaya kebun** memilih catatan kebun yang sudah dipublikasikan dan membagi nominal ke panen. Satu biaya dapat dibagi ke beberapa panen, tetapi jumlahnya tidak boleh melampaui nominal sumber. Alokasi tidak membuat pergerakan uang baru. Nominal 0 mengosongkan alokasi sambil mempertahankan audit. Pilihan biaya memakai pencarian dan pagination 20 baris.

Alokasi dapat diubah sampai tujuh hari sejak publikasi biaya sumber, dengan versi dan catatan alasan. Biaya yang sudah dialokasikan tidak dapat diedit menjadi lebih kecil daripada jumlah alokasinya; pengguna mengurangi alokasi dahulu. Riwayat lama tetap tersimpan. Biaya kebun belum dialokasikan, pengeluaran lainnya, transfer, dan koreksi saldo tidak termasuk keuntungan per panen; tabel menjelaskan batas perhitungan ini. Ini bukan laporan laba komprehensif seluruh usaha.

## Navigasi mobile

Sidebar tetap dibuka melalui tombol kanan atas. Kelompok Transaksi, Laporan dan Perencanaan dapat dibuka/tutup, dengan kelompok halaman aktif terbuka otomatis. Di desktop seluruh kelompok tetap terlihat. Tombol memiliki `aria-expanded`, `aria-controls`, serta mendukung keyboard. Navigasi menutup drawer dan mengembalikan fokus.

## Validasi

Pengujian otomatis mencakup penolakan AAL1 pada API/RPC/RLS, fungsi privat, pembatalan pemeriksaan frontend, batas pengingat dengan uang besar, template retry/versi/jadwal akhir bulan, kepemilikan, alokasi berlebihan, perubahan biaya sumber, profit dan lock tujuh hari. Seluruh 86 pengujian aplikasi lulus; build diperiksa sebelum push. Lima belas halaman diperiksa pada lebar 320/390/768/1440 px tanpa overflow halaman. Snapshot 50.000 catatan sekitar 394 ms / 32 KB dan 5.000 jurnal aktif sekitar 364 ms / 35 KB pada pengujian lokal, bukan jaminan latensi produksi.

Database/Storage/Auth produksi belum dihubungkan. Pengujian lokal PGlite dan mock API tidak menggantikan uji concurrency PostgreSQL multi-koneksi, Authenticator nyata, Storage RLS, SMTP dan restore backup di staging.
