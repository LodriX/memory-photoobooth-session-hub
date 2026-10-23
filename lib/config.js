'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  rootDir: 'C:\\dslrBooth',
  port: 3800,
  photosPerSession: 4,
  singleToPrintWindowSec: 150,
  idleGapSec: 30,
  leftoverClusterGapSec: 300,
  baseUrl: '',
  scanDebounceMs: 800,
  rootRescanSec: 60,

  // server mode: token yang harus dikirim booth saat push
  pushToken: '',

  // login operator (username default: admin; password dibuat otomatis saat
  // pertama jalan, atau isi adminPassword di sini sebelum start)
  auth: {
    adminPassword: ''
  },

  // booth mode: upload otomatis ke server
  cloud: {
    enabled: false,
    url: '',                 // contoh: https://photobooth.domain.com
    token: '',               // sama dengan pushToken di server
    uploadIncomplete: false, // kirim sesi yang belum lengkap juga?
    uploadSince: '',         // ISO date; kosong = sesi 24 jam terakhir
    retrySec: 60,            // jeda awal antar percobaan ulang
    tickSec: 10              // interval pemrosesan antrian
  }
};

function loadConfig() {
  const file = process.env.SESSIONHUB_CONFIG ||
    path.join(__dirname, '..', 'config.json');
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fs.existsSync(file)) {
      console.warn('[config] config tidak valid, memakai default:', err.message, file);
    }
  }
  const cfg = { ...DEFAULTS, ...user, cloud: { ...DEFAULTS.cloud, ...(user.cloud || {}) }, auth: { ...DEFAULTS.auth, ...(user.auth || {}) } };
  cfg.rootDir = path.resolve(cfg.rootDir);
  cfg.port = Number(cfg.port) || DEFAULTS.port;
  cfg.photosPerSession = Math.max(1, Number(cfg.photosPerSession) || DEFAULTS.photosPerSession);
  cfg.singleToPrintWindowSec = Math.max(10, Number(cfg.singleToPrintWindowSec) || DEFAULTS.singleToPrintWindowSec);
  cfg.idleGapSec = Math.max(5, Number(cfg.idleGapSec) || DEFAULTS.idleGapSec);
  cfg.leftoverClusterGapSec = Math.max(30, Number(cfg.leftoverClusterGapSec) || DEFAULTS.leftoverClusterGapSec);
  cfg.scanDebounceMs = Math.max(200, Number(cfg.scanDebounceMs) || DEFAULTS.scanDebounceMs);
  cfg.rootRescanSec = Math.max(10, Number(cfg.rootRescanSec) || DEFAULTS.rootRescanSec);
  return cfg;
}

module.exports = { loadConfig };
