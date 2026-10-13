'use strict';
// Ganti password operator. Contoh:  npm run setpass -- admin rahasia123
const path = require('path');
const { Auth } = require('../lib/auth');

const [, , username, pass] = process.argv;
if (!username || !pass) {
  console.log('Pakai: npm run setpass -- <username> <password>');
  process.exit(1);
}

const dataDir = process.env.SESSIONHUB_DATA || path.join(__dirname, '..', 'data');
const auth = new Auth(dataDir);
auth.setPassword(String(username).trim(), String(pass));
console.log(`Password untuk "${username}" sudah disimpan di ${dataDir}\\users.json`);
console.log('Jika server sedang berjalan, restart agar perubahan berlaku.');
