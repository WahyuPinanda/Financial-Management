# Audit deployment Cash Flow — 9 Oktober 2026

Audit menggunakan aplikasi Cloud Run dan Supabase yang sudah terhubung, melalui API HTTPS dan browser. Akun pemilik tidak dipakai untuk transaksi pengujian. Dua akun Auth sementara dipakai untuk data dummy dan pengujian isolasi pengguna. Sebelum tes, seluruh tabel finansial kosong dan hanya satu akun Auth asli tersedia.

URL yang diperiksa:

- https://cash-flow-qlfkji5t6a-as.a.run.app
- https://cash-flow-680795216338.asia-southeast1.run.app

## Temuan yang diperbaiki

**Konflik penyimpanan menyebabkan retry berulang.** Versi catatan yang sudah usang dan penggunaan ulang idempotency key dengan payload berbeda sebelumnya menggunakan SQLSTATE `40001`. Dalam deployment, permintaan tertentu menunggu sekitar 15 detik lalu mengembalikan 503. Kode tersebut diperlakukan sebagai kegagalan serialisasi yang dapat dicoba ulang oleh PostgREST, padahal konflik bisnis tidak bisa berhasil melalui retry.

Migrasi `202610090001_non_retryable_business_conflicts.sql` mengganti kode konflik bisnis menjadi `P0001`, yang sudah dipetakan API menjadi HTTP 409. Migrasi telah diterapkan ke database remote dan dicatat dalam riwayat migrasi. Identitas fungsi, pemilik, konfigurasi security dan izin EXECUTE dipertahankan. Setelah perbaikan, dua edit SPK bersamaan menghasilkan satu 200 dan satu 409 dalam 228–235 ms; saldo berubah tepat sekali. Tidak ada lagi fungsi public yang mengangkat `40001` sebagai konflik buatan.

Dasar diagnosis: [Supabase — custom error codes and infinite transaction retries](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

**Dropdown formulir terlalu kecil untuk mobile.** Elemen `select` langsung di dalam label belum mendapat tinggi dan padding yang sama dengan input. CSS disesuaikan menjadi 47 px, dengan border, radius, lebar penuh dan padding yang konsisten. Perubahan ini tidak mengubah perhitungan atau model data.

## Pemeriksaan fitur

| Fitur               | Pengujian dan hasil                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login / logout      | Login akun dummy berhasil; logout mengembalikan pengguna ke login dan akses dashboard terlindungi. Sesi yang dicabut atau akun yang dihapus ditolak API dengan 401.                                                                               |
| MFA / keamanan akun | Kode salah ditolak, kode TOTP benar membuka dashboard. Token AAL1 ditolak API dengan 403 dan RPC dengan 42501 ketika faktor sudah diverifikasi; AAL2 diterima. MFA akun pemilik tidak diubah.                                                     |
| Dashboard           | Ringkasan, saldo cash tersedia, pendapatan dan biaya sesuai jurnal. Filter periode tidak menghapus saldo kumulatif.                                                                                                                               |
| Rekening & transfer | Aktivasi saldo awal cash/bank, rekening tambahan, transfer internal, koreksi positif/negatif dan saldo cadangan diperiksa. Transfer tidak mengurangi total uang. Saldo awal tidak menjadi pendapatan.                                             |
| Pendapatan panen    | Draft tidak menambah cash; publikasi, dua SPK, berat bersih, potongan persen, edit harga dan agregasi panen sesuai. Edit melalui UI mempertahankan waktu publikasi dan mengubah cash hanya sebesar selisih.                                       |
| Pemasukan Lainnya   | Menambah cash; nominal desimal Rp12.345,67 yang disimpan melalui UI cocok dengan database. Pengiriman enam request dengan key yang sama menghasilkan satu catatan.                                                                                |
| Pengeluaran panen   | Berat × upah/kg + ongkos supir benar. Draft mobile Rp195.000 tidak memotong cash; publikasi Rp2.000.000 mengurangi cash.                                                                                                                          |
| Pengeluaran kebun   | Rincian dinamis dan edit nominal menghitung ulang total. Alokasi biaya ke panen memperbarui keuntungan tanpa memotong cash untuk kedua kalinya.                                                                                                   |
| Pengeluaran lainnya | Publikasi dan biaya dari template mengurangi cash tepat sekali; draft dikecualikan.                                                                                                                                                               |
| Tabungan            | Alokasi menjadi transfer cadangan. Belanja dan edit belanja memakai cadangan; tidak terjadi pengurangan cash utama dua kali. Target, progress dan sisa dana ditampilkan.                                                                          |
| Target Investasi    | Transfer alokasi, belanja cadangan, target nilai/tanggal dan sisa dana sesuai jurnal. Pengeluaran melampaui saldo ditolak secara atomik.                                                                                                          |
| Template transaksi  | Membuat template tidak memotong cash. Penerapan menghasilkan draft, publikasi perlu konfirmasi. Retry identik tidak membuat duplikat; versi usang ditolak cepat.                                                                                  |
| Analisis keuangan   | Bulanan/tahunan, periode nol, pergantian tahun, komposisi biaya, keuntungan panen, biaya/kg dan biaya kebun yang dialokasikan diperiksa.                                                                                                          |
| Anggaran bulanan    | Tambah/edit anggaran dan pengingat melewati batas diperiksa. Target mendekati tenggat menghasilkan pengingat.                                                                                                                                     |
| Riwayat perubahan   | Nilai sebelum/sesudah dan alasan koreksi tersimpan. Koreksi untuk sumber terkunci tidak mengubah sumber aslinya; koreksi tersebut tidak dapat diedit sebagai transaksi biasa.                                                                     |
| Laporan & bukti     | PNG dummy diunggah lewat signed upload, ukuran/hash diverifikasi, download privat sesuai hash. Akses pengguna lain dan URL bucket publik ditolak. MIME tidak diizinkan ditolak.                                                                   |
| Ekspor              | Ekspor kecil dan arsip besar selesai melalui worker bertahap; akses lintas pengguna ditolak. CSV pengeluaran diperiksa memakai snapshot `activeHarvest` yang dipakai halaman, mencakup pengeluaran dan status draft, tidak memuat pendapatan SPK. |

Pengujian input meliputi ownership palsu, nominal negatif, presisi tidak valid, tanggal tidak valid, publikasi di masa depan, retry key hilang dan versi edit hilang. API menolak input tersebut tanpa perubahan saldo. Saldo/jurnal memenuhi pemeriksaan integritas database.

Batas 7 hari diuji pada **9 catatan**: SPK, pengeluaran panen dan tujuh kategori cash. Waktu publikasi dummy diatur secara terkontrol melalui transaksi SQL, dengan guard dipulihkan sebelum commit. **18 percobaan edit/unpublish ditolak dengan 409**; penghapusan langsung juga tidak diizinkan dan saldo tidak berubah. Ini simulasi batas waktu pada database live, bukan menunggu tujuh hari kalender.

## Responsiveness dan pengalaman penggunaan

Lima belas menu diperiksa setelah loading selesai pada viewport **360×800, 390×844, 768×1024 dan 1440×1000**: 60 pemeriksaan halaman. Tidak ditemukan overflow horizontal pada halaman, alert error atau error/warning console dalam sesi yang diamati. Tabel lebar tetap menggunakan area gulir internal.

Drawer mobile dapat dibuka, kelompok menu dapat ditutup/dibuka, navigasi menutup drawer, dan Escape menutupnya. Modal pengeluaran dapat digulir dan disimpan pada layar 360 px. Pagination UI berpindah ke halaman kedua dari 5.000 catatan; filter periode kosong memperlihatkan empty state yang benar. Screenshot tersimpan sebagai bukti.

## Performa deployment

Dataset besar dibuat pada akun dummy kedua dengan SQL, menggunakan kalkulasi, jurnal dan trigger aplikasi yang sama. Pengukuran berikut menggunakan API Cloud Run sebenarnya, bukan hasil benchmark lokal.

| Ukuran / pengukuran                             | Hasil                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Catatan cash                                    | 5.000                                                                                                            |
| Kelompok panen / jurnal akun besar              | 32 / 5.033 event                                                                                                 |
| Halaman transaksi                               | 20 catatan; halaman berikutnya berbeda dan total seluruh riwayat tetap tepat                                     |
| Lima pembacaan berurutan                        | 188–476 ms; respons sekitar 30–57 KB                                                                             |
| 15 pembacaan dalam kelompok 5 request bersamaan | 0 error; median 569 ms; p95/maksimum 710 ms                                                                      |
| Ekspor arsip besar                              | 5.033 baris, 26 bagian, 708.623 byte; selesai sekitar 9,5 detik, seluruh 5.000 deskripsi income ditemukan sekali |
| Edit bersamaan setelah fix                      | Satu 200, satu 409; tidak ada saldo ganda atau penimpaan diam-diam                                               |

Uji ini mengukur beban kecil bersamaan dengan riwayat ribuan baris. CPU/RAM Cloud Run, cold start setelah scale-to-zero, beban ratusan pengguna, soak test berhari-hari, pemadaman Supabase dan restart container paksa belum diukur. Hasil tersebut tidak menjadi jaminan kapasitas tanpa batas.

## Regresi dan build

Seluruh **109 tes regresi lulus**, termasuk tes baru konflik SQLSTATE, RLS, MFA, penguncian tujuh hari, jurnal besar, pagination dan worker ekspor. Build produksi/typecheck berhasil. Percobaan regresi pertama diblokir sandbox pada koneksi loopback `EACCES`; pengulangan dengan izin localhost berhasil seluruhnya.

Build memperlihatkan warning bundle JS sekitar **611 KB sebelum gzip / 176 KB gzip**. Pemisahan bundle dapat diprioritaskan untuk jaringan ponsel lambat. Warning ini tidak menyebabkan build gagal; performa jaringan lambat belum disimulasikan.

## Pembersihan terverifikasi

Seluruh dummy telah dihapus: **33 panen, 34 SPK, 2 pengeluaran panen, 5.011 catatan cash, 9 rekening, seluruh jurnal/audit/request/template/target/anggaran/alokasi dummy, 2 job ekspor dan 27 bagiannya**. Storage dibersihkan: **1 bukti PNG dan 27 objek ekspor**. Dua akun Auth dummy beserta faktor MFA dihapus; file lokal credential sementara juga dihapus.

Pemeriksaan akhir membandingkan semua **21 tabel public dan satu view** dengan hash/count baseline: seluruhnya kembali **0 baris**. Hanya **1 akun Auth asli** tetap tersedia. Tidak ada objek Storage dummy tersisa, tidak ada trigger aplikasi yang tertinggal disabled, dan RLS aktif pada seluruh 21 tabel. Dua URL deployment tetap sehat (200); JWT akun dummy yang telah dihapus ditolak (401). Akun pemilik dan saldonya tidak diaktifkan/diubah oleh audit.

## Sebelum memasukkan data penting

1. **Signup publik masih aktif**, berdasarkan `/auth/v1/settings`. Untuk aplikasi pribadi, matikan izin pendaftaran pengguna baru di Supabase Authentication. Tidak ada management credential yang digunakan untuk mengubah pengaturan tersebut dalam audit ini.
2. Verifikasi SMTP dan seluruh alur email pemulihan memakai inbox nyata. Validasi email salah dan halaman pemulihan sudah diperiksa; penerimaan email dan perubahan password akun nyata belum diuji. Aktifkan MFA pada akun pemilik melalui proses pengguna sendiri.
3. Lengkapi backup remote terjadwal, cadangan Storage, uji restore ke database terpisah, alert error/uptime dan alert kegagalan health job. Keberhasilan job health yang sebelumnya dijalankan tidak membuktikan backup atau pengiriman notifikasi sudah aktif.
4. Lakukan load/soak test serta pengukuran CPU/RAM, koneksi database, cold start dan recovery saat gangguan sebelum menetapkan kapasitas produksi. Rate limiter in-memory dan ekspor yang dilanjutkan melalui polling mempunyai batas pada deployment multi-instance.

Tidak ada kegagalan fungsi yang tersisa pada skenario live yang lulus setelah perbaikan. Pengujian terbatas waktu tidak membuktikan semua kondisi masa depan bebas error.

## Bukti lokal

Artefak berada di `artifacts/deployed-audit-2026-10-09/` (diabaikan Git): `race-retest.json`, `storage-mfa-results.json`, `lock-results.json`, `performance.json`, `large-export-results.json`, `responsive-results.json`, `ui-write-results.json`, `remaining-feature-results.json`, `cleanup-verification.json`, `final-verification.json`, log regresi/build dan screenshot.

Download native dari tombol CSV tidak menghasilkan event download pada browser automation yang tersedia. Isi CSV dari snapshot halaman live dan download HTTP arsip besar sudah diverifikasi; penerimaan file CSV melalui dialog download browser pengguna belum dikonfirmasi oleh automation. Kredensial tidak disertakan dalam laporan atau commit.
