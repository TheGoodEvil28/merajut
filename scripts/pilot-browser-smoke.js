import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { chromium } from 'playwright';

const app = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:3100');
const mail = new URL(process.env.MAIL_ORIGIN ?? 'http://127.0.0.1:3101');
const password = process.env.DEMO_PASSWORD;
if (!password || ![app,mail].every(url => ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Use a local synthetic app and mailbox.');
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const browser=await chromium.launch(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {});
const screenshots=process.env.BROWSER_SCREENSHOTS;
const metric=[];
const tag=randomBytes(4).toString('hex');
const guestEmail='guest-'+tag+'@marajut.test';
const providerEmail='tailor-'+tag+'@marajut.test';
const guest=await browser.newPage({baseURL:app.origin,viewport:{width:360,height:844}});
const staff=await browser.newPage({baseURL:app.origin,viewport:{width:1366,height:900}});
const provider=await browser.newPage({baseURL:app.origin,viewport:{width:1024,height:900}});
const reset=await browser.newPage({baseURL:app.origin,viewport:{width:360,height:844}});
const axeReports=[];
const capture=async(page,name) => {
  if (screenshots) {
    await mkdir(screenshots,{recursive:true});
    await page.screenshot({path:screenshots+'/pilot-'+name+'.png'});
  }
};
const checkScreen=async(page,name) => {
  await page.addInitScript({path:axePath});
  await page.reload();
  await page.waitForFunction(() => Boolean(window.axe));
  const result=await page.evaluate(() => window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));
  axeReports.push(...result.violations.map(v => [name,v.id,v.nodes.map(node=>node.target)]));
};
async function signIn(page,email,value=password) {
  await page.goto('/login');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Kata sandi',{exact:true}).fill(value);
  await page.getByRole('main').getByRole('button',{name:'Masuk'}).click();
  await page.waitForURL(/\/(?:workspace|pengelola)$/);
}
async function openProof(page,email,subject) {
  const deadline=Date.now()+20000;
  let code;
  while (Date.now()<deadline && !code) {
    const messages=await (await fetch(mail.origin+'/messages')).json();
    const match=messages.findLast(message => (!subject || message.subject===subject)
      && message.recipients.some(value=>value.replace(/[<>]/g,'')===email));
    if (match) {
      const body=await (await fetch(mail.origin+'/messages/'+match.id+'.plain')).text();
      code=/\/akun\/tautan#([a-f0-9]{64})/.exec(body)?.[1];
    }
    if (!code) await delay(300);
  }
  assert.ok(code,'Expected a verification message in the fixture SMTP inbox.');
  await page.goto('/akun/tautan');
  await page.getByLabel('Kode dari email').fill(code);
  await page.getByRole('button',{name:'Periksa tautan'}).click();
  await page.getByRole('heading',{name:'Konfirmasi akun'}).waitFor();
}
try {
  const pages=[['market','/'],['signup','/akun/daftar']];
  for(const [name,path] of pages) {
    const start=performance.now();
    await guest.goto(path,{waitUntil:'load'});
    metric.push([name,Math.round(performance.now()-start)]);
    await checkScreen(guest,name);
  }
  await staff.goto('/login');
  await signIn(staff,'operator@marajut.test');
  await checkScreen(staff,'management');
  await staff.getByRole('link',{name:'Operasional',exact:true}).click();
  await staff.getByText('Undang pengguna ruang usaha lama',{exact:true}).click();
  const invite=staff.locator('form').filter({has:staff.getByRole('button',{name:'Kirim undangan',exact:true})});
  const business='Jahit Uji '+tag;
  await invite.getByLabel('Nama usaha').fill(business);
  await invite.getByLabel('Area layanan').fill('Semarang Timur');
  await invite.getByLabel('Cerita usaha').fill('Permak pakaian untuk latihan demo.');
  await invite.getByLabel('Email penjahit').fill(providerEmail);
  await invite.getByLabel('Kata sandi pengelola').fill(password);
  await invite.getByRole('button',{name:'Kirim undangan',exact:true}).click();
  await staff.getByRole('status',{name:''}).filter({hasText:'Perubahan tercatat.'}).waitFor();
  await openProof(provider,providerEmail);
  await provider.getByLabel('Nama Anda').fill('Penjahit QA');
  await provider.getByLabel('Kata sandi baru').fill(password);
  await provider.getByRole('button',{name:'Terima undangan'}).click();
  await provider.waitForURL('**/workspace');
  await provider.getByRole('link',{name:'Layanan Saya'}).click();
  await provider.getByLabel('Nama layanan').fill('Permak Celana '+tag);
  await provider.getByLabel('Deskripsi').fill('Pendekkan kelim dan rapikan jahitan.');
  await provider.getByLabel('Harga awal').fill('20000');
  await provider.getByRole('button',{name:'Tambah layanan'}).click();
  await provider.getByText('Permak Celana '+tag,{exact:true}).waitFor();
  await staff.getByRole('navigation',{name:'Navigasi utama'}).getByRole('link',{name:'Mitra',exact:true}).click();
  await staff.getByRole('link',{name:'Kelola '+business,exact:false}).click();
  await staff.getByLabel('Alasan perubahan').fill('Katalog demo telah ditinjau.');
  await staff.locator('#publikasi details').first().getByLabel('Kata sandi pengelola').fill(password);
  await staff.getByRole('button',{name:'Publikasikan profil'}).click();
  await staff.getByText('Perubahan tercatat.').waitFor();
  await capture(staff,'pengelola');

  await guest.goto('/');
  await guest.getByRole('article').filter({hasText:'Permak Celana '+tag}).getByRole('link',{name:'Minta penawaran'}).click();
  await guest.getByLabel('Email untuk verifikasi').fill(guestEmail);
  await guest.getByLabel('Apa yang perlu dikerjakan?').fill('Mohon pendekkan dua celana untuk latihan.');
  await guest.getByLabel('Jumlah pakaian').fill('2');
  await guest.getByRole('button',{name:'Simpan draf dan verifikasi email'}).click();
  const png=await sharp({create:{width:20,height:20,channels:3,background:'#79835c'}}).png().toBuffer();
  await guest.getByLabel('Foto pakaian').setInputFiles({name:'foto-demo.png',mimeType:'image/png',buffer:png});
  await guest.getByRole('button',{name:'Tambahkan foto ke draf'}).click();
  await guest.getByText('Foto tersimpan dalam draf.').waitFor();
  await openProof(guest,guestEmail);
  await capture(guest,'verifikasi');
  await guest.getByLabel('Nama Anda').fill('Pelanggan QA');
  await guest.getByLabel('Kata sandi baru').fill(password);
  await guest.getByRole('button',{name:'Konfirmasi dan kirim permintaan'}).click();
  await guest.getByRole('heading',{name:'Detail permintaan'}).waitFor();
  const path=new URL(guest.url()).pathname;
  await provider.goto(path);
  await provider.getByRole('img',{name:'Foto referensi 1'}).waitFor();
  await staff.goto(path);
  await staff.getByRole('button',{name:'Penjahit bersedia'}).click();
  await staff.getByLabel('Cara serah terima').selectOption('pickup');
  await staff.getByLabel(/Harga satuan/).first().fill('20000');
  await staff.getByLabel('Perkiraan selesai').fill(new Date(Date.now()+7*86400000).toISOString().slice(0,10));
  await staff.getByLabel('Rincian pengerjaan dan pengambilan').fill('Ambil di toko jika pakaian siap.');
  await staff.getByRole('button',{name:'Kirim penawaran'}).click();
  await staff.locator('#penawaran').getByText(/Versi 1/).waitFor();
  await guest.reload();
  await guest.getByText('Minta penyesuaian',{exact:true}).click();
  await guest.getByLabel('Pesan untuk admin').fill('Apakah bisa diambil di toko?');
  await guest.getByRole('button',{name:'Kirim permintaan penyesuaian'}).click();
  await guest.locator('#klarifikasi').getByText('Apakah bisa diambil di toko?',{exact:true}).waitFor();
  assert.equal(await guest.getByRole('button',{name:'Setujui penawaran'}).count(),0);
  await staff.reload();
  await staff.getByRole('button',{name:'Kirim penawaran'}).click();
  await staff.locator('#penawaran').getByText(/Versi 2/).waitFor();
  await guest.reload();
  await guest.getByRole('button',{name:'Setujui penawaran'}).click();
  await guest.getByRole('heading',{name:'Detail pesanan'}).waitFor();
  await staff.reload();
  for (const label of ['Mulai pengerjaan','Tandai jahitan siap']) await staff.getByRole('button',{name:label}).click();
  await guest.reload();
  await guest.getByRole('button',{name:'Mulai pembayaran simulasi'}).click();
  await staff.reload();
  await staff.getByRole('button',{name:'Verifikasi simulasi lunas'}).click();
  await guest.reload();
  await guest.getByText('Lunas · transaksi uji').waitFor();
  await guest.locator('#pembayaran').scrollIntoViewIfNeeded();
  await capture(guest,'pembayaran');
  await checkScreen(guest,'order');
  await staff.getByRole('button',{name:'Selesaikan pesanan'}).click();
  await guest.reload();
  await guest.locator('.workflow-heading .status').getByText('Pesanan selesai',{exact:true}).waitFor();

  await reset.goto('/akun/lupa');
  await reset.getByLabel('Email').fill(guestEmail);
  await reset.getByRole('button',{name:'Kirim tautan'}).click();
  await reset.getByRole('heading',{name:'Periksa email Anda'}).waitFor();
  await openProof(reset,guestEmail,'Atur ulang kata sandi Marajut');
  await reset.getByLabel('Kata sandi baru').fill(password+'-baru');
  await reset.getByRole('button',{name:'Simpan kata sandi baru'}).click();
  await reset.getByText('Kata sandi diperbarui.',{exact:false}).waitFor();
  await guest.goto(path);
  await guest.waitForURL('**/login');
  await signIn(reset,guestEmail,password+'-baru');

  const signup=await browser.newPage({baseURL:app.origin,viewport:{width:360,height:844}});
  const signupEmail='signup-'+tag+'@marajut.test';
  await signup.goto('/akun/daftar');
  await signup.getByLabel('Email').fill(signupEmail);
  await signup.getByRole('button',{name:'Kirim tautan'}).click();
  await signup.getByRole('heading',{name:'Periksa email Anda'}).waitFor();
  await openProof(signup,signupEmail);
  await signup.getByLabel('Nama Anda').fill('Pelanggan Baru');
  await signup.getByLabel('Kata sandi baru').fill(password);
  await signup.getByRole('button',{name:'Aktifkan akun'}).click();
  await signup.getByText('Belum ada permintaan.',{exact:true}).waitFor();
  assert.deepEqual(axeReports,[],'WCAG A/AA issues');
  console.log('Pilot browser checks passed. Local loads (ms): '+JSON.stringify(metric));
} finally {
  await browser.close();
}
