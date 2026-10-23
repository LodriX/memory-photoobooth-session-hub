'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Sesi yang sudah "dipesan" booth ke server, tetapi file-nya belum selesai
 * diunggah. Dipakai agar QR bisa dibuka lebih dulu dan halaman tamu
 * menampilkan status loading sampai foto benar-benar tersedia.
 *
 * File: data/pending.json
 * Struktur: { version: 1, items: { "<id>": { ...meta, createdAt, updatedAt } } }
 */
class PendingStore {
  constructor(file) {
    this.file = file;
    this.data = { version: 1, items: {} };
    this._saveTimer = null;
    this._dirty = false;
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (parsed && parsed.items && typeof parsed.items === 'object') {
          this.data = { version: parsed.version || 1, items: parsed.items };
        }
      }
    } catch (err) {
      try { fs.copyFileSync(this.file, this.file + '.bak-' + Date.now()); } catch (_) {}
      this.data = { version: 1, items: {} };
    }
    return this.data;
  }

  saveSoon(delayMs = 500) {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush().catch(() => {});
    }, delayMs);
  }

  async flush() {
    if (!this._dirty) return;
    this._dirty = false;
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf8');
    await fsp.rename(tmp, this.file);
  }

  get(id) {
    return this.data.items[id] || null;
  }

  all() {
    return Object.values(this.data.items);
  }

  count() {
    return Object.keys(this.data.items).length;
  }

  put(id, meta) {
    const now = new Date().toISOString();
    const prev = this.data.items[id];
    this.data.items[id] = {
      ...prev,
      ...meta,
      id,
      createdAt: (prev && prev.createdAt) || now,
      updatedAt: now
    };
    this.saveSoon();
    return this.data.items[id];
  }

  remove(id) {
    if (!this.data.items[id]) return false;
    delete this.data.items[id];
    this.saveSoon();
    return true;
  }

  /** Hapus entri yang sudah selesai (sesi ada) atau kedaluwarsa. */
  cleanup(maxAgeMs, isLive) {
    const now = Date.now();
    let removed = 0;
    for (const p of Object.values(this.data.items)) {
      const age = now - Date.parse(p.updatedAt || p.createdAt || 0);
      if ((isLive && isLive(p.id)) || !Number.isFinite(age) || age > maxAgeMs) {
        delete this.data.items[p.id];
        removed++;
      }
    }
    if (removed) this.saveSoon();
    return removed;
  }
}

module.exports = { PendingStore };
