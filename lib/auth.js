'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Autentikasi sederhana: user di data/users.json (hash scrypt + salt),
 * sesi login in-memory (token acak di cookie HttpOnly, masa berlaku12 jam).
 */
class Auth {
  constructor(dataDir, initialPassword) {
    this.dataDir = dataDir;
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
    if (!this.users.users.length) {
      const pass = initialPassword || 'mp-' + crypto.randomBytes(4).toString('hex');
      this.setPassword('admin', pass);
      if (!initialPassword) this.generatedPassword = pass;
    }
  }

  _hash(pass, salt) {
    return crypto.scryptSync(String(pass), salt, 32).toString('hex');
  }

  setPassword(username, pass) {
    const salt = crypto.randomBytes(12).toString('hex');
    const u = this.users.users.find((x) => x.username === username);
    if (u) {
      u.salt = salt;
      u.hash = this._hash(pass, salt);
    } else {
      this.users.users.push({ username, salt, hash: this._hash(pass, salt) });
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2));
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
    return s;
  }

  destroy(token) {
    if (token) this.sessions.delete(token);
  }
}

module.exports = { Auth };
