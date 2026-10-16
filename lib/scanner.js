'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const chokidar = require('chokidar');
const { EventEmitter } = require('events');

const JPG_RE = /\.jpe?g$/i;
const PRINT_RE = /^(\d{8}_\d{6}_\d{3})(?:_(\d{1,2}x))?\.jpe?g$/i;
// Nama Singles LumaBooth: timestamp polos (20250711_194816_203.jpg),
// bersuffix (20250630_185357_765_3600.jpg), atau ber-prefix kamera
// (IMG_0220_20250706_131902_3600.JPG).
const SINGLE_RE = /^(?:IMG_\d+_)?(\d{8}_\d{6})(?:_\d{3,4})*\.jpe?g$/i;
const IGNORED_DIR_RE = /[\\/](Originals|Animated|Videos|GreenScreen|Settings|Templates|SessionHub|thumb)([\\/]|$)/i;
const RAW_RE = /\.(cr2|cr3|arw|nef|dng|orf|rw2|tif|tiff|psd)$/i;

function tsFromBase(base) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(base);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

function baseToTitle(base) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(base);
  if (!m) return base;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  try {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(dt);
  } catch (_) {
    return dt.toLocaleString();
  }
}

async function listFiles(dir, dirFilter) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!dirFilter || dirFilter(e.name)) files.push({ dir: true, name: e.name, full });
    } else if (e.isFile()) {
      files.push({ dir: false, name: e.name, full });
    }
  }
  return files;
}

/** Scan satu folder event -> daftar sesi */
async function scanEvent(eventDir, eventName, cfg) {
  const printsDir = path.join(eventDir, 'Prints');
  const singlesDir = path.join(eventDir, 'Singles');
  const qrDir = path.join(printsDir, 'Qr');
  const printsThumbDir = path.join(printsDir, 'thumb');
  const singlesThumbDir = path.join(singlesDir, 'thumb');

  const [printEntries, singleEntries, qrEntries, printThumbEntries, singleThumbEntries] = await Promise.all([
    listFiles(printsDir, (n) => !/^(thumb|qr)$/i.test(n)),
    listFiles(singlesDir, (n) => !/^(thumb)$/i.test(n)),
    listFiles(qrDir),
    listFiles(printsThumbDir),
    listFiles(singlesThumbDir)
  ]);

  const printThumbs = new Set(printThumbEntries.filter((e) => !e.dir).map((e) => e.name));
  const singleThumbs = new Set(singleThumbEntries.filter((e) => !e.dir).map((e) => e.name));

  const rel = (full) => path.relative(cfg.rootDir, full).split(path.sep).join('/');
  const now = Date.now();
  const N = cfg.photosPerSession;
  const windowMs = cfg.singleToPrintWindowSec * 1000;
  const idleMs = cfg.idleGapSec * 1000;

  // --- Print (per base id, bisa ada varian 1x / 2x) ---
  const printGroups = new Map();
  for (const f of printEntries) {
    if (f.dir || !JPG_RE.test(f.name)) continue;
    const m = PRINT_RE.exec(f.name);
    if (!m) continue;
    const base = m[1];
    const ts = tsFromBase(base);
    if (!Number.isFinite(ts)) continue;
    let g = printGroups.get(base);
    if (!g) {
      g = { base, ts, prints: [], thumbs: printThumbs };
      printGroups.set(base, g);
    }
    g.prints.push({ name: f.name, full: f.full, variant: m[2] ? m[2].toLowerCase() : null });
  }

  // --- QR print dari DSLRBooth (jika ada) ---
  const qrPrints = new Map();
  for (const f of qrEntries) {
    if (f.dir || !JPG_RE.test(f.name)) continue;
    const m = /^(\d{8}_\d{6}_\d{3})(?:_\d{1,2}x)?\.jpe?g$/i.exec(f.name);
    if (!m) continue;
    qrPrints.set(m[1], f.full);
  }

  // --- Singles ---
  const singles = [];
  for (const f of singleEntries) {
    if (f.dir || !JPG_RE.test(f.name)) continue;
    const m = SINGLE_RE.exec(f.name);
    if (!m) continue;
    const ts = tsFromBase(m[1]);
    if (!Number.isFinite(ts)) continue;
    singles.push({ full: f.full, name: f.name, ts, base: m[1] });
  }
  singles.sort((a, b) => a.ts - b.ts);

  const used = new Set();
  const sessions = [];

  const photoObj = (s) => ({
    path: rel(s.full),
    thumb: singleThumbs.has('thumb_' + s.name) ? rel(path.join(singlesThumbDir, 'thumb_' + s.name)) : null,
    ts: new Date(s.ts).toISOString()
  });

  // --- 1) Pasangkan print dengan foto terdekat sebelumnya ---
  const prints = [...printGroups.values()].sort((a, b) => a.ts - b.ts);
  for (const pg of prints) {
    const candidates = singles.filter(
      (s) => !used.has(s) && s.ts <= pg.ts && pg.ts - s.ts <= windowMs
    );
    const chosen = candidates.slice(-N); // N foto yang paling dekat dengan print
    for (const s of chosen) used.add(s);

    const printObjs = pg.prints
      .sort((a, b) => String(a.variant).localeCompare(String(b.variant)))
      .map((p) => ({
        path: rel(p.full),
        variant: p.variant,
        thumb: printThumbs.has('thumb_' + pg.base + '.jpg')
          ? rel(path.join(printsThumbDir, 'thumb_' + pg.base + '.jpg'))
          : null
      }));

    sessions.push({
      id: pg.base,
      event: eventName,
      ts: new Date(pg.ts).toISOString(),
      base: pg.base,
      status: 'ready',
      hasPrint: true,
      photos: chosen.map(photoObj),
      prints: printObjs,
      qrPrint: qrPrints.has(pg.base) ? rel(qrPrints.get(pg.base)) : null
    });
  }

  // --- 2) Sisa foto tanpa print -> sesi "tanpa print" ---
  //    (dipecah per cluster: foto yang jeda > leftoverClusterGapSec dianggap sesi berbeda)
  const leftovers = singles.filter((s) => !used.has(s));
  const clusterGapMs = (cfg.leftoverClusterGapSec || 300) * 1000;
  const clusters = [];
  for (const s of leftovers) {
    const cur = clusters[clusters.length - 1];
    if (!cur || s.ts - cur[cur.length - 1].ts > clusterGapMs) clusters.push([s]);
    else cur.push(s);
  }

  for (const cluster of clusters) {
    for (let i = 0; i < cluster.length; i += N) {
      const chunk = cluster.slice(i, i + N);
      const isLastCluster = cluster === clusters[clusters.length - 1];
      const isLastChunk = i + N >= cluster.length;
      const lastTs = chunk[chunk.length - 1].ts;
      // chunk terakhir yang masih "basah" (foto baru / menunggu print) -> tahan dulu
      if (isLastCluster && isLastChunk && now - lastTs < idleMs) continue;

      sessions.push({
        id: 'nop-' + chunk[0].base,
        event: eventName,
        ts: new Date(chunk[0].ts).toISOString(),
        base: chunk[0].base,
        status: 'no-print',
        hasPrint: false,
        photos: chunk.map(photoObj),
        prints: [],
        qrPrint: null
      });
    }
  }

  for (const s of sessions) {
    s.title = baseToTitle(s.base);
    s.photoCount = s.photos.length;
    s.printCount = s.prints.length;
    // Lengkap = Template ada dan minimal 1 foto. Jumlah foto (2-4) mengikuti
    // layout template, jadi tidak dipakai sebagai syarat kelengkapan.
    s.incomplete = !s.hasPrint || s.photos.length === 0;
  }

  return sessions;
}

class Scanner extends EventEmitter {
  constructor(cfg, store) {
    super();
    this.cfg = cfg;
    this.store = store;
    this.state = { scanning: false, startedAt: null, lastScanAt: null, events: [], errors: [] };
    this._dirtyEvents = new Set();
    this._timer = null;
    this._watcher = null;
  }

  async discoverEvents() {
    const root = this.cfg.rootDir;
    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        // server mode: folder media belum ada -> buat dulu
        try {
          await fsp.mkdir(root, { recursive: true });
          console.log('[scan] folder root dibuat:', root);
          return [];
        } catch (_) { /* lanjut throw di bawah */ }
      }
      throw new Error('Folder root tidak bisa dibaca: ' + root + ' (' + err.message + ')');
    }
    const events = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (/^(SessionHub|Settings|Templates)$/i.test(e.name)) continue;
      const dir = path.join(root, e.name);
      const hasPrints = fs.existsSync(path.join(dir, 'Prints'));
      const hasSingles = fs.existsSync(path.join(dir, 'Singles'));
      if (hasPrints || hasSingles) events.push({ name: e.name, dir });
    }
    events.sort((a, b) => a.name.localeCompare(b.name));
    return events;
  }

  async rescanAll() {
    this.state.scanning = true;
    this.emit('state', this.state);
    try {
      const events = await this.discoverEvents();
      this.state.events = events.map((e) => e.name);
      for (const ev of events) {
        await this._scanOne(ev);
      }
      this.state.lastScanAt = new Date().toISOString();
      this.store.setLastScan(this.state.lastScanAt);
      this.emit('scanned', { events: this.state.events, at: this.state.lastScanAt });
    } finally {
      this.state.scanning = false;
      this.emit('state', this.state);
    }
  }

  async _scanOne(ev) {
    try {
      const sessions = await scanEvent(ev.dir, ev.name, this.cfg);
      const { changed, removed } = this.store.replaceEvent(ev.name, sessions);
      if (changed.length || removed.length) {
        this.emit('changed', { changed, removed, event: ev.name });
      }
    } catch (err) {
      this.state.errors.push({ event: ev.name, error: err.message, at: new Date().toISOString() });
      this.emit('error', err);
    }
  }

  /** Minta rescan satu event (dipakai endpoint push di server). */
  requestRescan(eventName) {
    if (eventName) this._dirtyEvents.add(eventName);
    this._scheduleRescan();
  }

  _scheduleRescan() {
    if (this._timer) return;    this._timer = setTimeout(async () => {
      this._timer = null;
      const dirty = [...this._dirtyEvents];
      this._dirtyEvents.clear();
      const known = new Map((await this.discoverEvents()).map((e) => [e.name, e]));
      const targets = dirty.length
        ? dirty.map((n) => known.get(n)).filter(Boolean)
        : [...known.values()];
      this.state.scanning = true;
      this.emit('state', this.state);
      try {
        for (const ev of targets) await this._scanOne(ev);
        this.state.lastScanAt = new Date().toISOString();
        this.store.setLastScan(this.state.lastScanAt);
        this.emit('scanned', { events: this.state.events, at: this.state.lastScanAt });
      } finally {
        this.state.scanning = false;
        this.emit('state', this.state);
      }
    }, this.cfg.scanDebounceMs);
  }

  _eventFromPath(p) {
    const rel = path.relative(this.cfg.rootDir, p);
    if (rel.startsWith('..')) return null;
    const seg = rel.split(path.sep);
    if (seg.length < 2) return null;
    const eventName = seg[0];
    const sub = seg[1];
    if (sub !== 'Prints' && sub !== 'Singles') return null;
    return eventName;
  }

  async start() {
    await this.rescanAll();
    this.state.startedAt = new Date().toISOString();

    this._watcher = chokidar.watch(this.cfg.rootDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 4,
      ignored: (p) => IGNORED_DIR_RE.test(p) || RAW_RE.test(p),
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 120 }
    });

    const onFileEvent = (p) => {
      const ev = this._eventFromPath(p);
      if (!ev) return;
      this._dirtyEvents.add(ev);
      this._scheduleRescan();
    };

    this._watcher.on('add', onFileEvent);
    this._watcher.on('change', onFileEvent);
    this._watcher.on('unlink', onFileEvent);
    this._watcher.on('addDir', (p) => {
      const rel = path.relative(this.cfg.rootDir, p);
      if (rel && !rel.includes(path.sep)) {
        this._dirtyEvents.clear(); // event baru -> scan semua
        this._scheduleRescan();
      }
    });
    this._watcher.on('error', (err) => {
      this.state.errors.push({ event: '*', error: err.message, at: new Date().toISOString() });
      this.emit('error', err);
    });

    // rescans berkala untuk jaga-jaga (file yang terlewat watcher)
    this._interval = setInterval(() => {
      this._dirtyEvents.clear();
      this._scheduleRescan();
    }, this.cfg.rootRescanSec * 1000);
    if (this._interval.unref) this._interval.unref();
  }

  async stop() {
    if (this._timer) clearTimeout(this._timer);
    if (this._interval) clearInterval(this._interval);
    if (this._watcher) await this._watcher.close();
  }
}

module.exports = { Scanner, scanEvent, tsFromBase };
