# Validasi koneksi Supabase — 8 Oktober 2026

Proyek uji `Financial-Management` (`vvhnlnebudpztjkuxgpb`) sudah menerima skema aplikasi. Pemeriksaan awal menemukan nol tabel public, nol pengguna Auth dan belum ada histori migrasi. Data pratinjau tidak dimasukkan ke database.

## Pemeriksaan yang selesai

- Koneksi Session pooler Singapore dengan `sslmode=verify-full` dan CA dari Dashboard Supabase. Koneksi Node PostgreSQL menunjukkan `encrypted=true` dan `authorized=true`. Password hanya digunakan dalam proses migrasi, tidak disimpan dalam source atau `.env` aplikasi.
- Supabase CLI **2.120.0** melakukan dry run, kemudian menerapkan **16 migrasi** sesuai urutan. Histori resmi `supabase_migrations.schema_migrations` berisi 16 versi. Jangan menjalankan ulang isi file migrasi melalui SQL Editor. Deployment berikutnya menggunakan histori yang sama.
- `supabase db lint --schema public --level error --fail-on error`: tidak menemukan error fungsi SQL.
- **21 tabel aplikasi**: RLS aktif; role `anon` tidak dapat membaca tabel; role `authenticated` tidak memiliki izin insert/update/delete langsung. Perubahan dilakukan melalui RPC tervalidasi.
- Katalog privilege fungsi pada Supabase nyata diperiksa: hanya `database_healthcheck` dapat dieksekusi oleh role `anon`; helper internal dan varian tanpa pemeriksaan MFA tidak dapat dieksekusi oleh `anon` maupun `authenticated`.
- Dua bucket `cash-flow-receipts` dan `cash-flow-exports` dibuat **private**, dengan batas ukuran 5 MiB dan 2 MiB. Empat kebijakan objek membatasi pemilik/pekerjaan ekspor; kebijakan MFA bersifat restrictive. Dua script `supabase/storage/` sudah diterapkan sekali.
- RPC `database_healthcheck` dan endpoint Node `/api/health/database` bertoken merespons **HTTP 200**, `ok=true`, memakai publishable key aplikasi.
- Tanpa login, RPC workspace/finance dan pembacaan tabel rekening ditolak **HTTP 401 / 42501**. Daftar objek Storage tanpa login kosong; tidak ada bukti transaksi untuk diuji unduh pada tahap ini.
- Uji langsung dalam satu transaksi PostgreSQL memverifikasi pemasukan, transfer tabungan, belanja tabungan, biaya kebun, aktivasi saldo awal, retry idempotent, koreksi cash, penolakan versi edit lama, serta snapshot workspace/productivity. Transaksi di-rollback; pengguna, journal events dan transaksi uji tidak tertinggal.
- **100 pengujian lokal lulus**, build backend/React/TypeScript berhasil. Build gabungan React/API menampilkan login dengan konfigurasi Supabase aktif dan tanpa error console. Peringatan ukuran bundle Vite tetap ada (sekitar 611 kB minified / 176 kB gzip); ini bukan error build.

## Yang belum selesai

Pengaturan Auth publik yang diperiksa menunjukkan provider email aktif, email confirmation aktif dan **signup publik belum dinonaktifkan**. Untuk aplikasi pribadi, nonaktifkan signup publik melalui Dashboard. Masukkan password akun uji langsung di Dashboard; jangan kirim password akun ke chat.

1. Rotate secret API key dan password database yang sebelumnya dibagikan. Key admin tidak dipakai aplikasi; perubahan password database tidak memengaruhi koneksi aplikasi yang memakai JWT pengguna/public key. Simpan penggantinya pada secret storage yang sesuai.
2. Atur Site URL `http://127.0.0.1:5173`, redirect `/reset-password` untuk origin tersebut (dan `localhost:5173` bila digunakan). Tambahkan domain Cloud Run setelah deployment tersedia.
3. Buat akun pengguna uji dengan email terkonfirmasi, nonaktifkan signup publik, periksa TOTP dan SMTP.
4. Restart proses development setelah `.env` berubah. Kedua `.env` lokal sudah berisi Project URL dan publishable key, diabaikan Git dan Docker.
5. Uji login nyata, MFA, lupa password via email, bukti transaksi/ekspor Storage dan pemisahan dua pengguna. Uji race lintas koneksi serta load test staging masih diperlukan; uji transaksi yang di-rollback di atas tidak membuktikan perilaku konkurensi produksi.
6. GCP belum dibuat/deploy: IAM, Secret Manager, Cloud Run, trigger GitHub, Scheduler/Jobs, monitoring alert, backup dan restore masih perlu dikonfigurasi. Ikuti [panduan Cloud Run](cloud-run-deployment.md).

Database berhasil dihubungkan dan skema siap untuk pengujian melalui akun nyata. Hasil ini belum menyatakan aplikasi siap digunakan untuk data keuangan produksi.

Referensi: [CLI migration history](https://supabase.com/docs/reference/cli/supabase-db-push), [PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS verification](https://supabase.com/docs/guides/platform/ssl-enforcement).
