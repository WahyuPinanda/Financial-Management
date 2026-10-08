# Rekening dan kesiapan operasional

Implementasi pada branch `feature/finance-production-foundation`. Database dan server produksi belum dihubungkan. Backup, Storage, dan monitor belum berjalan terhadap data nyata.

## Aturan saldo dan aktivasi

- **Cash tersedia** = rekening Cash + Bank. **Total dana** juga mencakup Tabungan dan Investasi.
- Pendapatan masuk Cash/Bank pilihan. Biaya harian keluar dari rekening pembayaran pilihan.
- Alokasi Tabungan/Investasi menjadi transfer ke rekening dana. Belanja mengurangi rekening dana tersebut; cash tersedia tidak dikurangi lagi.
- Transfer Cash → Bank tidak mengubah cash tersedia. Transfer keluar/masuk rekening dana mengubah cash tersedia tanpa mengubah total dana.
- Saldo awal merupakan uang **sebelum catatan pertama**, bukan pendapatan. Jangan memasukkan saldo sekarang lalu mengimpor pendapatan lama.
- Transfer keluar dan dana reserve memerlukan saldo cukup. Cash/Bank dapat menunjukkan saldo negatif bila biaya yang dicatat melampaui pemasukan; periksa saldo awal dan transaksi yang belum dicatat.

Aktivasi menampilkan proyeksi catatan lama dan meminta pemeriksaan tanggal/empat saldo awal. Aktivasi membutuhkan revisi terbaru, berjalan atomik, dan dapat diulang memakai kunci permintaan yang sama. Publikasi lama diimpor tanpa mengubah nominal, versi, atau waktu publikasi. Saldo reserve negatif hasil impor menolak aktivasi. Model lama berlaku sampai aktivasi selesai.

Semua penulisan melewati RPC dengan UUID untuk mencegah transaksi ganda; edit memerlukan versi sebelumnya. Penulisan pemilik yang sama mengunci baris kontrol sebelum membaca saldo atau mengubah catatan. Perubahan sumber, jurnal, saldo dan audit berada dalam satu transaksi. Uang dihitung dengan `NUMERIC`; agregat dikirim sebagai string desimal.

Edit publikasi membuat pembalikan nilai lama dan jurnal nilai baru. Jurnal/audit menolak perubahan dan penghapusan. Audit massal memakai transition tables untuk memperbarui revisi sekali per perintah SQL. Batas edit tetap 7 × 24 jam sejak publikasi pertama. **Catatan koreksi** memerlukan alasan, membuat jurnal baru, dan mempertahankan data asli yang terkunci. Koreksi tidak dikategorikan sebagai pendapatan/biaya biasa.

Menu, halaman, formulir dan perintah API Rekonsiliasi saldo telah dihapus. Data pemeriksaan lama dan audit tetap disimpan untuk menjaga riwayat. `/api/finance/integrity` tetap memeriksa saldo tersimpan terhadap pergerakan jurnal pengguna.

## Target dan anggaran

Tambahan MFA, pengingat, template rutin dan analisis keuntungan panen dijelaskan di [Keamanan dan produktivitas](security-and-productivity.md).

Satu target nilai/tanggal per rekening dana; tambahkan rekening terpisah untuk tujuan berbeda. Progress memakai saldo terkini dan dana dibelanjakan memakai biaya rekening tersebut. Saldo target berlaku seluruh periode.

Tabel analisis memisahkan transfer manual dari biaya/alokasi catatan: cash flow = pendapatan - biaya/alokasi catatan + transfer manual bersih + koreksi. Saldo awal hanya memengaruhi saldo rekening.

Anggaran per bulan/kategori memakai biaya dari semua rekening, termasuk belanja dana. Transfer dan saldo awal tidak menjadi biaya. `Semua periode` menampilkan komposisi seluruh riwayat; anggaran tetap bulan berjalan. Pilihan bulan pada menu Anggaran memperbarui filter.

## Migrasi, bukti dan ekspor

1. Terapkan semua `supabase/migrations/*.sql` sesuai urutan di staging dahulu. Migrasi 8 Oktober menutup penulisan tabel langsung.
2. Terapkan `supabase/storage/private_finance_files.sql` di Supabase. Bucket `cash-flow-receipts` dan `cash-flow-exports` wajib privat.
3. API/web memakai URL + anon/public key. **Storage admin key hanya di lingkungan operasi**, tidak di API/web.
4. Uji login/reset password, aktivasi data salinan, edit bersamaan, file Storage, ekspor, dan pemisahan dua pengguna di staging.

Bukti dilampirkan dari jurnal rekening: PDF/JPG/PNG, maksimal 5 MB dan 20 file per catatan. Upload langsung ke Storage; server mengonfirmasi checksum, signature format, dan ukuran. Metadata menyimpan versi sumber saat dilampirkan. URL unduh berlaku lima menit. File asli tidak ditimpa/dihapus melalui aplikasi. Signature format bukan pemeriksaan malware; pemindai tambahan dapat dipasang di infrastruktur.

Ekspor membekukan batas urutan jurnal dan tanggal snapshot. Maksimal dua giliran ekspor aktif per proses API; job lain tetap queued dan dilanjutkan lewat polling. Pekerja memproses 200 entri per bagian, maksimal 2.000 per giliran. Polling melanjutkan proses; lease database memisahkan pekerja yang bersamaan. Checksum memastikan replay upload identik. Bagian disimpan di Storage dan bertahan setelah restart. CSV mencantumkan versi sumber serta ID bukti yang sudah terlampir pada waktu snapshot.

Maksimal tiga pekerjaan aktif, 500.000 entri / 100 MB, tersedia tujuh hari. Download server memakai backpressure/checksum; browser memeriksa ukuran akhir. Rentang lebih pendek mengurangi ukuran unduhan. Edit/koreksi berikutnya memerlukan ekspor baru. Ekspor arsip membutuhkan model rekening aktif; draft tidak menjadi jurnal uang.

## Backup harian dan restore

Pekerja operasi terpisah dari API. Salin `ops/.env.example` menjadi `ops/.env`; batasi akses OS. `BACKUP_KEY_HEX` adalah 32 byte acak, disimpan di secret manager terpisah dari backup. Kehilangan kunci membuat backup tidak dapat dibuka.

```sh
npm run ops:backup
npm run ops:scheduler
npm run ops:restore-test -- /absolute/private-backup-root/backup-folder
npm run ops:monitor
```

Aktifkan `OPS_ENABLED=true` sesudah backup manual dan restore berhasil. Scheduler berjalan **01.00 WITA setiap hari** tanpa overlap; direktori lock bersama mencegah instance ganda. Setelah crash, periksa pekerja sebelumnya sebelum menghapus lock secara manual. Folder tanpa `complete.json` tidak dianggap backup berhasil.

Backup memakai snapshot baca `REPEATABLE READ` yang sama untuk `pg_dump`, fingerprint tabel, pemeriksaan saldo, dan metadata bukti. Skema `public` + `auth` disalin; file bukti diambil bertahap, checksum diperiksa, lalu dienkripsi. AES-256-GCM melindungi setiap komponen, tanpa dump plaintext. Privilege aplikasi ikut disimpan/diperiksa; role dan extension harus tersedia pada target.

Restore test hanya menerima database terpisah berakhiran `_restore_test`, versi mayor PostgreSQL sama, dan **tanpa tabel public/auth**. Tidak ada `DROP`, `--clean`, atau restore ke database sumber. Seluruh arsip diautentikasi sebelum SQL dijalankan. Jumlah/fingerprint tabel, privilege PUBLIC/anon/authenticated, saldo, dan file bukti dibandingkan setelah restore. File bukti diverifikasi lokal; tidak diunggah ke bucket hidup. Siapkan target kosong baru untuk uji berikutnya. Uji minimal bulanan dan sesudah perubahan skema. Monitor memeriksa usia hasil restore maksimal 30 hari jika target restore dikonfigurasi.

Gunakan client PostgreSQL sesuai server, direct/session connection, serta TLS `verify-full` dengan CA untuk koneksi remote. Contoh image memakai client 17; sesuaikan dengan database. Backup role membutuhkan baca seluruh tabel public/auth dan metadata. Restore role hanya untuk test, dengan kemampuan membuat objek dan memberikan privilege ke role yang sudah tersedia. Template target harus kompatibel dengan skema, fungsi Auth, role dan extension sumber; kegagalan restore harus diperbaiki di target terisolasi sebelum server produksi dipakai.

Backup ini bukan salinan penuh konfigurasi layanan Supabase. Role cluster, extension, Storage bucket/policy, SMTP, pengaturan Auth dan provider harus dipasang melalui konfigurasi terpisah. Gunakan backup/PITR provider sebagai pelengkap dan salinan terenkripsi offsite. Tetapkan retensi yang mempertahankan salinan teruji; script tidak menghapus backup otomatis. Backup database Supabase tidak memasukkan isi file Storage. [Supabase](https://supabase.com/docs/guides/platform/backups), [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

## Monitoring dan server

- `/api/health`: proses hidup. `/api/health/database`: kesiapan database dengan `X-Healthcheck-Token`.
- `/api/health/metrics`: token sama, uptime, error 5xx, jumlah request lambat, RSS memori dan maksimal 20 sampel error. Body/token/nominal tidak dicatat.
- Monitor operasi memeriksa API/database setiap 60 detik, backup terakhir ≤36 jam, dan uji restore ≤30 hari bila dikonfigurasi. Status berubah dicatat sebagai JSON. Hubungkan `request_failed`, `scheduled_backup_failed`, `operations_locked`, dan `uptime_state_changed` ke alert server. Pengiriman notifikasi eksternal belum diaktifkan.
- Health check database **00.00 WITA** tetap berlaku. Backup pukul 01.00 memeriksa integritas semua saldo.

`ops/compose.example.yml` menyediakan API/backup/monitor terpisah, restart policy, batas memori, dan API hanya di loopback. Atur reverse proxy HTTPS, permission volume, CA, log rotation, alert routing, disk monitoring dan backup offsite saat setup server. Docker engine tidak aktif di lingkungan ini; contoh container belum dijalankan.

## Verifikasi dan gate produksi

Pengujian SQL lokal mencakup aktivasi/import, revisi stale, transfer/idempotensi, edit/reversal, reserve tanpa potongan ganda, target/anggaran, rekonsiliasi, kepemilikan dan lock tujuh hari. Ekspor diuji untuk cutoff, lease, kelengkapan batch, hash/replay dan penolakan skip. Arsip PGlite dibuka kembali dan saldonya dibandingkan. Enkripsi diuji terhadap perubahan isi/kunci salah.

Audit terakhir: seluruh 94 pengujian otomatis lulus, build/typecheck lulus dan dependency melaporkan 0 kerentanan. Snapshot 100.000 jurnal aktif sekitar 885 ms / 22 KB di suite lokal; agregasi masih bergantung pada jumlah riwayat. Hasil per fitur, perbaikan race/UI, ukuran fixture lain, dan gate staging tersedia di [Audit seluruh fitur 8 Oktober](full-system-audit-2026-10-08.md).

Masih perlu: restore `pg_dump` nyata, Storage RLS Supabase, alert delivery, backup offsite, login/SMTP dan concurrency/beban PostgreSQL multi-koneksi. Belum ada kredensial produksi yang digunakan.
