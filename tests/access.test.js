'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Auth } = require('../lib/auth');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('akun lama bermigrasi menjadi superadmin tanpa mengganti password', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionhub-legacy-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const legacy = new Auth(temp, 'ExistingPass123');
  const before = legacy.getUser('admin').hash;
  const migrated = new Auth(temp, '', true);
  assert.equal(migrated.getUser('admin').hash, before);
  assert.equal(migrated.getUser('admin').role, 'superadmin');
  assert.equal(migrated.verify('admin', 'ExistingPass123'), true);
});

test('akun VPS dibatasi per event dan password mencabut sesi login', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionhub-access-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const rootDir = path.join(temp, 'media');
  for (const [event, time] of [['Event A', '120100'], ['Event B', '130100']]) {
    const dir = path.join(rootDir, event, 'Prints');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `20261027_${time}_001.jpg`), 'fixture');
  }
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ rootDir, port, pushToken: 'test-push-token', baseUrl: base,
    auth: { adminPassword: 'InitialPass123' } }));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, SESSIONHUB_CONFIG: config, SESSIONHUB_DATA: path.join(temp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });

  let live = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break;
    try { live = (await fetch(base + '/login')).ok; if (live) break; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(live, 'server harus siap: ' + logs);

  async function request(route, cookie, method = 'GET', body) {
    const response = await fetch(base + route, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }
  async function login(username, password) {
    const { response } = await request('/api/login', '', 'POST', { username, password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }

  const superCookie = await login('admin', 'InitialPass123');
  assert.equal((await request('/api/sessions', superCookie)).data.total, 2);
  assert.equal((await request('/api/users', superCookie)).data.users[0].role, 'superadmin');
  const created = await request('/api/users', superCookie, 'POST', {
    username: 'operator', password: 'OperatorPass123', role: 'admin', events: ['Event A']
  });
  assert.equal(created.response.status, 201);
  assert.deepEqual(created.data.user.events, ['Event A']);
  assert.equal((await request('/api/users', superCookie, 'POST', {
    username: 'unknown', password: 'OperatorPass123', role: 'admin', events: ['Tidak ada']
  })).response.status, 400);

  const adminCookie = await login('operator', 'OperatorPass123');
  assert.equal((await request('/api/sessions', adminCookie)).data.total, 1);
  assert.deepEqual((await request('/api/events', adminCookie)).data.events.map((e) => e.name), ['Event A']);
  assert.equal((await request('/api/angka', adminCookie)).data.total, 1);
  assert.equal((await request('/api/status', adminCookie)).data.counts.total, 1);
  assert.equal((await request('/api/sessions?event=Event%20B', adminCookie)).response.status, 403);
  assert.equal((await request('/api/users', adminCookie)).response.status, 403);
  assert.equal((await fetch(base + '/users', { headers: { Cookie: adminCookie } })).status, 403);
  assert.equal((await request('/api/rescan', adminCookie, 'POST')).response.status, 403);
  assert.equal((await request('/api/sessions/20261027_130100_001', adminCookie, 'DELETE')).response.status, 403);
  // Halaman tamu dan data event publik tetap dapat dibuka untuk QR dan rekonsiliasi booth.
  assert.equal((await request('/api/events/Event%20B', '')).data.total, 1);
  assert.equal((await request('/api/sessions/20261027_130100_001', '')).response.status, 200);
  assert.equal((await fetch(base + '/apple-touch-icon.png')).status, 200);

  assert.equal((await request('/api/users/admin', superCookie, 'PUT', { role: 'admin', events: ['Event A'] })).response.status, 400);
  assert.equal((await request('/api/me/password', adminCookie, 'POST', {
    currentPassword: 'salah', newPassword: 'ChangedPass123'
  })).response.status, 400);
  assert.equal((await request('/api/me/password', adminCookie, 'POST', {
    currentPassword: 'OperatorPass123', newPassword: 'ChangedPass123'
  })).response.status, 200);
  assert.equal((await request('/api/me', adminCookie)).response.status, 401);
  const newCookie = await login('operator', 'ChangedPass123');
  assert.equal((await request('/api/users/operator', superCookie, 'PUT', {
    role: 'admin', events: ['Event B'], password: 'ResetPass123'
  })).response.status, 200);
  assert.equal((await request('/api/me', newCookie)).response.status, 401);
  const resetCookie = await login('operator', 'ResetPass123');
  assert.deepEqual((await request('/api/events', resetCookie)).data.events.map((e) => e.name), ['Event B']);
  assert.equal((await request('/api/users/operator', superCookie, 'PUT', {
    username: 'operator2', role: 'admin', events: ['Event B']
  })).response.status, 200);
  assert.equal((await request('/api/me', resetCookie)).response.status, 401);
  const renamedCookie = await login('operator2', 'ResetPass123');
  assert.equal((await request('/api/users/operator2', superCookie, 'DELETE')).response.status, 200);
  assert.equal((await request('/api/me', renamedCookie)).response.status, 401);
});
