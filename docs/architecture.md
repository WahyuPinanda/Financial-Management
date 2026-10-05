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
- `public.harvest_expenses`: banyak catatan biaya per panen; foreign key pemilik yang sama. Berat keseluruhan, upah total, dan pengeluaran total dihitung generated columns PostgreSQL.

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

Panen, SPK, dan pengeluaran dibaca per halaman 500 baris agar default limit Supabase tidak memotong total. Respons panen menyertakan array `spks` dan `expenses`. Ringkasan menggunakan nilai final database dan penjumlahan dalam satuan sen untuk menghindari galat floating point. Pendapatan bersih dihitung sebagai pendapatan utama dikurangi pengeluaran publikasi; pendapatan SPK asli tidak ditimpa. Respons saat ini memuat semua catatan akun; untuk data yang sangat besar, tambahkan endpoint agregasi SQL dan pagination UI.

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

## Endpoint pengeluaran

| Method | Path                                | Fungsi                         |
| ------ | ----------------------------------- | ------------------------------ |
| POST   | `/api/harvests/:harvestId/expenses` | Tambah draft/publikasi biaya   |
| PATCH  | `/api/expenses/:expenseId`          | Ubah biaya yang belum terkunci |

```json
{
  "first_weight": 10000,
  "second_weight": 4000,
  "wage_per_kg": 250,
  "driver_cost": 450000,
  "publish": true
}
```

API tidak menerima `overall_weight`, `labor_cost`, `total_expense`, `user_id`, atau `published_at` dari client. Database menghitung berat/biaya dan mengatur waktu publikasi. `publish: false` menyimpan draft baru; penyuntingan biaya publikasi mempertahankan waktu publikasi awal. Pengeluaran memiliki RLS dan trigger terpisah, dengan batas edit 7 × 24 jam. Migrasi kedua bersifat tambahan dan tidak mengubah skema pendapatan yang sudah ada.

## Pengeluaran cash dengan rincian dinamis

Tabel `cash_expenses` menyimpan `category`, `expense_date`, dan array JSONB `items` berisi `description` serta `amount`. Fungsi immutable PostgreSQL memvalidasi rincian dan menghasilkan `total_expense` sebagai generated NUMERIC. Kategori disiapkan untuk `garden` dan `other`; pencatatan tidak wajib terikat ke satu panen. Tanggal pengeluaran dipakai untuk filter periode, sedangkan waktu publikasi server dipakai untuk penguncian 7 hari. Identitas, pemilik, kategori, dan publikasi yang sudah ada tidak bisa diubah. Hak delete tidak diberikan.

| Method | Path                               | Fungsi                                                   |
| ------ | ---------------------------------- | -------------------------------------------------------- |
| GET    | `/api/cash-expenses`               | Semua catatan pemilik, dipaginasi tanpa pemotongan saldo |
| POST   | `/api/cash-expenses/:category`     | Membuat catatan rincian                                  |
| PATCH  | `/api/cash-expenses/:category/:id` | Edit sebelum batas publikasi                             |

Payload: `{ "expense_date": "2026-10-06", "items": [{ "description": "Bensin", "amount": 100000 }], "publish": true }`. Client tidak boleh mengirim pemilik, jumlah final, atau tanggal publikasi. API memakai controller/service/repository JavaScript, validasi shared, JWT terverifikasi, dan RLS Supabase. Cash utama adalah seluruh pendapatan publikasi dikurangi pengeluaran panen serta rincian pengeluaran cash publikasi.

## Analisis dan konsistensi periode

`packages/shared/src/analytics.js` membangun peristiwa keuangan dari seluruh publikasi yang dapat diakses akun. Tidak menggunakan join SPK dengan rincian biaya yang bisa menggandakan total. Pemasukan memakai `delivery_date`, pengeluaran panen memakai `harvest_date`, pengeluaran cash memakai `expense_date`. Filter bulan ringkasan dashboard memakai tanggal yang sama. Grafik pertumbuhan memakai seluruh data agar bulan/tahun sebelumnya tetap tersedia walau tidak ditampilkan. Filter tahun analisis berdiri sendiri dari filter bulan kartu ringkasan.

Penjumlahan nilai uang memakai integer sen (BigInt); PostgreSQL tetap otoritatif untuk nilai transaksi. Saldo awal sebelum transaksi pertama diasumsikan nol. Saldo akhir adalah akumulasi cash flow bersih; tidak di-clamp saat negatif. Persentase menghitung perubahan cash flow bersih dibanding nilai absolut periode sebelumnya. Periode sebelumnya nol menghasilkan null (`—`), bulan kosong diisi nilai nol, dan batas Desember/Januari ditangani secara eksplisit. Periode berjalan diberi penanda belum lengkap. Grafik bulanan/tahunan dan tabel rincian tersedia di menu Analisis; dashboard hanya menampilkan ringkasan, grafik pertumbuhan, serta grafik pendapatan/insight yang dipertahankan.

## Batas fitur saat ini

Perubahan nama kelompok panen, penghapusan, multi-role, dan pendaftaran publik belum disediakan. Akun pemilik dibuat dari Supabase Dashboard. UI pratinjau hanya tersedia pada Vite development dan tidak melewati autentikasi API.
