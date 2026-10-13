#!/usr/bin/env bash
# SessionHub — installer untuk VPS Ubuntu (22.04 / 24.04)
# Jalankan sebagai root, mis.:  sudo bash install-ubuntu.sh
set -euo pipefail

# ==== atur di sini ====
DOMAIN="photobooth.example.com"   # <<< GANTI dengan domain Anda
APP_DIR="/opt/sessionhub"
APP_USER="sessionhub"
PORT="3800"
# ======================

echo "== 1/5 Node.js =="
if ! command -v node >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 2/5 User & aplikasi =="
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
if [ ! -f "$APP_DIR/server.js" ]; then
  echo "ERROR: $APP_DIR/server.js belum ada."
  echo "Upload dulu isi folder SessionHub (tanpa node_modules) ke $APP_DIR, misal via WinSCP/scp."
  exit 1
fi
cd "$APP_DIR"
mkdir -p data
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

echo "== 3/5 Firewall =="
apt-get install -y ufw >/dev/null 2>&1 || true
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80,443/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

echo "== 4/5 Caddy (HTTPS otomatis) =="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y >/dev/null
  apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:$PORT
    request_body {
        max_size 200MB
    }
}
EOF

echo "== 5/5 systemd =="
cat > /etc/systemd/system/sessionhub.service <<EOF
[Unit]
Description=SessionHub - DSLRBooth session uploader
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=on-fallback
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable sessionhub
systemctl restart sessionhub
systemctl restart caddy

echo
echo "Selesai."
echo " - App    : http://127.0.0.1:$PORT"
echo " - Online : https://$DOMAIN  (HTTPS aktif otomatis setelah DNS mengarah ke IP VPS)"
echo " - Log    : journalctl -u sessionhub -f"
echo
echo "Jangan lupa isi config.json di $APP_DIR:"
echo "   rootDir    = $APP_DIR/data/media"
echo "   baseUrl    = https://$DOMAIN"
echo "   pushToken  = (token rahasia, sama dengan cloud.token di booth)"
