'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');

const ALLOWED_SUBS = new Set(['Singles', 'Prints', 'Prints/Qr']);

/** Ringkas error fetch beserta penyebab aslinya (mis. ECONNRESET). */
function errText(err) {
  if (!err) return String(err);
  const cause = err.cause;
  const extra = [];
  if (cause) {
    if (cause.code) extra.push(cause.code);
    if (cause.message && cause.message !== err.message) extra.push(cause.message);
    if (!cause.code && cause.errno) extra.push('errno ' + cause.errno);
    if (Array.isArray(cause.errors) && cause.errors[0]) {
      const first = cause.errors[0];
      if (first.code) extra.push(first.code);
      if (first.message && first.message !== err.message) extra.push(first.message);
    }
  }
  return String(err.message || err) + (extra.length ? ' [' + extra.join(': ') + ']' : '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      uploadIncomplete: !!this.cloud.uploadIncomplete,
      uploaded: 0,
      lastOkAt: null,
      lastError: null,
      queue: 0,
      pending: 0
    };
    this._pending = new Map(); // id -> { tries, nextAt }
    this._timer = null;
    this._busy = false;
    this._reserved = new Set(); // id yang sudah dipesan ke server (QR cepat tampil)
    this._reserving = new Map(); // id -> Promise reserve yang sedang jalan
    this._reconciledEvents = new Set(); // event yang sudah dicocokkan dengan server
    this._reconcileRetryAt = new Map(); // event -> waktu coba lagi setelah gagal cek
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
      if (this._shouldUpload(s)) {
        this._pending.set(id, { tries: 0, nextAt: 0 });
        // pesan sesi lebih dulu agar QR bisa langsung discan (halaman loading)
        this._reserveRemote(s).catch(() => {});
      }
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
    this._busy = true;
    try {
      // Cek server lebih dulu: sesi yang sudah ada jangan dikirim ulang.
      await this._reconcileRemote();

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
        try {
          await this._upload(id);
          this._pending.delete(id);
        } catch (err) {
          p.tries++;
          this._reserved.delete(id);
          const backoff = Math.min(this.cloud.retrySec * 1000 * Math.pow(2, p.tries - 1), 900000);
          p.nextAt = Date.now() + backoff;
          const detail = errText(err);
          this.state.lastError = id + ': ' + detail;
          const cur = this.store.get(id);
          if (cur) {
            this.store.patch(id, {
              cloud: {
                ...(cur.cloud || {}),
                uploadState: 'retry',
                nextRetryAt: new Date(p.nextAt).toISOString(),
                lastError: detail
              }
            });
            this.emit('updated', id);
          }
          console.log(`[cloud] gagal kirim ${id} (percobaan ${p.tries}, ulang ${Math.round(backoff / 1000)}s): ${detail}`);
        } finally {
          this.state.pending = this._pending.size;
        }
      }
    } finally {
      this._busy = false;
      this.state.pending = this._pending.size;
    }
  }

  /**
   * Cocokkan sesi lokal dengan daftar event di server. Sesi yang sudah ready
   * ditandai terkirim, supaya backfill tidak mengunggah ulang file yang sama
   * setiap kali server/scanner restart.
   */
  async _reconcileRemote() {
    const base = String(this.cloud.url).replace(/\/+$/, '');
    const events = new Set();
    for (const s of this.store.all()) {
      if (this._shouldUpload(s) && !this._reconciledEvents.has(s.event)) events.add(s.event);
    }

    for (const event of events) {
      if ((this._reconcileRetryAt.get(event) || 0) > Date.now()) continue;
      try {
        const res = await fetch(base + '/api/events/' + encodeURIComponent(event), {
          headers: { Connection: 'close' },
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const ready = new Map();
        for (const item of data.items || []) {
          if (!item.pending && !item.incomplete) ready.set(item.id, item);
        }

        let marked = 0;
        for (const s of this.store.all()) {
          if (s.event !== event || !this._shouldUpload(s)) continue;
          const remote = ready.get(s.id);
          if (!remote) continue;
          // Jangan anggap selesai kalau jumlah filenya berbeda.
          if (Number(remote.photoCount) !== (s.photos || []).length) continue;
          if (Number(remote.printCount) !== (s.prints || []).length) continue;

          const cur = this.store.get(s.id);
          if (!cur) continue;
          this.store.patch(s.id, {
            cloud: {
              ...(cur.cloud || {}),
              uploadedAt: new Date().toISOString(),
              uploadState: 'done',
              server: base,
              lastError: null,
              verifiedOnServer: true
            }
          });
          this._pending.delete(s.id);
          marked++;
        }

        this._reconciledEvents.add(event);
        if (marked) {
          console.log(`[cloud] ${marked} sesi sudah ada di server, tidak diunggah ulang (${event})`);
        }
      } catch (err) {
        // Coba lagi beberapa menit kemudian; upload tetap boleh berjalan.
        this._reconcileRetryAt.set(event, Date.now() + 5 * 60 * 1000);
        console.log('[cloud] cek sesi di server gagal (' + event + '): ' + errText(err));
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

  async _reserveRemote(s) {
    if (!s || this._reserved.has(s.id)) return;
    if (this._reserving.has(s.id)) return this._reserving.get(s.id);

    const base = String(this.cloud.url).replace(/\/+$/, '');
    const payload = {
      id: s.id,
      event: s.event,
      ts: s.ts,
      title: s.title || s.id,
      photoCount: (s.photos || []).length,
      printCount: (s.prints || []).length,
      incomplete: !!s.incomplete,
      expectedFiles: (s.photos || []).length + (s.prints || []).length + (s.qrPrint ? 1 : 0)
    };
    const p = (async () => {
      let lastErr;
      // Satu percobaan ulang singkat untuk gangguan jaringan sesaat.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch(base + '/api/push/reserve', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + this.cloud.token,
              'Content-Type': 'application/json',
              Connection: 'close'
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
          });
          if (!res.ok) {
            const txt = (await res.text()).slice(0, 160);
            const e = new Error('HTTP ' + res.status + (txt ? ' — ' + txt : ''));
            e.status = res.status;
            throw e;
          }
          this._reserved.add(s.id);
          return;
        } catch (err) {
          lastErr = err;
          const status = Number(err.status) || 0;
          const canRetry = !status || status === 429 || status >= 500;
          if (!canRetry || attempt === 2) throw err;
          await delay(800);
        }
      }
      throw lastErr;
    })().finally(() => {
      this._reserving.delete(s.id);
    });
    this._reserving.set(s.id, p);
    return p;
  }

  async _upload(id) {
    const s = this.store.get(id);
    if (!s) return;

    // QR sudah bisa discan sebelum file selesai diunggah
    await this._reserveRemote(s).catch((err) => {
      console.log('[cloud] reserve gagal ' + id + ' (lanjut upload): ' + errText(err));
    });

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
    let res;
    try {
      res = await fetch(base + '/api/push', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.cloud.token,
          Connection: 'close'
        },
        body: fd,
        signal: AbortSignal.timeout(600000)
      });
    } catch (err) {
      throw new Error(errText(err));
    }
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
