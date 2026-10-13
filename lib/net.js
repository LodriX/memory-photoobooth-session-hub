'use strict';

const os = require('os');

function lanAddress() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return '127.0.0.1';
}

function isLocalHost(host) {
  if (!host) return true;
  const h = host.replace(/:\d+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

module.exports = { lanAddress, isLocalHost };
