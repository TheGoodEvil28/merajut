import nodemailer from 'nodemailer';
import { one } from './db.js';
import { digest, token } from './identity.js';

const subjects = {signup:'Aktifkan akun Marajut',guest:'Konfirmasi permintaan jahit',invite:'Undangan penjahit Marajut',recovery:'Atur ulang kata sandi Marajut'};

export function accountMailer() {
  const fixture = ['local','test'].includes(process.env.DJAHIT_ENV);
  if (!fixture && (!process.env.SMTP_HOST || !process.env.MAIL_FROM || !process.env.APP_ORIGIN?.startsWith('https://'))) {
    throw new Error('Configure secure account email and HTTPS origin.');
  }
  const smtp = nodemailer.createTransport({
    host: fixture ? 'mail' : process.env.SMTP_HOST, port: fixture ? 1025 : Number(process.env.SMTP_PORT ?? 465),
    secure: !fixture && Number(process.env.SMTP_PORT ?? 465) === 465, requireTLS: !fixture,
    auth: !fixture && process.env.SMTP_USER ? {user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD} : undefined,
    connectionTimeout:5000, greetingTimeout:5000, socketTimeout:10000,
    disableFileAccess:true, disableUrlAccess:true
  });
  return async ({email,purpose}, code) => {
    const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3100').origin;
    const subject = subjects[purpose];
    await smtp.sendMail({from:fixture ? 'Marajut <akun@djahit.test>' : process.env.MAIL_FROM,
      to:{address:email,name:''},subject,
      text:[subject, '', 'Periksa rincian sebelum mengonfirmasi. Buka tautan ini:', origin + '/akun/tautan#' + code,
        '', 'Atau tempel kode ini di halaman verifikasi:', code, '',
        'Masa berlaku: ' + (purpose === 'invite' ? '48 jam.' : '30 menit.'), 'Abaikan pesan ini bila Anda tidak memintanya.'].join('\n')
    });
  };
}

export async function processAccountMail(pool, send) {
  const code = token();
  const fingerprint = digest(code);
  const job = await one(pool, `WITH pending AS (SELECT id FROM account_challenges
    WHERE consumed_at IS NULL AND expires_at>now() AND mail_state IN ('QUEUED','SENDING')
      AND next_attempt_at<=now() AND mail_attempts<4 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE account_challenges c SET mail_state='SENDING',mail_attempts=mail_attempts+1,
      next_attempt_at=now()+interval '1 minute', code_digest=$1 FROM pending WHERE c.id=pending.id
    RETURNING c.id,c.email,c.purpose,c.mail_attempts`,[fingerprint]);
  if (!job) return false;
  let state = 'SENT';
  try { await send(job, code); }
  catch { state = job.mail_attempts >= 4 ? 'FAILED' : 'QUEUED'; }
  await pool.query(`UPDATE account_challenges SET mail_state=$3,next_attempt_at=now()+$4*interval '1 second'
    WHERE id=$1 AND code_digest=$2`,[job.id,fingerprint,state,2 ** job.mail_attempts]);
  return true;
}
