'use strict';

const $ = (id) => document.getElementById(id);
let eventName = location.pathname.replace(/^\/e\//, '');
try {
  eventName = decodeURIComponent(eventName);
} catch (_) {}
let timer = null;
let lastSig = '';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtTime(iso) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    }).format(new Date(iso));
  } catch (_) {
    return iso || '';
  }
}

function cardHtml(s) {
  const href = '/s/' + encodeURIComponent(s.id);
  const title = esc(s.title || s.id);

  if (s.pending) {
    return `
      <div class="card">
        <a class="thumb pending-thumb" href="${href}">
          <span class="spinner"></span>
          <span>Sedang diunggah…</span>
        </a>
        <div class="body">
          <div class="title">${title}</div>
          <div class="event">${esc(s.event)}</div>
          <div class="tags">
            <span class="tag warn">menunggu upload</span>
            <span class="tag">${s.photoCount || 0} foto</span>
          </div>
          <div class="actions"><a class="btn ghost" href="${href}">Lihat status</a></div>
        </div>
      </div>`;
  }

  const thumb = s.preview
    ? `<a class="thumb-wrap" href="${href}"><img class="thumb" loading="lazy" src="/file?p=${encodeURIComponent(s.preview)}" alt="" /></a>`
    : `<a class="thumb-wrap" href="${href}"><div class="thumb"></div></a>`;
  const tags = [
    `<span class="tag ${s.incomplete ? 'warn' : 'ok'}">${s.photoCount} foto</span>`,
    `<span class="tag ${s.printCount ? 'ok' : 'warn'}">${s.printCount} template</span>`
  ];
  if (s.incomplete) tags.push('<span class="tag warn">belum lengkap</span>');

  return `
    <div class="card">
      ${thumb}
      <div class="body">
        <div class="title">${title}</div>
        <div class="event">${esc(fmtTime(s.ts))}</div>
        <div class="tags">${tags.join('')}</div>
        <div class="actions"><a class="btn" href="${href}">Buka</a></div>
      </div>
    </div>`;
}

function render(data) {
  document.title = data.event + ' — Memory Photobooth';
  $('event-name').textContent = data.event;
  $('event-title').textContent = data.event;
  $('event-sub').textContent =
    `${data.total} sesi • ${data.pending} sedang diunggah • halaman diperbarui otomatis`;
  $('foot-update').textContent = 'Diperbarui ' + fmtTime(new Date().toISOString());

  const badge = $('live-badge');
  badge.textContent = 'LIVE';
  badge.classList.add('on');
  badge.classList.remove('off');

  $('event-loading').classList.add('hidden');
  const empty = $('event-empty');
  empty.textContent = 'Belum ada sesi di event ini. Halaman ini menyegarkan diri otomatis.';

  const grid = $('event-grid');
  if (!data.items.length) {
    lastSig = '';
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // hindari render ulang (flicker) bila isi belum berubah
  const sig = data.items.map((i) =>
    [i.id, i.pending ? 1 : 0, i.photoCount, i.printCount, i.incomplete ? 1 : 0, i.ts].join(',')
  ).join('|');
  if (sig === lastSig) return;
  lastSig = sig;
  grid.innerHTML = data.items.map(cardHtml).join('');
}

async function load() {
  clearTimeout(timer);
  try {
    const r = await fetch('/api/events/' + encodeURIComponent(eventName), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    render(await r.json());
    timer = setTimeout(load, 5000);
  } catch (err) {
    $('event-loading').classList.add('hidden');
    const empty = $('event-empty');
    empty.classList.remove('hidden');
    empty.textContent = 'Menunggu koneksi ke server... mencoba lagi otomatis.';
    $('live-badge').textContent = 'OFFLINE';
    $('live-badge').classList.remove('on');
    $('live-badge').classList.add('off');
    timer = setTimeout(load, 5000);
  }
}

$('btn-refresh').addEventListener('click', load);
load();
