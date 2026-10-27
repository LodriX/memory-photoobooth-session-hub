'use strict';

const $ = (id) => document.getElementById(id);
(async () => {
  const r = await fetch('/api/me');
  if (!r.ok) { location.href = '/login'; return; }
  const me = await r.json();
  if (!me.whatsappEnabled) { location.href = '/'; return; }
  $('account-name').textContent = me.user;
})().catch(() => { $('password-error').textContent = 'Tidak bisa memuat akun'; });

$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('password-error');
  err.textContent = '';
  const newPassword = $('new-password').value;
  if (newPassword !== $('confirm-password').value) { err.textContent = 'Konfirmasi password tidak cocok'; return; }
  try {
    const r = await fetch('/api/me/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: $('current-password').value, newPassword })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Gagal mengganti password');
    location.href = '/login';
  } catch (error) { err.textContent = error.message; }
});
