# Audit deployment Cash Flow — 23 Oktober 2026

## Kesimpulan dan lingkup

Audit menggunakan HTTPS deployment `mycashflow.id`, Supabase PostgreSQL melalui TLS terverifikasi, dan dua akun dummy terisolasi. Data pemilik tidak digunakan untuk transaksi pengujian. Hasil menunjukkan fungsi yang diuji berjalan dan saldo tetap konsisten pada batas beban terukur. Ini bukan sertifikasi kapasitas tanpa batas atau jaminan tidak pernah terjadi error.

Temuan yang diperbaiki:

1. Halaman laporan sebelumnya membaca daftar ekspor setiap lima detik walaupun tidak ada pekerjaan aktif. Polling kini berhenti pada antrean kosong/selesai/dijeda/kedaluwarsa, berhenti saat tab tersembunyi/offline, membatasi dua pemicu worker per siklus, serta memakai backoff pada kegagalan. Error autentikasi tidak diulang otomatis oleh timer.
2. Snapshot keuangan memindai riwayat jurnal dan mengevaluasi identitas berulang kali. Pada 100.033 entri, ramp awal menghasilkan 503 akibat pembacaan yang melewati deadline. Migrasi `202610230002` mengurangi evaluasi identitas dan mengelompokkan per hari. Migrasi `202610230003` menambahkan ringkasan harian privat yang diperbarui dalam transaksi jurnal yang sama; detail jurnal tetap menjadi sumber otoritatif dan tetap dipaginasi.
3. Trigger ringkasan menangani seluruh kaki transfer sekaligus, sehingga transfer cash/bank tidak terhitung sebagai pengeluaran. Bulk insert memakai agregasi per statement dan rencana query tersendiri agar tidak memakai rencana nested loop untuk volume besar.

Kedua migrasi telah diterapkan sebelum rollout aplikasi. Dry run dan penerapan membandingkan snapshot lengkap, izin fungsi, serta data asli. Tidak ada perubahan pada hasil saldo, aturan MFA, atau hak tulis langsung pengguna.

## Fitur yang diperiksa

| Area                | Skenario dan hasil                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login dan proteksi  | Endpoint privat menolak tanpa token/invalid token; halaman login dapat dimuat melalui HTTPS.                                                                                                                        |
| MFA                 | Enroll pada akun dummy, OTP salah ditolak, token AAL1 ditolak API dan RPC setelah MFA aktif, token AAL2 diterima. Faktor MFA pemilik tidak diubah.                                                                  |
| Rekening            | Aktivasi, saldo awal, rekening tambahan, transfer cash/bank, koreksi positif/negatif, saldo cadangan dan integritas jurnal sesuai.                                                                                  |
| Pendapatan panen    | Grup panen, beberapa SPK, draft/publikasi, persentase potongan, berat bersih, pendapatan dan edit delta sesuai.                                                                                                     |
| Pengeluaran panen   | Berat bayar manual berbeda dari berat bruto; 5.700 kg × Rp250 + Rp450.000 = Rp1.875.000. Draft tidak mengurangi saldo; publikasi/edit memperbarui saldo. Berat negatif/nol/melebihi bruto/presisi berlebih ditolak. |
| Biaya kebun/lainnya | Baris dinamis, nominal desimal, edit, draft/publikasi, kategori dan saldo sesuai.                                                                                                                                   |
| Pemasukan lainnya   | Nilai positif, edit versi dan idempotensi sesuai; data invalid ditolak.                                                                                                                                             |
| Tabungan/investasi  | Alokasi memindahkan dana tanpa menggandakan biaya; belanja cadangan mengurangi saldo sekali; overcommit dan saldo tidak cukup rollback.                                                                             |
| Template rutin      | Template tidak mempublikasikan transaksi sendiri; penerapan draft tetap perlu konfirmasi. Retry identik tidak menduplikasi dan tanggal jadwal ganda ditolak.                                                        |
| Analisis panen      | Alokasi biaya kebun memengaruhi laba/biaya per kg tanpa pengurangan cash kedua. Analisis periode, tahun, dan batas halaman dibandingkan dengan jurnal.                                                              |
| Anggaran/target     | Edit versi, ambang pengingat, tenggat dan progress saldo sesuai.                                                                                                                                                    |
| Riwayat/jurnal      | Koreksi/edit tercatat, cursor stabil, halaman dibatasi, dana direkonsiliasi dengan pergerakan jurnal.                                                                                                               |
| Bukti transaksi     | Signed upload, konfirmasi hash, unduh privat, MIME invalid dan akses akun lain ditolak.                                                                                                                             |
| Ekspor              | Arsip kecil selesai, retry key tidak membuat job kedua, akses lintas akun ditolak. Ekspor besar dicatat terpisah di bawah.                                                                                          |
| Validasi/isolasi    | Tanggal masa depan publikasi, tanggal invalid, nominal negatif/presisi berlebih, pemalsuan pemilik, header idempotensi/versi yang hilang ditolak. RLS dan akses langsung tabel tetap dibatasi.                      |

## Race condition dan pembatasan request

- Enam request identik bersamaan menyimpan satu transaksi dan satu dampak saldo.
- Dua edit dengan versi sama menghasilkan satu sukses dan satu HTTP 409; hasil sebelumnya tidak ditimpa penulis yang terlambat.
- Dua transfer yang bersama-sama akan melampaui saldo menghasilkan satu sukses dan satu konflik; total dana tidak berubah dan rekening tidak negatif.
- Kegagalan validasi/saldo tidak cukup membatalkan jurnal dan ringkasan dalam transaksi yang sama.
- Hook workspace diuji terhadap rerender, navigasi, unmount, focus/visibility bersamaan dan response lama. Rerender query yang sama tidak memanggil ulang API; refresh background terjadwal 60 detik hanya pada tab terlihat.
- Hook ekspor diuji terhadap antrean kosong/selesai/dijeda, 20 pekerjaan pending, fairness, offline, pembatalan, retry 5–60 detik, HTTP 429 dan kegagalan autentikasi. Tidak ada retry mutation otomatis.

Refresh saat pengguna kembali ke tab dan polling pekerjaan ekspor aktif adalah request yang disengaja. Tidak ada klaim bahwa aplikasi sama sekali tidak melakukan refresh berkala.

## Performa deployment

Dataset dummy: **100.033 entri jurnal**, **5.000 catatan pemasukan**, **32 panen**, dan **5.065 baris audit**. Sebagian jurnal besar dimasukkan sebagai fixture SQL melalui constraint/trigger, bukan simulasi 100 ribu klik browser.

| Pengukuran akhir             | Hasil                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| Request HTTP dalam run akhir | 73                                                                       |
| Error dalam run akhir        | 0                                                                        |
| Tingkat paralel              | 1, 5, 10, 20                                                             |
| p50 seluruh run              | 652 ms                                                                   |
| p95 seluruh run              | 1.954 ms                                                                 |
| Respons terlama              | 2.235 ms                                                                 |
| Payload JSON terbesar        | 56.757 byte                                                              |
| Soak terkendali              | 60 detik, lima pembacaan paralel setiap 10 detik                         |
| Saldo fixture                | Rp8.284.900; seluruh respons sesuai                                      |
| Pagination                   | 20 baris/halaman; dua halaman menghasilkan 40 ID unik dari 5.000 catatan |

Sebelum perbaikan, ramp menemukan 503. Satu burst awal setelah optimasi juga sempat gagal; pemeriksaan terpisah dan run akhir dengan pembatasan laju lulus. Hasil ini tidak membuktikan bahwa burst tanpa jeda, cold start, kehabisan pool, atau pemakaian berjam-jam bebas kegagalan. Naiknya paralelisme meningkatkan latency; 20 request paralel bukan berarti 20 pengguna terus-menerus menghasilkan beban maksimum.

Resource awal tetap 1 CPU/512 MiB, concurrency 20, maksimal tiga instance. Rate limiter masih per instance. Sebelum penggunaan berat berkelanjutan, ukur CPU/memori/pool PostgreSQL pada staging dengan durasi lebih panjang dan aktifkan alert kegagalan/latency. Jangan menyimpulkan kapasitas hanya dari max instances.

## Responsivitas dan kualitas build

- Seluruh 15 menu diperiksa setelah loading selesai pada lebar **320, 390, 768, 1.440 px**: 60 pemeriksaan, tanpa luapan horizontal atau alert error yang terlihat.
- Screenshot halaman keamanan mobile dan laporan desktop diperiksa secara visual. Konsol browser tidak merekam error pada sesi pemeriksaan terakhir.
- **121 pengujian otomatis lulus**, termasuk perhitungan, tujuh hari, otorisasi, CAS/idempotensi, polling, bulk data, dan kesetaraan snapshot cache/jurnal.
- Build frontend/backend berhasil; audit dependency melaporkan **0 kerentanan** pada waktu pemeriksaan.
- Bundel JavaScript sekitar 613,5 kB (gzip 176,9 kB) masih menghasilkan peringatan ukuran Vite. Ini bukan kegagalan build; pemisahan chunk dapat dievaluasi untuk koneksi lambat. Pengujian ini bukan pengukuran perangkat fisik atau seluruh browser.

## Akses pribadi dan operasional

Pemilik mengonfirmasi aplikasi hanya untuk akun pribadi/undangan. Pada audit, `disable_signup` Supabase masih `false`. Nonaktifkan **Authentication → Sign In / Providers → Allow new users to sign up**, simpan, lalu verifikasi pengaturan. Menyembunyikan tombol daftar saja tidak menutup endpoint signup. Admin tetap dapat mengundang pengguna melalui jalur administratif.

Pengiriman email recovery ke inbox nyata, backup/restore remote yang terjadwal, alert operasional saat ini, uji restart, dan soak berjam-jam belum diverifikasi dalam audit ini. Health job harian yang pernah berhasil tidak menggantikan backup dan alert tersebut.

Ringkasan harian adalah data turunan, bukan tabel yang boleh diedit client atau dihitung ulang sembarang di tengah traffic. Backup dump schema public mencakup tabel/fungsinya. Untuk perbaikan drift oleh operator: gunakan maintenance window, transaksi dan penguncian write, hitung ulang dari jurnal/pergerakan, lalu bandingkan hasil sebelum membuka traffic. Jangan menonaktifkan trigger pada traffic aktif.

## Ekspor besar, verifikasi akhir dan pembersihan

- Ekspor besar selesai dengan **100.033 entri, 501 bagian, 14.092.520 byte**. Unduhan lengkap memuat 5.000 deskripsi pemasukan volume dan 95.000 deskripsi jurnal tambahan; akses akun lain ditolak HTTP 404 setelah autentikasinya diperbarui. Status dan arsip mempertahankan snapshot walaupun transaksi baru dibuat sesudah ekspor.
- Sesudah trigger ringkasan terpasang, enam retry live kembali menghasilkan satu catatan; dua edit menghasilkan HTTP 200/409. Permintaan `publish:false` pada catatan yang sudah dipublikasikan mempertahankan publikasi sesuai aturan lama. Empat snapshot lengkap dari dua akun/periode dibandingkan dengan query jurnal tanpa cache dan identik; pemeriksaan integritas saldo lulus.
- Dry run pembersihan lulus. Penghapusan ledger dummy membutuhkan indeks FK sementara untuk menghindari scan berulang; indeks tersebut dibuat dan dihapus di dalam transaksi pembersihan. Penghapusan ledger tidak tersedia sebagai operasi pengguna biasa.
- Pembersihan sebenarnya lulus: dua akun Auth dummy dihapus, seluruh baris miliknya dihapus, satu bukti dan 502 file ekspor dihapus. Seluruh 23 hasil fingerprint tabel/view yang diperiksa cocok dengan baseline, termasuk dua baris ringkasan baru milik data asli. Tidak ada objek Storage dummy tersisa; daftar akun asli dan status trigger kembali seperti semula. Sebanyak 28 baris data asli dipertahankan; audit tidak mengosongkan data pemilik yang sudah ada.

Rilis mengikuti feature → development → main. Cloud Build menjalankan ulang pemeriksaan sebelum deployment; status build serta aset HTTPS yang benar-benar tersaji diverifikasi terpisah setelah push.

Bukti rinci lokal berada pada `artifacts/system-audit-2026-10-23/` yang diabaikan Git; token, password dan file fixture privat tidak masuk repository.
