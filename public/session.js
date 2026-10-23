'use strict';

const $ = (id) => document.getElementById(id);
const mediaUrl = (p) => '/file?p=' + encodeURIComponent(p);
let id = location.pathname.split('/').pop() || '';
try {
  id = decodeURIComponent(id);
} catch (_) {}

let session = null;
let pendingMeta = null;
let cloudEnabled = false;
let cloudUploadIncomplete = false;
let zipBusy = false;
let isAdmin = false;
let pollTimer = null;
let unknownTries = 0;
let statusFetchedAt = 0;

function fmtDate(iso) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(iso));
  } catch (_) {
    return iso;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
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

function lightbox(src) {
  $('lightbox-img').src = src;
  $('lightbox').classList.remove('hidden');
}

function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function setQr(url) {
  const qrUrl = String(url).replace(/\/+$/, '') + '/qr.png';
  $('qr').src = qrUrl + '?size=512&cb=' + Date.now();
  $('url').textContent = url;
  $('btn-qr-dl').href = qrUrl + '?size=1024';
  $('btn-copy').onclick = () => copyText(url);
}

function setEventLink(eventName) {
  const link = $('btn-event');
  if (eventName) {
    link.href = '/e/' + encodeURIComponent(eventName);
    link.classList.remove('hidden');
  } else {
    link.classList.add('hidden');
    link.removeAttribute('href');
  }
}

/** Tampilan loading: QR sudah bisa dipakai, foto menyusul otomatis. */
function showPending(meta) {
  if (meta) pendingMeta = meta;
  const info = meta || pendingMeta;
  const eventName = (info && info.event) || '';
  const gaveUp = !info && unknownTries >= 40;

  $('pending-panel').classList.remove('hidden');
  $('banner').classList.add('hidden');
  $('upload-status').classList.add('hidden');
  $('feature').classList.add('hidden');
  $('photos').innerHTML = '';
  $('zip-row').classList.add('hidden');
  $('zip-progress').classList.add('hidden');
  $('zip-info').classList.add('hidden');
  $('collage-row').classList.add('hidden');
  $('files').innerHTML = '';

  $('event-name').textContent = eventName || 'Memory Photobooth';
  $('title').textContent = gaveUp ? 'Sesi belum tersedia' : 'Menyiapkan sesi…';
  $('subtitle').textContent = info
    ? `${info.event} • ${info.photoCount || 0} foto + ${info.printCount || 0} template • menunggu unggahan`
    : 'Menunggu data sesi dari server...';

  $('pending-title').textContent = gaveUp ? 'Sesi belum tersedia' : 'Menyiapkan sesi…';
  $('pending-text').textContent = gaveUp
    ? 'Server belum menerima sesi ini. Pastikan QR yang discan benar, lalu coba lagi.'
    : 'Foto sedang diunggah ke server online. Halaman ini akan menampilkan foto secara otomatis — tidak perlu scan ulang.';
  $('pending-meta').textContent = info
    ? `${info.expectedFiles ? info.expectedFiles + ' file' : 'Foto'} akan tampil di sini otomatis.`
    : '';

  $('pending-error').classList.add('hidden');
  $('pending-retry').classList.toggle('hidden', !gaveUp);

  setQr((info && info.url) || (location.origin + '/s/' + encodeURIComponent(id)));
  setEventLink(eventName);
}

function hidePending() {
  $('pending-panel').classList.add('hidden');
  $('zip-row').classList.remove('hidden');
  $('collage-row').classList.remove('hidden');
  $('pending-meta').textContent = '';
  $('pending-error').classList.add('hidden');
  $('pending-retry').classList.add('hidden');
}

async function loadMe() {
  try {
    const r = await fetch('/api/me');
    isAdmin = r.ok;
  } catch (_) {
    isAdmin = false;
  }
  $('admin-bar').classList.toggle('hidden', !isAdmin);
}

async function load() {
  clearTimeout(pollTimer);
  try {
    const wantStatus = Date.now() - statusFetchedAt > 30000;
    const [sr, r] = await Promise.all([
      wantStatus ? fetch('/api/status').catch(() => null) : Promise.resolve(null),
      fetch('/api/sessions/' + encodeURIComponent(id))
    ]);
    if (sr) {
      statusFetchedAt = Date.now();
      if (sr.ok) {
        try {
          const st = await sr.json();
          cloudEnabled = !!(st.cloud && st.cloud.enabled);
          cloudUploadIncomplete = !!(st.cloud && st.cloud.uploadIncomplete);
        } catch (_) {}
      }
    }

    if (r.status === 404) {
      unknownTries++;
      pendingMeta = null;
      showPending(null);
      if (unknownTries < 40) pollTimer = setTimeout(load, unknownTries <= 10 ? 3000 : 10000);
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);

    const data = await r.json();
    if (data.pending) {
      pendingMeta = data;
      unknownTries = 0;
      showPending(data);
      pollTimer = setTimeout(load, 2500);
      return;
    }

    session = data;
    pendingMeta = null;
    unknownTries = 0;
    hidePending();
    render();
    if (session.incomplete) pollTimer = setTimeout(load, 5000);
  } catch (err) {
    showPending(pendingMeta);
    $('pending-error').textContent = 'Menunggu koneksi ke server... (' + ((err && err.message) || err) + ')';
    $('pending-error').classList.remove('hidden');
    pollTimer = setTimeout(load, 5000);
  }
}

function render() {
  const s = session;
  document.title = (s.title || s.id) + ' — Memory Photobooth';
  $('event-name').textContent = s.event;
  $('title').textContent = s.title || s.id;
  $('subtitle').textContent =
    `${s.event} • ${s.photoCount} foto • ${s.printCount} template • id: ${s.id}`;

  const banner = $('banner');
  if (s.incomplete) {
    banner.classList.remove('hidden', 'ok');
    banner.textContent = `Sesi belum lengkap — ${s.photoCount} foto, ${s.printCount ? 'template sudah ada' : 'menunggu template'}. Halaman ini menyegarkan diri otomatis.`;
  } else {
    banner.classList.remove('hidden');
    banner.classList.add('ok');
    banner.textContent = `Sesi lengkap: ${s.photoCount} foto + ${s.printCount} template. QR aktif.`;
  }

  // status unggah ke server online (hanya tampil di booth)
  const box = $('upload-status');
  if (!cloudEnabled) {
    box.classList.add('hidden');
  } else if (s.cloud && s.cloud.uploadedAt) {
    box.classList.remove('hidden');
    box.classList.add('done');
    $('upload-state').textContent = 'TERKIRIM';
    $('upload-info').textContent = 'Sesi ini sudah tersedia di website online.';
    box.querySelector('.bar').classList.add('hidden');
  } else if (s.incomplete && !cloudUploadIncomplete) {
    box.classList.remove('hidden');
    box.classList.add('done');
    $('upload-state').textContent = 'MENUNGGU LENGKAP';
    $('upload-info').textContent = 'Sesi akan diunggah otomatis setelah foto & template lengkap.';
    box.querySelector('.bar').classList.add('hidden');
  } else {
    box.classList.remove('hidden', 'done');
    box.querySelector('.bar').classList.remove('hidden');
    if (s.cloud && s.cloud.uploadState === 'uploading') {
      $('upload-state').textContent = 'MENGUNGGAH';
      $('upload-info').textContent = 'Mengirim file sesi ke server...';
    } else if (s.cloud && s.cloud.uploadState === 'retry') {
      $('upload-state').textContent = 'ULANG';
      $('upload-info').textContent = 'Koneksi terganggu, pengiriman otomatis diulang. ' +
        (s.cloud.nextRetryAt ? 'Percobaan berikutnya ' + fmtDate(s.cloud.nextRetryAt) + '.' : '');
    } else {
      $('upload-state').textContent = 'ANTRE';
      $('upload-info').textContent = 'File sesi akan otomatis terkirim ke server online.';
    }
  }

  // template utama
  const feature = $('feature');
  const mainPrint = s.prints[0];
  if (mainPrint) {
    feature.classList.remove('hidden');
    $('feature-img').src = mediaUrl(mainPrint.path);
    $('feature-img').onclick = () => lightbox(mediaUrl(mainPrint.path));
    $('feature-cap').textContent = 'Template' + (mainPrint.variant ? ' ' + mainPrint.variant : '');
  } else {
    feature.classList.add('hidden');
  }

  // foto-foto sesi
  const wrap = $('photos');
  wrap.innerHTML = '';
  for (const p of s.photos) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = mediaUrl(p.thumb || p.path);
    img.onclick = () => lightbox(mediaUrl(p.path));
    wrap.appendChild(img);
  }

  setQr(s.url);
  setEventLink(s.event);

  // daftar file (tombol hapus hanya untuk admin yang login)
  const files = [];
  s.photos.forEach((p, i) => files.push({ label: 'Foto ' + (i + 1), path: p.path }));
  s.prints.forEach((p, i) => files.push({
    label: 'Template' + (p.variant ? ' ' + p.variant : (s.prints.length > 1 ? ' ' + (i + 1) : '')),
    path: p.path
  }));
  if (s.qrPrint) files.push({ label: 'Template QR (DSLRBooth)', path: s.qrPrint });

  $('files').innerHTML = files.map((f) => `
    <li>
      <span class="f-label">
        <span class="f-name">${esc(f.label)}</span>
      </span>
      <span class="f-actions">
        <a class="btn small ghost" href="/file?p=${encodeURIComponent(f.path)}&download=1">Unduh</a>
        ${isAdmin ? `<button class="btn small ghost danger f-del" data-path="${esc(f.path)}">Hapus</button>` : ''}
      </span>
    </li>`).join('');
  $('files').onclick = (e) => {
    const btn = e.target.closest('.f-del');
    if (btn) deleteFile(btn.dataset.path);
  };

  $('btn-collage').onclick = makeCollage;
  $('btn-zip').onclick = downloadZip;
}

// ---------- hapus (khusus admin) ----------

async function deleteFile(rel) {
  if (!isAdmin) return;
  if (!confirm('Hapus file ini dari sesi?\n\nFile akan dihapus permanen dari penyimpanan server ini.')) return;
  try {
    const r = await fetch('/api/sessions/' + encodeURIComponent(id) + '/file?p=' + encodeURIComponent(rel), {
      method: 'DELETE'
    });
    if (r.status === 401) { location.replace('/login'); return; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    toast('File dihapus');
    setTimeout(load, 1200);
  } catch (err) {
    toast('Gagal menghapus file: ' + err.message);
  }
}

async function deleteSession() {
  if (!isAdmin) return;
  const info = session || pendingMeta;
  const eventName = (info && info.event) || '';
  if (!confirm('Hapus SELURUH sesi ini (foto + template)?\n\nFile akan dihapus permanen dari penyimpanan server ini dan tidak bisa dikembalikan.')) return;
  try {
    const r = await fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
    if (r.status === 401) { location.replace('/login'); return; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    toast('Sesi dihapus');
    setTimeout(() => {
      location.href = eventName ? '/e/' + encodeURIComponent(eventName) : '/';
    }, 700);
  } catch (err) {
    toast('Gagal menghapus sesi: ' + err.message);
  }
}

// ---------- ZIP: unduh semua file sesi dengan progress ----------

function downloadZip() {
  if (zipBusy || !session) return;
  zipBusy = true;
  const btn = $('btn-zip');
  const bar = $('zip-progress');
  const fill = bar.querySelector('i');
  const info = $('zip-info');
  btn.disabled = true;
  btn.textContent = 'Menyiapkan...';
  bar.classList.remove('hidden', 'indeterminate');
  bar.classList.add('indeterminate');
  info.classList.remove('hidden');
  info.textContent = 'Server menyiapkan arsip sesi...';

  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/sessions/' + encodeURIComponent(id) + '/zip');
  xhr.responseType = 'blob';
  xhr.onprogress = (e) => {
    bar.classList.remove('indeterminate');
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      fill.style.width = pct + '%';
      info.textContent = `Mengunduh ${fmtBytes(e.loaded)} / ${fmtBytes(e.total)} (${pct}%)`;
      btn.textContent = `Mengunduh ${pct}%`;
    } else {
      info.textContent = 'Mengunduh ' + fmtBytes(e.loaded) + '...';
    }
  };
  xhr.onload = () => {
    if (xhr.status !== 200) {
      return failZip('Gagal: HTTP ' + xhr.status);
    }
    fill.style.width = '100%';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(xhr.response);
    a.download = 'memoryphotobooth-' + id + '.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    btn.textContent = 'Terunduh';
    info.textContent = 'Arsip tersimpan di perangkat Anda.';
    toast('Semua foto + template terunduh');
    setTimeout(resetZipBtn, 2500);
    zipBusy = false;
  };
  xhr.onerror = () => failZip('Koneksi terputus');
  xhr.send();

  function failZip(msg) {
    btn.textContent = 'Unduh semua (ZIP)';
    info.textContent = msg + ' — coba lagi.';
    bar.classList.add('hidden');
    btn.disabled = false;
    zipBusy = false;
  }
  function resetZipBtn() {
    btn.textContent = 'Unduh semua (ZIP)';
    btn.disabled = false;
    bar.classList.add('hidden');
    info.classList.add('hidden');
    fill.style.width = '0%';
  }
}

// ---------- Kolase: 4 foto + QR, digambar di canvas browser ----------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) {
    sh = img.height;
    sw = sh * r;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / r;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function makeCollage() {
  if (!session) return;
  const btn = $('btn-collage');
  btn.disabled = true;
  btn.textContent = 'Membuat kolase...';
  try {
    const W = 1200;
    const H = 1800;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const margin = 34;
    const gap = 18;
    const cellW = (W - margin * 2 - gap) / 2;
    const cellH = Math.round(cellW * 4 / 3);
    const gridH = cellH * 2 + gap;
    const footerY = margin + gridH + 26;

    const sources = session.photos.map((p) => p.path);
    for (const p of session.prints) {
      if (sources.length >= 4) break;
      sources.push(p.path);
    }
    const imgs = [];
    for (const src of sources.slice(0, 4)) {
      try { imgs.push(await loadImage(mediaUrl(src))); } catch (_) {}
    }

    for (let i = 0; i < imgs.length; i++) {
      const cx = margin + (i % 2) * (cellW + gap);
      const cy = margin + Math.floor(i / 2) * (cellH + gap);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cellW, cellH);
      ctx.clip();
      drawCover(ctx, imgs[i], cx, cy, cellW, cellH);
      ctx.restore();
    }

    // footer
    const footerH = H - footerY;
    const grad = ctx.createLinearGradient(0, footerY, 0, H);
    grad.addColorStop(0, '#0f9b9b');
    grad.addColorStop(1, '#0b7f86');
    ctx.fillStyle = grad;
    ctx.fillRect(0, footerY, W, footerH);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '600 26px "Epilogue", sans-serif';
    ctx.fillText('MEMORY PHOTOBOOTH', W / 2, footerY + 52);

    ctx.font = '600 58px "Fraunces", Georgia, serif';
    let name = (session.event || '').toUpperCase();
    while (name && ctx.measureText(name).width > W - 60 && ctx.font.indexOf('58px') > -1) {
      ctx.font = '600 38px "Fraunces", Georgia, serif';
    }
    if (name) ctx.fillText(name, W / 2, footerY + 126);

    // logo Memory Photobooth di footer kolase
    try {
      const logo = await loadImage('/logo.png');
      const lh = 150;
      const lw = Math.round((logo.width / logo.height) * lh);
      ctx.drawImage(logo, margin, footerY + footerH - lh - 26, lw, lh);
    } catch (_) {}

    try {
      const qr = await loadImage(session.qr + '?size=420&cb=' + Date.now());
      const qs = 190;
      const qx = (W - qs) / 2;
      const qy = footerY + footerH - qs - 26;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qx - 10, qy - 10, qs + 20, qs + 20);
      ctx.drawImage(qr, qx, qy, qs, qs);
    } catch (_) {}

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = session.id + '_kolase.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Kolase terunduh');
  } catch (err) {
    toast('Gagal membuat kolase: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unduh kolase (4 foto + QR)';
  }
}

$('pending-retry').addEventListener('click', () => {
  unknownTries = 0;
  $('pending-retry').classList.add('hidden');
  load();
});
$('btn-delete-session').addEventListener('click', deleteSession);

(async function init() {
  await loadMe();
  load();
})();
