'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanEvent } = require('../lib/scanner');

const CFG = {
  photosPerSession: 4,
  singleToPrintWindowSec: 150,
  idleGapSec: 30,
  leftoverClusterGapSec: 300
};

function setupTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionhub-test-'));
  for (const rel of files) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }
  return root;
}

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

function scan(root, event) {
  return scanEvent(path.join(root, event), event, { rootDir: root, ...CFG });
}

test('foto bertimestamp polos dikenali dan dipasangkan dengan template', async (t) => {
  const root = setupTree([
    'Wedding/Singles/20240101_120001_000.jpg',
    'Wedding/Singles/20240101_120011_000.jpg',
    'Wedding/Singles/20240101_120021_000.jpg',
    'Wedding/Prints/20240101_120030_000.jpg'
  ]);
  cleanup(t, root);

  const sessions = await scan(root, 'Wedding');

  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.hasPrint, true);
  assert.equal(s.photos.length, 3);
  assert.equal(s.prints.length, 1);
  assert.equal(s.incomplete, false);
});

test('varian nama bersuffix _3600 dan ber-prefix IMG_ ikut dikenali', async (t) => {
  const root = setupTree([
    'Staging/Singles/20250630_185357_765_3600.jpg',
    'Staging/Singles/20250630_185408_175_3600.jpg',
    'Staging/Singles/20250630_185418_125_3600.jpg',
    'Staging/Prints/20250630_185424_000.jpg',
    'Wedding/Singles/IMG_0220_20250706_131902_3600.JPG',
    'Wedding/Singles/IMG_0221_20250706_131912_3600.JPG',
    'Wedding/Prints/20250706_131937_235.jpg'
  ]);
  cleanup(t, root);

  const staging = await scan(root, 'Staging');
  assert.equal(staging.length, 1);
  assert.equal(staging[0].photos.length, 3);
  assert.equal(staging[0].incomplete, false);

  const wedding = await scan(root, 'Wedding');
  assert.equal(wedding.length, 1);
  assert.equal(wedding[0].photos.length, 2);
  assert.equal(wedding[0].incomplete, false);
});

test('template tanpa foto berstatus belum lengkap', async (t) => {
  const root = setupTree([
    'Wedding/Prints/20240101_120030_000.jpg'
  ]);
  cleanup(t, root);

  const sessions = await scan(root, 'Wedding');

  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.hasPrint, true);
  assert.equal(s.photos.length, 0);
  assert.equal(s.incomplete, true);
});

test('foto tanpa template tampil sebagai sesi tanpa print, dipisah per jeda klaster', async (t) => {
  const root = setupTree([
    'Wedding/Singles/20240101_120000_000.jpg',
    'Wedding/Singles/20240101_120010_000.jpg',
    'Wedding/Singles/20240101_121000_000.jpg'
  ]);
  cleanup(t, root);

  const sessions = await scan(root, 'Wedding');

  assert.equal(sessions.length, 2);
  for (const s of sessions) {
    assert.equal(s.hasPrint, false);
    assert.equal(s.status, 'no-print');
    assert.equal(s.incomplete, true);
  }
  const sizes = sessions.map((s) => s.photos.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test('lima foto sebelum satu template: 4 dipakai, 1 jadi sesi tanpa print', async (t) => {
  const root = setupTree([
    'Staging/Singles/20240101_120000_000.jpg',
    'Staging/Singles/20240101_120010_000.jpg',
    'Staging/Singles/20240101_120020_000.jpg',
    'Staging/Singles/20240101_120030_000.jpg',
    'Staging/Singles/20240101_120040_000.jpg',
    'Staging/Prints/20240101_120050_000.jpg'
  ]);
  cleanup(t, root);

  const sessions = await scan(root, 'Staging');

  assert.equal(sessions.length, 2);
  const withPrint = sessions.find((s) => s.hasPrint);
  const withoutPrint = sessions.find((s) => !s.hasPrint);
  assert.equal(withPrint.photos.length, 4);
  assert.equal(withPrint.incomplete, false);
  assert.equal(withoutPrint.photos.length, 1);
  assert.equal(withoutPrint.status, 'no-print');

  const chosen = withPrint.photos.map((p) => path.basename(p.path));
  assert.deepEqual(chosen, [
    '20240101_120010_000.jpg',
    '20240101_120020_000.jpg',
    '20240101_120030_000.jpg',
    '20240101_120040_000.jpg'
  ]);
});

test('varian template _1x/_2x disatukan, QR print dan thumbnail ikut terdeteksi', async (t) => {
  const root = setupTree([
    'Wedding/Singles/20240101_120001_000.jpg',
    'Wedding/Singles/20240101_120011_000.jpg',
    'Wedding/Singles/20240101_120021_000.jpg',
    'Wedding/Singles/20240101_120025_000.CR2',
    'Wedding/Singles/20240101_120026_000.txt',
    'Wedding/Singles/thumb/thumb_20240101_120001_000.jpg',
    'Wedding/Prints/20240101_120030_000.jpg',
    'Wedding/Prints/20240101_120030_000_1x.jpg',
    'Wedding/Prints/20240101_120030_000_2x.jpg',
    'Wedding/Prints/Qr/20240101_120030_000.jpg'
  ]);
  cleanup(t, root);

  const sessions = await scan(root, 'Wedding');

  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.photos.length, 3);
  assert.equal(s.prints.length, 3);
  const variants = s.prints.map((p) => p.variant);
  assert.ok(variants.includes('1x'), 'varian 1x ada');
  assert.ok(variants.includes('2x'), 'varian 2x ada');
  assert.ok(variants.includes(null), 'print utama tanpa varian ada');
  assert.ok(s.qrPrint, 'qrPrint terdeteksi');
  assert.ok(s.photos[0].thumb, 'thumbnail terpasang untuk foto pertama');
  assert.equal(s.photos.filter((p) => p.path.endsWith('.CR2')).length, 0);
  assert.equal(s.photos.filter((p) => p.path.endsWith('.txt')).length, 0);
});
