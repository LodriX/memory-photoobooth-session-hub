# Setup Server Online dari Nol — VPS + Domain

Panduan ini membawa Anda **dari nol** sampai:

- foto dari booth **otomatis terunggah** ke server online;
- tamu **scan QR** → membuka `https://domain-anda.com/s/<id>` → melihat dan mengunduh foto/template/ZIP **dari jaringan mana pun** (tidak perlu satu WiFi dengan booth);
- server online menampilkan **dashboard operator** dan **galeri publik**.

Booth tetap bisa dipakai lokal sebagai cadangan saat internet mati. Unggahan yang
tertunda otomatis diulang begitu internet kembali.

**Perkiraan waktu:** 45–90 menit.
**Perkiraan biaya:** VPS ± Rp 50–150 rb/bulan + domain ± Rp 150–250 rb/tahun.

---

## Peta langkah

- [ ] 1. Siapkan VPS
- [ ] 2. Arahkan domain (DNS)
- [ ] 3. Upload aplikasi ke VPS
- [ ] 4. Jalankan installer
- [ ] 5. Konfigurasi server
- [ ] 6. Nyalakan & verifikasi server
- [ ] 7. Konfigurasi booth agar upload
- [ ] 8. Uji QR + download dari HP
- [ ] 9. Backup & operasional

---

## 1. Siapkan VPS

Spesifikasi minimum:

| Item | Nilai |
|---|---|
| CPU / RAM | 1 vCPU / 1 GB |
| Disk | 25 GB SSD |
| OS | **Ubuntu 24.04 LTS** (22.04 juga bisa) |
| Lokasi | Singapore / Jakarta (dekat booth) |

Contoh penyedia: DigitalOcean, Vultr, Hetzner, IDCloudHost, Rumahweb, Biznet Gio.

Setelah VPS dibuat, catat **IP publik**-nya, lalu masuk lewat SSH dari Windows
(PowerShell sudah punya `ssh`) atau PuTTY:

```bash
ssh root@IP_VPS
```

Perbarui sistem:

```bash
apt update && apt upgrade -y
```

> Kalau penyedia memberi user non-root, jalankan `sudo -i` dulu agar semua perintah
> di panduan ini bisa langsung dipakai.

---

## 2. Arahkan domain (DNS)

Di panel domain (registrar/DNS provider), buat dua record **A**:

| Tipe | Nama | Nilai | TTL |
|---|---|---|---|
| A | `@` | `IP_VPS` | Auto / 300 |
| A | `www` | `IP_VPS` | Auto / 300 |

Cek dari Windows:

```powershell
Resolve-DnsName domain-anda.com
Resolve-DnsName www.domain-anda.com
```

Keduanya harus menampilkan **IP VPS**. Tunggu 1–15 menit bila belum.

> **Penting:** HTTPS otomatis (Let's Encrypt) hanya bisa dibuat setelah domain
> mengarah ke VPS. Bila memakai Cloudflare, atur mode **DNS only** (awan abu-abu)
> saat pemasangan pertama.

---

## 3. Upload aplikasi ke VPS

### Opsi A — clone dari GitHub (paling mudah)

```bash
apt update && apt install -y git
git clone https://github.com/LodriX/memory-photoobooth-session-hub.git /opt/sessionhub
```

### Opsi B — kirim ZIP dari Windows

Di Windows (PowerShell):

```powershell
robocopy C:\dslrBooth\SessionHub C:\temp\sessionhub-deploy /MIR /XD node_modules data .git
Compress-Archive C:\temp\sessionhub-deploy\* C:\temp\sessionhub.zip -Force
scp C:\temp\sessionhub.zip root@IP_VPS:/root/
```

Di VPS:

```bash
apt install -y unzip
mkdir -p /opt/sessionhub
unzip -o /root/sessionhub.zip -d /opt/sessionhub
```

Pastikan file utama ada:

```bash
ls /opt/sessionhub/server.js /opt/sessionhub/deploy/install-ubuntu.sh
```

> Folder `data/` (sesi lokal, hash password, log) **tidak** ikut diunggah.

---

## 4. Jalankan installer

Edit domain di skrip installer:

```bash
cd /opt/sessionhub/deploy
nano install-ubuntu.sh
```

Ganti baris paling atas:

```bash
DOMAIN="photobooth.example.com"    # -> DOMAIN="domain-anda.com"
```

Simpan (`Ctrl+O`, `Enter`, `Ctrl+X`), lalu jalankan:

```bash
sudo bash install-ubuntu.sh
```

Installer memasang:

- **Node.js 22**;
- user sistem `sessionhub` + `npm install` produksi;
- folder `data/media`;
- **UFW**: hanya port 22, 80, 443 yang dibuka (port 3800 tidak diekspos);
- **Caddy**: HTTPS otomatis + redirect `www` → domain utama;
- service **systemd** `sessionhub` (auto-start saat boot, auto-restart bila mati).

> Service di-**enable** tetapi belum dijalankan — konfigurasi diisi dulu pada
> langkah berikutnya.

---

## 5. Konfigurasi server

Semua konfigurasi server disimpan di **`/opt/sessionhub/data/config.json`**
(di luar repo, tidak ikut git, permission 600).

### 5.1 Buat token rahasia

Di VPS:

```bash
openssl rand -hex 32
```

Atau di Windows (PowerShell):

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

Salin hasilnya (64 karakter). Token ini dipakai **di server dan di booth** —
simpan di password manager.

### 5.2 Edit konfigurasi

```bash
nano /opt/sessionhub/data/config.json
```

Isi lengkap yang disarankan:

```json
{
  "rootDir": "/opt/sessionhub/data/media",
  "port": 3800,

  "photosPerSession": 4,
  "singleToPrintWindowSec": 150,
  "idleGapSec": 30,
  "leftoverClusterGapSec": 300,

  "baseUrl": "https://domain-anda.com",
  "pushToken": "TOKEN_HASIL_OPENSSL_TADI",

  "auth": {
    "adminPassword": "PasswordOperatorYangKuat"
  },

  "cloud": {
    "enabled": false,
    "url": "",
    "token": "",
    "uploadIncomplete": false,
    "uploadSince": "",
    "retrySec": 60,
    "tickSec": 10
  },

  "scanDebounceMs": 800,
  "rootRescanSec": 60
}
```

Yang wajib benar:

| Kunci | Arti |
|---|---|
| `rootDir` | Folder penyimpanan media di VPS. **Wajib** `/opt/sessionhub/data/media`. |
| `baseUrl` | Alamat publik. QR dan tautan sesi akan memakai alamat ini. |
| `pushToken` | Token dari langkah 5.1. Tanpa ini, unggahan booth ditolak (403). |
| `auth.adminPassword` | Password login operator pertama kali. |
| `cloud.enabled` | **`false`** di server — hanya booth yang mengunggah. |

### 5.3 Permission

```bash
mkdir -p /opt/sessionhub/data/media
chown -R sessionhub:sessionhub /opt/sessionhub/data
chmod 600 /opt/sessionhub/data/config.json
```

### 5.4 Kalau ingin mengganti password nanti

`auth.adminPassword` hanya dipakai saat `data/users.json` **belum ada**. Setelah
server pernah berjalan, ganti password dengan:

```bash
cd /opt/sessionhub
sudo -u sessionhub npm run setpass -- admin 'PasswordBaru'
sudo systemctl restart sessionhub
```

---

## 6. Nyalakan & verifikasi server

```bash
sudo systemctl start sessionhub
sudo systemctl status sessionhub --no-pager
journalctl -u sessionhub -n 30 --no-pager
```

Log yang benar kira-kira:

```text
 Root folder : /opt/sessionhub/data/media
 Event terdeteksi: (belum ada)
 Login operator    : https://domain-anda.com/login
```

Cek dari VPS:

```bash
curl -I http://127.0.0.1:3800/login          # harus 200
curl -I https://domain-anda.com/login        # harus 200 (HTTPS Caddy)
```

Cek endpoint unggah (tanpa token harus ditolak — artinya server hidup):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://domain-anda.com/api/push
```

| Hasil | Arti |
|---|---|
| `401` | Normal — endpoint aktif, token tidak dikirim/salah. |
| `403` | `pushToken` di `config.json` masih kosong. |
| `404`/`502` | Aplikasi/Caddy belum jalan — cek `systemctl status`. |

Cek firewall dan HTTPS:

```bash
sudo ufw status verbose     # 22, 80, 443 ALLOW; 3800 TIDAK terbuka
sudo systemctl status caddy --no-pager
journalctl -u caddy -n 30 --no-pager
```

Buka di browser: **`https://domain-anda.com`** → halaman login operator
(username `admin`). Sertifikat harus terkunci (HTTPS valid).

> Bila sertifikat belum muncul, pastikan DNS sudah mengarah ke VPS; Caddy akan
> mencoba ulang otomatis. Pantau `journalctl -u caddy -f`.

---

## 7. Konfigurasi booth agar upload

Di PC booth, edit `C:\dslrBooth\SessionHub\config.json`. Cukup tambahkan/ubah:

```json
"baseUrl": "https://domain-anda.com",

"cloud": {
  "enabled": true,
  "url": "https://domain-anda.com",
  "token": "TOKEN_YANG_SAMA_DENGAN_SERVER",
  "uploadIncomplete": false,
  "uploadSince": "",
  "retrySec": 60,
  "tickSec": 10
}
```

Lalu:

1. Tutup jendela `start.cmd` yang lama, jalankan **`start.cmd`** lagi.
2. Di jendela server booth harus muncul:

   ```text
   [cloud] upload otomatis aktif -> https://domain-anda.com
   ```

3. Buka dashboard booth → status cloud aktif.

Catatan:

| Kunci | Arti |
|---|---|
| `cloud.token` | **Harus sama persis** dengan `pushToken` di server. |
| `uploadSince` | Kosong = hanya sesi **24 jam terakhir**. Isi `"2025-01-01"` untuk mengirim sesi lama. |
| `uploadIncomplete` | `false` = hanya sesi lengkap (4 foto + template) yang dikirim. |
| `retrySec` | Jeda percobaan ulang saat internet/server bermasalah. |

Booth **tetap** melayani galeri lokal (cadangan saat internet mati) — jangan
matikan server lokalnya.

---

## 8. Uji QR + download dari HP

1. Buat satu sesi baru di DSLRBooth.
2. Di dashboard booth, kartu sesi akan bertanda **☁ online** setelah terunggah.
3. Buka **`https://domain-anda.com`** di komputer lain (atau HP dengan **data
   seluler**, bukan WiFi booth) → login → event dan sesi baru muncul.
4. Buka halaman sesi / scan QR → 4 foto + template tampil.
5. Tekan **Unduh ZIP** → file terunduh dari server online.

Uji ketahanan internet (opsional):

1. Matikan internet booth.
2. Buat sesi baru — sesi tetap tersimpan lokal, antrean menunggu.
3. Nyalakan internet kembali.
4. Dalam ±1 menit sesi terkirim otomatis (tag ☁ online).

### Tentang QR

- QR dari SessionHub dibuat dari `baseUrl`. Karena `baseUrl` diisi domain, QR
  **mengarah ke server online** dan bisa discan dari mana saja.
- QR lama yang sudah tercetak saat `baseUrl` masih kosong tetap berisi IP LAN —
  cetak ulang QR dari halaman sesi.
- Halaman tamu `/s/<id>`, QR, dan unduhan bersifat **publik** (tanpa login) agar
  QR yang dicetak tetap berfungsi.

---

## 9. Backup & operasional

**Restart / cek status:**

```bash
sudo systemctl restart sessionhub
sudo systemctl status sessionhub --no-pager
journalctl -u sessionhub -f
```

**Backup** (sessions.json + seluruh media):

```bash
tar -czf /root/sessionhub-backup-$(date +%F).tar.gz -C /opt/sessionhub data
```

Simpan hasil backup di luar VPS (unduh via `scp`/WinSCP). Perkiraan kapasitas:
± 8–20 MB per sesi → 1000 sesi ≈ 8–20 GB. Pantau dengan `df -h`.

**Update aplikasi:**

```bash
cd /opt/sessionhub
sudo -u sessionhub git pull
sudo chown -R sessionhub:sessionhub /opt/sessionhub
sudo -u sessionhub npm install --omit=dev --no-audit --no-fund
sudo systemctl restart sessionhub
```

> Bila memakai metode ZIP, unggah ulang file aplikasi (kecuali `data/`) lalu
> `npm install` + restart.

**Reset indeks sesi** (media tidak dihapus, index dibangun ulang saat start):

```bash
sudo systemctl stop sessionhub
sudo rm /opt/sessionhub/data/sessions.json
sudo systemctl start sessionhub
```

**Ganti token push** (lakukan di kedua sisi):

1. Server: ubah `pushToken` di `/opt/sessionhub/data/config.json` → `sudo systemctl restart sessionhub`.
2. Booth: ubah `cloud.token` di `config.json` → restart `start.cmd`.

---

## 10. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `https://domain` belum bisa dibuka | DNS belum mengarah ke VPS. Cek `Resolve-DnsName domain-anda.com`; tunggu propagasi. |
| Sertifikat HTTPS gagal | DNS salah / Cloudflare proxy aktif. Set DNS-only, cek `journalctl -u caddy -f`. |
| `502 Bad Gateway` | Aplikasi mati. `sudo systemctl status sessionhub`, lalu `journalctl -u sessionhub -n 50`. |
| Login selalu gagal | Password berbeda dari `auth.adminPassword` (users.json sudah pernah dibuat). Jalankan `setpass` lalu restart. |
| Upload booth `HTTP 403` | `pushToken` server masih kosong. |
| Upload booth `HTTP 401` | `cloud.token` booth ≠ `pushToken` server (harus sama persis). |
| Upload `ECONNREFUSED` / `ENOTFOUND` | `cloud.url` salah, DNS belum siap, atau server mati. |
| Server online kosong padahal booth ☁ | Cek `journalctl -u sessionhub -f` saat unggahan masuk; pastikan `rootDir` benar. |
| Tamu tidak bisa buka link | Pastikan link memakai domain (bukan IP LAN), server hidup, dan port 80/443 terbuka di firewall VPS. |
| QR masih menunjuk IP LAN | `baseUrl` di booth masih kosong; isi domain lalu restart booth. |
| `ENOSPC` / disk penuh | `df -h`; hapus media lama atau tambah disk VPS. |
| Service restart terus-menerus | `journalctl -u sessionhub -n 50`; biasanya `config.json` bukan JSON valid atau `rootDir` tidak bisa diakses. |

---

## 11. Checklist akhir

- [ ] DNS `@` dan `www` mengarah ke IP VPS
- [ ] `https://domain-anda.com` terbuka dengan HTTPS valid
- [ ] Login operator `admin` berhasil
- [ ] `POST /api/push` tanpa token → `401`
- [ ] Booth menampilkan `[cloud] upload otomatis aktif -> ...`
- [ ] Sesi baru bertanda ☁ online di dashboard booth
- [ ] Sesi muncul di dashboard online
- [ ] QR discan dari HP dengan data seluler → foto tampil
- [ ] Unduh ZIP dari server online berhasil
- [ ] Backup `data/` sudah dicoba

---

## Keamanan

- `data/config.json` berisi token & password — permission `600`, jangan dibagikan.
- Gunakan password operator yang kuat (dashboard terbuka di internet).
- Jangan pernah commit token/password ke git (folder `data/` sudah di-ignore).
- Port aplikasi (3800) tidak perlu dibuka ke internet; cukup Caddy di 80/443.
- Rutin: `apt update && apt upgrade -y`, dan ganti token bila pernah terekspos.
