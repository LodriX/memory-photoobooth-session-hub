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
let whatsappEnabled = false;
let canDelete = false;
let allowedEvents = [];
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
  updateShareButton();

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
    if (r.ok) {
      const me = await r.json();
      whatsappEnabled = !!me.whatsappEnabled;
      canDelete = !!me.canDelete;
      allowedEvents = me.events || [];
    }
  } catch (_) {
    isAdmin = false;
  }
  $('admin-bar').classList.toggle('hidden', !isAdmin);
  $('btn-delete-session').classList.toggle('hidden', !canDelete);
  $('btn-account').classList.toggle('hidden', !whatsappEnabled);
  updateShareButton();
}

function updateShareButton() {
  const s = session || pendingMeta;
  $('btn-share-whatsapp').classList.toggle('hidden', !(isAdmin && whatsappEnabled && s &&
    (canDelete || allowedEvents.includes(s.event))));
}

function shareSession() {
  const s = session || pendingMeta;
  if (isAdmin && whatsappEnabled && s && (canDelete || allowedEvents.includes(s.event))) {
    SessionWhatsapp.open(s.url, s.title || s.id);
  }
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
      session = null;
      unknownTries++;
      pendingMeta = null;
      showPending(null);
      if (unknownTries < 40) pollTimer = setTimeout(load, unknownTries <= 10 ? 3000 : 10000);
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);

    const data = await r.json();
    if (data.pending) {
      session = null;
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
    updateShareButton();
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
        ${canDelete ? `<button class="btn small ghost danger f-del" data-path="${esc(f.path)}">Hapus</button>` : ''}
      </span>
    </li>`).join('');
  $('files').onclick = (e) => {
    const btn = e.target.closest('.f-del');
    if (btn) deleteFile(btn.dataset.path);
  };

  $('btn-collage').onclick = makeCollage;
  $('btn-collage').textContent = collageLabel();
  $('collage-row').classList.toggle('hidden', !s.photos.length);
  $('btn-zip').onclick = downloadZip;
}

// ---------- hapus (khusus admin) ----------

async function deleteFile(rel) {
  if (!canDelete) return;
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
  if (!canDelete) return;
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

// ---------- Kolase: foto + QR, digambar di canvas browser ----------

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

/** Bungkus teks judul event menjadi beberapa baris di header kolase. */
function wrapLines(ctx, text, maxWidth) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (!line || ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitTitle(ctx, text, maxWidth, maxLines, maxSize, minSize) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `600 ${size}px "Fraunces", Georgia, serif`;
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { lines, size };
  }
  ctx.font = `600 ${minSize}px "Fraunces", Georgia, serif`;
  const lines = wrapLines(ctx, text, maxWidth).slice(0, maxLines);
  if (lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return { lines, size: minSize };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPhotoFrame(ctx, img, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(75, 58, 56, .16)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.restore();

  const pad = 10;
  const ix = x + pad;
  const iy = y + pad;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, 9);
  ctx.clip();
  ctx.fillStyle = '#f3e8de';
  ctx.fillRect(ix, iy, iw, ih);
  if (img) {
    drawCover(ctx, img, ix, iy, iw, ih);
  } else {
    ctx.fillStyle = '#9a8480';
    ctx.textAlign = 'center';
    ctx.font = '600 18px "Epilogue", system-ui, sans-serif';
    ctx.fillText('Foto tidak tersedia', ix + iw / 2, iy + ih / 2);
  }
  ctx.restore();
}

function collageLabel() {
  const n = session && session.photos ? session.photos.length : 0;
  return n ? `Unduh kolase (${n} foto + QR)` : 'Unduh kolase + QR';
}

async function makeCollage() {
  if (!session || !session.photos || !session.photos.length) {
    toast('Belum ada foto untuk kolase');
    return;
  }
  const btn = $('btn-collage');
  const label = collageLabel();
  btn.disabled = true;
  btn.textContent = 'Membuat kolase...';
  try {
    // Tunggu font web siap supaya hasil canvas memakai Fraunces/Epilogue.
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (_) {}

    const W = 1200;
    const M = 48;
    const GAP = 20;
    const HEADER_H = 150;
    const FOOTER_H = 300;
    const RATIO = 2 / 3; // foto DSLRBooth 3:2 landscape -> tinggi = lebar * 2/3
    const gridW = W - M * 2;
    const halfW = Math.floor((gridW - GAP) / 2);
    const halfH = Math.round(halfW * RATIO);
    const fullH = Math.round(gridW * RATIO);

    // 1 foto = full; 2 foto = dua full bertumpuk; 3+ = 2 kolom,
    // sisa 1 foto memakai lebar penuh. Tidak ada sel kosong.
    const n = session.photos.length;
    const rows = [];
    if (n <= 2) {
      for (let i = 0; i < n; i++) {
        rows.push([{ i, x: M, w: gridW, h: fullH }]);
      }
    } else {
      let i = 0;
      while (i < n) {
        if (n - i === 1) {
          rows.push([{ i, x: M, w: gridW, h: fullH }]);
          i += 1;
        } else {
          rows.push([
            { i, x: M, w: halfW, h: halfH },
            { i: i + 1, x: M + halfW + GAP, w: halfW, h: halfH }
          ]);
          i += 2;
        }
      }
    }

    const photosH = rows.reduce((sum, row, idx) => {
      return sum + Math.max(...row.map((cell) => cell.h)) + (idx ? GAP : 0);
    }, 0);
    const headerY = M;
    const gridY = headerY + HEADER_H + 24;
    const footerY = gridY + photosH + 28;
    const H = footerY + FOOTER_H;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f6efe8';
    ctx.fillRect(0, 0, W, H);

    // ---------- header ----------
    ctx.save();
    ctx.shadowColor = 'rgba(75, 58, 56, .12)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fffbf7';
    roundRect(ctx, M, headerY, gridW, HEADER_H, 24);
    ctx.fill();
    ctx.restore();

    let textX = M + 28;
    try {
      const logo = await loadImage('/logo.png');
      const lh = 92;
      const lw = Math.round((logo.width / logo.height) * lh);
      ctx.drawImage(logo, M + 26, headerY + (HEADER_H - lh) / 2, lw, lh);
      textX = M + 26 + lw + 24;
    } catch (_) {}

    const eventName = String(session.event || 'Memory Photobooth');
    const maxTextW = W - M - 28 - textX;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a9646f';
    ctx.font = '600 17px "Epilogue", system-ui, sans-serif';
    ctx.fillText('For Your Precious Memories', textX, headerY + 42);

    const title = fitTitle(ctx, eventName, maxTextW, 2, 40, 26);
    ctx.fillStyle = '#4b3a38';
    ctx.font = `600 ${title.size}px "Fraunces", Georgia, serif`;
    if (title.lines.length === 1) {
      ctx.fillText(title.lines[0], textX, headerY + 112);
    } else {
      const lh = title.size + 8;
      title.lines.forEach((line, i) => ctx.fillText(line, textX, headerY + 84 + i * lh));
    }

    // ---------- foto ----------
    const images = await Promise.all(session.photos.map((p) =>
      loadImage(mediaUrl(p.path)).catch(() => null)
    ));
    let rowY = gridY;
    for (const row of rows) {
      const rowH = Math.max(...row.map((cell) => cell.h));
      for (const cell of row) {
        drawPhotoFrame(ctx, images[cell.i], cell.x, rowY, cell.w, rowH);
      }
      rowY += rowH + GAP;
    }

    // ---------- footer ----------
    const grad = ctx.createLinearGradient(0, footerY, 0, footerY + FOOTER_H);
    grad.addColorStop(0, '#a9646f');
    grad.addColorStop(1, '#c4848d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, footerY, W, FOOTER_H);
    ctx.fillStyle = 'rgba(255, 255, 255, .25)';
    ctx.fillRect(M, footerY, W - M * 2, 1);

    const qrBox = 236;
    const qrSize = 192;
    const qx = W - M - qrBox;
    const qy = footerY + (FOOTER_H - qrBox) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(75, 58, 56, .20)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, qx, qy, qrBox, qrBox, 22);
    ctx.fill();
    ctx.restore();

    // URL relatif: QR tetap mengarah ke domain (baseUrl), tetapi canvas tidak
    // tercemar CORS saat halaman dibuka lewat localhost/LAN.
    const qr = await loadImage('/s/' + encodeURIComponent(session.id) + '/qr.png?size=420&cb=' + Date.now());
    ctx.drawImage(qr, qx + (qrBox - qrSize) / 2, qy + (qrBox - qrSize) / 2, qrSize, qrSize);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 34px "Fraunces", Georgia, serif';
    ctx.fillText('For Your Precious Memories', M, footerY + 76);

    ctx.fillStyle = 'rgba(255, 255, 255, .92)';
    ctx.font = '500 21px "Epilogue", system-ui, sans-serif';
    ctx.fillText(session.title || fmtDate(session.ts), M, footerY + 118);

    ctx.fillStyle = 'rgba(255, 255, 255, .86)';
    ctx.font = '400 19px "Epilogue", system-ui, sans-serif';
    ctx.fillText('Scan QR untuk melihat & mengunduh foto.', M, footerY + 166);

    let host = location.host;
    try {
      if (session.qr) host = new URL(session.qr).host || host;
    } catch (_) {}
    ctx.fillStyle = 'rgba(255, 255, 255, .65)';
    ctx.font = '600 15px "Epilogue", system-ui, sans-serif';
    ctx.fillText(String(host).toUpperCase(), M, footerY + 214);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, .88)';
    ctx.font = '600 13px "Epilogue", system-ui, sans-serif';
    ctx.fillText('SCAN UNTUK FOTO', qx + qrBox / 2, footerY + FOOTER_H - 17);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Canvas tidak dapat disimpan');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (session.id || 'sesi') + '_kolase.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Kolase terunduh');
  } catch (err) {
    toast('Gagal membuat kolase: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

$('pending-retry').addEventListener('click', () => {
  unknownTries = 0;
  $('pending-retry').classList.add('hidden');
  load();
});
$('btn-delete-session').addEventListener('click', deleteSession);
$('btn-share-whatsapp').addEventListener('click', shareSession);

(async function init() {
  await loadMe();
  load();
})();
