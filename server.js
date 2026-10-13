'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { loadConfig } = require('./lib/config');
const { Store } = require('./lib/store');
const { Scanner } = require('./lib/scanner');
const { CloudSync } = require('./lib/cloud-sync');
const { qrBuffer } = require('./lib/qr');
const { lanAddress, isLocalHost } = require('./lib/net');
const { Auth } = require('./lib/auth');

const cfg = loadConfig();
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_MEDIA_RE = /\.(jpe?g|png|webp|gif|mp4|mov|m4v)$/i;
const BLOCKED_RE = /[\\/](Settings|Templates|SessionHub)([\\/]|$)/i;

const DATA_DIR = process.env.SESSIONHUB_DATA || path.join(__dirname, 'data');
const store = new Store(path.join(DATA_DIR, 'sessions.json'));
store.load();

const scanner = new Scanner(cfg, store);
const cloudSync = new CloudSync(cfg, store);
const auth = new Auth(DATA_DIR, (cfg.auth && cfg.auth.adminPassword) || '');
const bus = new EventEmitter();
bus.setMaxListeners(0);

const app = express();
app.disable('x-powered-by');

// cegah browser memakai aset lama (html/js/css) setelah aplikasi diperbarui
app.use((req, res, next) => {
  if (req.method === 'GET' &&
      (req.path === '/' || req.path === '/login' || /\.(html|js|css)$/.test(req.path))) {
    res.set('Cache-Control', 'no-store, must-revalidate');
  }
  next();
});

function lanUrl() {
  const host = cfg.baseUrl ? cfg.baseUrl.replace(/\/+$/, '') : null;
  if (host) return host;
  return 'http://' + lanAddress() + ':' + cfg.port;
}

function baseUrlFor(req) {
  if (cfg.baseUrl) return String(cfg.baseUrl).replace(/\/+$/, '');
  const host = req.get('host');
  if (isLocalHost(host)) return 'http://' + lanAddress() + ':' + cfg.port;
  return (req.protocol || 'http') + '://' + host;
}

function sessionUrl(req, id) {
  return baseUrlFor(req) + '/s/' + encodeURIComponent(id);
}

function publicSession(req, s) {
  return {
    ...s,
    url: sessionUrl(req, s.id),
    qr: sessionUrl(req, s.id) + '/qr.png'
  };
}

// ---------- Login ----------

const COOKIE = 'mp_auth';
const loginFails = new Map(); // ip -> { count, until }

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function tokenOf(req) {
  return parseCookies(req)[COOKIE];
}

function requireAuth(req, res, next) {
  if (auth.getSession(tokenOf(req))) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Belum login' });
  return res.redirect(302, '/login');
}

app.get('/api/me', (req, res) => {
  const s = auth.getSession(tokenOf(req));
  if (!s) return res.status(401).json({ error: 'Belum login' });
  res.json({ user: s.user });
});

app.post('/api/login', express.json(), async (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginFails.get(ip) || { count: 0, until: 0 };
  if (rec.until > now) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' });
  }
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  await new Promise((r) => setTimeout(r, 400)); // perlambat brute force

  if (username && password && auth.verify(username, password)) {
    loginFails.delete(ip);
    const token = auth.createSession(username);
    res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
    console.log('[login] berhasil:', username, 'dari', ip);
    return res.json({ ok: true, user: username });
  }
  rec.count += 1;
  if (rec.count > 8) {
    rec.count = 0;
    rec.until = now + 10 * 60 * 1000;
  }
  loginFails.set(ip, rec);
  res.status(401).json({ error: 'Username atau password salah' });
});

app.post('/api/logout', (req, res) => {
  auth.destroy(tokenOf(req));
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});

// ---------- API ----------

app.get('/api/status', requireAuth, (req, res) => {
  const all = store.all();
  const ready = all.filter((s) => !s.incomplete).length;
  res.json({
    ok: true,
    rootDir: cfg.rootDir,
    port: cfg.port,
    photosPerSession: cfg.photosPerSession,
    singleToPrintWindowSec: cfg.singleToPrintWindowSec,
    lanUrl: lanUrl(),
    scanning: scanner.state.scanning,
    startedAt: scanner.state.startedAt,
    lastScanAt: scanner.state.lastScanAt || store.data.lastScan,
    events: scanner.state.events,
    counts: { total: all.length, ready, incomplete: all.length - ready },
    cloud: cloudSync.state,
    errors: scanner.state.errors.slice(-10)
  });
});

app.get('/api/events', requireAuth, (req, res) => {
  const byEvent = {};
  for (const s of store.all()) {
    const e = (byEvent[s.event] = byEvent[s.event] || { name: s.event, total: 0, ready: 0, incomplete: 0 });
    e.total++;
    if (s.incomplete) e.incomplete++;
    else e.ready++;
  }
  res.json({ events: Object.values(byEvent).sort((a, b) => a.name.localeCompare(b.name)) });
});

// statistik menyesuaikan event terpilih (?event=NamaEvent)
// catatan: path sengaja bukan "/stats" — kadang diblokir ekstensi pemblokir di browser
app.get('/api/angka', requireAuth, (req, res) => {
  const event = String(req.query.event || '').trim();
  const all = store.all();
  const list = event ? all.filter((s) => s.event === event) : all;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ready = list.filter((s) => !s.incomplete).length;
  res.json({
    event: event || null,
    total: list.length,
    ready,
    incomplete: list.length - ready,
    uploaded: list.filter((s) => s.cloud && s.cloud.uploadedAt).length,
    today: list.filter((s) => Date.parse(s.ts) >= today.getTime()).length,
    events: new Set(all.map((s) => s.event)).size
  });
});

// alias lama (dipertahankan untuk kompatibilitas)
app.get('/api/stats', requireAuth, (req, res) => res.redirect(307, '/api/angka' + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '')));

app.get('/api/sessions', requireAuth, (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const event = String(req.query.event || '').trim();
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  let list = store.all();
  if (event) list = list.filter((s) => s.event === event);
  if (status === 'ready') list = list.filter((s) => !s.incomplete);
  if (status === 'incomplete') list = list.filter((s) => s.incomplete);
  if (q) {
    list = list.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        (s.title || '').toLowerCase().includes(q) ||
        s.event.toLowerCase().includes(q)
    );
  }
  list.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const total = list.length;
  const items = list.slice(offset, offset + limit).map((s) => publicSession(req, s));
  res.json({ total, offset, limit, items });
});

app.get('/api/sessions/:id', (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  res.json(publicSession(req, s));
});

app.post('/api/rescan', requireAuth, async (req, res) => {
  try {
    await scanner.rescanAll();
    res.json({ ok: true, lastScanAt: scanner.state.lastScanAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Push dari booth (upload ke server) ----------

const ALLOWED_PUSH_SUBS = new Set(['Singles', 'Prints', 'Prints/Qr']);
const pushUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 24 }
});

function safeName(s) {
  return String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/^\.+$/, '')
    .trim()
    .slice(0, 120);
}

function tokenOk(req) {
  if (!cfg.pushToken) return false;
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : String(req.query.token || '');
  const a = Buffer.from(token);
  const b = Buffer.from(cfg.pushToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/api/push', pushUpload.array('files', 24), async (req, res) => {
  if (!cfg.pushToken) {
    return res.status(403).json({ error: 'pushToken belum diatur di server (config.json)' });
  }
  if (!tokenOk(req)) {
    return res.status(401).json({ error: 'token salah' });
  }
  let meta;
  try {
    meta = JSON.parse(req.body.meta || '{}');
  } catch (_) {
    return res.status(400).json({ error: 'meta bukan JSON valid' });
  }
  const event = safeName(meta.event);
  const items = Array.isArray(meta.items) ? meta.items : [];
  const files = req.files || [];
  if (!event) return res.status(400).json({ error: 'event kosong' });
  if (!items.length || files.length !== items.length) {
    return res.status(400).json({ error: `jumlah file (${files.length}) tidak cocok dengan meta (${items.length})` });
  }
  for (const it of items) {
    if (!ALLOWED_PUSH_SUBS.has(it.sub)) return res.status(400).json({ error: 'folder tidak diizinkan: ' + it.sub });
    if (!safeName(it.name)) return res.status(400).json({ error: 'nama file tidak valid' });
  }

  try {
    const saved = [];
    for (let i = 0; i < items.length; i++) {
      const dir = path.join(cfg.rootDir, event, items[i].sub);
      await fsp.mkdir(dir, { recursive: true });
      const dest = path.join(dir, safeName(items[i].name));
      await fsp.writeFile(dest, files[i].buffer);
      saved.push(path.relative(cfg.rootDir, dest).split(path.sep).join('/'));
    }
    scanner.requestRescan(event);
    console.log(`[push] ${event} / ${meta.id || '-'}: ${saved.length} file`);
    res.json({ ok: true, event, id: meta.id || null, saved: saved.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ZIP: unduh seluruh sesi (foto + template + QR) ----------

const AdmZip = require('adm-zip');

app.get('/api/sessions/:id/zip', async (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  try {
    const zip = new AdmZip();
    let n = 0;
    const addFile = (rel, zipDir) => {
      if (!rel) return false;
      const abs = path.join(cfg.rootDir, rel);
      if (!fs.existsSync(abs)) return false;
      zip.addLocalFile(abs, zipDir, path.basename(rel));
      n++;
      return true;
    };
    for (const p of s.photos) addFile(p.path, 'Foto');
    for (const p of s.prints) addFile(p.path, 'Template');
    addFile(s.qrPrint, 'Template');
    if (!n) return res.status(404).json({ error: 'Tidak ada file untuk diunduh' });
    try {
      zip.addFile('QR-sesi.png', await qrBuffer(sessionUrl(req, s.id), 640));
    } catch (_) { /* QR gagal bukan penghalang */ }
    const buf = zip.toBuffer();
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="memoryphotobooth-${s.id}.zip"`);
    res.set('Content-Length', String(buf.length));
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- QR ----------

app.get('/s/:id/qr.png', async (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).send('Not found');
  const size = Math.min(1500, Math.max(128, parseInt(req.query.size, 10) || 512));
  try {
    const buf = await qrBuffer(sessionUrl(req, s.id), size);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Media ----------

app.get('/file', (req, res) => {
  const rel = String(req.query.p || '');
  if (!rel) return res.status(400).send('Param p wajib');
  const abs = path.resolve(cfg.rootDir, rel);
  const rootWithSep = cfg.rootDir.endsWith(path.sep) ? cfg.rootDir : cfg.rootDir + path.sep;
  if (!abs.startsWith(rootWithSep)) return res.status(403).send('Akses ditolak');
  if (BLOCKED_RE.test(rel)) return res.status(403).send('Akses ditolak');
  if (!ALLOWED_MEDIA_RE.test(abs)) return res.status(415).send('Tipe file tidak didukung');
  if (!fs.existsSync(abs)) return res.status(404).send('File tidak ditemukan');

  res.set('Cache-Control', 'public, max-age=86400');
  if (req.query.download === '1') {
    return res.download(abs);
  }
  res.sendFile(abs);
});

// ---------- Halaman ----------

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/login', (req, res) => {
  if (auth.getSession(tokenOf(req))) return res.redirect(302, '/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/s/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'session.html'));
});

// ---------- SSE ----------

app.get('/api/stream', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  res.write('event: hello\ndata: {}\n\n');

  const onChange = (payload) => {
    try { res.write('event: change\ndata: ' + JSON.stringify(payload) + '\n\n'); } catch (_) {}
  };
  const onState = () => {
    try { res.write('event: state\ndata: {}\n\n'); } catch (_) {}
  };
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  bus.on('change', onChange);
  bus.on('state', onState);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('change', onChange);
    bus.off('state', onState);
  });
});

app.use(express.static(PUBLIC_DIR));

// ---------- Start ----------

scanner.on('changed', (payload) => {
  bus.emit('change', payload);
  cloudSync.notify(payload.changed);
});
cloudSync.on('updated', (id) => bus.emit('change', { changed: [id], removed: [], event: '* cloud' }));
scanner.on('state', () => bus.emit('state', {}));
scanner.on('scanned', () => bus.emit('state', {}));
scanner.on('error', (err) => console.error('[scan]', err.message));

(async () => {
  console.log('==============================================');
  console.log(' SessionHub - DSLRBooth Session Uploader');
  console.log('==============================================');
  console.log(' Root folder :', cfg.rootDir);
  try {
    await scanner.start();
  } catch (err) {
    console.error(' Gagal memulai scanner:', err.message);
    console.error(' Periksa "rootDir" di config.json');
    process.exit(1);
  }
  console.log(' Event terdeteksi:', scanner.state.events.join(', ') || '(belum ada)');
  console.log(' Total sesi     :', store.count());
  if (auth.generatedPassword) {
    console.log('');
    console.log('  AKUN PERTAMA DIBUAT:  admin / ' + auth.generatedPassword);
    console.log('  Catat password ini! Ganti dengan: npm run setpass -- admin <passwordBaru>');
  }
  app.listen(cfg.port, '0.0.0.0', () => {
    console.log('');
    console.log(' Login operator    : ' + lanUrl() + '/login');
    console.log(' Dashboard (lokal) : http://localhost:' + cfg.port);
    console.log(' Untuk HP / tamu   : ' + lanUrl());
    console.log(' QR akan menuju    : ' + lanUrl());
    console.log('');
    console.log(' Biarkan jendela ini terbuka (atau jadikan startup).');
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function shutdown() {
  console.log('\nMenyimpan data & berhenti...');
  try { await scanner.stop(); } catch (_) {}
  try { await store.flush(); } catch (_) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------- diagnosa: catat error tak terduga + heartbeat ----------

function logError(tag, err) {
  try {
    const line = `[${new Date().toISOString()}] ${tag}: ${(err && (err.stack || err.message)) || err}\n`;
    fs.appendFileSync(path.join(DATA_DIR, 'error.log'), line);
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  console.error('[fatal]', err);
  logError('uncaughtException', err);
  process.exit(1); // start.cmd akan menyalakan ulang otomatis
});
process.on('unhandledRejection', (err) => {
  console.error('[rejection]', err);
  logError('unhandledRejection', err);
});

// heartbeat tiap10 detik — kalau file ini basi, berarti proses menggantung
setInterval(() => {
  try { fs.writeFileSync(path.join(DATA_DIR, 'heartbeat.txt'), String(Date.now())); } catch (_) {}
}, 10000);
