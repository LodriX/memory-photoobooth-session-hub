# Agent Handover — Memory Photobooth SessionHub

> **For Your Precious Memories**
>
> Dokumen ini adalah titik masuk untuk agent atau operator berikutnya.
> Baca `README.md` untuk fitur dan `DEPLOY.md` untuk pemasangan VPS.
>
> **Snapshot terakhir:** 24 Oktober 2026, commit `0986900` (branch `Main`).
> Status di bawah adalah kondisi saat serah terima; **selalu verifikasi ulang**
> sebelum mengubah produksi.

---

## 1. Ringkasan proyek

SessionHub adalah aplikasi Node.js yang memantau hasil **DSLRBooth**, menggabungkan
foto menjadi sesi, membuat QR, dan menyajikan galeri tamu. Satu kode dipakai untuk
dua peran:

| Peran | Lokasi | Tugas |
|---|---|---|
| **Booth** | PC photobooth Windows, `C:\dslrBooth\SessionHub` | Scan folder, galeri lokal, reserve + upload ke VPS, retry saat internet putus |
| **Server** | VPS Ubuntu, `/opt/sessionhub` | Menerima upload, menyimpan media, galeri publik, admin, QR |
| **Publik** | `https://foto.memorystudio.id` | Halaman sesi/event untuk tamu dari jaringan mana pun |

Alur utama:

1. DSLRBooth menulis foto ke `Singles/` dan print ke `Prints/`.
2. Scanner lokal mengelompokkan foto + print menjadi satu sesi.
3. Booth mengirim **reserve** ke server supaya QR dan halaman loading langsung aktif.
4. File sesi diunggah lewat `POST /api/push`.
5. Server menyimpan file, scanner server mengindeks, galeri berubah dari
   *pending* menjadi *ready*.
6. Tamu membuka `/s/<id>` atau `/e/<event>`; admin dapat menghapus sesi/foto
   setelah login.

---

## 2. Status saat serah terima

### Lokal (booth)

- Server berjalan di port **3800**, dijalankan lewat `start.cmd`.
- `cloud.enabled: true`, `concurrency: 3`.
- Antrean upload: **0**, `lastError: null`.
- Sesi event terakhir: **133/133 sudah ditandai terupload**.
- Tidak ada error di `data/error.log`.
- Seluruh perubahan terbaru sudah aktif setelah restart pukul 22:35 lokal.

### Server online

- Domain: `https://foto.memorystudio.id`.
- Fitur server yang dipakai sudah terverifikasi:
  - `POST /api/push/reserve` tanpa token → **401** (bukan 404).
  - `/e/<event>` → **200**.
  - QR event → **200**.
- Event terakhir: **133 sesi ready** di server, cocok dengan 133 sesi lokal.
- Tidak ada ID duplikat.
- Masih ada **24 kartu pending lama** di server yang tidak punya file lokal.
  Ini **bukan duplikat**; akan kedaluwarsa otomatis dalam 24 jam.

> `cloud.uploaded` di `/api/status` adalah penghitung sejak server lokal restart.
> Jumlah sebenarnya ada di `data/sessions.json` pada `cloud.uploadedAt` per sesi.

### Commit terbaru

| Commit | Isi |
|---|---|
| `11eea3d` | Anti-duplikat: pertahankan status upload saat rescan + rekonsiliasi dengan server |
| `0986900` | Upload paralel, keep-alive, reserve tidak memblokir upload, skip sesi tanpa file |

Keduanya sudah di-push ke `Main`:

`https://github.com/LodriX/memory-photoobooth-session-hub`

**VPS tidak wajib di-update untuk dua commit tersebut** karena keduanya hanya
mengubah perilaku booth. Update VPS hanya diperlukan jika ada perubahan
`server.js`, route API, atau file `public/` yang ingin dipakai publik.

---

## 3. Arsitektur upload dan anti-duplikat

### Reserve lebih dulu

- Booth memanggil `POST /api/push/reserve` dengan metadata sesi.
- Server menyimpan entri pending selama kurang lebih 24 jam.
- QR sesi dan event sudah bisa dibuka sebelum file tiba.
- Halaman tamu menampilkan loading dan melakukan polling sampai sesi ready.

### Upload file

- `POST /api/push` memakai multipart dan token `Bearer`.
- Satu sesi biasanya berisi:
  - 2 foto (`photosPerSession: 2`),
  - 1 print/template.
- Server menulis file ke folder event di `data/media/`.
- Scanner server kemudian mengindeks sesi.

### Anti-duplikat

Ada dua lapis perlindungan:

1. **`lib/store.js`**
   - Status `cloud` dipertahankan saat folder di-rescan.
   - `uploadedAt` hanya di-reset bila path media berubah atau sesi berubah
     dari belum lengkap menjadi lengkap.
2. **`lib/cloud-sync.js`**
   - Saat mulai, booth membaca `/api/events/<event>`.
   - Sesi yang sudah ada dan ready di server ditandai sudah terupload.
   - Hanya sesi yang belum ada yang masuk antrean.

Jangan mengubah salah satu lapis ini tanpa menguji skenario rescan dan restart.

### Optimasi kecepatan

- Koneksi HTTPS dipakai ulang (keep-alive).
- Reserve berjalan bersamaan dengan upload.
- `cloud.concurrency` default **3** (batas 1–4).
- Upload yang gagal karena koneksi dicoba ulang; timeout tidak langsung diulang.
- Sesi tanpa file tidak lagi masuk antrean.

Batas fisik: jalur booth → VPS saat ini sekitar **0,9–1 MB/detik**. Upload paralel
tidak dapat melewati kapasitas uplink. Tanpa kompresi atau upgrade jaringan,
optimasi hanya mengurangi overhead dan waktu tunggu.

---

## 4. Akses dan konfigurasi

### Lokal

| Item | Nilai |
|---|---|
| Folder aplikasi | `C:\dslrBooth\SessionHub` |
| Root media DSLRBooth | `C:\dslrBooth` |
| Dashboard | `http://localhost:3800/login` |
| Username admin | `admin` |
| Password admin | **tidak disimpan di repo**; lihat pemilik / reset bila perlu |
| Config aktif | `C:\dslrBooth\SessionHub\config.json` (tidak masuk git) |
| Database sesi | `data/sessions.json` |
| Pending lokal | `data/pending.json` |
| Log error | `data/error.log` |

Nilai penting di config lokal:

```json
{
  "rootDir": "C:\\dslrBooth",
  "port": 3800,
  "photosPerSession": 2,
  "baseUrl": "https://foto.memorystudio.id",
  "cloud": {
    "enabled": true,
    "url": "https://foto.memorystudio.id",
    "uploadIncomplete": false,
    "retrySec": 60,
    "tickSec": 10,
    "concurrency": 3
  }
}
```

Jangan commit `config.json`; token dan pengaturan lokal ada di sana.

### VPS

| Item | Nilai |
|---|---|
| Folder aplikasi | `/opt/sessionhub` |
| Config aktif | `/opt/sessionhub/data/config.json` (permission `600`) |
| Root media | `/opt/sessionhub/data/media` |
| Service | `sessionhub` |
| Web server | Caddy |
| Domain | `https://foto.memorystudio.id` |

Yang harus cocok antara booth dan VPS:

- `cloud.token` di booth **=** `pushToken` di VPS.
- `photosPerSession` di booth **=** `photosPerSession` di VPS.
- `baseUrl` di kedua sisi adalah domain publik.

Password admin VPS **terpisah** dari admin lokal. Jangan mengasumsikan password
yang sama; reset lewat perintah di server bila perlu.

---

## 5. File penting

| File | Fungsi |
|---|---|
| `server.js` | Express: dashboard, API publik/operator, push, QR, ZIP, hapus |
| `lib/scanner.js` | Memantau `Singles/` dan `Prints/`, membentuk sesi |
| `lib/store.js` | Menyimpan sesi; **mempertahankan metadata cloud** |
| `lib/cloud-sync.js` | Reserve, upload, retry, rekonsiliasi anti-duplikat |
| `lib/pending.js` | Entri pending sebelum file tiba; expiry 24 jam |
| `lib/auth.js` | Hash password scrypt + sesi login |
| `lib/qr.js` | Pembuatan QR sesi/event |
| `public/session.js` | Halaman tamu, loading, polling, hapus admin, kolase |
| `public/event.js` | Galeri event + polling sesi pending |
| `public/app.js` | Dashboard operator dan status upload |
| `scripts/validate.js` | Validasi konfigurasi dan path |
| `scripts/setpass.js` | Reset password operator |
| `start.cmd` | Supervisor/watchdog Windows |
| `DEPLOY.md` | Panduan VPS dari nol |
| `README.md` | Dokumentasi fitur dan pemakaian |
| `agent.md` | Dokumen handover ini |

---

## 6. Menjalankan dan memeriksa lokal

```powershell
cd C:\dslrBooth\SessionHub
start.cmd
```

`start.cmd` menjalankan watchdog; jika proses Node mati, server akan dihidupkan
ulang otomatis. Jangan menutup jendela supervisor saat event berlangsung.

Pemeriksaan dasar:

```powershell
node --check server.js
node --check lib\cloud-sync.js
node scripts\validate.js
```

Buka `http://localhost:3800/login`, lalu cek:

- daftar event,
- jumlah sesi siap/belum lengkap,
- status cloud (`pending`, `lastError`),
- tombol **Rescan** bila ada file baru yang belum terindeks.

Untuk melihat status mentah, gunakan dashboard atau panggil `/api/status`
setelah login. Jangan menaruh password admin di skrip yang di-commit.

---

## 7. Update dan deploy VPS

Update hanya jika memang ada perubahan server. Untuk commit `11eea3d` dan
`0986900`, langkah ini **opsional**.

```bash
cd /opt/sessionhub
git status --short
git pull
sudo systemctl restart sessionhub
sudo systemctl status sessionhub --no-pager
sudo journalctl -u sessionhub -n 50 --no-pager
```

Tidak ada dependency baru pada dua commit terakhir, jadi `npm install` tidak
diperlukan. Jika `package.json` berubah, jalankan instalasi sesuai `DEPLOY.md`.

Jangan mengubah `data/config.json` hanya untuk menambah `cloud.concurrency`;
itu pengaturan booth, bukan server.

---

## 8. Verifikasi setelah perubahan

### Cek server publik

```bash
# Harus 401/403, bukan 404
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://foto.memorystudio.id/api/push/reserve

# Halaman event harus 200 (URL-encode nama event)
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://foto.memorystudio.id/e/Nama%20Event'
```

### Cek data event

Buka:

```text
https://foto.memorystudio.id/api/events/<event>
```

Periksa:

- `items` berisi sesi ready dan pending,
- jumlah `id` unik = jumlah item (tidak ada duplikat),
- sesi lokal yang sudah `cloud.uploadedAt` juga ready di server.

### Cek alur tamu

1. Sesi baru selesai di booth.
2. Buka `/s/<id>` **sebelum** upload selesai: harus tampil loading.
3. Setelah upload: foto dan template muncul otomatis.
4. Buka `/e/<event>`: kartu pending berubah menjadi ready.
5. Scan QR sesi dan QR event dari HP.

### Cek admin

- Tanpa login: tombol hapus tidak muncul; `DELETE` mengembalikan 401.
- Setelah login: hapus sesi/foto berfungsi.
- Jangan menguji hapus pada sesi tamu yang masih dibutuhkan.

---

## 9. Troubleshooting

| Gejala | Penyebab / tindakan |
|---|---|
| `[cloud] reserve gagal ... fetch failed` | Gangguan koneksi sesaat. Reserve diulang, upload tetap lanjut. Cek WiFi/ISP booth dan pastikan VPS hidup. Log kini menyertakan `cause` koneksi. |
| Upload antre terus | Cek `cloud.enabled`, `url`, `token`, dan `lastError` di dashboard. Pastikan file sesi masih ada. |
| Sesi lama terunggah ulang | Pastikan `lib/store.js` versi terbaru dan restart booth. Cek rekonsiliasi `/api/events/<event>`. |
| `tidak ada file untuk dikirim` | Sesi sudah tidak punya file; versi terbaru membuang entri ini dari antrean. Jangan hapus data valid. |
| `/e/<event>` 404 | VPS masih versi lama. Pull dan restart `sessionhub`. |
| Sesi online dianggap belum lengkap | `photosPerSession` VPS berbeda dengan booth. Samakan, lalu rescan/restart. |
| QR mengarah ke alamat lama | Isi `baseUrl` dengan domain permanen; buka ulang halaman agar QR dibuat ulang. |
| Halaman tamu terus loading | File belum tiba atau reserve gagal. Cek status cloud dan log server. |
| Kartu pending lama di event | Sisa reserve tanpa file lokal. Bukan duplikat; hilang otomatis setelah 24 jam. |
| Login admin lupa | Lokal: `npm run setpass -- admin PasswordBaru`, lalu restart. VPS: jalankan perintah yang sama di `/opt/sessionhub`, lalu restart service. |
| Server lokal tidak merespons | Tunggu watchdog ±15 detik; cek `data/heartbeat.txt` dan `data/error.log`. Hindari restart saat upload aktif. |

---

## 10. Hal yang diketahui / risiko

1. **24 pending lama di server** tidak punya file lokal. Biarkan kedaluwarsa
   atau buat mekanisme pembersihan khusus; jangan menganggapnya sesi valid.
2. **Kecepatan upload** dibatasi uplink ±1 MB/detik. Jangan menjanjikan
   percepatan besar tanpa kompresi/upgrade jaringan.
3. **VPS bisa tertinggal commit** dari booth. Selalu cek `git log` dan
   `git status` sebelum melakukan perubahan server.
4. **Tidak ada test suite otomatis** yang lengkap. `scripts/validate.js` hanya
   memvalidasi konfigurasi/path. Uji alur reserve → upload → event → hapus
   secara manual setelah perubahan besar.
5. **Data dan config tidak masuk git**. Backup `data/` dan `config.json`
   sebelum perubahan berisiko.
6. **Kapasitas disk**: event 133 sesi ≈ 730 MB. Pantau ruang disk VPS dan lokal.
7. **Password admin VPS berbeda** dari lokal. Jangan mencoba password lokal
   di server publik.

---

## 11. Checklist handover

- [ ] `git status` bersih dan `Main` sudah di-push.
- [ ] `config.json` lokal berisi `rootDir`, `baseUrl`, token, dan `concurrency`
      yang benar.
- [ ] `data/config.json` VPS berisi `pushToken` dan `photosPerSession` yang
      cocok dengan booth.
- [ ] Backup `data/` lokal dan VPS.
- [ ] Status lokal `cloud.pending = 0` dan tidak ada `lastError`.
- [ ] `/api/push/reserve` tanpa token mengembalikan 401, bukan 404.
- [ ] `/e/<event>` dan QR event mengembalikan 200.
- [ ] Sesi lokal yang sudah terupload juga ready di server.
- [ ] Uji satu sesi baru: QR loading → foto muncul → event ready.
- [ ] Uji tombol hapus: hanya admin yang bisa.
- [ ] Uji tampilan HP (galeri, QR, unduh, kolase).
- [ ] Catat perubahan baru di `README.md` dan `agent.md`.

---

## 12. Aturan kerja untuk agent berikutnya

1. **Baca dulu** `agent.md`, `README.md`, dan `DEPLOY.md` sebelum mengubah kode.
2. **Jangan commit** `config.json`, `data/`, token, password, atau file media.
3. **Jangan menekan tombol restart** saat antrean upload aktif. Cek
   `cloud.pending` sampai 0; kalau perlu, hentikan upload dengan hati-hati.
4. **Jangan menghapus sesi/foto** di luar alur admin yang sah.
5. **Jangan mengubah `photosPerSession`** di satu sisi saja.
6. **Jangan mengompres atau mengubah resolusi** foto tanpa persetujuan pemilik.
7. **Pertahankan metadata `cloud`** di `lib/store.js`; ini inti anti-duplikat.
8. **Uji dengan mock server lokal** untuk perubahan antrean/upload sebelum
   menyentuh server produksi.
9. **Commit dengan pesan jelas** dan push ke `Main` setelah verifikasi.
10. **Perbarui dokumentasi** jika perilaku, konfigurasi, atau alur berubah.
11. **Jangan mengekspos URL privat atau data tamu** di commit/dokumentasi.
12. **Gunakan Bahasa Indonesia** untuk teks UI dan dokumentasi yang ada.

---

## 13. Perintah cepat

```powershell
# Lokal
cd C:\dslrBooth\SessionHub
start.cmd

# Cek sintaks + validasi
node --check server.js
node --check lib\cloud-sync.js
node scripts\validate.js

# Git
git status --short
git log -3 --oneline
git pull
```

```bash
# VPS
cd /opt/sessionhub
git status --short
git pull
sudo systemctl restart sessionhub
sudo systemctl status sessionhub --no-pager
sudo journalctl -u sessionhub -n 50 --no-pager
```

---

## 14. Referensi

- Fitur dan pemakaian: [`README.md`](README.md)
- Pemasangan VPS dari nol: [`DEPLOY.md`](DEPLOY.md)
- Repository: `https://github.com/LodriX/memory-photoobooth-session-hub`
- Domain publik: `https://foto.memorystudio.id`

Jika status di dokumen ini berbeda dengan kondisi live, **percayai kondisi live**
dan perbarui dokumen setelah verifikasi.
