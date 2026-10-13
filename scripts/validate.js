'use strict';

// Dry-run: scan semua event tanpa menyimpan, lalu cetak statistik grouping.
// Dipakai untuk menyesuaikan config.json (photosPerSession, singleToPrintWindowSec, dll).

const path = require('path');
const { loadConfig } = require('../lib/config');
const { Scanner } = require('../lib/scanner');

(async () => {
  const cfg = loadConfig();
  console.log('Root           :', cfg.rootDir);
  console.log('Foto/sesi      :', cfg.photosPerSession);
  console.log('Jendela foto-print:', cfg.singleToPrintWindowSec + ' dtk');
  console.log('Idle gap       :', cfg.idleGapSec + ' dtk');
  console.log('');

  const fakeStore = {
    replaceEvent(event, sessions) {
      const hist = {};
      let photos = 0;
      let withPrint = 0;
      for (const s of sessions) {
        const k = `${s.photos.length} foto + ${s.prints.length} print`;
        hist[k] = (hist[k] || 0) + 1;
        photos += s.photos.length;
        if (s.hasPrint) withPrint++;
      }
      console.log(`=== ${event} ===`);
      console.log(`  sesi: ${sessions.length} | dengan print: ${withPrint} | tanpa print: ${sessions.length - withPrint}`);
      for (const [k, v] of Object.entries(hist).sort()) console.log(`  ${v}x  ${k}`);
      const samples = sessions.slice(-3);
      for (const s of samples) {
        console.log(`  contoh: ${s.id} | ${s.photos.length} foto | print=${s.prints.length} | qrPrint=${s.qrPrint ? 'ada' : '-'}`);
        for (const p of s.photos) console.log(`      ${p.ts}  ${path.basename(p.path)}`);
        for (const p of s.prints) console.log(`      PRINT ${p.variant || '-'}  ${path.basename(p.path)}`);
      }
      console.log('');
      return { changed: [], removed: [] };
    },
    setLastScan() {}
  };

  const scanner = new Scanner(cfg, fakeStore);
  await scanner.rescanAll();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
