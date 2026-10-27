'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Autentikasi sederhana: user di data/users.json (hash scrypt + salt),
 * sesi login in-memory (token acak di cookie HttpOnly, masa berlaku12 jam).
 */
class Auth {
  constructor(dataDir, initialPassword, serverMode = false) {
    this.dataDir = dataDir;
    this.serverMode = serverMode;
    this.usersFile = path.join(dataDir, 'users.json');
    this.users = { users: [] };
    this.sessions = new Map();
    this.generatedPassword = null;
    this._load(initialPassword);
  }

  _load(initialPassword) {
    try {
      this.users = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
      if (!Array.isArray(this.users.users)) this.users.users = [];
    } catch (_) {
      this.users = { users: [] };
    }
    // Akun lama sebelumnya punya akses penuh: pertahankan hak itu di VPS.
    if (this.serverMode) {
      let migrated = false;
      for (const u of this.users.users) {
        if (!u.role) { u.role = 'superadmin'; migrated = true; }
        if (!Array.isArray(u.events)) { u.events = []; migrated = true; }
      }
      if (migrated) this._save();
    }
    if (!this.users.users.length) {
      const pass = initialPassword || 'mp-' + crypto.randomBytes(4).toString('hex');
      this.setPassword('admin', pass);
      if (!initialPassword) this.generatedPassword = pass;
    }
  }

  _hash(pass, salt) {
    return crypto.scryptSync(String(pass), salt, 32).toString('hex');
  }

  _save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = this.usersFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.users, null, 2));
    fs.renameSync(temp, this.usersFile);
  }

  getUser(username) {
    return this.users.users.find((u) => u.username === username) || null;
  }

  publicUser(u) {
    return { username: u.username, role: u.role || 'superadmin', events: u.events || [] };
  }

  listUsers() {
    return this.users.users.map((u) => this.publicUser(u));
  }

  revoke(username) {
    for (const [token, s] of this.sessions) {
      if (s.user === username) this.sessions.delete(token);
    }
  }

  createUser(username, pass, role, events = []) {
    if (this.getUser(username)) throw new Error('Username sudah dipakai');
    const salt = crypto.randomBytes(12).toString('hex');
    const u = { username, salt, hash: this._hash(pass, salt), role, events };
    this.users.users.push(u);
    this._save();
    return this.publicUser(u);
  }

  updateUser(username, changes) {
    const u = this.getUser(username);
    if (!u) throw new Error('User tidak ditemukan');
    if (changes.username && changes.username !== username && this.getUser(changes.username)) {
      throw new Error('Username sudah dipakai');
    }
    if (changes.role && changes.role !== u.role) {
      if (u.role === 'superadmin' && this.superadminCount() <= 1) throw new Error('Superadmin terakhir tidak boleh diturunkan');
      u.role = changes.role;
    }
    if (changes.events) u.events = changes.events;
    if (changes.password) {
      u.salt = crypto.randomBytes(12).toString('hex');
      u.hash = this._hash(changes.password, u.salt);
    }
    if (changes.username) u.username = changes.username;
    this._save();
    this.revoke(username);
    return this.publicUser(u);
  }

  superadminCount() {
    return this.users.users.filter((u) => u.role === 'superadmin').length;
  }

  deleteUser(username) {
    const u = this.getUser(username);
    if (!u) throw new Error('User tidak ditemukan');
    if (u.role === 'superadmin' && this.superadminCount() <= 1) throw new Error('Superadmin terakhir tidak boleh dihapus');
    this.users.users = this.users.users.filter((item) => item !== u);
    this._save();
    this.revoke(username);
  }

  setPassword(username, pass) {
    const salt = crypto.randomBytes(12).toString('hex');
    const u = this.getUser(username);
    if (u) {
      u.salt = salt;
      u.hash = this._hash(pass, salt);
    } else {
      this.users.users.push({ username, salt, hash: this._hash(pass, salt), role: 'superadmin', events: [] });
    }
    this._save();
    this.revoke(username);
  }

  verify(username, pass) {
    const u = this.users.users.find((x) => x.username === username);
    if (!u) return false;
    const a = Buffer.from(this._hash(pass, u.salt), 'hex');
    const b = Buffer.from(u.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  createSession(username, ttlMs = 12 * 3600 * 1000) {
    const token = crypto.randomBytes(24).toString('base64url');
    this.sessions.set(token, { user: username, expires: Date.now() + ttlMs });
    return token;
  }

  getSession(token) {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    const user = this.getUser(s.user);
    if (!user) { this.sessions.delete(token); return null; }
    return { ...s, role: user.role || 'superadmin', events: user.events || [] };
  }

  destroy(token) {
    if (token) this.sessions.delete(token);
  }
}

module.exports = { Auth };
