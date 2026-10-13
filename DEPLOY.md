# Deploy SessionHub ke VPS + Domain (online 24 jam)

Gambaran:

```
[PC Booth + DSLRBooth]                        [VPS Ubuntu + domain, online 24/7]
SessionHub lokal (monitor + QR lokal)
   └─ sesi lengkap (4 foto + print)
        └─ UPLOAD otomatis (HTTPS + token) ──►  SessionHub server
                                                 ├─ menyimpan file di /opt/sessionhub/data/media
                                                 ├─ galeri: https://domain.com/s/<id>
                                                 └─ QR mengarah ke domain online
```

Yang Anda butuhkan:

1. **VPS Ubuntu 22.04/24.04** — cukup 1 vCPU / 1 GB RAM / 25 GB disk
   (DigitalOcean, Vultr, Hetzner, Rumahweb, IDCloudHost, dll; ± Rp 50–150 rb/bln).
2. **Domain** (mis. `memoryphotobooth.com`) + A record mengarah ke IP VPS.
3. PC booth tetap menyala hanya saat event — internet boleh mati, upload otomatis
   diulang (retry) begitu kembali.

---

## Langkah 1 — Siapkan aplikasi di booth (Windows)

1. Edit `C:\dslrBooth\SessionHub\config.json`:

```json
"baseUrl": "https://memoryphotobooth.com",

"cloud": {
  "enabled": true,
  "url": "https://memoryphotobooth.com",
  "token": "GANTI-DENGAN-TEKS-RAHASIA-YANG-PANJANG",
  "uploadIncomplete": false,
  "uploadSince": "",
  "retrySec": 60,
  "tickSec": 10
}
```

Catatan:
- `baseUrl` di booth = supaya **QR yang dibuat booth** menuju website online.
- `uploadSince` kosong = hanya sesi 24 jam terakhir yang dikirim. Isi tanggal
  (mis. `"2026-01-01"`) kalau mau ikut mengirim sesi lama.
- `token` buat sendiri, misal: teks acak panjang. Simpan — akan dipasang juga di server.

2. Bungkus aplikasi untuk dikirim ke server (PowerShell):

```powershell
robocopy C:\dslrBooth\SessionHub C:\temp\sessionhub-deploy /MIR /XD node_modules data
Compress-Archive C:\temp\sessionhub-deploy\* C:\temp\sessionhub.zip -Force
```

## Langkah 2 — Upload ke VPS

Salin `sessionhub.zip` ke VPS (WinSCP / scp), lalu di VPS:

```bash
sudo apt update && sudo apt install -y unzip
sudo mkdir -p /opt/sessionhub
sudo unzip sessionhub.zip -d /opt/sessionhub
```

## Langkah 3 — Install (Node, Caddy/HTTPS, firewall, service)

Di VPS:

```bash
cd /opt/sessionhub/deploy
sudo bash install-ubuntu.sh
```

Edit dulu baris `DOMAIN="..."` di dalam `install-ubuntu.sh` (atas), atau edit
`/etc/caddy/Caddyfile` + `/etc/systemd/system/sessionhub.service` sesudahnya.

Script ini memasang: Node.js, Caddy (HTTPS gratis otomatis via Let's Encrypt),
ufw (hanya port 22/80/443), dan service `sessionhub` yang auto-restart.

## Langkah 4 — Config server

Edit `/opt/sessionhub/config.json` di VPS:

```json
{
  "rootDir": "/opt/sessionhub/data/media",
  "port": 3800,
  "baseUrl": "https://memoryphotobooth.com",
  "pushToken": "SAMA-DENGAN-TOKEN-DI-BOOTH",
  "auth": {
    "adminPassword": "PASSWORD-LOGIN-OPERATOR"
  }
}
```

Lalu:

```bash
sudo systemctl restart sessionhub
journalctl -u sessionhub -f     # lihat log
```

**Login operator:** buka `https://memoryphotobooth.com` → otomatis ke `/login`,
username `admin` + password dari `auth.adminPassword` di atas. (Kalau `auth` dikosongkan,
password acak dibuat saat pertama start dan tercetak di `journalctl -u sessionhub`;
ganti dengan `npm run setpass -- admin <passwordBaru>`.) Galeri tamu `/s/<id>` tetap
terbuka tanpa login agar QR berfungsi.

## Langkah 5 — DNS

Di panel domain, buat record:

| Tipe | Nama | Nilai |
|---|---|---|
| A | @ | IP VPS |
| A | www | IP VPS |

Tunggu beberapa menit lalu buka `https://domain-anda.com` — dashboard server
muncul dengan sertifikat HTTPS otomatis.

## Langkah 6 — Uji dari booth

1. Jalankan `start.cmd` di booth. Lihat log: baris `[cloud] upload otomatis aktif -> ...`
2. Buat satu sesi photobooth (atau tunggu sesi berikutnya).
3. Di dashboard booth, kartu sesi akan mendapat tag **☁ online**.
4. Cek `https://domain-anda.com/s/<id>` dari HP (pakai data seluler, bukan WiFi booth)
   — 4 foto + print tampil, QR bisa discan.

Uji manual endpoint push (opsional, dari mana saja):

```bash
curl -X POST https://memoryphotobooth.com/api/push -H "Authorization: Bearer TOKEN-ANDA"
# tanpa file -> harus merespons 400 (artinya endpoint aktif & token benar merespons 401 saat salah)
```

---

## Keamanan & operasional

- Token adalah satu-satunya "gerbang" push — buat acak & jangan bagikan.
- Server hanya membuka port 80/443; app (3800) tetap lokal di VPS.
- Backup: cukup cadangkan `/opt/sessionhub/data` (sessions.json + media).
- Kapasitas: ± 8 MB per sesi. 1000 sesi ≈ 8 GB — tambah disk / pindah media ke
  object storage bila perlu.
- Reset sesi server: hapus `/opt/sessionhub/data/sessions.json` lalu restart
  (media tidak hilang; rescan membangun ulang index dari file).

## Troubleshooting

| Gejala | Solusi |
|---|---|
| `[cloud] gagal kirim ... ECONNREFUSED/CERT` | Cek `cloud.url`, DNS, dan HTTPS di server |
| `[cloud] gagal kirim ... HTTP 401` | Token booth ≠ `pushToken` server |
| Tamu tidak bisa buka link | Cek firewall VPS (80/443) & record DNS |
| Server kosong padahal booth sudah ☁ online | `journalctl -u sessionhub -f` saat push tiba |
| HTTPS belum muncul | Pastikan DNS sudah resolve ke IP VPS sebelum install Caddy |
