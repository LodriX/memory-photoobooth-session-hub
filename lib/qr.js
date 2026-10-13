'use strict';

const QRCode = require('qrcode');

const cache = new Map();
const MAX_CACHE = 300;

async function qrBuffer(text, size = 512) {
  const key = text + '|' + size;
  if (cache.has(key)) return cache.get(key);
  const buf = await QRCode.toBuffer(text, {
    type: 'png',
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0b1220', light: '#ffffff' }
  });
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, buf);
  return buf;
}

module.exports = { qrBuffer };
