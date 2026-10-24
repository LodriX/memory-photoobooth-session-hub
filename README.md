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
- [Hapus sesi / foto (khusus admin)](#hapus-sesi--foto-khusus-admin)
- [Cara pengelompokan sesi](#cara-pengelompokan-sesi)
- [Konfigurasi](#konfigurasi)
- [Unggah otomatis ke VPS + domain](#unggah-otomatis-ke-vps--domain)
- [Ganti jaringan / pindah WiFi](#ganti-jaringan--pindah-wifi)
- [URL penting](#url-penting)
- [Restart & perawatan](#restart--perawatan)
- [Struktur proyek](#struktur-proyek)
- [Troubleshooting](#troubleshooting)
- [Keamanan](#keamanan)

---

## Fitur

- **Deteksi otomatis** foto baru di `Singles/` dan print di `Prints/` (termasuk `Prints/Qr/`). Aplikasi hanya *membaca* folder DSLRBooth.
- **Pengelompokan sesi**: sejumlah foto (default 4, diatur lewat `photosPerSession`) + 1 template.
- **Galeri tamu + QR** per sesi. QR dibuat saat halaman dibuka, jadi selalu mengikuti alamat server terkini.
- **QR langsung aktif**: begitu sesi selesai, booth memesan (reserve) sesi ke server. Tamu bisa scan QR sebelum file selesai diunggah; halaman menampilkan status loading dan terisi otomatis.
- **Galeri event + QR utama**: satu QR untuk semua sesi dalam event (`/e/<event>`), termasuk sesi yang masih diunggah. Tombol **QR Event** tersedia di dashboard.
- **Hapus sesi/foto (khusus admin)**: tombol hapus hanya muncul setelah login; endpoint `DELETE` wajib autentikasi.
- **Unduh** per foto, template, **ZIP satu sesi**, dan **kolase PNG** (foto + QR; tata letak menyesuaikan jumlah foto, tanpa sel kosong).
- **Dashboard operator**: login, pilih event, statistik per event, kartu sesi *live* (SSE), rescan, status unggah.
- **Statistik per event**: total sesi, siap/lengkap, belum lengkap, terunggah.
- **Unggah otomatis ke VPS** dengan antrean + retry — internet putus tidak masalah, unggahan dilanjutkan saat kembali.
- **Anti-duplikat**: status upload disimpan lintas rescan; sebelum backfill, booth mencocokkan daftar sesi dengan `/api/events/<event>` sehingga sesi yang sudah ada di server tidak dikirim ulang.
- **Tema soft romantic**, responsif di HP, iPad mini, dan desktop.
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

## Hapus sesi / foto (khusus admin)

- Login sebagai operator, lalu buka dashboard atau halaman sesi.
- Tombol **Hapus** hanya muncul saat login; endpoint `DELETE` juga menolak request tanpa sesi login (401).
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
| `scanDebounceMs` | `800` | Debounce scan saat ada file baru. |
| `rootRescanSec` | `60` | Rescan penuh berkala. |

> Samakan `photosPerSession` di booth dan server. Kalau booth memakai 2 foto,
> server juga harus 2; kalau tidak, sesi akan tampil "belum lengkap" di server.

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
     "tickSec": 10
   }
   ```

2. Di **server**, isi `pushToken` dengan token yang sama dan `baseUrl` domain.
   Konfigurasi server disimpan di **`/opt/sessionhub/data/config.json`**
   (di luar repo, permission `600`). Nilai `photosPerSession` harus sama dengan booth.
3. Ikuti panduan lengkap dari nol di **[DEPLOY.md](DEPLOY.md)** (VPS, DNS,
   Node, Caddy/HTTPS, firewall, systemd auto-restart).

Setelah aktif: sesi lengkap diunggah otomatis; bila internet putus, sesi tetap
tersimpan lokal dan diunggah ulang saat koneksi kembali. QR yang dibuat booth
langsung mengarah ke domain publik.

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
| `DELETE /api/sessions/<id>` | operator | Hapus sesi + semua file. |
| `DELETE /api/sessions/<id>/file?p=...` | operator | Hapus satu file/foto sesi. |
| `/api/push/reserve` | server (Bearer token) | Booth memesan sesi agar QR langsung aktif. |
| `/api/push` | server (Bearer token) | Menerima unggahan sesi dari booth. |

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
├─ scripts/            # validate.js, setpass.js
├─ deploy/             # Caddyfile, systemd service, install-ubuntu.sh
└─ data/               # sessions, pending, users, log, media (tidak masuk git)
```

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `localhost:3800` tidak terbuka | Tunggu ±15 detik (watchdog). Bila tetap, tutup lalu jalankan `start.cmd` lagi; cek `data/heartbeat.txt` dan `data/error.log`. |
| HP tamu tidak bisa membuka galeri | Pastikan HP di WiFi yang sama, alamat IP benar, dan `add-firewall.cmd` sudah dijalankan sebagai Administrator. Cek juga client isolation di router. |
| QR mengarah ke IP lama | Jaringan/IP berubah. Buka ulang halaman sesi (QR dibuat ulang), atau isi `baseUrl` domain agar permanen. |
| Statistik menampilkan `?` | Garis merah muda di bawah kotak statistik menampilkan pesan error; klik untuk mencoba lagi. |
| Sesi tidak muncul | Cek `rootDir`, jalankan `npm run validate`, lalu **Rescan** di dashboard. |
| Halaman sesi terus **Menyiapkan sesi** | Upload belum selesai atau reserve belum diterima server. Cek koneksi, `cloud.token`, dan log `[reserve]`/`[cloud]`. Halaman mencoba otomatis; tombol **Coba lagi** muncul setelah ±2 menit. |
| QR Event / `/e/...` 404 | Server VPS masih versi lama. Deploy update lalu `systemctl restart sessionhub`. |
| Tombol **Hapus** tidak muncul | Anda belum login sebagai operator. Hapus memang khusus admin; endpoint mengembalikan 401 tanpa login. |
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
