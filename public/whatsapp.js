'use strict';

// Form berbagi dipakai dashboard dan detail sesi. Nomor hanya ada di browser
// sampai operator membuka WhatsApp; aplikasi tidak menyimpan atau mengirimnya.
const SessionWhatsapp = (() => {
  let modal;
  let input;
  let error;
  let sessionUrl = '';

  function close() {
    modal.classList.add('hidden');
    input.value = '';
    error.textContent = '';
    sessionUrl = '';
  }

  function normalizePhone(value) {
    let number = String(value).replace(/[\s().-]/g, '');
    if (number.startsWith('+')) number = number.slice(1);
    if (number.startsWith('0')) number = '62' + number.slice(1);
    return /^628\d{8,11}$/.test(number) ? number : null;
  }

  function setup() {
    modal = document.createElement('div');
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-box whatsapp-box" role="dialog" aria-modal="true" aria-labelledby="whatsapp-title">
        <button class="modal-close" type="button" aria-label="Tutup">×</button>
        <h3 id="whatsapp-title">Kirim link via WhatsApp</h3>
        <p class="whatsapp-session"></p>
        <form class="whatsapp-form">
          <label for="whatsapp-phone">Nomor WhatsApp penerima</label>
          <input id="whatsapp-phone" class="lp-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="Contoh: 081234567890" required />
          <p class="whatsapp-error" role="alert"></p>
          <button class="btn" type="submit">Lanjut ke WhatsApp</button>
        </form>
      </div>`;
    document.body.appendChild(modal);
    input = modal.querySelector('#whatsapp-phone');
    error = modal.querySelector('.whatsapp-error');
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const phone = normalizePhone(input.value);
      if (!phone) {
        error.textContent = 'Masukkan nomor HP Indonesia yang valid (08, 62, atau +62).';
        input.focus();
        return;
      }
      const message = 'Halo! Lihat foto Memory Photobooth Anda di sini:\n' + sessionUrl;
      const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message);
      window.open(url, '_blank', 'noopener,noreferrer');
      close();
    });
  }

  return {
    open(url, title) {
      if (!modal) setup();
      sessionUrl = url;
      modal.querySelector('.whatsapp-session').textContent = title;
      modal.classList.remove('hidden');
      input.focus();
    }
  };
})();
