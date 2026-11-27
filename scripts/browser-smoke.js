import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { seedEmails } from '../apps/marajut/seed.js';
import { previewBrowserOptions } from './preview-auth.js';

const base = new URL(process.env.APP_ORIGIN ?? 'http://localhost:' + (process.env.APP_PORT ?? '3100'));
const password = process.env.DEMO_PASSWORD;
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || !password) {
  throw new Error('Use a local app and a configured synthetic DEMO_PASSWORD.');
}
const pageOptions = { baseURL: base.origin, ...previewBrowserOptions(base) };
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
// Crucial actions ask for confirmation in the shared modal; press its confirm button.
async function confirmAction(page) {
  const ok = page.locator('dialog[data-confirm-dialog][open] [data-confirm-ok]');
  await ok.waitFor();
  await ok.click();
  await page.locator('dialog[data-confirm-dialog]').and(page.locator(':not([open])')).waitFor({ state: 'attached' });
}
const customer = await browser.newPage({ ...pageOptions, viewport: { width: 360, height: 844 } });
const tailor = await browser.newPage({ ...pageOptions, viewport: { width: 1366, height: 900 } });
const admin = await browser.newPage({ ...pageOptions, viewport: { width: 1366, height: 900 } });
const pageErrors = [];
for (const page of [customer, tailor, admin]) page.on('pageerror', error => pageErrors.push(error.message));

// Below 960 px the dashboard links sit in the hamburger drawer; open it first when it is shown.
async function dashboardNav(page) {
  const toggle = page.getByRole('button', { name: 'Buka menu' });
  if (await toggle.isVisible()) await toggle.click();
  return page.getByRole('navigation', { name: 'Navigasi utama' });
}

async function signIn(page, email, destination = '**/workspace') {
  if (new URL(page.url()).pathname !== '/login') await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(password);
  const [response] = await Promise.all([
    page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/session'
      && result.request().method() === 'POST'),
    page.getByRole('main').getByRole('button', { name: 'Masuk' }).click()
  ]);
  assert.equal(response.status(), 303, 'Browser sign-in form response: ' + await page.locator('main').innerText());
  await page.waitForURL(destination);
  if (base.protocol === 'https:') {
    const cookies = await page.context().cookies(base.origin);
    const session = cookies.find(cookie => cookie.name === 'marajut_session');
    assert.ok(session?.secure && session.httpOnly, 'HTTPS sign-in must set a secure session cookie.');
  }
}

try {
  await customer.goto('/');
  await customer.getByRole('heading', { name: 'Layanan jahit di sekitar Anda' }).waitFor();
  await customer.evaluate(() => document.fonts.ready);
  const brand = customer.getByRole('link', { name: 'Beranda Marajut' });
  const signInLink = customer.getByRole('link', { name: 'Masuk', exact: true });
  for (const width of [320, 360, 768, 1366]) {
    await customer.setViewportSize({ width, height: 844 });
    assert.equal(await customer.evaluate(() => document.documentElement.scrollWidth), width);
    const [brandBox, loginBox] = await Promise.all([brand.boundingBox(), signInLink.boundingBox()]);
    assert.ok(Math.abs((brandBox.y + brandBox.height / 2) - (loginBox.y + loginBox.height / 2)) < 3,
      'Guest sign-in should share the header row with the brand at ' + width);
  }
  await customer.setViewportSize({ width: 360, height: 844 });
  await customer.keyboard.press('Tab');
  assert.equal(await customer.getByRole('link', { name: 'Lewati ke konten' }).evaluate(link => link === document.activeElement), true);
  await customer.keyboard.press('Enter');
  assert.equal(await customer.getByRole('main').evaluate(main => document.activeElement === main), true);
  await customer.getByRole('heading', { name: 'Layanan jahit di sekitar Anda' }).waitFor();
  await customer.goto('/');
  await customer.evaluate(() => document.fonts.ready);
  const screenshotDir = process.env.BROWSER_SCREENSHOTS;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await customer.screenshot({ path: screenshotDir + '/market-mobile.png' });
    await customer.setViewportSize({ width: 1366, height: 900 });
    await customer.screenshot({ path: screenshotDir + '/market-desktop.png' });
    await customer.setViewportSize({ width: 360, height: 844 });
  }
  const pageWidth = await customer.evaluate(() => ({
    page: document.documentElement.scrollWidth, viewport: window.innerWidth
  }));
  assert.equal(pageWidth.page, pageWidth.viewport, 'Mobile catalog must fit the viewport.');
  await customer.getByLabel('Cari layanan atau penjahit').fill('tidak-ada-layanan-ini');
  await customer.getByRole('button', { name: 'Cari', exact: true }).click();
  const categories = customer.getByRole('navigation', { name: 'Kategori layanan' });
  await categories.getByRole('link', { name: 'Permak & ukuran' }).click();
  await customer.getByText('Tidak ada layanan yang cocok.').waitFor();
  assert.equal(new URL(customer.url()).searchParams.get('q'), 'tidak-ada-layanan-ini');
  await customer.getByRole('link', { name: 'Hapus filter' }).click();
  await categories.getByRole('link', { name: 'Permak & ukuran' }).click();
  assert.equal(await categories.getByRole('link', { name: 'Permak & ukuran' }).getAttribute('aria-current'), 'true');

  const listing = customer.getByRole('article').filter({ hasText: /Permak panjang pakaian|Hem adjustment/ });
  await listing.getByRole('link', { name: 'Jahit Rina', exact: true }).click();
  await customer.getByRole('heading', { name: 'Jahit Rina', exact: true }).waitFor();
  await customer.getByRole('article').filter({ hasText: /Permak panjang pakaian|Hem adjustment/ })
    .getByRole('link', { name: 'Minta penawaran' }).click();
  await customer.getByRole('link', {name:'Masuk ke akun'}).click();
  await signIn(customer, seedEmails.customer, '**/requests/new?service=*');
  const selected = await customer.getByLabel('Penjahit dan layanan').locator('option:checked').innerText();
  assert.match(selected, /Permak panjang pakaian|Hem adjustment/);
  await customer.getByText('Sebutkan bagian yang ingin dipendekkan', { exact: false }).waitFor();
  const description = 'Uji pesanan: pendekkan celana 3 cm. ' + new Date().toISOString();
  await customer.getByLabel('Apa yang perlu dikerjakan?').fill(description);
  await customer.getByLabel('Jumlah pakaian').fill('2');
  await customer.getByText(/Rp\s?50\.000/, {exact:false}).first().waitFor();
  await customer.getByLabel('Perlu fitting?').selectOption('true');
  await customer.getByLabel('Cara serah terima').selectOption('delivery');
  await customer.getByLabel('Ukuran atau catatan khusus').fill('Panjang akhir yang diinginkan 90 cm.');
  await customer.getByRole('button', { name: 'Kirim permintaan' }).click();
  await customer.getByText(description, { exact: true }).waitFor();
  const requestUrl = customer.url();
  const requestPath = new URL(requestUrl).pathname;
  const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#728060' } }).png().toBuffer();
  await customer.getByLabel('Tambahkan foto').setInputFiles({ name: 'test-cloth.png', mimeType: 'image/png', buffer: photo });
  await customer.getByRole('button', { name: 'Unggah foto' }).click();
  await customer.getByRole('img', { name: 'Foto referensi 1' }).waitFor();
  await customer.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Pesanan Saya' }).click();
  await customer.getByText('Simulasi dan notifikasi uji',{exact:true}).click();
  await customer.getByRole('link', { name: 'Notifikasi simulasi' }).click();
  const enable = customer.getByRole('button', { name: 'Aktifkan notifikasi simulasi', exact: true });
  if (await enable.isVisible()) {
    await enable.click();
    await customer.getByRole('button', { name: 'Nonaktifkan notifikasi simulasi', exact: true }).waitFor();
  }
  await customer.goto(requestUrl);

  await signIn(tailor, seedEmails.provider);
  await tailor.getByRole('heading', { name: 'Jahit Rina', exact: true }).waitFor();
  const studioNav = tailor.getByRole('navigation', { name: 'Navigasi utama' });
  assert.equal(await studioNav.getByRole('link', { name: 'Ringkasan' }).getAttribute('aria-current'), 'page');
  if (screenshotDir) {
    await tailor.screenshot({ path: screenshotDir + '/workspace-desktop.png' });
  }
  await tailor.setViewportSize({ width: 360, height: 800 });
  assert.equal(await tailor.evaluate(() => document.documentElement.scrollWidth), 360);
  const queueMenu = tailor.locator('[data-queue-menu]');
  await queueMenu.getByRole('heading', { name: 'Antrean lain', exact: true }).waitFor(); // always expanded, also on phones
  if (screenshotDir) await tailor.screenshot({ path: screenshotDir + '/workspace-mobile.png', fullPage: true });
  await queueMenu.locator('[data-queue="clarify"]').click();
  await tailor.getByRole('heading', { name: 'Butuh klarifikasi', exact: true }).waitFor();
  await (await dashboardNav(tailor)).getByRole('link', { name: 'Layanan Saya' }).click();
  await tailor.getByRole('heading', { name: 'Tambah layanan' }).waitFor();
  const setting = tailor.locator('.service-setting').filter({ hasText: /Permak panjang pakaian|Hem adjustment/ });
  await setting.getByText('Ubah layanan').click();
  await setting.getByLabel('Harga awal (IDR)').waitFor();
  await (await dashboardNav(tailor)).getByRole('link', { name: 'Profil Usaha' }).click();
  await tailor.getByLabel('Nama usaha').waitFor();
  await (await dashboardNav(tailor)).getByRole('link', { name: 'Ringkasan' }).click();
  await tailor.setViewportSize({ width: 1366, height: 900 });
  await tailor.locator('[data-queue="inbox"]').click();
  assert.equal(await tailor.locator('[data-queue="inbox"]').getAttribute('aria-current'), 'true');
  await tailor.locator('.queue-entry').filter({ has: tailor.locator('a[href="' + requestPath + '"]') })
    .getByText('Ayu', { exact: true }).waitFor();
  await tailor.locator('a[href="' + requestPath + '"]').click();
  assert.equal(new URL(tailor.url()).pathname, requestPath);
  await tailor.getByText('Panjang akhir yang diinginkan 90 cm.', { exact: false }).waitFor();
  await tailor.getByRole('img', { name: 'Foto referensi 1' }).waitFor();
  assert.equal(await tailor.getByRole('button',{name:'Kirim penawaran'}).count(),0);
  await signIn(admin,seedEmails.operator,'**/pengelola');
  const deskFilters = admin.getByRole('navigation',{name:'Filter pesanan'});
  const compactDesk = admin.locator('[data-desk-filter-menu]');
  if (screenshotDir) await admin.screenshot({ path: screenshotDir + '/admin-board.png', fullPage: true });
  await deskFilters.getByRole('link',{name:/Koordinasi/}).click();
  await admin.getByLabel('Cari pesanan').fill('#'+requestPath.split('/').at(-1).slice(0,8));
  await admin.getByRole('button',{name:'Cari',exact:true}).click();
  assert.equal(await admin.locator('.desk-list li').count(),1);
  await admin.locator('a[href="'+requestPath+'"]').click();
  await admin.getByRole('button',{name:'Catat sudah dihubungi'}).click();
  await admin.getByRole('button',{name:'Penjahit bersedia'}).click();
  await admin.getByRole('button',{name:'Minta detail pelanggan'}).click(); // opens the clarify modal
  const clarify=admin.getByRole('dialog',{name:'Minta detail pelanggan'});
  await clarify.getByLabel('Pertanyaan untuk pelanggan').fill('Berapa panjang akhir yang diinginkan?');
  await clarify.getByRole('button',{name:'Kirim pertanyaan'}).click();
  await customer.reload();
  await customer.locator('#klarifikasi').getByText('Berapa panjang akhir yang diinginkan?', { exact: true }).waitFor();
  await customer.getByLabel('Jawaban untuk admin').fill('Panjang akhir 90 cm.');
  await customer.getByRole('button', { name: 'Kirim jawaban' }).click();
  await admin.reload();
  await admin.getByLabel(/Harga satuan/).first().fill('15000');
  await admin.getByRole('button', { name: 'Tambah rincian' }).click();
  await admin.getByLabel(/Rincian baris 2/).fill('Benang');
  await admin.getByLabel(/Jumlah baris 2/).fill('1');
  await admin.getByLabel(/Harga satuan/).last().fill('2500');
  await admin.waitForFunction(() => document.querySelector('output')?.textContent.includes('32.500'));
  if (screenshotDir) {
    await admin.locator('[data-quote-editor]').scrollIntoViewIfNeeded();
    await admin.screenshot({ path: screenshotDir + '/quote-editor.png' });
  }
  await admin.getByLabel('Perkiraan selesai').fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  assert.equal(await admin.getByLabel('Cara serah terima').inputValue(),'delivery');
  const fittingDay = new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  await admin.getByLabel('Waktu fitting (WIB)').fill(fittingDay+'T10:30');
  await admin.getByLabel('Lokasi fitting').fill('Studio latihan');
  await admin.getByLabel('Rincian pengerjaan dan pengambilan').fill('Pendekkan celana. Kurir mengantar setelah pelanggan membayar.');
  await admin.getByRole('button', { name: 'Kirim penawaran' }).click(); await confirmAction(admin);
  await admin.getByRole('heading', { name: 'Penawaran harga' }).waitFor();

  await customer.goto('/workspace');
  const attention = customer.locator('.order-group').filter({ has: customer.getByRole('heading', { name: /Perlu tindakan Anda/ }) });
  if (screenshotDir) await customer.screenshot({ path: screenshotDir + '/orders-mobile.png' });
  await attention.locator('a[href="' + requestPath + '"]').click();
  await customer.getByRole('link', { name: 'Tinjau penawaran',exact:true }).click();
  if (screenshotDir) await customer.screenshot({path:screenshotDir+'/customer-quote.png'});
  await customer.getByText('Benang', { exact: true }).waitFor();
  await customer.getByRole('button', { name: 'Setujui penawaran' }).click(); await confirmAction(customer);
  await customer.getByRole('heading', { name: 'Detail pesanan' }).waitFor();
  await customer.getByText('Minta jadwal lain',{exact:true}).click();
  await customer.getByLabel('Waktu yang cocok untuk Anda').fill('Saya bisa datang pukul 14.00.');
  await customer.getByRole('button',{name:'Minta jadwal baru'}).click();
  await admin.goto('/pengelola');
  await deskFilters.getByRole('link',{name:/Perlu tindak lanjut/}).click();
  const followUp = admin.locator('.desk-list a[href="'+requestPath+'#fitting"]');
  await followUp.getByText('Fitting perlu dijadwalkan ulang',{exact:true}).waitFor();
  assert.match(await followUp.innerText(), /Jadwal sebelumnya .* WIB/);
  await admin.setViewportSize({width:360,height:844});
  await compactDesk.getByRole('navigation', { name: 'Filter pesanan' }).waitFor(); // filters stay visible on phones (no fold-out)
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth),360);
  assert.equal(await deskFilters.getByRole('link',{name:/Perlu tindak lanjut/}).getAttribute('aria-current'),'true');
  if (screenshotDir) await admin.screenshot({path:screenshotDir+'/admin-follow-up-mobile.png'});
  await followUp.click();
  assert.equal(new URL(admin.url()).hash,'#fitting');
  await admin.setViewportSize({width:1366,height:900});
  await admin.getByLabel('Waktu baru (WIB)').fill(fittingDay+'T14:00');
  await admin.getByRole('button',{name:'Kirim jadwal baru'}).click();
  await customer.reload();
  await customer.getByRole('button',{name:'Setujui jadwal fitting'}).click();
  await admin.reload();
  await admin.getByRole('button',{name:'Catat fitting selesai'}).click(); await confirmAction(admin);
  await admin.getByRole('button',{name:'Mulai pengerjaan'}).click(); await confirmAction(admin);
  await admin.getByRole('button',{name:'Tandai jahitan siap'}).click(); await confirmAction(admin);
  await customer.goto('/workspace');
  await attention.locator('a[href="' + requestPath + '"]').getByText('Buka pembayaran').click();
  assert.equal(await customer.locator('.journey [aria-current="step"]').innerText(), 'Pembayaran');
  const paymentSection = customer.locator('#pembayaran');
  const total = await paymentSection.locator('.price-highlight strong').innerText();
  await paymentSection.getByRole('button',{name:'Mulai pembayaran simulasi'}).click();
  await admin.reload();
  await admin.getByRole('button',{name:'Tandai simulasi gagal'}).click(); await confirmAction(admin);
  await customer.reload();
  await paymentSection.getByText('Tagihan sebelumnya sudah ditutup.',{exact:false}).waitFor();
  assert.equal(await paymentSection.locator('.price-highlight strong').innerText(),total);
  await paymentSection.getByRole('button',{name:'Ulangi pembayaran simulasi'}).click();
  await admin.reload();
  await admin.getByRole('button',{name:'Verifikasi simulasi lunas'}).click(); await confirmAction(admin);
  await admin.getByLabel('Kurir, nomor resi, atau catatan pengantaran').fill('Kurir uji, resi QA-3160.');
  await admin.getByRole('button',{name:'Catat sudah dikirim'}).click(); await confirmAction(admin);
  await customer.reload();
  await customer.locator('.workflow-heading .status').getByText('Dalam pengiriman',{exact:true}).waitFor();
  await customer.locator('#serah-terima').getByText('Kurir uji, resi QA-3160.',{exact:true}).waitFor();
  await admin.getByRole('button',{name:'Selesaikan pesanan'}).click(); await confirmAction(admin);
  await admin.locator('.workflow-heading .status').getByText('Pesanan selesai',{exact:true}).waitFor();
  await customer.reload();
  assert.equal(await customer.locator('.journey .done').count(),5);
  for (const width of [320,375,768]) {
    await customer.setViewportSize({width,height:844});
    assert.equal(await customer.evaluate(()=>document.documentElement.scrollWidth),width);
  }
  await customer.setViewportSize({width:375,height:844});
  if (screenshotDir) {
    await customer.screenshot({ path: screenshotDir + '/customer-mobile.png', fullPage: true });
    await tailor.reload();
    await tailor.screenshot({ path: screenshotDir + '/tailor-desktop.png', fullPage: true });
  }

  await customer.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Pesanan Saya' }).click();
  await customer.locator('.order-group').filter({ has: customer.getByRole('heading', { name: /Riwayat/ }) })
    .locator('a[href="' + requestPath + '"]').waitFor();
  await customer.getByText('Simulasi dan notifikasi uji',{exact:true}).click();
  await customer.getByRole('link', { name: 'Notifikasi simulasi' }).click();
  const currentOrderMessage = customer.getByRole('listitem')
    .filter({ has: customer.getByRole('link', { name: /Jahitan siap dibayar/ }) })
    .filter({ has: customer.locator('a[href="' + new URL(requestUrl).pathname + '"]') });
  const simulated = currentOrderMessage.getByText('Notifikasi simulasi', { exact: true });
  const deadline = Date.now() + 10000;
  while (!(await simulated.isVisible()) && Date.now() < deadline) {
    await delay(250);
    await customer.reload();
  }
  assert.ok(await simulated.isVisible(), 'The worker should record a simulated collection notice for this order.');
  await (await dashboardNav(admin)).getByRole('link',{name:'Kinerja',exact:true}).click();
  await admin.getByRole('heading',{name:'Kinerja layanan'}).waitFor();
  for (const width of [320,375,768]) {
    await admin.setViewportSize({width,height:844});
    assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth),width);
  }
  await (await dashboardNav(admin)).getByRole('link',{name:'Pesanan',exact:true}).click();
  await admin.getByRole('heading',{name:'Papan pesanan'}).waitFor();
  await admin.setViewportSize({width:375,height:844});
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth),375);
  await compactDesk.getByRole('navigation', { name: 'Filter pesanan' }).waitFor(); // filters stay visible on phones (no fold-out)
  if (screenshotDir) await admin.screenshot({path:screenshotDir+'/admin-board-mobile.png'});
  await deskFilters.getByRole('link',{name:/Pembayaran/}).click();
  assert.equal(new URL(admin.url()).searchParams.get('filter'),'payment');
  assert.deepEqual(pageErrors, []);
  console.log('Browser workflow passed for customer, administrator, and legacy tailor views.');
} finally {
  await browser.close();
}
