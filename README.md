# SessionHub — Upload & Gabung Sesi DSLRBooth Otomatis

Aplikasi web (Node.js) yang memantau folder output DSLRBooth:

- Setiap foto baru (**Singles**) dan print baru (**Prints**) terdeteksi otomatis.
- Foto digabung per sesi: **4 foto + 1 print** (atur di `config.json`).
- Tiap sesi langsung punya **halaman web** + **QR code otomatis** yang mengarah ke halaman tersebut.
- Tamu scan QR → lihat 4 foto + print sesi mereka → bisa unduh.
- Bonus: tombol **kolase** (4 foto + QR) diunduh sebagai 1 gambar PNG.

> Aplikasi ini **hanya membaca** folder DSLRBooth. Semua data aplikasi disimpan di
> `C:\dslrBooth\SessionHub\data\sessions.json`.

---

## Cara pakai (booth)

1. Pastikan **Node.js LTS** terpasang (cek: `node -v`). Kalau belum: https://nodejs.org
2. Klik dua kali **`start.cmd`** (pertama kali otomatis `npm install`).
3. Buka browser:
   - Di komputer booth: `http://localhost:3800`
   - Di HP (satu WiFi): `http://<IP-booth>:3800` (tertampil di tombol 🔗 di dashboard)
4. Jalankan DSLRBooth seperti biasa. Sesi baru muncul sendiri di dashboard (LIVE).

Agar HP/tamu bisa akses, jalankan **`add-firewall.cmd` sekali dengan klik kanan → Run as administrator**.

---

## Login operator

Dashboard dilindungi login. Alur pemakaian saat event:

1. Operator buka `http://localhost:3800` → dialihkan ke **`/login`**.
2. Masuk dengan akun operator → dashboard terbuka.
3. **Pilih event** lewat chips (pilihan diingat di browser). Statistik (total sesi,
   siap, belum lengkap, terunggah) menyesuaikan event terpilih.
4. Kartu sesi dipakai untuk membuka galeri, menampilkan QR, dan mengunduh ZIP/file
   bagi pengunjung.

**Akun:** username `admin`. Password dibuat otomatis saat pertama kali start
(tercetak di jendela konsol), atau atur sendiri di `config.json` → `auth.adminPassword`
sebelum start. Ganti kapan saja:

```
npm run setpass -- admin passwordBaru
```

Halaman galeri tamu (`/s/<id>` + QR + unduhan) **tetap terbuka tanpa login** —
login hanya untuk dashboard operator. Sesi login berlaku12 jam (cookie HttpOnly),
percobaan gagal dibatasi anti brute-force.

---

## Cek saat restart perangkat

Aplikasi ini dipakai dalam **dua entitas** (software sama, beda peran):

| | **1. Perangkat booth (Windows)** | **2. Server (VPS Ubuntu, lihat DEPLOY.md)** |
|---|---|---|
| Peran | Pantau DSLRBooth, kelompokkan sesi, dashboard login, QR, **unggah file ke server** | Terima upload (`/api/push`), sajikan halaman publik `/s/<id>` + login di domain |
| Saat restart | **Klik `start.cmd` saja**, biarkan jendelanya terbuka | **Otomatis** (systemd `sessionhub` + Caddy) |
| Siapa mengakses | Operator (login `admin`) | Tamu via QR (tanpa login) + operator (login) |
| Cek cepat | Buka `http://localhost:3800/login` → statistik terisi | `systemctl status sessionhub` → active (running) |

**Setup sekali saja (bukan tiap restart):**

- **Booth — firewall (WAJIB; cek dulu, bisa jadi belum pernah dijalankan):**
  klik kanan `add-firewall.cmd` → **Run as administrator**. Tanpa ini HP tamu
  tidak bisa membuka `http://<IP-booth>:3800`.
- **Booth — auto-start (opsional):** `Win+R` → `shell:startup` → buat shortcut ke `start.cmd`,
  maka aplikasi jalan otomatis setiap login Windows.
- **Booth — koneksi online (saat VPS sudah siap):** isi `cloud.enabled`, `cloud.url`,
  `cloud.token`, dan `baseUrl` di `config.json`.
- **Server:** sekali jalan ikuti [DEPLOY.md](DEPLOY.md); selebihnya otomatis.

---

## Cara kerja pengelompokan (grouping)

- Nama file DSLRBooth memuat timestamp, contoh:
  - `Singles\IMG_3551_20261011_122028_3600.JPG` → foto jam 12:20:28
  - `Prints\20261011_122033_341.jpg` → print jam 12:20:33 (varian `_1x` / `_2x` disatukan)
- Saat file print muncul, aplikasi mengambil **4 foto terakhir sebelum print**
  (rentang maksimal `singleToPrintWindowSec`, default 150 detik) sebagai satu sesi.
- ID sesi = timestamp print, mis. `20261011_122033_341`.
- Foto yang tidak menemukan print (mis. print dimatikan / uji coba) tampil sebagai sesi
  **"tanpa print"** di dashboard, tetap bisa dibuka & di-QR-kan.
- Jika ada `Prints\Qr\...jpg` dari DSLRBooth, file itu ikut ditampilkan sebagai "Print QR (DSLRBooth)".

Semua bisa diubah di `config.json`:

| Key | Arti | Default |
|---|---|---|
| `rootDir` | Folder root DSLRBooth | `C:\dslrBooth` |
| `port` | Port web | `3800` |
| `photosPerSession` | Jumlah foto per sesi | `4` |
| `singleToPrintWindowSec` | Rentang foto→print | `150` |
| `idleGapSec` | Tunggu sebelum anggap sesi selesai | `30` |
| `leftoverClusterGapSec` | Jeda agar foto liar dianggap sesi terpisah | `300` |
| `baseUrl` | Link QR publik (opsional, mis. `https://domain.com`) | kosong = IP lokal |

### Cek grouping tanpa menyimpan (dry-run)

```
npm run validate
```

Menampilkan statistik per event: jumlah sesi, distribusi "4 foto + 1 print", "3 foto + 2 print", dst.

---

## Upload otomatis ke server (online)

Sesi bisa otomatis dikirim dari booth ke **VPS + domain** sehingga tamu mengakses
galeri lewat internet (`https://domain-anda.com/s/<id>`), bukan hanya WiFi lokal.
Fitur ini sudah built-in:

- Server: endpoint `POST /api/push` (dilindungi `pushToken`).
- Booth: modul `lib/cloud-sync.js` — sesi lengkap langsung dikirim; kalau internet
  putus, otomatis diulang dengan backoff. Status penerimaan muncul sebagai tag **☁ online**.
- Isi `cloud` + `baseUrl` di `config.json` (lihat contoh di `config.json`).

Langkah deploy Ubuntu + Caddy (HTTPS otomatis) + DNS: ikuti **[DEPLOY.md](DEPLOY.md)**.

## URL penting

| URL | Fungsi | Login |
|---|---|---|
| `/login` | Halaman login operator | publik |
| `/` | Dashboard live (pilih event, statistik) | wajib |
| `/s/<id>` | Halaman galeri satu sesi (target QR) | publik |
| `/s/<id>/qr.png?size=1024` | QR PNG (ukuran bisa diubah) | publik |
| `/api/sessions` | JSON daftar sesi | wajib |
| `/api/sessions/<id>` | JSON satu sesi | publik |
| `/api/sessions/<id>/zip` | Unduh seluruh sesi (foto+template+QR) | publik |
| `/api/stats?event=` | Statistik menyesuaikan event | wajib |
| `/api/status` | Status watcher & statistik | wajib |
| `POST /api/rescan` | Paksa scan ulang | wajib |
| `POST /api/login` / `/api/logout` | Masuk / keluar | publik |

---

## Menjalankan otomatis saat Windows login (opsional)

Buat task di Task Scheduler:
- Program: `C:\dslrBooth\SessionHub\start.cmd`
- Trigger: **At log on**

Atau via PowerShell (Run as admin):

```powershell
schtasks /create /tn "SessionHub" /tr "C:\dslrBooth\SessionHub\start.cmd" /sc onlogon /f
```

---

## Rencana lanjutan (bila diperlukan)

- ~~**Upload ke website publik/cloud**~~ — sudah ada, lihat [DEPLOY.md](DEPLOY.md).
- **QR tercetak otomatis di template** DSLRBooth (pakai folder `Prints\Qr` atau
  QR dinamis di template DSLRBooth).
- Galeri multi-event dengan filter tamu, kode akses, atau auto-delete setelah X hari.
- Kompresi foto sebelum upload (hemat bandwidth) & pindah media ke object storage
  bila volume besar.
