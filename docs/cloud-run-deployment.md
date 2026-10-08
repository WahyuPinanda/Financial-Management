# Persiapan GCP Cloud Run

`cloudbuild.yaml` menyiapkan verifikasi, build, push image ke Artifact Registry, deploy API/React dan pengaturan origin. Deployment pertama di GCP belum berhasil: build awal berhenti saat verifikasi karena origin kosong masuk ke konfigurasi API tes. Repo private dapat dipakai setelah koneksi GitHub Cloud Build diberi akses ke repo yang dipilih. Alur rilis: **feature → development → main**. Default branch GitHub tetap `development`; trigger deployment dibatasi ke **`^main$`**. Default branch repo tidak menentukan branch trigger.

## Langkah Cloud Shell

Project pada screenshot pengguna adalah `river-sky-416523`. Periksa project tersebut dan billing sebelum menjalankan perintah; skrip membuat resource GCP yang dapat dikenai biaya. Jalankan sebagai akun yang boleh mengaktifkan API, membuat resource dan memberikan binding IAM. Tidak ada resource GCP yang dibuat dari workstation dalam tahap persiapan ini.

Kloning private repo memakai login GitHub biasa saat diminta terminal. Jangan menaruh PAT di URL clone, command history, source atau chat. Siapkan resource dahulu dari feature branch terbaru:

```bash
gcloud config set project river-sky-416523
git clone --branch feature/finance-production-foundation https://github.com/WahyuPinanda/Financial-Management.git
cd Financial-Management
bash scripts/gcp/cloud-shell.sh bootstrap river-sky-416523
```

`bootstrap` mengaktifkan APIs, membuat Artifact Registry dan source bucket, empat service account dengan peran terpisah, serta health token acak di Secret Manager. Token dialirkan langsung lewat pipe; tidak dicetak atau disimpan dalam file source. Resource yang sudah ada digunakan kembali. Ia tidak membuat trigger GitHub dan tidak membuka website untuk publik.

Jika bootstrap sebelumnya berhenti pada `Adding a binding without specifying a condition...`, ambil perbaikan terbaru dengan `git pull --ff-only origin feature/finance-production-foundation`, lalu jalankan ulang perintah bootstrap dari direktori repo. Binding role build account menggunakan `--condition=None` secara eksplisit; conditional binding milik project yang sudah ada tetap dipertahankan. Service account, repository dan secret/version yang sudah dibuat digunakan kembali. Jangan clone ulang atau menghapus resource untuk melanjutkan setup.

Setelah perubahan feature digabung ke `development` lalu `main`, lakukan deployment pertama dari Cloud Shell. Isi publishable key melalui input terminal; password pemilik dan admin key Supabase tidak diperlukan oleh build/deployment:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
export CASH_FLOW_SUPABASE_URL=https://vvhnlnebudpztjkuxgpb.supabase.co
read -r -p 'Supabase publishable key: ' CASH_FLOW_SUPABASE_PUBLISHABLE_KEY
export CASH_FLOW_SUPABASE_PUBLISHABLE_KEY
bash scripts/gcp/cloud-shell.sh deploy river-sky-416523
```

`deploy` menolak branch selain `main` dan source yang belum di-commit. Build menggunakan account `cash-flow-builder@river-sky-416523.iam.gserviceaccount.com`; upload source memakai `.gcloudignore`, sehingga `.env`, sertifikat dan artifacts lokal tidak ikut dikirim ke Cloud Build. Proses build menjalankan test dan audit sebelum deployment.

Tahap verifikasi membaca `_WEB_ORIGIN` melalui `DEPLOY_WEB_ORIGIN`, terpisah dari `WEB_ORIGIN` milik API. Nilai kosong tetap diperbolehkan untuk menggunakan URL resmi Cloud Run; tes memakai origin default lokal. Origin HTTPS custom tetap divalidasi sebelum build. Jika build lama gagal dengan `ZodError` pada `WEB_ORIGIN`, jalankan `git pull --ff-only origin main` lalu ulangi `deploy` setelah perbaikan digabung. Tidak perlu membuat ulang resource bootstrap. Origin runtime tetap ditetapkan dari URL service atau origin custom pada tahap `origin`.

Website login awal masih dibatasi IAM Google. Untuk membukanya lewat browser menggunakan Supabase login, jalankan satu kali sebagai administrator project:

```bash
gcloud run services update cash-flow --project=river-sky-416523 \
  --region=asia-southeast1 --no-invoker-iam-check
bash scripts/gcp/cloud-shell.sh schedule river-sky-416523
gcloud run services describe cash-flow --project=river-sky-416523 \
  --region=asia-southeast1 --format='value(status.url)'
```

Halaman login menjadi dapat dibuka publik; API keuangan tetap membutuhkan JWT Supabase dan diperiksa RLS/MFA. Endpoint health database tetap membutuhkan health token. Skrip `schedule` menguji Cloud Run Job sampai execution berhasil sebelum membuat/memperbarui jadwal **00.00 WITA**. Jalankan kembali `schedule` setelah mengganti health secret atau mengubah kode job supaya image dan versi token tetap sesuai service.

Tambahkan URL hasil deployment sebagai **Site URL** Supabase dan `<URL>/reset-password` pada **Redirect URLs**. Nonaktifkan signup publik, konfigurasi SMTP dan aktifkan MFA dari akun pemilik. Pantau execution job serta buat alert; scheduler yang dibuat belum mencakup alert, backup atau restore.

## Akun pemilik

Akun pemilik disiapkan satu kali melalui `scripts/supabase/bootstrap-owner.js`. Email dan password yang diminta pengguna ada di **`ops/bootstrap/.env` lokal**, diabaikan Git, Docker dan Cloud Build. Nilai tersebut tidak menjadi login bypass, tidak diisi otomatis pada form browser, dan tidak perlu disimpan pada environment Cloud Run. Supabase Auth menyimpan kredensial pengguna dan memverifikasi login biasa.

Admin key digunakan sementara hanya ketika membuat akun. Menjalankan setup lagi tidak mengubah password akun yang sudah ada. Template tanpa credential tersedia pada `ops/bootstrap/.env.example`; jalankan `node scripts/supabase/bootstrap-owner.js` hanya dari lingkungan lokal yang dipercaya. Karena password awal telah dibagikan di chat, ganti melalui alur pemulihan password sebelum penggunaan nyata; ubah/hapus nilai setup lokal sesudahnya agar tidak menjadi salinan password yang kedaluwarsa.

## Trigger deployment branch main

Sesudah release pertama berhasil, di **Cloud Build → Triggers** hubungkan repo GitHub dan pilih:

- Event: push to a branch; branch regex **`^main$`**.
- Configuration: Cloud Build configuration file, path **`cloudbuild.yaml`** di root.
- Service account: `cash-flow-builder@river-sky-416523.iam.gserviceaccount.com`.
- Substitutions: URL/publishable key, runtime account `cash-flow-runtime@river-sky-416523.iam.gserviceaccount.com`, region, serta versi health secret yang ditampilkan `bootstrap`.

Jangan membuat trigger deployment untuk push `development` atau PR feature. CI test pada branch tersebut boleh dibuat terpisah tanpa deployment. Lindungi `main` dengan PR/review dan status checks; penggabungan ke `main` akan memicu deployment kode, bukan menjalankan migrasi Supabase otomatis. Migrasi database memakai workflow Supabase yang terpisah; untuk perubahan skema gunakan migrasi yang kompatibel dengan versi aplikasi yang masih berjalan sebelum rollout kode.

Trigger Cloud Build tidak menunggu deployment migrasi dari integrasi GitHub Supabase. Untuk rilis berikutnya yang mengubah skema, verifikasi migrasi kompatibel selesai terlebih dahulu melalui workflow CLI terkontrol sebelum merge ke `main`, atau tambahkan tahap migrasi/gate pada pipeline rilis. Jangan membiarkan dua deployment asynchronous mengasumsikan urutan yang sama. Saat ini seluruh 16 migrasi untuk kode ini sudah diterapkan pada proyek uji.

## Container aplikasi

Gunakan `deploy/cloudrun/Dockerfile`, bukan Dockerfile/Compose operasi VM. React dibangun dengan URL/public key lalu dilayani Express pada origin yang sama dengan `/api`. Node mendengarkan `0.0.0.0:$PORT` (8080). Deep link seperti `/login` mengembalikan SPA; endpoint API/aset yang tidak ada tidak mendapat HTML. HTML tidak dicache permanen; aset hasil build dicache immutable. CSP mengizinkan koneksi Auth/Storage ke origin Supabase.

Variabel `VITE_*` dimasukkan ke JavaScript saat build, sehingga hanya public key yang boleh digunakan. Tidak perlu secret API key atau database password di container web/API. Source `.env` lokal dan artifacts tidak masuk build context. `SERVE_WEB=false` tetap menjadi default development.

## Resource dan trigger yang perlu disiapkan

1. Pilih **GCP Project ID** dan region; ID Supabase bukan GCP Project ID. Region awal `asia-southeast1` sesuai pooler Supabase Singapore; ukur latency sebelum memindahkan region.
2. Aktifkan Cloud Build, Cloud Run, Artifact Registry, Secret Manager serta Cloud Scheduler APIs. Buat Docker repository `cash-flow` pada region tersebut.
3. Buat service account runtime khusus aplikasi. Buat secret `cash-flow-healthcheck-token` bernilai acak minimal 32 karakter, simpan lewat Secret Manager dan beri runtime account akses ke secret itu saja. Tidak ada plaintext token dalam repo/build substitutions. Pada deployment ini secret version dipin ke `1`; ubah nomor setelah rotasi.
4. Gunakan service account Cloud Build khusus dengan Artifact Registry Writer pada repository, Cloud Run Developer untuk membuat/memperbarui service, Service Account User pada runtime account, Service Usage Consumer, dan izin Cloud Logging sesuai konfigurasi `CLOUD_LOGGING_ONLY`. Skrip juga menyediakan Storage Object Viewer pada bucket source khusus untuk build manual. Jangan memberi role Owner. Akun yang menjalankan build/membuat trigger perlu izin `iam.serviceAccounts.actAs` pada build account. Koneksi source repository dan izin trigger disiapkan terpisah di Console.
5. Buat trigger repository private menggunakan `cloudbuild.yaml`. Isi substitutions berikut pada trigger.

| Substitution                                | Nilai                                                               |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `_SUPABASE_URL`                             | `https://vvhnlnebudpztjkuxgpb.supabase.co`                          |
| `_SUPABASE_PUBLISHABLE_KEY`                 | Publishable key proyek; bukan `sb_secret_*`                         |
| `_RUNTIME_SERVICE_ACCOUNT`                  | Email service account runtime GCP                                   |
| `_REGION`                                   | `asia-southeast1` atau region yang dipilih                          |
| `_AR_REPOSITORY`                            | Nama Docker repository, default `cash-flow`                         |
| `_SERVICE`                                  | Nama Cloud Run service, default `cash-flow`                         |
| `_WEB_ORIGIN`                               | Kosong untuk URL resmi service, atau origin HTTPS custom tanpa path |
| `_HEALTH_SECRET` / `_HEALTH_SECRET_VERSION` | Nama secret / versi, default `cash-flow-healthcheck-token` / `1`    |

Build menolak URL yang bukan root Supabase dan key yang bukan `sb_publishable_*`. API memakai `SUPABASE_ANON_KEY` untuk kompatibilitas nama variabel. URL/key harus berasal dari proyek yang sama.

Service baru tetap memakai pembatasan IAM bawaan: pipeline tidak memberi akses publik. Atur akses website sesuai keputusan deployment nanti. Supabase Auth, RLS dan MFA tetap melindungi data ketika website diakses pengguna. Tambahkan URL final ke Site URL dan Redirect URLs Supabase; ganti origin development pada tahap produksi. Tahap `origin` pada pipeline membuat revision tambahan untuk menetapkan `WEB_ORIGIN` dari URL service yang sebenarnya.

## Health check setiap pergantian hari

Timer dalam Node dinonaktifkan otomatis pada Cloud Run (`K_SERVICE`) karena service dapat scale ke nol. Gunakan **Cloud Scheduler → Cloud Run Job → endpoint API database**, pukul **00.00 Asia/Makassar** setiap hari.

Job menjalankan `node scripts/gcp/healthcheck.js` dari image aplikasi yang sama. Ia mengambil ID token dari metadata GCP untuk service target, kemudian mengirim token tersebut bersama secret health check ke `/api/health/database`. Token, JWT dan body database tidak ditulis ke log. URL harus berupa origin resmi `*.run.app`; gunakan URL service asli juga bila website memiliki custom domain.

Siapkan dua service account khusus: job account memiliki `roles/run.invoker` pada service dan Secret Accessor pada health secret; Scheduler account memiliki `roles/run.invoker` pada job. Scheduler memakai OAuth untuk memanggil Google Cloud Run API, sehingga token aplikasi tidak berada dalam konfigurasi Scheduler.

Contoh berikut adalah template **bash/Cloud Shell**. Ganti placeholder dan jalankan setelah resource/IAM/secret siap; jangan memakai contoh sebagai nilai credential.

```bash
gcloud run jobs create cash-flow-db-health \
  --project=GCP_PROJECT_ID --region=asia-southeast1 \
  --image=IMAGE_FROM_SUCCESSFUL_BUILD \
  --service-account=HEALTH_JOB_SERVICE_ACCOUNT \
  --command=node --args=scripts/gcp/healthcheck.js \
  --set-env-vars=HEALTHCHECK_API_URL=https://SERVICE_URL.run.app/api/health/database \
  --set-secrets=HEALTHCHECK_TOKEN=cash-flow-healthcheck-token:1 \
  --tasks=1 --parallelism=1 --max-retries=2 --task-timeout=60s \
  --cpu=1 --memory=512Mi

gcloud scheduler jobs create http cash-flow-db-health-midnight \
  --project=GCP_PROJECT_ID --location=asia-southeast1 \
  --schedule='0 0 * * *' --time-zone=Asia/Makassar \
  --uri=https://run.googleapis.com/v2/projects/GCP_PROJECT_ID/locations/asia-southeast1/jobs/cash-flow-db-health:run \
  --http-method=POST --oauth-service-account-email=SCHEDULER_SERVICE_ACCOUNT
```

Jalankan job manual dahulu dan pastikan execution sukses. Buat alert pada **job gagal** dan **tidak ada execution sukses dalam 26 jam**. Respons sukses Scheduler hanya membuktikan job diterima, bukan database sehat. Health check ini tidak menggantikan backup ataupun monitor uptime eksternal.

## Kapasitas, ekspor dan backup

Batas awal service: 1 CPU, 512 MiB, concurrency 20, min instances 0, max instances 3. Ini batas pengujian awal, bukan hasil load test. Pipeline menggunakan `--no-cpu-throttling` agar worker ekspor mendapatkan CPU setelah respons HTTP 202; instance-based billing dapat menambah biaya. Instance masih bisa berhenti, sehingga pekerjaan memakai lease database dan Storage privat untuk melanjutkan batch setelah request berikutnya. Untuk ekspor yang harus terus berjalan tanpa pengguna aktif, tambahkan worker durable terpisah sebelum penggunaan arsip besar.

Rate limit HTTP saat ini berada di memori tiap instance; batas global memerlukan gateway/distributed limiter pada deployment multi-instance. Ukur memory, latency snapshot, koneksi database dan cold start saat staging. Uji request paralel lintas instance sebelum data nyata.

Jangan menjalankan scheduler backup VM pada filesystem Cloud Run yang sementara. Backup remote, penyimpanan GCS yang tahan restart, lock lintas worker, pengujian restore pada database terpisah dan alert backup kedaluwarsa belum dikonfigurasi. Password backup dan encryption key disimpan terpisah di Secret Manager; bukti Storage juga perlu dicadangkan. Database remote saat ini PostgreSQL **17**: pilih `pg_dump`/`pg_restore` yang kompatibel sebelum menyiapkan backup.

## Validasi

Pengujian lokal mencakup deep link SPA, CSP Supabase, caching, penolakan fallback API/aset, OIDC health job dan kegagalan metadata/database. Container belum dibuild atau dideploy di GCP; Docker engine lokal belum tersedia saat pemeriksaan. Lanjutkan dengan build trigger, uji login/MFA/SMTP/Storage, restart/retry ekspor, job health, alert, backup/restore dan load test staging.

Referensi: [Cloud Build to Cloud Run](https://docs.cloud.google.com/build/docs/deploying-builds/deploy-cloud-run), [Container contract](https://docs.cloud.google.com/run/docs/container-contract), [CPU and billing](https://docs.cloud.google.com/run/docs/configuring/billing-settings), [Jobs on a schedule](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule).
