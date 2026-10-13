'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Penyimpanan sesi dalam satu file JSON (atomic write).
 * Struktur:
 * {
 *   version: 1,
 *   lastScan: ISO string,
 *   sessions: { "<id>": sessionObject }
 * }
 */
class Store extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.data = { version: 1, lastScan: null, sessions: {} };
    this._saveTimer = null;
    this._dirty = false;
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sessions && typeof parsed.sessions === 'object') {
          this.data = {
            version: parsed.version || 1,
            lastScan: parsed.lastScan || null,
            sessions: parsed.sessions
          };
        }
      }
    } catch (err) {
      // file rusak: backup lalu mulai baru
      try {
        fs.copyFileSync(this.file, this.file + '.bak-' + Date.now());
      } catch (_) { /* ignore */ }
      this.data = { version: 1, lastScan: null, sessions: {} };
    }
    return this.data;
  }

  saveSoon(delayMs = 1000) {
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

  setLastScan(iso) {
    this.data.lastScan = iso;
    this.saveSoon();
  }

  get(id) {
    return this.data.sessions[id] || null;
  }

  all() {
    return Object.values(this.data.sessions);
  }

  count() {
    return Object.keys(this.data.sessions).length;
  }

  /** Gabungkan patch ke session yang ada (mis. tandai sudah ter-upload). */
  patch(id, obj) {
    const s = this.data.sessions[id];
    if (!s) return null;
    Object.assign(s, obj);
    this.saveSoon();
    return s;
  }

  /**
   * Ganti semua sesi milik sebuah event dengan hasil scan terbaru.
   * Mengembalikan daftar id yang berubah + id yang terhapus.
   */
  replaceEvent(event, newSessions) {
    const changed = [];
    const removed = [];
    const keepIds = new Set();
    const now = new Date().toISOString();

    // hindari tabrakan id antar event
    const usedIds = new Set(
      Object.values(this.data.sessions)
        .filter((s) => s.event !== event)
        .map((s) => s.id)
    );

    for (const session of newSessions) {
      let id = session.id;
      if (usedIds.has(id)) {
        let n = 2;
        while (usedIds.has(id + '-' + n)) n++;
        id = id + '-' + n;
      }
      usedIds.add(id);
      keepIds.add(id);

      const next = { ...session, id, updatedAt: now };
      const prev = this.data.sessions[id];
      if (!prev || JSON.stringify(stripVolatile(prev)) !== JSON.stringify(stripVolatile(next))) {
        this.data.sessions[id] = next;
        changed.push(id);
      }
    }

    for (const s of Object.values(this.data.sessions)) {
      if (s.event === event && !keepIds.has(s.id)) {
        removed.push(s.id);
        delete this.data.sessions[s.id];
      }
    }

    if (changed.length || removed.length) this.saveSoon();
    return { changed, removed };
  }
}

function stripVolatile(s) {
  const { updatedAt, ...rest } = s;
  return rest;
}

module.exports = { Store };
