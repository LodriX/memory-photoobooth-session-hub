'use strict';

const form = document.getElementById('login-form');
const errEl = document.getElementById('login-error');
const btn = document.getElementById('login-btn');

(async function check() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) location.replace('/');
  } catch (_) {}
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Memeriksa...';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      })
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      btn.textContent = 'Berhasil';
      location.replace('/');
      return;
    }
    errEl.textContent = data.error || 'Login gagal';
  } catch (_) {
    errEl.textContent = 'Tidak bisa terhubung ke server';
  }
  btn.disabled = false;
  btn.textContent = 'Masuk';
});
