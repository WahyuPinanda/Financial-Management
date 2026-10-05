# Arsitektur dan API

## Alur data

```text
React → Supabase Auth (email/password dan pemulihan email)
React → Bearer JWT → Express auth middleware → Controller → Service → Repository
Repository → Supabase Data API → PostgreSQL (RLS + checks + generated columns + trigger)
```

Password tidak disimpan oleh aplikasi atau database `public`. Supabase Auth mengelola password, sesi, dan email pemulihan. Middleware memvalidasi JWT lewat `auth.getUser(token)`. Setiap request memiliki client Supabase sendiri agar sesi akun tidak tercampur. Role anon/public key ditambah JWT pengguna membuat RLS berlaku pada setiap query.

## Model data

- `auth.users`: identitas Supabase.
- `public.harvests`: nama dan tanggal kelompok panen; dimiliki satu akun.
- `public.spks`: banyak SPK per kelompok panen; foreign key `(harvest_id, user_id)` memastikan pemilik SPK sama dengan pemilik panen.

Nilai `gross_weight`, `net_weight`, `deduction_percent`, dan `total_income` adalah generated columns. API tidak menerima nilai hasil hitungan dari client. `published_at`, `created_at`, dan `updated_at` SPK diatur trigger. SPK publikasi tidak dapat dikembalikan menjadi draft atau dipindahkan ke kelompok lain.

Penguncian tepat saat waktu database ≥ `published_at + 7 days`. Service memeriksa lebih awal untuk pesan yang jelas, tetapi trigger PostgreSQL menjadi aturan final meskipun pengguna mengirim request langsung. UI menampilkan timestamp WITA; penyimpanan menggunakan `timestamptz`.

## Endpoint

Semua endpoint kecuali health memerlukan `Authorization: Bearer <access_token>`.

| Method | Path                            | Fungsi                                 |
| ------ | ------------------------------- | -------------------------------------- |
| GET    | `/api/health`                   | Status proses dan konfigurasi          |
| GET    | `/api/harvests`                 | Semua panen milik akun beserta SPK     |
| POST   | `/api/harvests`                 | Membuat kelompok panen                 |
| POST   | `/api/harvests/:harvestId/spks` | Menambah draft/SPK publikasi           |
| PATCH  | `/api/spks/:spkId`              | Mengubah draft/SPK yang belum terkunci |

Daftar database dibaca per halaman 500 baris agar default limit Supabase tidak memotong total pendapatan. Respons saat ini memuat semua catatan akun; untuk data yang sangat besar, tambahkan endpoint agregasi SQL dan pagination UI.

### Buat kelompok panen

```json
{ "name": "Panen kebun A — Oktober", "harvest_date": "2026-10-05" }
```

### Buat / ubah SPK

```json
{
  "company_name": "PT. Sawit Sejahtera",
  "delivery_date": "2026-10-05",
  "bunch_count": 500,
  "first_weight": 10000,
  "second_weight": 4000,
  "deduction_kg": 120,
  "price_per_kg": 3000,
  "publish": true
}
```

`publish: false` menyimpan draft baru. SPK yang sudah dipublikasikan tetap berstatus publikasi ketika disunting; waktu awal tidak direset. User ID diperoleh dari JWT, bukan request body.

### Respons dan error

Berhasil: `{ "status": true, "data": ... }`. Daftar juga menyertakan `server_time`. Gagal: `{ "status": false, "message": "..." }`, dengan rincian validasi hanya untuk error input.

| HTTP | Makna                                                     |
| ---- | --------------------------------------------------------- |
| 400  | Input, tanggal, ID, atau JSON tidak valid                 |
| 401  | Sesi tidak ada / tidak valid                              |
| 403  | Akses database tidak diizinkan                            |
| 404  | Data tidak ditemukan atau tidak dimiliki akun             |
| 409  | SPK terkunci / perubahan identitas atau publikasi ditolak |
| 429  | Batas request terlampaui                                  |
| 503  | Konfigurasi atau database belum tersedia                  |

## Batas tahap pertama

Pengeluaran, perubahan nama kelompok panen, penghapusan, multi-role, dan pendaftaran publik belum disediakan. Akun pemilik dibuat dari Supabase Dashboard. UI pratinjau hanya tersedia pada Vite development dan tidak melewati autentikasi API.
