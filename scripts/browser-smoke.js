import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { seedEmails } from '../apps/djahit/seed.js';

const base = new URL(process.env.APP_ORIGIN ?? 'http://localhost:' + (process.env.APP_PORT ?? '3100'));
const password = process.env.DEMO_PASSWORD;
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || !password) {
  throw new Error('Use a local app and a configured synthetic DEMO_PASSWORD.');
}
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
const customer = await browser.newPage({ viewport: { width: 360, height: 844 }, baseURL: base.origin });
const tailor = await browser.newPage({ viewport: { width: 1366, height: 900 }, baseURL: base.origin });
const pageErrors = [];
for (const page of [customer, tailor]) page.on('pageerror', error => pageErrors.push(error.message));

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
  if (screenshotDir) await tailor.screenshot({ path: screenshotDir + '/workspace-mobile.png', fullPage: true });
  const queueMenu = tailor.locator('[data-queue-menu]');
  assert.equal(await queueMenu.getAttribute('open'), null);
  await queueMenu.getByText('Antrean lain', { exact: true }).click();
  await queueMenu.locator('[data-queue="clarify"]').click();
  await tailor.getByRole('heading', { name: 'Butuh klarifikasi', exact: true }).waitFor();
  await studioNav.getByRole('link', { name: 'Layanan Saya' }).click();
  await tailor.getByRole('heading', { name: 'Tambah layanan' }).waitFor();
  const setting = tailor.locator('.service-setting').filter({ hasText: /Permak panjang pakaian|Hem adjustment/ });
  await setting.getByText('Ubah layanan').click();
  await setting.getByLabel('Harga awal (IDR)').waitFor();
  await studioNav.getByRole('link', { name: 'Profil Usaha' }).click();
  await tailor.getByLabel('Nama usaha').waitFor();
  await studioNav.getByRole('link', { name: 'Ringkasan' }).click();
  await tailor.setViewportSize({ width: 1366, height: 900 });
  await tailor.locator('[data-queue="inbox"]').click();
  assert.equal(await tailor.locator('[data-queue="inbox"]').getAttribute('aria-current'), 'true');
  await tailor.locator('.queue-entry').filter({ has: tailor.locator('a[href="' + requestPath + '"]') })
    .getByText('Ayu', { exact: true }).waitFor();
  await tailor.locator('a[href="' + requestPath + '"]').click();
  assert.equal(tailor.url(), requestUrl);
  await tailor.getByText('Panjang akhir yang diinginkan 90 cm.', { exact: false }).waitFor();
  await tailor.getByRole('img', { name: 'Foto referensi 1' }).waitFor();
  await tailor.getByText('Klarifikasi atau tutup permintaan', { exact: true }).click();
  await tailor.getByLabel('Catatan untuk pelanggan dan penjahit').fill('Berapa panjang akhir yang diinginkan?');
  await tailor.getByRole('button', { name: 'Minta klarifikasi' }).click();
  await customer.reload();
  await customer.getByText('Berapa panjang akhir yang diinginkan?', { exact: true }).waitFor();
  await customer.getByLabel('Catatan untuk pelanggan dan penjahit').fill('Panjang akhir 90 cm.');
  await customer.getByRole('button', { name: 'Kirim detail' }).click();
  await tailor.reload();
  await tailor.getByLabel(/Harga satuan/).first().fill('15000');
  await tailor.getByRole('button', { name: 'Tambah rincian' }).click();
  await tailor.getByLabel(/Rincian baris 2/).fill('Benang');
  await tailor.getByLabel(/Jumlah baris 2/).fill('1');
  await tailor.getByLabel(/Harga satuan/).last().fill('2500');
  await tailor.waitForFunction(() => document.querySelector('output')?.textContent.includes('32.500'));
  if (screenshotDir) {
    await tailor.locator('[data-quote-editor]').scrollIntoViewIfNeeded();
    await tailor.screenshot({ path: screenshotDir + '/quote-editor.png' });
  }
  await tailor.getByLabel('Perkiraan selesai').fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  await tailor.getByLabel('Rincian pengerjaan dan pengambilan').fill('Pendekkan celana. Ambil langsung di tempat jahit.');
  await tailor.getByRole('button', { name: 'Kirim penawaran' }).click();
  await tailor.getByRole('heading', { name: 'Penawaran v1' }).waitFor();

  await customer.goto('/workspace');
  const attention = customer.locator('.order-group').filter({ has: customer.getByRole('heading', { name: /Perlu tindakan Anda/ }) });
  if (screenshotDir) await customer.screenshot({ path: screenshotDir + '/orders-mobile.png' });
  await attention.locator('a[href="' + requestPath + '"]').click();
  await customer.getByRole('link', { name: 'Tinjau penawaran v1' }).click();
  await customer.getByText('Benang', { exact: true }).waitFor();
  await customer.getByRole('button', { name: 'Setujui penawaran v1' }).click();
  await customer.getByRole('heading', { name: 'Detail pesanan' }).waitFor();
  await tailor.reload();
  await tailor.getByRole('button', { name: 'Mulai pengerjaan' }).click();
  await tailor.getByRole('button', { name: 'Tandai siap diambil' }).click();
  await customer.goto('/workspace');
  await attention.locator('a[href="' + requestPath + '"]').getByText('Lihat pengambilan').click();
  assert.equal(await customer.locator('.order-progress [aria-current="step"]').innerText(), 'Siap diambil');
  await tailor.getByRole('button', { name: 'Selesaikan pesanan' }).click();
  await tailor.getByText('Selesai', { exact: true }).first().waitFor();

  await customer.reload();
  assert.equal(await customer.locator('.order-progress [aria-current="step"]').innerText(), 'Selesai');
  if (screenshotDir) {
    await customer.screenshot({ path: screenshotDir + '/customer-mobile.png', fullPage: true });
    await tailor.screenshot({ path: screenshotDir + '/tailor-desktop.png', fullPage: true });
  }

  await customer.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Pesanan Saya' }).click();
  await customer.locator('.order-group').filter({ has: customer.getByRole('heading', { name: /Riwayat/ }) })
    .locator('a[href="' + requestPath + '"]').waitFor();
  await customer.getByRole('link', { name: 'Notifikasi simulasi' }).click();
  const currentOrderMessage = customer.getByRole('listitem')
    .filter({ has: customer.getByRole('link', { name: /Pesanan siap diambil/ }) })
    .filter({ has: customer.locator('a[href="' + new URL(requestUrl).pathname + '"]') });
  const simulated = currentOrderMessage.getByText('Notifikasi simulasi', { exact: true });
  const deadline = Date.now() + 10000;
  while (!(await simulated.isVisible()) && Date.now() < deadline) {
    await delay(250);
    await customer.reload();
  }
  assert.ok(await simulated.isVisible(), 'The worker should record a simulated collection notice for this order.');
  assert.deepEqual(pageErrors, []);
  console.log('Browser workflow passed at mobile customer and desktop tailor sizes.');
} finally {
  await browser.close();
}
