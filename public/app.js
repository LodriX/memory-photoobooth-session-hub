'use strict';

const state = {
  items: [],
  total: 0,
  offset: 0,
  limit: 60,
  status: '',
  event: localStorage.getItem('mp_event') || '',
  q: '',
  events: [],
  cloudEnabled: false
};

const $ = (id) => document.getElementById(id);
const mediaUrl = (p) => '/file?p=' + encodeURIComponent(p);

function fmtDate(iso) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(iso));
  } catch (_) {
    return iso;
  }
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Link disalin');
}

// statistik menyesuaikan event yang dipilih
async function loadStats(retry = 3) {
  const errEl = $('stats-error');
  try {
    const r = await fetch('/api/angka?event=' + encodeURIComponent(state.event || ''));
    if (r.status === 401) { location.replace('/login'); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const st = await r.json();
    $('stat-total').textContent = st.total;
    $('stat-ready').textContent = st.ready;
    $('stat-incomplete').textContent = st.incomplete;
    $('stat-extra').textContent = state.event ? st.uploaded : st.events;
    $('stat-extra-label').textContent = state.event ? 'Terunggah' : 'Event';
    if (errEl) errEl.classList.add('hidden');
  } catch (err) {
    if (retry > 0) return void setTimeout(() => loadStats(retry - 1), 1500);
    ['stat-total', 'stat-ready', 'stat-incomplete', 'stat-extra'].forEach((id) => {
      const el = $(id);
      if (el) el.textContent = '?';
    });
    if (errEl) {
      errEl.textContent = 'Statistik gagal dimuat: ' + ((err && err.message) || err) + ' — klik untuk coba lagi';
      errEl.classList.remove('hidden');
      errEl.onclick = () => { errEl.classList.add('hidden'); loadStats(); };
    }
  }
}

async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    if (r.status === 401) { location.replace('/login'); return; }
    const st = await r.json();
    $('foot-root').textContent = 'Root: ' + st.rootDir;
    $('foot-scan').textContent = 'Scan terakhir: ' + (st.lastScanAt ? fmtDate(st.lastScanAt) : '—');
    $('scan-hint').textContent = st.scanning ? 'scanning...' : '';
    state.cloudEnabled = !!(st.cloud && st.cloud.enabled);
    $('lan-chip').textContent = st.lanUrl;
    $('lan-chip').onclick = () => copyText(st.lanUrl);
    const badge = $('live-badge');
    badge.classList.remove('off');
    badge.classList.add('on');
    badge.textContent = 'LIVE';
  } catch (err) {
    const badge = $('live-badge');
    badge.classList.remove('on');
    badge.classList.add('off');
    badge.textContent = 'SERVER MATI';
  }
}

async function loadEvents() {
  try {
    const r = await fetch('/api/events');
    const { events } = await r.json();
    state.events = events;
    const chips = $('event-chips');
    const all = [{ name: '', total: events.reduce((n, e) => n + e.total, 0) }, ...events];
    chips.innerHTML = all.map((e) => {
      const label = e.name ? e.name : 'Semua event';
      const active = state.event === e.name ? ' active' : '';
      return `<button class="chip-ev${active}" data-event="${esc(e.name)}">${esc(label)} (${e.total})</button>`;
    }).join('');
    chips.querySelectorAll('.chip-ev').forEach((b) => {
      b.addEventListener('click', () => {
        state.event = b.dataset.event;
        if (state.event) localStorage.setItem('mp_event', state.event);
        else localStorage.removeItem('mp_event');
        loadEvents();
        loadStats();
        loadSessions();
      });
    });
  } catch (_) {}
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function loadSessions(append = false, retry = 3) {
  const params = new URLSearchParams({
    limit: state.limit,
    offset: append ? state.offset : 0
  });
  if (state.event) params.set('event', state.event);
  if (state.status) params.set('status', state.status);
  if (state.q) params.set('q', state.q);

  try {
    const r = await fetch('/api/sessions?' + params.toString());
    if (r.status === 401) { location.replace('/login'); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    state.total = data.total;
    state.offset = (append ? state.offset : 0) + data.items.length;
    state.items = append ? state.items.concat(data.items) : data.items;
    render();
  } catch (err) {
    if (retry > 0) setTimeout(() => loadSessions(append, retry - 1), 1500);
    else if (!append) toast('Gagal memuat daftar sesi — coba muat ulang halaman');
  }
}

function uploadTag(s) {
  if (s.cloud && s.cloud.uploadedAt) return '<span class="tag ok">online</span>';
  if (s.cloud && s.cloud.uploadState === 'uploading') {
    return '<span class="tag warn">mengunggah</span><span class="bar tiny indeterminate"><i></i></span>';
  }
  if (s.cloud && s.cloud.uploadState === 'retry') {
    return '<span class="tag warn">unggah ulang</span>';
  }
  if (state.cloudEnabled) {
    return '<span class="tag warn">antre unggah</span><span class="bar tiny indeterminate"><i></i></span>';
  }
  return '';
}

function cardHtml(s) {
  // thumbnail kartu: utamakan template/print (hasil jadi yang dikenal tamu)
  const preview = (s.prints[0] && (s.prints[0].thumb || s.prints[0].path)) ||
    (s.photos[0] && (s.photos[0].thumb || s.photos[0].path)) || '';
  const img = preview
    ? `<img class="thumb" loading="lazy" src="${mediaUrl(preview)}" onclick="openSession('${esc(s.id)}')" alt="" />`
    : `<div class="thumb"></div>`;
  const tags = [];
  tags.push(`<span class="tag ${s.photoCount >= 4 ? 'ok' : 'warn'}">${s.photoCount} foto</span>`);
  tags.push(`<span class="tag ${s.prints.length ? 'ok' : 'warn'}">${s.prints.length} template</span>`);
  tags.push(uploadTag(s));
  if (s.incomplete) tags.push('<span class="tag warn">belum lengkap</span>');
  return `
    <div class="card">
      ${img}
      <div class="body">
        <div class="title">${esc(s.title || s.id)}</div>
        <div class="event">${esc(s.event)}</div>
        <div class="tags">${tags.join('')}</div>
        <div class="actions">
          <a class="btn" href="/s/${encodeURIComponent(s.id)}">Buka</a>
          <button class="btn ghost" onclick="showQr('${esc(s.id)}')">QR</button>
          <a class="btn ghost" href="/api/sessions/${encodeURIComponent(s.id)}/zip" title="Unduh semua foto + template">ZIP</a>
        </div>
      </div>
    </div>`;
}

function render() {
  const root = $('grid-root');
  const items = state.items;

  $('empty').classList.toggle('hidden', items.length > 0);
  $('load-more').classList.toggle('hidden', state.offset >= state.total);
  $('load-more').textContent = `Muat lebih banyak (${items.length}/${state.total})`;

  if (!state.event) {
    // kelompokkan per event (mengikuti nama folder)
    const groups = new Map();
    for (const s of items) {
      if (!groups.has(s.event)) groups.set(s.event, []);
      groups.get(s.event).push(s);
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      const ta = a[1][0] ? a[1][0].ts : '';
      const tb = b[1][0] ? b[1][0].ts : '';
      return tb < ta ? -1 : tb > ta ? 1 : 0;
    });
    root.innerHTML = ordered.map(([name, list]) => `
      <section class="event-sec">
        <h3 class="event-title">${esc(name)} <span class="count">${list.length} sesi ditampilkan</span></h3>
        <div class="grid">${list.map(cardHtml).join('')}</div>
      </section>`).join('');
  } else {
    root.innerHTML = `<section class="event-sec">
      <h3 class="event-title">${esc(state.event)} <span class="count">${state.total} sesi</span></h3>
      <div class="grid">${items.map(cardHtml).join('')}</div>
    </section>`;
  }
}

function openSession(id) {
  location.href = '/s/' + encodeURIComponent(id);
}

function showModal(s) {
  $('modal-title').textContent = s.title || s.id;
  $('modal-qr').src = s.qr + '?size=480&cb=' + Date.now();
  $('modal-link').textContent = s.url;
  $('modal-open').href = '/s/' + encodeURIComponent(s.id);
  $('modal-download').href = s.qr + '?size=1024';
  $('qr-modal').classList.remove('hidden');
}

async function showQr(id) {
  try {
    const r = await fetch('/api/sessions/' + encodeURIComponent(id));
    if (!r.ok) throw new Error('not found');
    showModal(await r.json());
  } catch (_) {
    showModal({ id, title: id, url: location.origin + '/s/' + id, qr: '/s/' + id + '/qr.png' });
  }
}
function closeModal() { $('qr-modal').classList.add('hidden'); }
function copyModalLink() { copyText($('modal-link').textContent); }

$('qr-modal').addEventListener('click', (e) => {
  if (e.target.id === 'qr-modal') closeModal();
});

// ---------- filter ----------
let debounceTimer = null;
function onFilterChanged() {
  state.status = $('filter-status').value;
  state.q = $('search').value.trim();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadSessions(), 250);
}
$('filter-status').addEventListener('change', onFilterChanged);
$('search').addEventListener('input', onFilterChanged);
$('load-more').addEventListener('click', () => loadSessions(true));
$('btn-rescan').addEventListener('click', async () => {
  toast('Memindai ulang...');
  await fetch('/api/rescan', { method: 'POST' });
  await Promise.all([loadStats(), loadStatus(), loadEvents(), loadSessions()]);
  toast('Selesai');
});

$('btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
  location.href = '/login';
});

// ---------- live update (SSE + fallback polling) ---------- */
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    loadStats();
    loadStatus();
    loadSessions();
  }, 700);
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('change', scheduleRefresh);
  es.addEventListener('state', () => { loadStats(); loadStatus(); });
  es.onerror = () => {
    es.close();
    setTimeout(connectStream, 5000);
  };
}

(async function init() {
  try {
    const me = await fetch('/api/me');
    if (me.status === 401) { location.replace('/login'); return; }
  } catch (_) {}
  // semua muat paralel; kegagalan satu tidak menghalangi yang lain
  await Promise.allSettled([loadStats(), loadStatus(), loadEvents(), loadSessions()]);
  connectStream();
  setInterval(loadStats, 15000);
  setInterval(loadStatus, 30000);
  // muat ulang saat koneksi kembali (mis. server baru selesai restart)
  window.addEventListener('online', () => {
    loadStats(); loadStatus(); loadEvents(); loadSessions();
  });
})();
