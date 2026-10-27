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
const { PendingStore } = require('./lib/pending');

const cfg = loadConfig();
const serverMode = !!cfg.pushToken && !cfg.cloud.enabled;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_MEDIA_RE = /\.(jpe?g|png|webp|gif|mp4|mov|m4v)$/i;
const BLOCKED_RE = /[\\/](Settings|Templates|SessionHub)([\\/]|$)/i;

const DATA_DIR = process.env.SESSIONHUB_DATA || path.join(__dirname, 'data');
const store = new Store(path.join(DATA_DIR, 'sessions.json'));
store.load();
const pending = new PendingStore(path.join(DATA_DIR, 'pending.json'));
pending.load();

const scanner = new Scanner(cfg, store);
const cloudSync = new CloudSync(cfg, store);
const auth = new Auth(DATA_DIR, (cfg.auth && cfg.auth.adminPassword) || '', serverMode);
const bus = new EventEmitter();
bus.setMaxListeners(0);

const app = express();
app.disable('x-powered-by');
// Hanya VPS penerima push yang menawarkan tombol berbagi ke WhatsApp.
const whatsappEnabled = serverMode;

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

function eventUrl(req, name) {
  return baseUrlFor(req) + '/e/' + encodeURIComponent(name);
}

/** Data sesi yang sudah dipesan tetapi file-nya belum selesai diunggah. */
function publicPending(req, p) {
  const url = sessionUrl(req, p.id);
  return {
    pending: true,
    id: p.id,
    event: p.event,
    title: p.title || p.id,
    ts: p.ts || p.createdAt,
    photoCount: Number(p.photoCount) || 0,
    printCount: Number(p.printCount) || 0,
    incomplete: !!p.incomplete,
    expectedFiles: Number(p.expectedFiles) || 0,
    createdAt: p.createdAt || null,
    url,
    qr: url + '/qr.png'
  };
}

// ---------- util file (untuk hapus sesi oleh admin) ----------

function rootPathOf(rel) {
  const abs = path.resolve(cfg.rootDir, String(rel || ''));
  const rootWithSep = cfg.rootDir.endsWith(path.sep) ? cfg.rootDir : cfg.rootDir + path.sep;
  return abs.startsWith(rootWithSep) ? abs : null;
}

function removeRelFile(rel) {
  const abs = rootPathOf(rel);
  if (!abs) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/** Semua file (foto, thumb, template, QR print) milik satu sesi. */
function sessionFilePaths(s) {
  const out = new Set();
  const add = (p) => {
    if (!p) return;
    if (p.path) out.add(p.path);
    if (p.thumb) out.add(p.thumb);
  };
  (s.photos || []).forEach(add);
  (s.prints || []).forEach(add);
  if (s.qrPrint) out.add(s.qrPrint);
  return [...out];
}

/** File yang boleh dihapus lewat endpoint hapus-satu-file. */
function sessionFileTargets(s, rel) {
  for (const p of [...(s.photos || []), ...(s.prints || [])]) {
    if (p.path === rel) return [p.path, p.thumb].filter(Boolean);
  }
  if (s.qrPrint && s.qrPrint === rel) return [s.qrPrint];
  return null;
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
  const session = auth.getSession(tokenOf(req));
  if (session) { req.operator = session; return next(); }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Belum login' });
  return res.redirect(302, '/login');
}

function isSuper(req) {
  return !serverMode || req.operator.role === 'superadmin';
}

function canManageEvent(req, event) {
  return isSuper(req) || req.operator.events.includes(event);
}

function requireSuper(req, res, next) {
  if (isSuper(req)) return next();
  res.status(403).json({ error: 'Hanya superadmin yang dapat melakukan tindakan ini' });
}

function validatedEvents(value) {
  const known = new Set([...scanner.state.events, ...store.all().map((s) => s.event)]);
  if (!Array.isArray(value) || value.length > 100 || value.some((e) => typeof e !== 'string' || !known.has(e))) return null;
  return [...new Set(value)];
}

app.get('/api/me', (req, res) => {
  const s = auth.getSession(tokenOf(req));
  if (!s) return res.status(401).json({ error: 'Belum login' });
  res.json({ user: s.user, role: s.role, events: s.events, whatsappEnabled,
    canDelete: !serverMode || s.role === 'superadmin' });
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

// Manajemen akun hanya di VPS; operator booth tetap memakai login lama.
app.get('/api/users', requireAuth, requireSuper, (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Tidak tersedia di booth' });
  res.json({ users: auth.listUsers() });
});

app.post('/api/users', requireAuth, requireSuper, express.json({ limit: '32kb' }), (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Tidak tersedia di booth' });
  const { username, password, role } = req.body || {};
  const events = validatedEvents((req.body || {}).events || []);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username || '') || typeof password !== 'string' || password.length < 8 ||
      !['admin', 'superadmin'].includes(role) || !events || (role === 'admin' && !events.length)) {
    return res.status(400).json({ error: 'Username, password (min. 8 karakter), role, atau event tidak valid' });
  }
  try { res.status(201).json({ user: auth.createUser(username, password, role, role === 'admin' ? events : []) }); }
  catch (err) { res.status(409).json({ error: err.message }); }
});

app.put('/api/users/:username', requireAuth, requireSuper, express.json({ limit: '32kb' }), (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Tidak tersedia di booth' });
  const current = auth.getUser(req.params.username);
  if (!current) return res.status(404).json({ error: 'User tidak ditemukan' });
  const body = req.body || {};
  const role = body.role === undefined ? current.role : body.role;
  const username = body.username === undefined ? current.username : body.username;
  const events = body.events === undefined ? current.events : validatedEvents(body.events);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username || '') || !['admin', 'superadmin'].includes(role) ||
      !events || (role === 'admin' && !events.length) ||
      (body.password !== undefined && (typeof body.password !== 'string' || body.password.length < 8))) {
    return res.status(400).json({ error: 'Role, event, atau password (min. 8 karakter) tidak valid' });
  }
  if (req.params.username === req.operator.user && role !== 'superadmin') {
    return res.status(400).json({ error: 'Tidak dapat menurunkan role diri sendiri' });
  }
  try { res.json({ user: auth.updateUser(req.params.username, { username, role, events: role === 'admin' ? events : [], password: body.password }) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/users/:username', requireAuth, requireSuper, (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Tidak tersedia di booth' });
  if (req.params.username === req.operator.user) return res.status(400).json({ error: 'Tidak dapat menghapus diri sendiri' });
  try { auth.deleteUser(req.params.username); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/me/password', requireAuth, express.json({ limit: '8kb' }), (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Tidak tersedia di booth' });
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !auth.verify(req.operator.user, currentPassword)) {
    return res.status(400).json({ error: 'Password lama salah' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
  }
  auth.setPassword(req.operator.user, newPassword);
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});

// ---------- API ----------

app.get('/api/status', requireAuth, (req, res) => {
  const all = store.all().filter((s) => canManageEvent(req, s.event));
  const ready = all.filter((s) => !s.incomplete).length;
  res.json({
    ok: true,
    rootDir: isSuper(req) ? cfg.rootDir : 'Akses terbatas',
    port: cfg.port,
    photosPerSession: cfg.photosPerSession,
    singleToPrintWindowSec: cfg.singleToPrintWindowSec,
    lanUrl: lanUrl(),
    whatsappEnabled,
    scanning: scanner.state.scanning,
    startedAt: scanner.state.startedAt,
    lastScanAt: scanner.state.lastScanAt || store.data.lastScan,
    events: scanner.state.events.filter((e) => canManageEvent(req, e)),
    counts: { total: all.length, ready, incomplete: all.length - ready },
    pendingUploads: isSuper(req) ? pending.count() : 0,
    cloud: isSuper(req) ? cloudSync.state : { enabled: false },
    errors: isSuper(req) ? scanner.state.errors.slice(-10) : []
  });
});

app.get('/api/events', requireAuth, (req, res) => {
  const byEvent = {};
  for (const s of store.all()) {
    if (!canManageEvent(req, s.event)) continue;
    const e = (byEvent[s.event] = byEvent[s.event] || { name: s.event, total: 0, ready: 0, incomplete: 0, pending: 0 });
    e.total++;
    if (s.incomplete) e.incomplete++;
    else e.ready++;
  }
  for (const p of pending.all()) {
    const e = byEvent[p.event];
    if (e) e.pending++;
  }
  const events = Object.values(byEvent)
    .map((e) => ({ ...e, url: eventUrl(req, e.name), qr: eventUrl(req, e.name) + '/qr.png' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ events });
});

// statistik menyesuaikan event terpilih (?event=NamaEvent)
// catatan: path sengaja bukan "/stats" — kadang diblokir ekstensi pemblokir di browser
app.get('/api/angka', requireAuth, (req, res) => {
  const event = String(req.query.event || '').trim();
  const all = store.all().filter((s) => canManageEvent(req, s.event));
  if (event && !canManageEvent(req, event)) return res.status(403).json({ error: 'Event tidak diizinkan' });
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
  list = list.filter((s) => canManageEvent(req, s.event));
  if (event && !canManageEvent(req, event)) return res.status(403).json({ error: 'Event tidak diizinkan' });
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
  if (s) return res.json(publicSession(req, s));
  const p = pending.get(req.params.id);
  if (p) return res.json(publicPending(req, p));
  res.status(404).json({ error: 'Sesi belum tersedia', pending: false });
});

// ---------- Hapus sesi / foto (superadmin VPS atau operator booth) ----------

app.delete('/api/sessions/:id/file', requireAuth, requireSuper, (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  const rel = String(req.query.p || '');
  const targets = sessionFileTargets(s, rel);
  if (!targets) return res.status(400).json({ error: 'File bukan bagian dari sesi ini' });

  const deleted = [];
  for (const t of targets) {
    try {
      if (removeRelFile(t)) deleted.push(t);
    } catch (err) {
      return res.status(500).json({ error: 'Gagal menghapus ' + t + ': ' + err.message });
    }
  }
  scanner.requestRescan(s.event);
  bus.emit('change', { changed: [s.id], removed: [], event: s.event });
  console.log('[hapus] file ' + s.id + ': ' + deleted.join(', '));
  res.json({ ok: true, deleted });
});

app.delete('/api/sessions/:id', requireAuth, requireSuper, (req, res) => {
  const s = store.get(req.params.id);
  const cancelled = pending.remove(req.params.id);
  if (!s) {
    if (cancelled) return res.json({ ok: true, pending: true, deletedFiles: 0 });
    return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  }

  const deleted = [];
  for (const rel of sessionFilePaths(s)) {
    try {
      if (removeRelFile(rel)) deleted.push(rel);
    } catch (err) {
      return res.status(500).json({ error: 'Gagal menghapus ' + rel + ': ' + err.message });
    }
  }
  store.remove(s.id);
  scanner.requestRescan(s.event);
  bus.emit('change', { changed: [], removed: [s.id], event: s.event });
  console.log('[hapus] sesi ' + s.id + ' (' + deleted.length + ' file)');
  res.json({ ok: true, deletedFiles: deleted.length });
});

// ---------- Galeri event publik (QR utama per event) ----------

app.get('/api/events/:event', (req, res) => {
  const name = String(req.params.event || '').trim();
  if (!name) return res.status(400).json({ error: 'Event kosong' });

  const items = [];
  const seen = new Set();
  for (const s of store.all()) {
    if (s.event !== name) continue;
    seen.add(s.id);
    const preview = (s.prints[0] && (s.prints[0].thumb || s.prints[0].path)) ||
      (s.photos[0] && (s.photos[0].thumb || s.photos[0].path)) || '';
    const url = sessionUrl(req, s.id);
    items.push({
      id: s.id,
      title: s.title || s.id,
      ts: s.ts,
      photoCount: s.photoCount,
      printCount: (s.prints || []).length,
      incomplete: !!s.incomplete,
      pending: false,
      preview,
      url,
      qr: url + '/qr.png'
    });
  }
  for (const p of pending.all()) {
    if (p.event !== name || seen.has(p.id)) continue;
    items.push({ ...publicPending(req, p), preview: '' });
  }
  items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  res.json({
    event: name,
    total: items.length,
    ready: items.filter((i) => !i.pending && !i.incomplete).length,
    pending: items.filter((i) => i.pending).length,
    items
  });
});

app.post('/api/rescan', requireAuth, requireSuper, async (req, res) => {
  try {
    await scanner.rescanAll();
    res.json({ ok: true, lastScanAt: scanner.state.lastScanAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Push dari booth (upload ke server) ----------

// Booth memesan slot sesi lebih dulu supaya QR langsung bisa discan dan
// halaman tamu menampilkan status "sedang diunggah" sampai file tiba.
app.post('/api/push/reserve', express.json({ limit: '256kb' }), (req, res) => {
  if (!cfg.pushToken) {
    return res.status(403).json({ error: 'pushToken belum diatur di server (config.json)' });
  }
  if (!tokenOk(req)) return res.status(401).json({ error: 'token salah' });

  const meta = req.body || {};
  const id = String(meta.id || '').trim();
  const event = safeName(meta.event);
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return res.status(400).json({ error: 'id tidak valid' });
  if (!event) return res.status(400).json({ error: 'event kosong' });

  if (store.get(id)) return res.json({ ok: true, exists: true });

  const ts = String(meta.ts || '');
  const p = pending.put(id, {
    event,
    title: String(meta.title || '').slice(0, 120),
    ts: Number.isFinite(Date.parse(ts)) ? ts : new Date().toISOString(),
    photoCount: Math.min(50, Math.max(0, Number(meta.photoCount) || 0)),
    printCount: Math.min(50, Math.max(0, Number(meta.printCount) || 0)),
    incomplete: !!meta.incomplete,
    expectedFiles: Math.min(100, Math.max(0, Number(meta.expectedFiles) || 0))
  });
  console.log('[reserve] ' + event + ' / ' + id + ' (' + p.expectedFiles + ' file)');
  res.json({ ok: true, id, event });
});

// Booth mengirim daftar ID yang masih valid. Server menghapus reserve lama
// untuk event itu yang tidak ada di daftar dan umurnya sudah >= minAgeSec.
// Reserve muda tidak disentuh agar upload yang sedang berjalan tetap aman.
app.post('/api/push/prune', express.json({ limit: '1mb' }), (req, res) => {
  if (!cfg.pushToken) {
    return res.status(403).json({ error: 'pushToken belum diatur di server (config.json)' });
  }
  if (!tokenOk(req)) return res.status(401).json({ error: 'token salah' });

  const meta = req.body || {};
  const event = safeName(meta.event);
  if (!event) return res.status(400).json({ error: 'event kosong' });

  const keep = (Array.isArray(meta.keep) ? meta.keep : [])
    .map((id) => String(id || '').trim())
    .filter((id) => /^[A-Za-z0-9._-]{1,120}$/.test(id))
    .slice(0, 5000);
  if (!keep.length) return res.status(400).json({ error: 'keep kosong' });

  const minAgeSec = Math.min(86400, Math.max(60, Number(meta.minAgeSec) || 600));
  const removed = pending.prune(event, keep, minAgeSec * 1000);
  if (removed) console.log(`[prune] ${event}: ${removed} reserve yatim dihapus`);
  res.json({ ok: true, event, removed, remaining: pending.count() });
});

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
  const id = String(req.params.id || '');
  if (!id || id.length > 200) return res.status(400).send('Id tidak valid');
  const size = Math.min(1500, Math.max(128, parseInt(req.query.size, 10) || 512));
  try {
    const buf = await qrBuffer(sessionUrl(req, id), size);
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

app.get('/users', requireAuth, requireSuper, (req, res) => {
  if (!serverMode) return res.status(404).send('Tidak tersedia di booth');
  res.sendFile(path.join(PUBLIC_DIR, 'users.html'));
});
app.get('/users.html', requireAuth, requireSuper, (req, res) => {
  if (!serverMode) return res.status(404).send('Tidak tersedia di booth');
  res.sendFile(path.join(PUBLIC_DIR, 'users.html'));
});

app.get('/account', requireAuth, (req, res) => {
  if (!serverMode) return res.status(404).send('Tidak tersedia di booth');
  res.sendFile(path.join(PUBLIC_DIR, 'account.html'));
});
app.get('/account.html', requireAuth, (req, res) => {
  if (!serverMode) return res.status(404).send('Tidak tersedia di booth');
  res.sendFile(path.join(PUBLIC_DIR, 'account.html'));
});

app.get('/s/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'session.html'));
});

// QR utama event -> halaman semua sesi event tersebut
app.get('/e/:event/qr.png', async (req, res) => {
  const name = String(req.params.event || '').trim();
  if (!name || name.length > 200) return res.status(400).send('Event tidak valid');
  const size = Math.min(1500, Math.max(128, parseInt(req.query.size, 10) || 512));
  try {
    const buf = await qrBuffer(eventUrl(req, name), size);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/e/:event', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'event.html'));
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
    const current = auth.getSession(tokenOf(req));
    if (!current) { res.end(); return; }
    req.operator = current;
    if (payload.event !== '* cloud' && !canManageEvent(req, payload.event)) return;
    if (payload.event === '* cloud' && !isSuper(req) &&
        !(payload.changed || []).some((id) => { const s = store.get(id); return s && canManageEvent(req, s.event); })) return;
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

function cleanupPending() {
  const n = pending.cleanup(24 * 3600 * 1000, (id) => !!store.get(id));
  if (n) console.log('[pending] ' + n + ' entri selesai/kedaluwarsa dibersihkan');
}

scanner.on('changed', (payload) => {
  cleanupPending();
  bus.emit('change', payload);
  cloudSync.notify(payload.changed);
});
cloudSync.on('updated', (id) => bus.emit('change', { changed: [id], removed: [], event: '* cloud' }));
scanner.on('state', () => bus.emit('state', {}));
scanner.on('scanned', () => {
  cleanupPending();
  bus.emit('state', {});
});
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
  cleanupPending();
  console.log(' Menunggu upload:', pending.count());
  // penting: timer ini yang menjalankan backfill saat start + retry saat jaringan buruk
  cloudSync.start();
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
  try { cloudSync.stop(); } catch (_) {}
  try { await pending.flush(); } catch (_) {}
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
