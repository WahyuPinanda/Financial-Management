# Koneksi pertama ke Supabase

Target awal: proyek Supabase baru/kosong untuk pengujian. Koneksi GitHub menerapkan migrasi; React/Node memakai Project URL, public API key dan JWT pengguna. Integrasi ini tidak menghosting aplikasi React atau server Express.

## Integrasi GitHub

1. Pada Supabase **Project Settings → Integrations → GitHub**, pilih `WahyuPinanda/Financial-Management`.
2. Repo boleh private selama otorisasi GitHub memberikan akses ke repo tersebut. Periksa akses integrasi setelah perubahan visibility bila repo tidak lagi terbaca. Tidak perlu mempublikasikan repo untuk menghubungkan database.
3. Isi **Working directory** dengan `.` karena folder `supabase/` ada di root repo.
4. Untuk database uji ini, sumber terbaru berada di `feature/finance-production-foundation`. Pilih branch itu sebagai sumber deployment awal ke proyek uji. Jika ingin memakai `development`, gabungkan perubahan terbaru dahulu; jangan memilih branch yang belum memuat migrasi/kode terbaru. Istilah **Deploy to production** pada pengaturan integrasi menunjuk database proyek yang terhubung; pada tahap ini proyek tersebut khusus pengujian.
5. Pilih pengaturan deployment migrasi ke branch yang benar, aktifkan integrasi, lalu periksa log sampai seluruh migrasi berhasil. Automatic branching/preview per PR adalah pilihan terpisah; tidak diperlukan untuk koneksi pertama.

`supabase/config.toml` berisi nama proyek lokal, seed dinonaktifkan, dan dua bucket privat. `project_id = "financial-management"` bukan Project Ref remote. Tidak ada project password, access token, API key atau data pratinjau dalam konfigurasi Git.

GitHub integration menjalankan migrasi yang belum diterapkan dari `supabase/migrations/`. Gunakan satu jalur untuk histori migrasi. Jika integrasi sudah menerapkannya, jangan menyalin dan menjalankan ulang file yang sama lewat SQL Editor. Bila suatu langkah gagal, periksa log dan histori sebelum mengulang.

Referensi: [GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration), [Deployment](https://supabase.com/docs/guides/deployment), [CLI config](https://supabase.com/docs/guides/local-development/cli/config), [GitHub OAuth permissions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

## Kebijakan Storage

Sesudah semua migrasi aplikasi berhasil, jalankan **satu kali**, berurutan, pada SQL Editor proyek uji:

1. `supabase/storage/private_finance_files.sql`
2. `supabase/storage/mfa_storage_access.sql`

File di `supabase/storage/` tidak dijalankan sebagai migrasi otomatis oleh integrasi. Konfigurasi bucket belum mengatur akses objek; kedua script menambahkan pembatasan pemilik, pekerjaan ekspor dan MFA. Konfirmasikan dua bucket tetap **private**. Jangan mengulangi `CREATE POLICY` bila sudah ada; periksa kebijakan yang diterapkan sebelumnya.

## Koneksi React dan Node

Buka **Connect** atau **Settings → API Keys** untuk mendapatkan Project URL dan **Publishable key** (`sb_publishable_...`). Key ini merupakan identitas publik aplikasi; hak akses data tetap ditentukan login, RLS dan pemeriksaan MFA. Backend aplikasi ini juga memakai JWT pengguna dan public key. Key admin tidak diperlukan untuk menjalankan fitur aplikasi.

Salin template jika file `.env` belum ada, kemudian isi sendiri nilai proyek yang sama:

| File            | Variabel                 | Isi                       |
| --------------- | ------------------------ | ------------------------- |
| `apps/api/.env` | `SUPABASE_URL`           | Project URL               |
| `apps/api/.env` | `SUPABASE_ANON_KEY`      | Publishable key           |
| `apps/web/.env` | `VITE_SUPABASE_URL`      | Project URL yang sama     |
| `apps/web/.env` | `VITE_SUPABASE_ANON_KEY` | Publishable key yang sama |

Nama variabel masih memakai `ANON_KEY` untuk kompatibilitas kode yang ada; nilainya dapat berupa publishable key baru. Biarkan `VITE_API_URL` kosong saat development agar `/api` memakai proxy Vite ke port 3001. File `.env` sudah diabaikan Git. Restart proses dev sesudah mengubah variabel.

Secret key (`sb_secret_...`), service-role key, database password dan access token tidak boleh dimasukkan ke frontend atau commit Git, termasuk repo private. Rahasia operasi backup/CLI diatur terpisah di server/local secret storage.

Referensi: [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Migrating API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

## Auth dan uji koneksi

Pengaturan Auth hosted dilakukan di dashboard proyek ini. Root `config.toml` tidak otomatis memperbarui pengaturan Auth persistent project dalam deployment GitHub biasa.

- Site URL awal: `http://127.0.0.1:5173`.
- Redirect URLs untuk development: `http://127.0.0.1:5173/reset-password`, `http://localhost:5173/reset-password` serta root masing-masing origin bila digunakan.
- Buat pengguna uji melalui Supabase Authentication. Masukkan password langsung di dashboard; tidak perlu menyimpannya dalam repo atau chat.
- Untuk aplikasi pribadi ini, nonaktifkan signup publik melalui dashboard. Aktifkan TOTP enrollment/verification dan pasang SMTP untuk uji lupa password.
- Jalankan `npm run dev` dengan versi Node yang didukung. `/api/health` hanya menunjukkan konfigurasi/proses; koneksi database harus dibuktikan melalui RPC `database_healthcheck` atau endpoint database bertoken, kemudian login dan baca workspace.
- Setelah login, uji draft, publication, edit, transfer, template, analisis, bukti/ekspor dan dua pengguna. Aktifkan model rekening dengan saldo awal yang benar; gunakan data uji dahulu.

Supabase belum dianggap terhubung hanya karena repo dipilih atau health `configured` bernilai true. Koneksi awal selesai setelah migrasi + Storage policies berhasil, request database hidup dan login membaca snapshot pengguna. Pemeriksaan staging lanjut tetap mengikuti [audit sistem](full-system-audit-2026-10-08.md).
