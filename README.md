# Memory Photobooth — SessionHub

> **For Your Precious Memories**

SessionHub adalah aplikasi web (Node.js) yang memantau folder hasil **DSLRBooth**, menggabungkan foto menjadi **sesi (jumlah foto diatur, default 4, + 1 template)**, lalu menyajikan galeri tamu lewat **QR code** — lengkap dengan dashboard operator, statistik per event, unduh ZIP, dan unggah otomatis ke **VPS + domain**. QR sesi dan QR event sudah bisa dipakai sebelum upload selesai.

Satu aplikasi, dua peran:

| Peran | Berjalan di | Fungsi |
|---|---|---|
| **Booth (lokal)** | PC photobooth (Windows) | Memantau folder DSLRBooth, galeri + QR untuk tamu di WiFi yang sama, **cadangan saat internet mati**, mengunggah sesi ke server. |
| **Server (publik)** | VPS Ubuntu + domain | Menerima unggahan booth, galeri publik `https://domain/s/<id>` dan `https://domain/e/<event>` untuk tamu dari jaringan mana pun. |

---

## Daftar isi

- [Fitur](#fitur)
- [Arsitektur](#arsitektur)
- [Kebutuhan](#kebutuhan)
- [Mulai cepat (booth)](#mulai-cepat-booth)
- [Login operator](#login-operator)
- [Alur pemakaian harian](#alur-pemakaian-harian)
- [QR sesi & QR event](#qr-sesi--qr-event)
- [Hapus sesi / foto (khusus superadmin VPS)](#hapus-sesi--foto-khusus-superadmin-vps)
- [Cara pengelompokan sesi](#cara-pengelompokan-sesi)
- [Konfigurasi](#konfigurasi)
- [Unggah otomatis ke VPS + domain](#unggah-otomatis-ke-vps--domain)
- [Ganti jaringan / pindah WiFi](#ganti-jaringan--pindah-wifi)
- [URL penting](#url-penting)
- [Restart & perawatan](#restart--perawatan)
- [Struktur proyek](#struktur-proyek)
- [Handover](#handover)
- [Troubleshooting](#troubleshooting)
- [Keamanan](#keamanan)

---

## Fitur

- **Deteksi otomatis** foto baru di `Singles/` dan print di `Prints/` (termasuk `Prints/Qr/`). Aplikasi hanya *membaca* folder DSLRBooth.
- **Pengelompokan sesi**: sejumlah foto (default 4, diatur lewat `photosPerSession`) + 1 template.
- **Galeri tamu + QR** per sesi. QR dibuat saat halaman dibuka, jadi selalu mengikuti alamat server terkini.
- **QR langsung aktif**: begitu sesi selesai, booth memesan (reserve) sesi ke server. Tamu bisa scan QR sebelum file selesai diunggah; halaman menampilkan status loading dan terisi otomatis.
- **Galeri event + QR utama**: satu QR untuk semua sesi dalam event (`/e/<event>`), termasuk sesi yang masih diunggah. Tombol **QR Event** tersedia di dashboard.
- **Hapus sesi/foto**: di VPS khusus superadmin; pada booth lokal tetap untuk operator yang login.
- **Unduh** per foto, template, **ZIP satu sesi**, dan **kolase PNG** (foto + QR; tata letak menyesuaikan jumlah foto, tanpa sel kosong).
- **Dashboard operator**: login, pilih event, statistik per event, kartu sesi *live* (SSE), rescan, status unggah.
- **Statistik per event**: total sesi, siap/lengkap, belum lengkap, terunggah.
- **Unggah otomatis ke VPS** dengan antrean + retry — internet putus tidak masalah, unggahan dilanjutkan saat kembali.
- **Anti-duplikat**: status upload disimpan lintas rescan; sebelum backfill, booth mencocokkan daftar sesi dengan `/api/events/<event>` sehingga sesi yang sudah ada di server tidak dikirim ulang.
- **Upload efisien**: koneksi HTTPS dipakai ulang, reserve berjalan bersamaan dengan upload, dan beberapa sesi dapat diunggah paralel (`cloud.concurrency`, default 3).
- **Prune reserve yatim**: booth mengirim daftar ID valid; server menghapus kartu *pending* lama yang tidak punya pasangan lokal (mis. print dibuat ulang) setelah umurnya 10 menit.
- **Tema soft romantic**, responsif di HP, iPad mini, dan desktop.
- **Kirim link sesi via WhatsApp** dari dashboard dan halaman sesi (operator VPS): isi nomor penerima, lalu WhatsApp terbuka dengan pesan siap kirim.
- **Manajemen akun VPS**: superadmin mengelola user; admin hanya melihat dan membagikan sesi dari event yang ditugaskan; setiap akun dapat mengganti password sendiri.
- **Apple Touch Icon** dari simbol logo untuk shortcut Safari di layar utama iPhone/iPad.
- **Watchdog**: `start.cmd` menghidupkan ulang server otomatis, plus heartbeat dan `data/error.log` untuk diagnosa.

## Arsitektur

```
        [ PC BOOTH + DSLRBooth ]                      [ VPS Ubuntu + domain ]
  ┌──────────────────────────────────┐          ┌────────────────────────────────┐
  │  SessionHub — mode booth         │  HTTPS   │  SessionHub — mode server      │
  │  • pantau Singles/ + Prints/     │ ───────► │  • terima POST /api/push       │
  │  • galeri lokal + QR             │  token   │  • simpan media                │
  │  • antrean upload + retry        │          │  • galeri publik /s/<id>       │
  │  • cadangan saat internet mati   │          │  • login operator + statistik  │
  └──────────────────────────────────┘          └────────────────────────────────┘
      tamu di WiFi booth (cadangan)                tamu dari jaringan mana pun
```

Saat sesi selesai, booth mengirim **metadata reserve** lebih dulu, lalu file menyusul.
Dengan begitu `/s/<id>` dan `/e/<event>` sudah bisa dibuka dan terisi otomatis.
Booth juga mengirim daftar ID valid secara berkala agar server dapat membuang
reserve yatim yang tidak akan pernah terisi.

Kode yang sama dipakai di kedua sisi. Perannya ditentukan oleh `config.json`:

- **Booth**: `cloud.enabled = true` + `cloud.url` + `cloud.token` + `baseUrl` domain.
- **Server**: `pushToken` diisi (sama dengan `cloud.token` di booth) dan `baseUrl` domain.

Panduan lengkap VPS: **[DEPLOY.md](DEPLOY.md)**.

## Kebutuhan

- **Windows 10/11** (mode booth) + **Node.js LTS** — cek dengan `node -v`.
- **DSLRBooth** dengan folder output `Singles/` dan `Prints/`.
- *(Opsional, untuk mode publik)* **VPS Ubuntu 22.04/24.04** + **domain** dengan A record ke IP VPS.

## Mulai cepat (booth)

1. Pasang **Node.js LTS** bila belum ada: <https://nodejs.org>
2. Bila `config.json` belum ada, salin template: `copy config.example.json config.json`. Lalu jalankan **`install.cmd`** sekali (atau `npm install`).
3. Klik dua kali **`start.cmd`** — biarkan jendelanya terbuka (boleh diminimalkan).
   Watchdog di dalamnya otomatis menghidupkan server bila mati.
4. Jalankan **`add-firewall.cmd`** sekali sebagai **Administrator** (aturan port 3800,
   berlaku untuk semua profil jaringan). Tanpa ini, HP tamu tidak bisa membuka galeri.
5. Buka **<http://localhost:3800>** → login → pilih event.
6. Di HP (WiFi yang sama): buka alamat yang tampil di chip 🔗 dashboard,
   mis. `http://192.168.1.8:3800`.

**Auto-start saat Windows login** (opsional): tekan `Win+R` → `shell:startup` →
buat shortcut ke `start.cmd` di folder itu.

## Login operator

- Username: **`admin`**
- Password pertama **dibuat otomatis** saat aplikasi pertama kali berjalan dan
  **ditampilkan sekali di jendela server**. Catat!
- Bisa juga ditentukan sebelum start: isi `auth.adminPassword` di `config.json`.
- Ganti kapan saja:

  ```cmd
  npm run setpass -- admin PasswordBaru
  ```

  lalu **restart** server agar berlaku.

Sesi login berlaku **12 jam** (cookie `mp_auth`, HttpOnly). Setelah 9 kali gagal
login dari IP yang sama, login dikunci 10 menit.

Halaman tamu (`/s/<id>`, QR, unduh ZIP) **publik** — supaya QR yang sudah dicetak
tetap berfungsi tanpa login. Dashboard dan API operator wajib login.

### Peran dan manajemen user di server online

Pada VPS, akun lama otomatis menjadi **superadmin** saat versi ini pertama kali
berjalan; password tetap sama. Superadmin dapat membuka **Kelola user** (`/users`)
untuk membuat, melihat, mengedit, menghapus akun, mengatur role dan event admin,
serta mereset password admin. Superadmin juga dapat menghapus sesi/foto dan rescan.
Superadmin terakhir tidak bisa dihapus atau diturunkan rolenya.

**Admin event** hanya melihat dashboard, statistik, dan sesi dari event yang
ditugaskan. Admin dapat membagikan link sesi event tersebut lewat WhatsApp, tetapi
tidak dapat menghapus media, rescan, atau mengelola user. Galeri tamu dan API
event publik tetap dapat dibuka siapa pun sesuai perilaku QR sebelumnya.
Sistem role ini hanya berlaku di VPS; login booth lokal tidak berubah.

Setiap akun VPS dapat memakai **Ganti password** (`/account`) dengan password
lamanya. Perubahan password, reset oleh superadmin, atau penghapusan user
langsung membatalkan sesi login user tersebut; login kembali diperlukan.

### Kirim link via WhatsApp

Di dashboard VPS, klik **Kirim via WhatsApp** pada kartu sesi; di detail sesi
tombol yang sama tersedia saat login sebagai superadmin atau admin yang ditugaskan
ke event tersebut. Masukkan nomor HP Indonesia (`08…`, `62…`, atau `+62…`).
Aplikasi membuka `wa.me` di tab baru dengan link **satu sesi** terisi di pesan.
Periksa penerima, lalu tekan **Kirim** di WhatsApp. Pesan tidak dikirim otomatis
dan nomor penerima tidak disimpan oleh SessionHub. Link sesi pending juga dapat
dibagikan; tamu melihat halaman loading sampai foto selesai diunggah.

Di Safari iPad/iPhone, **Add to Home Screen** kini memakai simbol logo.
Shortcut lama yang masih menampilkan huruf “M” perlu dihapus dan dibuat ulang
setelah update server agar ikon baru digunakan.

## Alur pemakaian harian

1. Nyalakan PC booth → `start.cmd` berjalan → cek dashboard di `http://localhost:3800`.
2. Buat event di DSLRBooth (nama folder event dipakai sebagai nama event di dashboard).
3. Jalankan sesi foto seperti biasa.
4. Tamu scan QR → halaman loading (bila upload belum selesai) → foto + template tampil otomatis → unduh ZIP / kolase.
5. Bila cloud aktif, sesi lengkap otomatis diunggah ke VPS dan bisa diakses dari mana saja.
6. Untuk satu QR berisi semua sesi event, gunakan tombol **QR Event** di dashboard.

## QR sesi & QR event

- **QR sesi** ada di kartu sesi dashboard dan di halaman sesi. QR mengikuti `baseUrl`; isi domain agar permanen.
- **QR event** ada di judul setiap event pada dashboard. QR membuka `/e/<event>` yang menampilkan **semua sesi event**, termasuk sesi yang masih diunggah (kartu loading dengan spinner).
- Halaman event menyegarkan diri otomatis; tamu tidak perlu scan ulang ketika upload selesai.
- Cetak QR event besar-besar untuk diletakkan di meja registrasi; tamu bisa langsung memilih sesinya.

## Hapus sesi / foto (khusus superadmin VPS)

- Login sebagai superadmin VPS, lalu buka dashboard atau halaman sesi. Di booth lokal, operator tetap dapat menghapus.
- Tombol **Hapus** hanya muncul bagi akun yang berwenang; endpoint `DELETE` menolak request tanpa login (401) atau admin event (403).
- **Hapus foto** menghapus satu file + thumbnail. **Hapus sesi** menghapus seluruh foto, template, dan QR print sesi tersebut.
- File dihapus permanen dari folder `rootDir` server yang sedang dipakai.
- Jika sesi masih dalam proses upload dari booth, unggahan yang berjalan bisa memunculkannya kembali. Tunggu upload selesai sebelum menghapus sesi uji.

## Cara pengelompokan sesi

- Foto diambil dari `Singles/`, print dari `Prints/` (termasuk `Prints/Qr/`).
- **Sejumlah foto berurutan (default 4, sesuai `photosPerSession`) + 1 print** dalam jendela
  `singleToPrintWindowSec` (default 150 detik) digabung menjadi satu sesi.
- Jeda tanpa aktivitas lebih dari `idleGapSec` (default 30 detik) memisahkan sesi.
- Foto sisa tanpa print digabung per cluster `leftoverClusterGapSec` (default 300 detik)
  dan ditandai **belum lengkap**.

Cek hasil pengelompokan tanpa menjalankan server:

```cmd
npm run validate
```

## Konfigurasi

Semua di `config.json` (di server VPS: `/opt/sessionhub/data/config.json`,
dibaca lewat env `SESSIONHUB_CONFIG`). File `config.json` bersifat **lokal**
(berisi token/password) dan tidak di-commit; template aman ada di `config.example.json`.

| Kunci | Default | Arti |
|---|---|---|
| `rootDir` | `C:\dslrBooth` | Folder induk DSLRBooth (berisi `Singles/`, `Prints/`). |
| `port` | `3800` | Port server lokal. |
| `photosPerSession` | `4` | Jumlah foto per sesi. |
| `singleToPrintWindowSec` | `150` | Batas waktu foto→print untuk satu sesi. |
| `idleGapSec` | `30` | Jeda yang memisahkan sesi. |
| `leftoverClusterGapSec` | `300` | Pengelompokan foto sisa tanpa print. |
| `baseUrl` | `""` | Kosong = pakai IP LAN saat ini. Isi `https://domain` agar QR selalu ke domain publik. |
| `pushToken` | `""` | **Mode server**: token yang harus dikirim booth saat push. |
| `auth.adminPassword` | `""` | Password awal operator (kosong = dibuat otomatis). |
| `cloud.enabled` | `false` | **Mode booth**: aktifkan unggah otomatis. |
| `cloud.url` | `""` | Alamat server, mis. `https://photobooth.domain.com`. |
| `cloud.token` | `""` | Sama dengan `pushToken` di server. |
| `cloud.uploadIncomplete` | `false` | Ikut unggah sesi yang belum lengkap? |
| `cloud.uploadSince` | `""` | Kosong = sesi **24 jam terakhir**. Isi tanggal ISO untuk backfill sesi lama. |
| `cloud.retrySec` | `60` | Jeda awal antar percobaan ulang. |
| `cloud.tickSec` | `10` | Interval pemrosesan antrean unggah. |
| `cloud.concurrency` | `3` | Jumlah sesi yang diunggah bersamaan (1–4). Turunkan bila koneksi tidak stabil. |
| `cloud.pruneSec` | `600` | Interval kirim daftar ID valid untuk membersihkan reserve yatim (detik). |
| `scanDebounceMs` | `800` | Debounce scan saat ada file baru. |
| `rootRescanSec` | `60` | Rescan penuh berkala. |

> Samakan `photosPerSession` di booth dan server. Kalau booth memakai 2 foto,
> server juga harus 2; kalau tidak, sesi akan tampil "belum lengkap" di server.

> Kecepatan total upload tetap dibatasi bandwidth uplink. Tanpa kompresi atau
> upgrade jaringan, optimasi yang dipakai adalah koneksi HTTPS keep-alive,
> reserve yang berjalan bersamaan dengan upload, dan `cloud.concurrency`
> (default 3). Bila koneksi tidak stabil, turunkan ke 2 atau 1.

## Unggah otomatis ke VPS + domain

1. Di **booth**, isi `config.json`:

   ```json
   "baseUrl": "https://photobooth.domain.com",
   "cloud": {
     "enabled": true,
     "url": "https://photobooth.domain.com",
     "token": "TOKEN-RAHASIA-PANJANG",
     "uploadIncomplete": false,
     "uploadSince": "",
     "retrySec": 60,
     "tickSec": 10,
     "concurrency": 3,
     "pruneSec": 600
   }
   ```

2. Di **server**, isi `pushToken` dengan token yang sama dan `baseUrl` domain.
   Konfigurasi server disimpan di **`/opt/sessionhub/data/config.json`**
   (di luar repo, permission `600`). Nilai `photosPerSession` harus sama dengan booth.
3. Ikuti panduan lengkap dari nol di **[DEPLOY.md](DEPLOY.md)** (VPS, DNS,
   Node, Caddy/HTTPS, firewall, systemd auto-restart).
4. Pastikan VPS memakai versi yang memiliki `POST /api/push/prune`. Tanpa
   endpoint itu, booth tetap bisa upload tetapi reserve lama tidak dibersihkan.

Setelah aktif: sesi lengkap diunggah otomatis; bila internet putus, sesi tetap
tersimpan lokal dan diunggah ulang saat koneksi kembali. QR yang dibuat booth
langsung mengarah ke domain publik. Reserve yang tidak pernah mendapat file
dibersihkan otomatis setelah 10 menit (maksimal setiap `pruneSec`).

## Ganti jaringan / pindah WiFi

**Ya, aplikasi tetap berjalan.** Server mendengarkan di `0.0.0.0` (semua antarmuka),
jadi saat IP komputer berubah, server tidak perlu diubah:

- Alamat baru otomatis terdeteksi — chip 🔗 di dashboard dan `/api/status` (`lanUrl`)
  selalu menampilkan IP yang berlaku saat itu.
- Tautan sesi dan **QR yang baru dibuat** otomatis memakai IP/host terkini.
- Aturan firewall berbasis **port** (bukan IP), berlaku di semua profil jaringan —
  tetap valid setelah pindah WiFi.
- Data sesi tidak terpengaruh; tersimpan permanen di `data/sessions.json`.

Yang **tidak** otomatis:

- **QR yang sudah tercetak/tersimpan** dengan IP lama tidak bisa dibuka lagi dari
  jaringan baru. Cetak ulang QR, atau pilih solusi permanen di bawah.
- WiFi tamu dengan **client isolation** (umum di WiFi publik) tetap tidak bisa
  mengakses perangkat lain di jaringan yang sama — ini kebijakan router, bukan aplikasi.

**Solusi permanen agar QR tidak pernah berubah:**

1. Isi `baseUrl` dengan domain VPS (mis. `https://photobooth.domain.com`) — QR selalu
   menuju domain, dari jaringan mana pun.
2. Atau beri PC booth **IP statis / DHCP reservation** di router, sehingga IP LAN tidak berubah.

## URL penting

| URL | Akses | Fungsi |
|---|---|---|
| `/login` | publik | Halaman login operator. |
| `/users` | superadmin VPS | CRUD user, role, penugasan event, reset password. |
| `/account` | operator VPS | Ganti password akun sendiri. |
| `/` | operator | Dashboard (event, statistik, kartu sesi, rescan). |
| `/s/<id>` | publik | Galeri tamu satu sesi; menampilkan loading bila upload belum selesai. |
| `/s/<id>/qr.png` | publik | Gambar QR sesi (bisa dibuat sebelum sesi terindeks). |
| `/e/<event>` | publik | Galeri semua sesi event, termasuk yang sedang diunggah. |
| `/e/<event>/qr.png` | publik | QR utama event. |
| `/file?...` | publik | File foto/template sesi. |
| `/api/sessions/<id>` | publik | Detail sesi; `pending:true` saat file belum tiba. |
| `/api/sessions/<id>/zip` | publik | Unduh ZIP sesi. |
| `/api/events/<event>` | publik | Data sesi untuk halaman event. |
| `/api/status`, `/api/events`, `/api/sessions`, `/api/rescan`, `/api/stream` | operator | API dashboard / live update. |
| `/api/angka?event=...` | operator | Statistik per event (`/api/stats` tetap tersedia sebagai alias). |
| `DELETE /api/sessions/<id>` | superadmin VPS / operator booth | Hapus sesi + semua file. |
| `DELETE /api/sessions/<id>/file?p=...` | superadmin VPS / operator booth | Hapus satu file/foto sesi. |
| `/api/users`, `/api/users/<username>` | superadmin VPS | Daftar, buat, ubah, hapus user. |
| `POST /api/me/password` | operator VPS | Ganti password sendiri (wajib password lama). |
| `/api/push/reserve` | server (Bearer token) | Booth memesan sesi agar QR langsung aktif. |
| `/api/push` | server (Bearer token) | Menerima unggahan sesi dari booth. |
| `/api/push/prune` | server (Bearer token) | Menghapus reserve yatim yang tidak ada di daftar ID booth. |

## Restart & perawatan

**Booth (Windows):**

1. Tutup jendela `start.cmd` lama (atau biarkan — watchdog akan memakai ulang server yang sehat).
2. Jalankan `start.cmd` lagi.
3. Cek `http://localhost:3800/login` → harus terbuka.
4. Bila bermasalah: lihat `data/error.log`, cek umur `data/heartbeat.txt`
   (diperbarui tiap 10 detik). Watchdog menghidupkan ulang server dalam ±10–15 detik.

**Server (VPS):**

```bash
sudo systemctl restart sessionhub
sudo systemctl status sessionhub
journalctl -u sessionhub -n 50 --no-pager
```

## Struktur proyek

```
SessionHub/
├─ server.js           # Express: dashboard, API, galeri tamu/event, push, QR, ZIP, hapus
├─ README.md           # dokumentasi fitur dan pemakaian
├─ DEPLOY.md           # panduan pemasangan VPS dari nol
├─ agent.md            # handover: status live, arsitektur upload, checklist
├─ config.example.json # template konfigurasi (aman di-commit)
├─ config.json         # konfigurasi lokal (token/password; tidak masuk git)
├─ start.cmd           # supervisor + watchdog Windows
├─ install.cmd         # npm install sekali klik
├─ add-firewall.cmd    # aturan firewall port 3800 (jalankan sebagai Admin)
├─ lib/
│  ├─ scanner.js       # pemantau folder DSLRBooth
│  ├─ store.js         # penyimpanan sesi (data/sessions.json)
│  ├─ pending.js       # reserve sesi sebelum upload + halaman loading
│  ├─ auth.js          # hash password (scrypt) + sesi login
│  ├─ cloud-sync.js    # antrean unggah booth → server
│  ├─ qr.js            # pembuatan QR
│  ├─ net.js           # deteksi IP LAN
│  └─ config.js        # pemuatan konfigurasi
├─ public/             # dashboard, halaman sesi, halaman event, login, tema
│  ├─ users.html/js     # manajemen user superadmin VPS
│  ├─ account.html/js   # ganti password akun VPS
│  ├─ whatsapp.js       # dialog nomor + link wa.me
│  └─ apple-touch-icon.png # ikon Home Screen iPhone/iPad
├─ scripts/            # validate.js, setpass.js
├─ deploy/             # Caddyfile, systemd service, install-ubuntu.sh
└─ data/               # sessions, pending, users, log, media (tidak masuk git)
```

## Handover

Untuk serah terima ke operator atau agent berikutnya, baca **[agent.md](agent.md)**.
Dokumen tersebut memuat snapshot status booth/VPS, arsitektur reserve + upload,
konfigurasi penting, checklist verifikasi, troubleshooting, dan aturan kerja.

Ringkasan snapshot **25 Oktober 2026**:

- Booth lokal: antrean upload **0**, seluruh sesi event terakhir sudah ditandai
  terupload, dan `cloud.concurrency` aktif di angka **3**.
- Server publik: 131 sesi ready; 2 sesi lokal masih 404 di server dan belum
  dikirim ulang. Tidak ada ID duplikat. Masih ada 24 entri pending lama tanpa
  file lokal; fitur **prune** akan menghapusnya otomatis setelah VPS dan booth
  memakai versi terbaru.
- Perbaikan upload sebelumnya hanya berjalan di booth. **Fitur prune butuh
  update di VPS dan restart booth**; update VPS juga menyamakan versi.
- Sebelum restart booth, pastikan `cloud.pending` sudah 0 agar upload tidak
  terputus di tengah jalan.

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `localhost:3800` tidak terbuka | Tunggu ±15 detik (watchdog). Bila tetap, tutup lalu jalankan `start.cmd` lagi; cek `data/heartbeat.txt` dan `data/error.log`. |
| HP tamu tidak bisa membuka galeri | Pastikan HP di WiFi yang sama, alamat IP benar, dan `add-firewall.cmd` sudah dijalankan sebagai Administrator. Cek juga client isolation di router. |
| QR mengarah ke IP lama | Jaringan/IP berubah. Buka ulang halaman sesi (QR dibuat ulang), atau isi `baseUrl` domain agar permanen. |
| Statistik menampilkan `?` | Garis merah muda di bawah kotak statistik menampilkan pesan error; klik untuk mencoba lagi. |
| Sesi tidak muncul | Cek `rootDir`, jalankan `npm run validate`, lalu **Rescan** di dashboard. |
| Halaman sesi terus **Menyiapkan sesi** | Upload belum selesai atau reserve belum diterima server. Cek koneksi, `cloud.token`, dan log `[reserve]`/`[cloud]`. Halaman mencoba otomatis; tombol **Coba lagi** muncul setelah ±2 menit. |
| Kartu pending lama tetap muncul | Reserve yatim dari sesi yang ID-nya berubah. Setelah VPS memakai versi prune, booth akan menghapusnya otomatis saat pengecekan berikutnya. Tanpa prune, entri hilang setelah 24 jam. |
| QR Event / `/e/...` 404 | Server VPS masih versi lama. Deploy update lalu `systemctl restart sessionhub`. |
| Tombol **Hapus** tidak muncul | Di VPS tombol hanya untuk superadmin. Tanpa login endpoint mengembalikan 401; admin event menerima 403. |
| Sesi online dianggap belum lengkap | `photosPerSession` di server berbeda dengan booth. Samakan nilainya lalu rescan/restart server. |
| Unggah ke VPS tidak jalan | Cek `cloud.enabled`, `cloud.url`, `cloud.token`, dan status cloud di `/api/status`. |
| Log `[cloud] reserve gagal ... fetch failed` | Koneksi booth ke VPS terputus sesaat. Reserve dicoba ulang otomatis, upload tetap dilanjutkan, dan antrean akan retry. Bila sering, cek WiFi/ISP booth dan pastikan VPS tidak restart. |
| Sesi lama terunggah ulang | Update sudah menyimpan status upload lintas rescan dan mencocokkan sesi dengan server saat start. Pastikan versi terbaru terpasang, lalu restart SessionHub. |
| Login lupa password | `npm run setpass -- admin PasswordBaru`, lalu restart server. |

## Keamanan

- Folder **`data/` tidak masuk git** — berisi hash password (`users.json`), database sesi,
  heartbeat, log, dan media server.
- `config.json` lokal juga **tidak di-commit** karena berisi token/password; template ada di
  `config.example.json`. Di VPS, config ada di `data/config.json` (permission `600`).
- Endpoint hapus sesi/foto memerlukan login operator.
- **Ganti password default** operator setelah pemasangan pertama.
- `cloud.token` / `pushToken` adalah rahasia — gunakan teks acak panjang dan **HTTPS**
  di server publik.
- Halaman tamu memang publik (agar QR berfungsi); dashboard operator selalu butuh login.

---

Lisensi: **ISC** (lihat `package.json`).
