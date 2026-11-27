import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { seedEmails } from '../apps/marajut/seed.js';
import { previewBrowserOptions } from './preview-auth.js';

const origin = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:' + (process.env.APP_PORT ?? '3100'));
const password = process.env.DEMO_PASSWORD;
if (!['localhost', '127.0.0.1'].includes(origin.hostname) || !password) {
  throw new Error('Use a local app and the configured synthetic demo password.');
}
const pageOptions = { baseURL: origin.origin, ...previewBrowserOptions(origin) };
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
// Crucial actions ask for confirmation in the shared modal; press its confirm button.
async function confirmAction(page) {
  const ok = page.locator('dialog[data-confirm-dialog][open] [data-confirm-ok]');
  await ok.waitFor();
  await ok.click();
  await page.locator('dialog[data-confirm-dialog]').and(page.locator(':not([open])')).waitFor({ state: 'attached' });
}
const customer = await browser.newPage({ ...pageOptions, viewport: { width: 390, height: 844 } });
const tailor = await browser.newPage({ ...pageOptions, viewport: { width: 1366, height: 900 } });

async function signIn(page, email, destination) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL(destination);
}

async function refreshUntil(page, locator) {
  const deadline = Date.now() + 12_000;
  while (!(await locator.isVisible()) && Date.now() < deadline) {
    await delay(200);
    await page.reload();
  }
  await locator.waitFor({ timeout: 1500 });
}

try {
  await customer.goto('/#cara-kerja'); // header links are hidden for guests on phones
  await customer.getByRole('link', { name: 'Buka simulasi WhatsApp' }).click();
  await customer.getByText('Masuk untuk mencoba simulasi WhatsApp.', {exact:false}).waitFor();
  await signIn(customer, seedEmails.otherCustomer, '**/workspace/intake');
  assert.match(await customer.title(), /Simulasi WhatsApp · Marajut/);
  await customer.getByLabel('Pesan pelanggan').fill('Hello, I need help repairing a seam.');
  await customer.getByRole('button', { name: 'Kirim pesan simulasi' }).click();
  const choice = customer.getByLabel('Penjahit dan layanan');
  const service = await choice.getByRole('option', { name: /Ruang Jahit Dewi · (Perbaikan jahitan lepas|Seam repair)/ }).innerText();
  await choice.selectOption({ label: service });
  await customer.getByRole('button', { name: 'Pilih layanan' }).click();
  await customer.getByLabel('Detail jahitan').fill('Repair the loose seam on my cotton jacket.');
  await customer.getByRole('button', { name: 'Kirim detail' }).click();

  const begin = customer.getByRole('button', { name: 'Tautkan pengirim' });
  if (await begin.isVisible()) {
    await begin.click();
    const code = await customer.locator('main code').innerText();
    await customer.getByLabel('Kode dari akun ini').fill(code);
    await customer.getByRole('button', { name: 'Kirim bukti simulasi' }).click();
    const confirm = customer.getByRole('button', { name: 'Konfirmasi tautan' });
    await refreshUntil(customer, confirm);
    await confirm.click();
  }
  await customer.getByText('Terhubung dengan akun Anda.').waitFor();
  await customer.getByRole('button', { name: 'Minta bantuan penjahit' }).click();
  const newConversation = customer.getByRole('listitem').filter({ hasText: 'Perlu ditangani' })
    .getByRole('link', { name: /Perbaikan jahitan lepas|Seam repair/ }).first();
  await refreshUntil(customer, newConversation);
  await newConversation.click();
  const conversationUrl = customer.url();

  await tailor.goto('/login?ruang=usaha');
  await signIn(tailor, seedEmails.otherProvider, '**/workspace');
  await tailor.locator('[data-queue="handoffs"]').click();
  await tailor.locator('a[href="' + new URL(conversationUrl).pathname + '"]').click();
  await tailor.getByRole('button', { name: 'Tangani percakapan' }).click();
  await tailor.getByLabel('Balasan').fill('I can repair the seam. I will issue a quote.');
  await tailor.getByRole('button', { name: 'Kirim balasan simulasi' }).click();
  await customer.reload();
  await customer.getByText('I can repair the seam. I will issue a quote.').waitFor();

  await tailor.getByRole('button', { name: 'Buat permintaan layanan' }).click();
  await tailor.getByRole('heading', { name: 'Detail permintaan' }).waitFor();
  await tailor.getByRole('heading', { name: 'Percakapan terkait' }).waitFor();
  const admin = await browser.newPage(pageOptions);
  await admin.goto('/login');
  await signIn(admin,seedEmails.operator,'**/pengelola');
  await admin.goto(tailor.url());
  await admin.getByRole('button',{name:'Penjahit bersedia'}).click();
  await admin.getByLabel('Cara serah terima').selectOption('pickup');
  await admin.getByLabel(/Harga satuan/).first().fill('24000');
  await admin.getByLabel('Perkiraan selesai').fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  await admin.getByLabel('Rincian pengerjaan dan pengambilan').fill('Repair jacket seam, collect in person.');
  await admin.getByRole('button', { name: 'Kirim penawaran' }).click(); await confirmAction(admin);
  await admin.getByRole('heading', { name: 'Penawaran harga' }).waitFor();

  await customer.reload();
  await customer.getByRole('link', { name: 'Buka permintaan layanan' }).click();
  await customer.getByRole('button', { name: 'Setujui penawaran' }).click(); await confirmAction(customer);
  await customer.getByRole('heading', { name: 'Detail pesanan' }).waitFor();
  assert.equal(new URL(customer.url()).pathname, new URL(tailor.url()).pathname);
  await tailor.goto(conversationUrl);
  await tailor.getByRole('button', { name: 'Selesaikan percakapan' }).click(); await confirmAction(tailor);
  await customer.goto(conversationUrl);
  await customer.getByText('Percakapan selesai', { exact: true }).waitFor();
  console.log('Inbound browser workflow passed through simulated reply, draft conversion, quote acceptance, and resolution.');
} finally {
  await browser.close();
}
