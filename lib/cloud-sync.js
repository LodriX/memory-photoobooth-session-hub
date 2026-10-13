'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');

const ALLOWED_SUBS = new Set(['Singles', 'Prints', 'Prints/Qr']);

/**
 * CloudSync — mengirim sesi yang sudah lengkap dari booth ke server
 * (POST /api/push dengan Bearer token). Antrian & retry otomatis.
 * Emit 'updated' (id) tiap status unggah sebuah sesi berubah.
 */
class CloudSync extends EventEmitter {
  constructor(cfg, store) {
    super();
    this.cloud = cfg.cloud;
    this.cloud.retrySec = Math.max(10, Number(this.cloud.retrySec) || 60);
    this.cloud.tickSec = Math.max(3, Number(this.cloud.tickSec) || 10);
    this.rootDir = cfg.rootDir;
    this.store = store;
    this.state = {
      enabled: false,
      uploaded: 0,
      lastOkAt: null,
      lastError: null,
      queue: 0,
      pending: 0
    };
    this._pending = new Map(); // id -> { tries, nextAt }
    this._timer = null;
    this._busy = false;
    // Default: kirim sesi 24 jam terakhir yang belum terkirim (aman dari antrean offline
    // saat restart). Atur cloud.uploadSince untuk backfill khusus.
    this._since = this.cloud.uploadSince
      ? Date.parse(this.cloud.uploadSince)
      : Date.now() - 24 * 3600 * 1000;
    if (!Number.isFinite(this._since)) this._since = Date.now() - 24 * 3600 * 1000;
  }

  get enabled() {
    return !!(this.cloud.enabled && this.cloud.url && this.cloud.token);
  }

  start() {
    this.state.enabled = this.enabled;
    if (!this.enabled) return;
    console.log('[cloud] upload otomatis aktif ->', this.cloud.url);
    this._timer = setInterval(() => this._tick(), this.cloud.tickSec * 1000);
    if (this._timer.unref) this._timer.unref();
    this._tick();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  /** Dipanggil tiap ada sesi berubah. */
  notify(changedIds) {
    if (!this.enabled) return;
    for (const id of changedIds || []) {
      const s = this.store.get(id);
      if (this._shouldUpload(s)) this._pending.set(id, { tries: 0, nextAt: 0 });
    }
    this.state.pending = this._pending.size;
    this._tick();
  }

  _shouldUpload(s) {
    if (!s) return false;
    if (s.cloud && s.cloud.uploadedAt) return false;
    if (Date.parse(s.ts) < this._since) return false;
    if (s.incomplete && !this.cloud.uploadIncomplete) return false;
    if (!s.photos.length && !s.prints.length) return false;
    return true;
  }

  async _tick() {
    if (this._busy || !this.enabled) return;

    // backfill: antrekan sesi valid yang belum pernah dikirim (mis. setelah restart)
    for (const s of this.store.all()) {
      if (this._shouldUpload(s) && !this._pending.has(s.id)) {
        this._pending.set(s.id, { tries: 0, nextAt: 0 });
      }
    }
    this.state.pending = this._pending.size;

    const now = Date.now();
    for (const [id, p] of [...this._pending]) {
      if (p.nextAt > now) continue;
      this._busy = true;
      try {
        await this._upload(id);
        this._pending.delete(id);
      } catch (err) {
        p.tries++;
        const delay = Math.min(this.cloud.retrySec * 1000 * Math.pow(2, p.tries - 1), 900000);
        p.nextAt = Date.now() + delay;
        this.state.lastError = id + ': ' + err.message;
        const cur = this.store.get(id);
        if (cur) {
          this.store.patch(id, {
            cloud: {
              ...(cur.cloud || {}),
              uploadState: 'retry',
              nextRetryAt: new Date(p.nextAt).toISOString(),
              lastError: err.message
            }
          });
          this.emit('updated', id);
        }
        console.log(`[cloud] gagal kirim ${id} (percobaan ${p.tries}, ulang ${Math.round(delay / 1000)}s): ${err.message}`);
      } finally {
        this._busy = false;
        this.state.pending = this._pending.size;
      }
    }
  }

  _subOf(relPath) {
    const parts = String(relPath).split('/');
    parts.shift(); // buang nama event
    parts.pop(); // buang nama file
    const sub = parts.join('/');
    if (!ALLOWED_SUBS.has(sub)) {
      throw new Error('folder tidak dikenal: ' + sub + ' (' + relPath + ')');
    }
    return sub;
  }

  async _upload(id) {
    const s = this.store.get(id);
    if (!s) return;

    const items = [];
    const absFiles = [];
    const add = (rel) => {
      if (!rel) return;
      const abs = path.join(this.rootDir, rel);
      if (!fs.existsSync(abs)) return;
      items.push({ sub: this._subOf(rel), name: path.basename(rel) });
      absFiles.push(abs);
    };
    for (const p of s.photos) add(p.path);
    for (const p of s.prints) add(p.path);
    add(s.qrPrint);

    if (!items.length) throw new Error('tidak ada file untuk dikirim');

    const fd = new FormData();
    fd.append('id', s.id);
    fd.append('event', s.event);
    fd.append('meta', JSON.stringify({ id: s.id, event: s.event, ts: s.ts, items }));
    for (const abs of absFiles) {
      const buf = await fsp.readFile(abs);
      fd.append('files', new Blob([buf]), path.basename(abs));
    }

    const base = String(this.cloud.url).replace(/\/+$/, '');
    this.store.patch(s.id, { cloud: { ...(s.cloud || {}), uploadState: 'uploading' } });
    this.emit('updated', s.id);
    const res = await fetch(base + '/api/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.cloud.token },
      body: fd,
      signal: AbortSignal.timeout(180000)
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 200);
      throw new Error('HTTP ' + res.status + (txt ? ' — ' + txt : ''));
    }

    this.store.patch(s.id, {
      cloud: { uploadedAt: new Date().toISOString(), server: base, uploadState: 'done' }
    });
    this.state.uploaded++;
    this.state.lastOkAt = new Date().toISOString();
    this.state.lastError = null;
    this.emit('updated', s.id);
    console.log(`[cloud] terkirim ✓ ${s.id} (${items.length} file, ${s.event})`);
  }
}

module.exports = { CloudSync };
