# Audit seluruh fitur sebelum integrasi — 8 Oktober 2026

Audit lanjutan pada `feature/finance-production-foundation`, setelah MFA, pengingat, template rutin dan keuntungan panen ditambahkan. Database dan server produksi belum dihubungkan. Hasil lokal mendukung integrasi staging, belum merupakan persetujuan penggunaan uang nyata.

## Hasil akhir

| Pemeriksaan         | Bukti                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Pengujian aplikasi  | `npm test`: 94 lulus, 0 gagal, 0 dilewati                                                                                |
| Build               | Sintaks backend JavaScript, TypeScript dan Vite lulus                                                                    |
| Dependency          | `npm audit --audit-level=high --json`: 0 kerentanan terdeteksi                                                           |
| UI seluruh 15 menu  | 60 pemeriksaan pada 320/390/768/1440 px; tidak ada overflow halaman atau alert error                                     |
| Formulir/modal      | 17 jenis modal pada 320/1440 px: 34 pemeriksaan; dialog tetap di dalam viewport                                          |
| Login/lupa password | 8 pemeriksaan pada empat ukuran layar; tombol dinonaktifkan dengan jelas sebelum Supabase tersedia                       |
| Navigasi mobile     | Buka/tutup kelompok via keyboard, penutupan setelah navigasi, Escape dan pengembalian fokus berhasil                     |
| Perhitungan UI      | 10.000 − 4.000 kg, upah Rp250/kg + supir Rp450.000 → Rp1.950.000; publikasi tanggal besok ditolak melalui input keyboard |
| Console browser     | Tidak ada error/warning pada navigasi dan interaksi yang diamati                                                         |
| Bundle produksi     | JavaScript 488,78 KB / 142,24 KB gzip; CSS 39,91 KB / 9,12 KB gzip                                                       |

Fixture SQL memakai PGlite. API diuji dengan autentikasi/database tiruan melalui HTTP lokal. Browser menggunakan data pratinjau; tidak ada transaksi keuangan nyata, OTP, password atau file pribadi yang dikirim. Pengujian API pertama terbatas oleh sandbox loopback; setelah dijalankan dengan izin koneksi lokal, seluruh suite lulus. Node 24 lokal digunakan; CI/proyek menetapkan Node 22 yang didukung.

## Pemeriksaan per fitur

| Fitur                            | Hal yang diperiksa                                               | Hasil lokal / batas                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login, lupa/reset password       | State sesi, submit ganda, unmount, kesalahan koneksi, layout     | Sesi baru mengalahkan hasil awal yang terlambat. Pengiriman email/reset nyata memerlukan Supabase + SMTP; reset hanya dianalisis dari kode                     |
| MFA / keamanan                   | API, RPC, RLS, AAL1/AAL2, fungsi privat, refresh sesi            | AAL1 ditolak setelah faktor verified. Hasil pemeriksaan lama tidak membuka halaman. Form pemilik yang sama bertahan saat refresh; enrollment nyata belum diuji |
| Dashboard                        | Cash kumulatif, filter periode, draft, perubahan data            | Nilai cash tidak berubah hanya karena memilih bulan. Snapshot database yang sama mengisi saldo dan laporan                                                     |
| Rekening / saldo awal / transfer | Aktivasi, revisi, kepemilikan, kecukupan dana, retry             | Transfer mempertahankan total dana. Revisi stale ditolak. Saldo awal harus mewakili uang sebelum catatan pertama                                               |
| Pendapatan panen / SPK           | Berat, potongan persen, pendapatan, multi-SPK, edit/date         | Nilai dihitung ulang SQL NUMERIC; draft tidak masuk saldo; batas 7 × 24 jam memakai waktu server                                                               |
| Pemasukan lainnya                | Rincian, nominal, publication, edit dan tanggal                  | Menambah cash; versi/key/lock dan perubahan antarperiode diuji                                                                                                 |
| Pengeluaran panen                | Overall Weight, upah/kg, supir, perubahan nilai                  | Mengurangi pendapatan sesuai hasil hitung; ekspor memakai pengeluaran halaman yang dipilih                                                                     |
| Pengeluaran kebun                | Dua rincian awal, penambahan item, edit, biaya teralokasi        | Pengurangan cash tepat sekali. Edit biaya tidak boleh lebih kecil daripada alokasi yang masih digunakan                                                        |
| Pengeluaran lainnya              | Rincian dinamis, saldo, publication, edit                        | Penjumlahan, kepemilikan, retry dan lock diuji bersama seluruh kategori                                                                                        |
| Tabungan                         | Alokasi, saldo reserve, target, belanja                          | Alokasi transfer ke rekening dana. Belanja mengurangi dana tersebut tanpa memotong cash utama dua kali; dana tidak cukup membatalkan transaksi                 |
| Target Investasi                 | Alokasi, target/tenggat, sisa dana, belanja                      | Aturan reserve sama dengan Tabungan; nilai target dan progress mengikuti saldo terkini                                                                         |
| Anggaran / pengingat             | Biaya semua rekening, kategori, 80%/100%, tenggat                | Transfer/saldo awal bukan biaya. Pengingat anggaran selalu bulan berjalan; tenggat target mengikuti WITA                                                       |
| Template transaksi rutin         | Jadwal akhir bulan, draft default, pagination, konflik, rollback | 12 pengiriman bertumpuk menghasilkan satu transaksi. Jadwal dan transaksi atomik; tidak ada publikasi otomatis                                                 |
| Analisis cash flow               | Bulan/tahun kosong, nol/negatif, tahun berganti, edit nilai/date | Saldo akhir dan analisis cocok; persentase tanpa pembagi ditampilkan dengan aman                                                                               |
| Keuntungan panen                 | Seluruh SPK, biaya panen, pembagian biaya kebun, biaya/kg        | Alokasi biaya tidak memotong cash lagi. Biaya yang belum dialokasikan, transfer/koreksi dan biaya lain tidak termasuk keuntungan per panen                     |
| Riwayat / koreksi                | Nilai sebelum/sesudah, append-only, cursor dan periode           | Edit membuat reversal + jurnal baru. Catatan terkunci dikoreksi melalui jurnal terpisah beralasan; riwayat tidak ditimpa                                       |
| Laporan / bukti transaksi        | Batas arsip, lease, upload replay/hash, ownership, batch         | 5.000 entri diekspor lengkap dalam 25 bagian. Storage/unduhan/file nyata masih perlu diuji di staging                                                          |
| Health, backup dan monitor       | Pergantian hari WITA, retry, shutdown, overlap, enkripsi         | Scheduler dan enkripsi/restore fixture lulus. Belum ada backup `pg_dump`, restore atau alert delivery terhadap layanan nyata                                   |

## Temuan yang diperbaiki

1. **Ringkasan jurnal menghitung agregat berulang.** CTE yang membaca snapshot kini materialized, sehingga satu request menghitungnya sekali. Agregasi seluruh riwayat hanya membawa kolom yang dibutuhkan; rincian jurnal diambil langsung dengan cursor dan limit 21/20. Fungsi privat tetap tanpa hak execute pengguna dan wrapper MFA tetap berlaku.
2. **Filter jurnal dan riwayat tidak lengkap.** Query jurnal kini menyaring tanggal sesuai bulan, termasuk halaman berikutnya. Key frontend menyertakan bulan; cursor direset ketika periode berubah atau setelah menyimpan. Respons lama tidak tampil di bawah bulan baru; pembatalan pembacaan tidak meninggalkan paginator dalam keadaan busy. Data pratinjau mengikuti aturan filter yang sama.
3. **Refresh token menutup formulir.** Ruang kerja pemilik yang sama tetap mounted tetapi tersembunyi selama pemeriksaan ulang MFA. Sesi berbeda membuang ruang kerja lama. Pemeriksaan tetap menutup akses sampai token terbaru disetujui.
4. **Semua rincian template dikirim saat refresh dashboard.** Rincian sekarang dibaca ketika halaman Template dibuka, 20 per halaman, dengan pencarian literal dan index cursor. Snapshot hanya mengirim jumlah template dan pengingat jadwal singkat. Maksimal 100 template / 50 item masing-masing tetap berlaku.
5. **Banyak ekspor bisa berebut memori proses.** Maksimal dua giliran ekspor aktif per proses API, tanpa duplikasi job lokal; lease SQL tetap mengatur beberapa proses. Job lain tetap queued dan dilanjutkan lewat polling.
6. **Publikasi tanggal mendatang belum konsisten sebelum aktivasi rekening.** Trigger baru menolak publikasi SPK, biaya panen dan rincian cash di masa depan, termasuk model legacy. Draft tetap diizinkan. Form menampilkan penjelasan sebelum request dikirim. Data lama tidak dihapus oleh migrasi.
7. **Request SDK browser belum memiliki deadline aplikasi.** HTTP Supabase Auth/Storage dibatasi 60 detik per panggilan, mempertahankan cancellation pemanggil, dengan deadline baru untuk setiap panggilan. Retry internal SDK dapat membuat durasi operasi keseluruhan lebih lama; tidak ada retry mutation aplikasi dengan key baru.
8. **Keterangan draft belanja reserve menyebut cash utama.** Keterangan sekarang menjelaskan bahwa draft belum mengubah saldo rekening, sesuai model transfer/alokasi yang digunakan.

Perubahan SQL berada di migrasi tambahan `202610080008_audit_reliability.sql`; migrasi yang sudah ada tidak ditulis ulang. Terapkan seluruh migrasi berurutan sebelum menjalankan kode baru.

## Race condition dan ketepatan uang

Penulisan pemilik yang sama mengunci `finance_controls` sebelum membaca saldo/versi. UUID idempotency key mencegah replay menjadi transaksi baru; versi stale mengembalikan konflik. Sumber, audit, jadwal template, jurnal, movement dan saldo cache berada dalam satu transaksi. Pembacaan frontend memakai latest-only/cancellation, sedangkan snapshot SQL memakai satu pandangan database konsisten.

Tambahan uji memastikan kegagalan belanja reserve karena saldo kurang tidak memajukan jadwal, tidak mengubah saldo, dan tidak mengonsumsi key. Setelah dana tersedia, key tersebut dapat dicoba lagi dan replay berikutnya mengembalikan transaksi yang sama. Uji juga memastikan RPC baru serta fungsi privat tidak melewati MFA.

Overlap request pada PGlite diproses melalui antrean runtime; ini menguji hasil retry/versi/rollback, **bukan bukti isolasi antar beberapa koneksi PostgreSQL**. Urutan lock telah ditinjau, tetapi deadlock/timeout, banyak pemilik, dan persaingan beberapa proses harus diuji pada server staging nyata.

## Data besar dan beban

| Fixture                                   | Snapshot hasil suite akhir | Pemeriksaan                                                                                                 |
| ----------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 50.000 catatan source                     | 390 ms / 32.423 byte       | Saldo/analisis tepat dan cursor tetap stabil setelah edit                                                   |
| 100.000 jurnal aktif + metadata per entri | 885 ms / 22.016 byte       | Cash/total dana Rp123.000 tepat; metadata tidak dikirim; 20 baris dan cursor bulan berikutnya benar         |
| 5.000 publikasi diimpor ke jurnal         | 77 ms / 35.416 byte        | Agregat besar tepat; ekspor 25 × 200 entri lengkap                                                          |
| 100 template × 50 item panjang            | 94 ms / 220.709 byte       | Dashboard tidak membawa rincian template; lima halaman mencakup 100 ID unik, owner lain tidak dapat membaca |

Perbandingan terisolasi 100.000 jurnal sebelum/sesudah perbaikan: sekitar 4.195 ms → 691 ms. Suite akhir berjalan bersama build dan fixture lain; angka ini bukan benchmark produksi atau SLA. Fixture 100.000 jurnal diinsert sebagai arsip sintetis oleh test administrator, bukan 100.000 request aplikasi atau simulasi jumlah pengguna.

Respons UI dibatasi pagination; total dan chart tetap dihitung dari seluruh riwayat, bukan dari halaman saat ini. Aggregate/chart masih bertumbuh dengan jumlah entri (**O(N)**), walaupun rincian tidak dibawa semuanya ke Node/React. Pada jutaan entri atau banyak pengguna aktif perlu ukur query plan PostgreSQL, memori, I/O dan p95; ringkasan incremental hanya ditambahkan bila terukur perlu, dengan validasi reversal/rollback.

220 KB fixture template terutama berasal dari 20 baris audit sebelum/sesudah berisi rincian panjang, yang sengaja dipertahankan untuk pemeriksaan. Ukuran 22–35 KB pada fixture lain bukan batas maksimum semua snapshot. Audit, jurnal, evidence, ekspor dan backup bertambah sepanjang waktu; monitoring disk dan kebijakan retensi arsip/backup diperlukan tanpa menghapus riwayat keuangan sembarangan.

Node melayani JSON kecil/berpaginasi; pekerjaan ekspor dibagi 200 entri dan dibatasi concurrency. Upload langsung ke Storage, konfirmasi bukti maksimal 5 MB. Polling workspace 60 detik hanya saat tab terlihat dan tidak menumpuk dengan read aktif. Backup/monitor berjalan terpisah dari API. Tidak ada pengukuran RSS atau throughput server produksi; rate limit multi-instance saat ini masih memerlukan keputusan deployment. Unduhan CSV maksimal 100 MB menggunakan Blob pada browser dan dapat berat untuk ponsel dengan RAM kecil; pilih rentang laporan lebih pendek. Unduhan sebesar itu belum diuji pada perangkat nyata.

## Pengujian yang masih diperlukan saat integrasi

1. Pasang migrasi, bucket privat dan kebijakan MFA Storage di staging. Uji dua pengguna, anon, AAL1/AAL2, enrollment/unenrollment, refresh, kehilangan sesi, serta SMTP reset password.
2. Jalankan konflik create/edit/transfer/template dengan beberapa koneksi PostgreSQL dan dua proses API, jaringan terputus setelah commit, restart saat export, dan cancellation. Cocokkan `finance_integrity`, saldo, journal, report dan audit setelah setiap skenario.
3. Impor salinan data representatif, periksa publikasi lama bertanggal mendatang dan saldo awal sebelum aktivasi. Uji query plan/beban memakai target jumlah pengguna dan riwayat sebenarnya. Pantau p95, slow query, error dan RSS; jangan menentukan ukuran server hanya dari hasil PGlite.
4. Jalankan backup manual dan restore `pg_dump` ke database kosong terisolasi. Verifikasi Auth, privilege, fingerprint, saldo dan bukti. Atur backup offsite, disk alert, retensi, secret/CA, HTTPS dan log rotation.
5. Aktifkan worker operasi setelah restore nyata berhasil. Health harian 00.00 WITA, backup 01.00 WITA, monitor 60 detik; sambungkan alert dan buktikan notifikasi kegagalan benar-benar diterima.
6. Uji CSV/SPK/pengeluaran dan bukti pada browser/perangkat yang digunakan, termasuk koneksi lambat, input keyboard tanggal, landscape, nilai nominal panjang dan ukuran arsip besar.

Bukti UI lokal: `artifacts/audit-ui-2026-10-08.json` dan screenshot `artifacts/screenshots/audit-accounts-desktop.png`, `audit-template-mobile.png`, `audit-navigation-mobile.png`. Artefak screenshot bersifat lokal dan diabaikan Git. Konfigurasi operasional dijelaskan di [finance-operations.md](finance-operations.md) dan [security-and-productivity.md](security-and-productivity.md).
