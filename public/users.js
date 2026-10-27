'use strict';

const $ = (id) => document.getElementById(id);
let users = [];
let events = [];
let editing = null;
let self = '';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, options) {
  const r = await fetch(url, options);
  if (r.status === 401) { location.href = '/login'; throw new Error('Silakan login kembali'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
  return data;
}

function render() {
  $('users-list').innerHTML = users.map((u) => `
    <div class="user-item">
      <div><b>${esc(u.username)}</b> <span class="tag">${esc(u.role)}</span>
        <div class="hint">${u.role === 'admin' ? esc(u.events.join(', ')) : 'Semua event'}</div></div>
      <div class="row"><button class="btn small ghost" data-edit="${esc(u.username)}">Edit / reset password</button>
      ${u.username !== self ? `<button class="btn small ghost danger" data-delete="${esc(u.username)}">Hapus</button>` : ''}</div>
    </div>`).join('');
  $('user-events').innerHTML = events.map((name) => `<label><input type="checkbox" value="${esc(name)}" /> ${esc(name)}</label>`).join('') ||
    '<span class="hint">Belum ada event. Tambahkan event sebelum membuat admin event.</span>';
  $('user-events-wrap').classList.toggle('hidden', $('user-role').value !== 'admin');
}

function resetForm() {
  editing = null;
  $('user-form').reset();
  $('user-name').disabled = false;
  $('user-form-title').textContent = 'Tambah user';
  $('password-hint').textContent = '(minimal 8 karakter)';
  $('user-cancel').classList.add('hidden');
  $('user-error').textContent = '';
  render();
}

$('users-list').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  const remove = e.target.closest('[data-delete]');
  if (edit) {
    const u = users.find((item) => item.username === edit.dataset.edit);
    if (!u) return;
    editing = u.username;
    $('user-name').value = u.username;
    $('user-name').disabled = false;
    $('user-role').value = u.role;
    $('user-password').value = '';
    $('user-form-title').textContent = 'Edit ' + u.username;
    $('password-hint').textContent = '(kosongkan jika tidak diubah)';
    $('user-cancel').classList.remove('hidden');
    $('user-error').textContent = '';
    render();
    $('user-events').querySelectorAll('input').forEach((box) => { box.checked = u.events.includes(box.value); });
    $('user-form').scrollIntoView({ behavior: 'smooth' });
  }
  if (remove && confirm('Hapus user ' + remove.dataset.delete + '? User akan langsung keluar dari sesi login.')) {
    try {
      await api('/api/users/' + encodeURIComponent(remove.dataset.delete), { method: 'DELETE' });
      await reload();
      resetForm();
    } catch (err) { $('user-error').textContent = err.message; }
  }
});

$('user-role').addEventListener('change', () => {
  $('user-events-wrap').classList.toggle('hidden', $('user-role').value !== 'admin');
});
$('user-cancel').addEventListener('click', resetForm);
$('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const role = $('user-role').value;
  const selected = [...$('user-events').querySelectorAll('input:checked')].map((box) => box.value);
  if (role === 'admin' && !selected.length) { $('user-error').textContent = 'Pilih minimal satu event.'; return; }
  const password = $('user-password').value;
  const body = { username: $('user-name').value.trim(), role, events: role === 'admin' ? selected : [] };
  if (editing) { if (password) body.password = password; }
  else { body.password = password; }
  try {
    await api(editing ? '/api/users/' + encodeURIComponent(editing) : '/api/users', {
      method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (editing === self) { location.href = '/login'; return; }
    await reload();
    resetForm();
  } catch (err) { $('user-error').textContent = err.message; }
});

async function reload() {
  const [userData, eventData] = await Promise.all([api('/api/users'), api('/api/events')]);
  users = userData.users;
  events = eventData.events.map((event) => event.name);
  render();
}

(async () => {
  try {
    const me = await api('/api/me');
    if (me.role !== 'superadmin' || !me.whatsappEnabled) { location.href = '/'; return; }
    self = me.user;
    await reload();
  } catch (err) { $('user-error').textContent = err.message; }
})();
