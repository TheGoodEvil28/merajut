const money = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
});

for (const [selector, breakpoint] of [['[data-queue-menu]',720],['[data-desk-filter-menu]',680]]) {
  const menu = document.querySelector(selector);
  if (!menu) continue;
  const compact = window.matchMedia('(max-width: '+breakpoint+'px)');
  const fitMenu = () => { menu.open = !compact.matches; };
  compact.addEventListener('change',fitMenu);
  fitMenu();
}

const service = document.querySelector('[data-service-picker]');
const emailProof = document.querySelector('[data-email-proof]');
if (emailProof && /^#[a-f0-9]{64}$/.test(location.hash)) {
  emailProof.value = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
}
const guestPhoto = document.querySelector('[data-guest-photo]');
if (guestPhoto) {
  const button = guestPhoto.querySelector('button');
  const status = guestPhoto.querySelector('[role="status"]');
  button.hidden = false;
  guestPhoto.addEventListener('submit', async event => {
    event.preventDefault();
    const file = guestPhoto.querySelector('[type="file"]').files[0];
    if (!file || file.size > 3145728) { status.textContent='Pilih foto hingga 3 MB.'; return; }
    button.disabled = true;
    try {
      const response = await fetch(guestPhoto.action,{method:'POST',headers:{'X-CSRF-Token':guestPhoto.elements._csrf.value},body:file});
      status.textContent=response.ok ? 'Foto tersimpan dalam draf.' : 'Unggah gagal. Periksa format foto dan masa berlaku draf.';
    } catch { status.textContent='Koneksi terputus. Silakan coba lagi.'; }
    finally { button.disabled=false; }
  });
}
if (service) {
  const hint = document.querySelector('[data-service-hint]');
  const estimates = document.querySelectorAll('[data-request-estimate]');
  const quantity = service.form?.elements.quantity;
  function refresh() {
    const choice = service.selectedOptions[0];
    if (hint) hint.textContent = choice?.dataset.hint || 'Jelaskan bagian pakaian dan perubahan yang Anda inginkan.';
    if (!estimates.length) return;
    const price = Number(choice?.dataset.price);
    const count = quantity?.valueAsNumber;
    const amount = !choice?.value ? 'Pilih layanan' : !price ? 'Sesuai penawaran'
      : Number.isInteger(count) && count>=1 && count<=50 ? money.format(price*count) : 'Isi jumlah pakaian';
    for (const output of estimates) output.textContent = amount;
  }
  service.addEventListener('change', refresh);
  quantity?.addEventListener('input', refresh);
  refresh();
}

if (navigator.clipboard) {
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      const status = button.parentElement.querySelector('[data-copy-status]');
      try {
        await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent.trim());
        status.textContent = 'Nomor disalin.';
      } catch {
        status.textContent = 'Pilih dan salin nomor secara manual.';
      }
    });
  }
}

const quote = document.querySelector('[data-quote-editor]');
if (quote) {
  const lines = quote.querySelector('[data-quote-lines]');
  const add = quote.querySelector('[data-add-line]');
  const template = quote.querySelector('template');
  const total = quote.querySelector('output');
  let nextIndex = lines.children.length + 1;

  function refresh() {
    let sum = 0;
    for (const row of lines.children) {
      const quantity = row.querySelector('[name="itemQuantity"]').valueAsNumber;
      const unitPrice = row.querySelector('[name="itemPrice"]').valueAsNumber;
      if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) sum += quantity * unitPrice;
    }
    total.textContent = money.format(sum);
    add.disabled = lines.children.length >= 8;
  }

  for (const remove of lines.querySelectorAll('[data-remove-line]')) remove.hidden = false;
  add.hidden = false;
  add.addEventListener('click', () => {
    const row = template.content.firstElementChild.cloneNode(true);
    const index = nextIndex++;
    for (const label of row.querySelectorAll('.sr-only')) label.textContent = 'baris ' + index;
    const remove = row.querySelector('[data-remove-line]');
    remove.hidden = false;
    remove.setAttribute('aria-label', 'Hapus rincian baris ' + index);
    lines.append(row);
    row.querySelector('input').focus();
    refresh();
  });
  lines.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-line]');
    if (!remove) return;
    remove.closest('[data-quote-line]').remove();
    refresh();
    add.focus();
  });
  quote.addEventListener('input', refresh);
  refresh();
}

const photo = document.querySelector('[data-photo-upload]');
if (photo) {
  photo.hidden = false;
  photo.addEventListener('submit', async event => {
    event.preventDefault();
    const file = photo.elements.photo.files[0];
    const status = photo.querySelector('[data-photo-status]');
    const button = photo.querySelector('button');
    const feedback = message => { status.textContent = message; status.hidden = false; };
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
      feedback('Pilih foto JPEG, PNG, atau WebP berukuran maksimal 3 MB.');
      return;
    }
    button.disabled = true;
    feedback('Sedang mengunggah foto…');
    try {
      const response = await fetch(photo.dataset.url, {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-CSRF-Token': photo.elements._csrf.value, Accept: 'application/json' },
        body: file
      });
      if (response.ok) {
        window.location.hash = 'request-photos';
        window.location.reload();
        return;
      }
      feedback(response.status === 409 ? 'Foto tidak dapat ditambahkan pada status permintaan ini atau batasnya sudah tercapai.'
        : response.status === 422 ? 'Foto tidak dapat dibaca. Pilih foto lain.' : 'Unggah gagal. Muat ulang halaman dan coba lagi.');
    } catch {
      feedback('Unggah gagal. Periksa sambungan dan coba lagi.');
    } finally {
      button.disabled = false;
    }
  });
}

// Storefront navbar: after scrolling about 0.6 of a viewport it slides back in from above.
const storefront = document.body.classList.contains('market-shell') ? document.querySelector('.site-header') : null;
if (storefront) {
  const root = document.body;
  const sync = () => {
    const past = window.scrollY > window.innerHeight * 0.6;
    const pinned = root.classList.contains('nav-pinned');
    if (past) {
      root.style.setProperty('--nav-h', `${storefront.offsetHeight}px`);
      root.classList.remove('nav-leaving');
      root.classList.add('nav-pinned');
    } else if (!past && pinned && !root.classList.contains('nav-leaving')) {
      root.classList.add('nav-leaving');
      const finish = () => root.classList.remove('nav-pinned', 'nav-leaving');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else setTimeout(() => { if (root.classList.contains('nav-leaving')) finish(); }, 260);
    }
  };
  addEventListener('scroll', sync, { passive: true });
  addEventListener('resize', sync);
  sync();
}

// Shared confirmation modal (views/confirm-dialog.ejs). Any form with data-confirm opens it before submitting.
const confirmDialog = document.querySelector('[data-confirm-dialog]');
if (confirmDialog && typeof confirmDialog.showModal === 'function') {
  const part = name => confirmDialog.querySelector(`[data-confirm-${name}]`);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pending = null;

  const close = result => {
    if (!confirmDialog.open || confirmDialog.classList.contains('is-closing')) return;
    confirmDialog.classList.add('is-closing');
    const done = () => {
      confirmDialog.classList.remove('is-closing');
      confirmDialog.close(result);
    };
    if (reduced.matches) done(); else setTimeout(done, 160);
  };

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.confirm) return;
    if (form.dataset.confirmed === 'yes') { delete form.dataset.confirmed; return; }
    event.preventDefault();
    pending = { form, submitter: event.submitter };
    const d = form.dataset;
    part('title').textContent = d.confirmTitle || 'Yakin?';
    part('message').textContent = d.confirm;
    part('ok').textContent = d.confirmAction || 'Lanjutkan';
    part('cancel').textContent = d.confirmCancel || 'Batal';
    part('ok').classList.toggle('danger', d.confirmTone === 'danger');
    part('icon-use').setAttribute('href', `/assets/studio-icons.svg#${d.confirmIcon || 'door'}`);
    confirmDialog.returnValue = '';
    confirmDialog.showModal();
    window.lenis?.stop();
  });

  // Both buttons are submit buttons of a method="dialog" form; animate out before closing.
  confirmDialog.addEventListener('submit', event => {
    event.preventDefault();
    close(event.submitter?.value === 'confirm' ? 'confirm' : 'cancel');
  });
  confirmDialog.addEventListener('cancel', event => { event.preventDefault(); close('cancel'); }); // Esc
  confirmDialog.addEventListener('click', event => { if (event.target === confirmDialog) close('cancel'); }); // backdrop
  confirmDialog.addEventListener('close', () => {
    window.lenis?.start();
    const job = pending;
    pending = null;
    if (job && confirmDialog.returnValue === 'confirm') {
      // Resubmit on the next task: during 'close' the page behind the modal can still be inert, and
      // Chrome then drops a submission whose submitter is an inert button. Only pass the submitter
      // when it carries a name/value the server needs.
      const submitter = job.submitter?.name && job.submitter.form === job.form ? job.submitter : undefined;
      setTimeout(() => {
        job.form.dataset.confirmed = 'yes';
        job.form.requestSubmit(submitter);
      });
    }
  });
}

// Dashboard drawer (studio pages below 960px): hamburger opens, close button / backdrop / Esc closes.
const navToggle = document.querySelector('[data-nav-toggle]');
if (navToggle) {
  const drawer = document.getElementById(navToggle.getAttribute('aria-controls'));
  const scrim = document.querySelector('[data-nav-scrim]');
  const closeButton = drawer.querySelector('[data-nav-close]');
  const isOpen = () => document.body.classList.contains('nav-open');
  const setOpen = open => {
    if (open === isOpen()) return;
    document.body.classList.toggle('nav-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    if (open) { window.lenis?.stop(); closeButton.focus(); }
    else { window.lenis?.start(); navToggle.focus({ preventScroll: true }); }
  };
  navToggle.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  scrim.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen() && !document.querySelector('dialog[open]')) setOpen(false);
  });
  window.matchMedia('(min-width: 960px)').addEventListener('change', event => {
    if (event.matches && isOpen()) { document.body.classList.remove('nav-open'); navToggle.setAttribute('aria-expanded', 'false'); }
  });
}
