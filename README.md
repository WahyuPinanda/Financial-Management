# Cash Flow — Financial Management

Website pengelolaan pendapatan panen sawit. Frontend React, backend Node.js/Express **JavaScript CommonJS** (`require` / `module.exports`), database SQL PostgreSQL melalui Supabase. Frontend menggunakan TypeScript untuk kontrak data; backend dan logika bersama menggunakan JavaScript.

## Fitur awal

- Login email/password, logout, lupa password melalui email, dan halaman password baru memakai Supabase Auth.
- Dashboard yang dilindungi sesi login, ringkasan pendapatan, grafik per panen, filter bulan panen, pencarian, dan ekspor CSV.
- Kelompok panen dengan beberapa SPK: perusahaan, tanggal, janjang, timbangan pertama/kedua, potongan kg, harga Rp/kg, serta hasil otomatis.
- Draft tidak termasuk dalam total pendapatan. Publikasi memulai batas edit **7 × 24 jam**, berdasarkan waktu database, bukan tanggal yang diisi pengguna.
- Semua isian SPK dapat diubah sebelum batas tersebut. Setelahnya, trigger PostgreSQL menolak perubahan, termasuk upaya mengubah waktu publikasi. Penghapusan tidak disediakan.
- RLS memisahkan data antar akun. API menggunakan token pengguna dan anon key, bukan service-role key.

Pengeluaran panen terhubung dengan pendapatan SPK melalui kelompok panen. Setiap SPK dan catatan pengeluaran memiliki batas edit tersendiri sejak publikasi.

## Pengeluaran panen

Pada kelompok panen, pilih **Tambah pengeluaran** dan isi 1st Weight, 2nd Weight, upah panen per kg, serta ongkos supir total. **Total Overall Weight** dihitung otomatis dari 1st Weight − 2nd Weight. Catatan bisa disimpan sebagai draft atau dipublikasikan. Beberapa catatan biaya dapat ditambahkan untuk satu panen.

```text
Total upah (Rp)      = Total Overall Weight × upah panen per kg
Pengeluaran (Rp)     = total upah + ongkos supir
Pendapatan bersih    = total pendapatan SPK publikasi − total pengeluaran publikasi
```

Contoh: 10.000 − 4.000 = 6.000 kg; upah Rp250/kg menghasilkan Rp1.500.000; ongkos supir Rp450.000 → pengeluaran Rp1.950.000. Dari pendapatan Rp17.640.000, pendapatan bersih menjadi Rp15.690.000. Timbangan biaya berdiri sendiri dan tidak dikurangi potongan SPK.

Menu `/pengeluaran` memerlukan login. Draft belum mengurangi pendapatan. Perubahan input setelah publikasi langsung menghitung ulang berat, total biaya, serta pendapatan bersih. Catatan bisa diedit selama 7 × 24 jam sejak publikasi; waktu awal tidak diperpanjang oleh penyuntingan. Database menolak perubahan setelah batas tersebut, pemindahan kelompok, perubahan waktu publikasi, dan penghapusan. Upah dan ongkos supir boleh 0. Nilai negatif tetap ditampilkan jika biaya melebihi pendapatan.

Backend JavaScript menggunakan `expenseController`, `expenseService`, dan `expenseRepository`. Frontend menggunakan fitur `features/expenses`.

## Struktur proyek

```text
apps/
  api/                         # Backend JavaScript
    src/
      config/                  # Environment dan factory Supabase
      controllers/             # Validasi request dan response HTTP
      services/                # Aturan bisnis dan serialisasi
      repositories/            # Query database
      middlewares/             # Verifikasi sesi pengguna
      routes/                  # Endpoint Express
      libs/                    # Error handling
      app.js                   # Express app (dapat diuji tanpa listen)
      server.js                # Entry point server
  web/                         # React + Vite
    src/
      features/auth/           # Login dan pemulihan password
      features/dashboard/      # Ringkasan dan catatan panen
      features/harvests/        # Form kelompok panen dan SPK
      components/              # Komponen UI bersama
      lib/                     # API client, format, Supabase
packages/shared/               # Validasi dan kalkulasi JavaScript + deklarasi tipe frontend
supabase/migrations/           # Skema SQL, indeks, RLS, trigger
tests/                         # Pengujian API, perhitungan, dan PostgreSQL
scripts/                       # Pemeriksaan sintaks dan runner test lintas OS
docs/                          # Arsitektur dan referensi API
```

## Menjalankan lokal

Gunakan **Node.js 22 LTS** dan npm. File `.nvmrc` menetapkan Node 22. Lingkungan dengan Node 20.19+ juga didukung; hindari Node 21 yang sudah tidak didukung oleh Vite.

```powershell
npm install
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Isi kedua `.env` dengan URL dan **anon/public key** proyek Supabase yang sama. Jangan memasukkan `service_role` atau secret key ke frontend. File `.env` diabaikan oleh Git.

```powershell
npm run dev
```

- Website: http://localhost:5173
- API: http://localhost:3001/api/health
- Pratinjau data contoh: http://localhost:5173/preview (hanya development; tidak menyimpan data dan tidak tersedia pada build produksi).

Tanpa konfigurasi Supabase, halaman login dan pratinjau dapat dibuka, tetapi login serta penyimpanan tidak aktif. Tidak ada akun demo/password hardcoded.

## Menyiapkan Supabase

1. Buat proyek Supabase. Ambil Project URL dan legacy anon key/public key yang sesuai dari pengaturan API, lalu isi `.env` backend dan frontend. Implementasi ini memakai anon key JWT.
2. Jalankan migrasi SQL sesuai urutan: `202610050001_initial_harvest.sql`, lalu `202610050002_harvest_expenses.sql`, di SQL Editor Supabase atau melalui workflow migrasi Supabase CLI. Jika migrasi pertama sudah diterapkan, jalankan hanya migrasi kedua. Migrasi belum diterapkan otomatis ke proyek remote mana pun.
3. Di Authentication, aktifkan provider Email. Buat akun pemilik melalui Authentication → Users → Add user, dengan email terkonfirmasi. Pendaftaran publik tidak disediakan di UI; untuk kebun pribadi, nonaktifkan pendaftaran baru di pengaturan Auth.
4. Atur Site URL menjadi `http://localhost:5173`. Tambahkan `http://localhost:5173/reset-password` dan, bila memakai `127.0.0.1`, `http://127.0.0.1:5173/reset-password` ke Redirect URLs. Tambahkan domain produksi ketika deploy.
5. Konfigurasikan SMTP di Supabase untuk pengiriman email lupa password yang sungguh digunakan. Pengiriman SMTP dikelola Supabase, bukan Node API.
6. Restart `npm run dev` setelah mengubah `.env`, lalu uji login, simpan panen/SPK, dan pemulihan password memakai email pemilik.

Alur pemulihan: pengguna meminta tautan → membuka email → halaman `/reset-password` memperoleh sesi pemulihan Supabase → `updateUser` menyimpan password baru → pengguna login kembali. Respons permintaan tidak mengungkap apakah email terdaftar.

## Rumus

```text
Berat muatan (kg)      = 1st Weight − 2nd Weight
Potongan (%)          = potongan kg / berat muatan × 100
Berat bersih (kg)     = berat muatan − potongan kg
Pendapatan (Rp)       = berat bersih × harga per kg
Total satu panen      = jumlah pendapatan SPK yang dipublikasikan
Potongan satu panen % = jumlah potongan kg / jumlah berat muatan × 100
```

Contoh: 10.000 − 4.000 = 6.000 kg muatan; potongan 120 kg = 2%; bersih 5.880 kg; harga Rp3.000/kg → Rp17.640.000.

Persentase gabungan menggunakan perbandingan total berat, bukan rata-rata persentase SPK. PostgreSQL menghitung nilai final dengan `NUMERIC`; UI menampilkan pratinjau. Berat/harga maksimal dua angka desimal; total dibulatkan ke dua angka desimal. Janjang harus bilangan bulat positif. 2nd Weight harus lebih kecil dari 1st Weight dan potongan tidak boleh melebihi muatan. Batas berat/harga per isian 1.000.000 untuk menjaga presisi tampilan.

## Verifikasi

```powershell
npm run build
npm run typecheck
npm test
npm audit
```

Pengujian PostgreSQL memakai PGlite lokal dengan role dan fungsi Auth pengganti: SQL aplikasi, RLS, dan trigger dijalankan tanpa perubahan. Pengujian API memakai sesi fixture; pengiriman email dan autentikasi Supabase remote membutuhkan konfigurasi nyata dan pengujian tersendiri.

## Deploy

Build menghasilkan `apps/web/dist` untuk hosting statis. Konfigurasikan fallback SPA ke `index.html` agar `/reset-password` dapat dibuka langsung. Set `VITE_API_URL` sebelum build jika API berada di domain berbeda. Jalankan backend dengan `npm start`, gunakan Node 22, HTTPS, dan `WEB_ORIGIN` sesuai domain frontend. Jalankan migrasi terlebih dahulu dan atur Redirect URLs Supabase ke domain tersebut.

Frontend dan API menggunakan npm workspaces: instal dependency dari root dengan `npm ci`. Deploy dari root repository agar package `@sawit/shared` ikut tersedia. API tidak memerlukan transpilation. Untuk reverse proxy, sesuaikan `trust proxy` hanya dengan konfigurasi proxy yang diketahui agar pembatasan request menghitung IP dengan benar. Backup database dan pantau error di Supabase sebelum digunakan untuk data produksi.

## Pengeluaran kebun

Jalankan `supabase/migrations/202610060001_cash_expenses.sql` setelah dua migrasi panen sebelumnya. Menu **Pengeluaran kebun** menyediakan dua rincian default (Ongkos Semprot dan Bensin), tanggal pengeluaran, serta tombol tambah/hapus rincian. Maksimal 50 rincian per catatan. Total publikasi mengurangi cash utama; draft tidak dihitung. Edit yang diperbolehkan menghitung ulang total tanpa mengatur ulang batas 7 × 24 jam sejak publikasi. RLS memisahkan catatan tiap akun dan database menolak perubahan setelah terkunci.

Dashboard mempertahankan enam kartu ringkasan, grafik pendapatan per panen, dan catatan panen. Formulir dan tabel pencatatan berada pada menu fitur masing-masing. `/preview/*` menampilkan seluruh menu dengan data contoh pada mode development.

## Pengeluaran lainnya

Menu **Pengeluaran lainnya** memakai dua pasangan keterangan/jumlah Rupiah yang awalnya kosong. Tambahkan rincian sesuai kebutuhan, simpan sebagai draft atau publikasikan. Publikasi dikurangi dari cash yang sama dengan pendapatan panen dan pengeluaran kebun. Pengeditan dan penguncian memakai aturan 7 × 24 jam yang sama. Tidak diperlukan migrasi tambahan; tabel `cash_expenses` memakai kategori `other` dan aturan database yang sama.

## Analisis cash flow

Menu **Analisis keuangan** dan dashboard menampilkan grafik pertumbuhan bulanan/tahunan. Analisis menggunakan tanggal SPK untuk pemasukan, tanggal kelompok panen untuk biaya panen, dan tanggal pengeluaran untuk kebun/lainnya. Total hanya mencakup publikasi. Tabel analisis menunjukkan pemasukan, setiap kategori biaya, cash flow bersih, saldo akhir kumulatif, dan persentase pertumbuhan.

`Pertumbuhan = (cash flow bersih periode ini − periode sebelumnya) / abs(cash flow bersih periode sebelumnya) × 100%`. Bila periode sebelumnya nol, persentase ditampilkan `—`; tidak dibuat angka tak terhingga. Saldo awal dihitung dari transaksi periode terdahulu dengan asumsi saldo awal sebelum transaksi pertama Rp0. Bulanan membandingkan Januari dengan Desember tahun sebelumnya. Tahun berjalan menampilkan bulan hingga saat ini dan diberi keterangan belum lengkap. Tahunan menampilkan hingga 10 tahun berakhir pada tahun terpilih; saldo sebelumnya tetap ikut dihitung.

Sebelum dipakai dengan Supabase, jalankan seluruh migrasi `.sql` berurutan melalui SQL Editor (atau `supabase db push` jika proyek CLI sudah dihubungkan). Jangan mengulangi migrasi yang sudah dijalankan. Pengujian lokal tidak menerapkan migrasi ke database remote dan tidak memerlukan kredensial produksi.

## Git

## Tabungan dan konsistensi saldo

Menu **Tabungan** menyediakan satu rincian kosong (keterangan dan Rupiah), dengan tombol menambah rincian. Publikasi mengalokasikan dana sehingga cash tersedia berkurang; draft tidak dihitung. Pengeditan dibatasi 7 × 24 jam sejak publikasi awal.

Jalankan migrasi `202610060002_allocations_and_safe_writes.sql` dan `202610060003_workspace_snapshot.sql` setelah migrasi sebelumnya. Penyimpanan memakai transaksi database, `Idempotency-Key` UUID untuk retry, dan `If-Match` berisi versi catatan untuk edit. Edit dari versi lama ditolak dengan HTTP 409; muat ulang sebelum mencoba lagi. Retry harus memakai key dan payload yang sama.

Ringkasan dan analisis dihitung dalam satu snapshot PostgreSQL, dengan nilai uang desimal dikirim sebagai teks agar saldo besar tetap tepat. Daftar dipaginasi 20 catatan per halaman memakai cursor stabil; ringkasan tetap mencakup seluruh data. Ekspor SPK mencakup halaman aktif. Setelah penyimpanan, UI mengambil ulang ringkasan dari database dan memberi tahu tab lain; refresh berkala hanya berjalan saat halaman terlihat.

Pengujian lokal mencakup retry, konflik versi, isolasi akun, batas edit, serta 50.000 catatan tambahan. Hasil ini bukan jaminan kapasitas produksi; pantau database dan uji beban pada konfigurasi hosting yang digunakan.

Branch autentikasi/pendapatan: `feature/auth-harvest-dashboard`. Pengeluaran panen: `feature/harvest-expenses`. Pengeluaran kebun: `feature/garden-expenses`. Pengeluaran lainnya: `feature/other-expenses`. Analisis: `feature/cash-flow-analysis`. Fitur baru dibuat dari `development`, lalu digabungkan ke `development` setelah verifikasi. Gunakan Conventional Commits (`feat:`, `fix:`, `docs:`), dan pertahankan `main` sebagai branch stabil.

Referensi: [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
