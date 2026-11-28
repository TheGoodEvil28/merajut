import { one, transaction } from './db.js';
import { digest, fixtureEmail, hashPassword, verifyPassword, startSession, endSession } from './identity.js';
import { AppError, conflict, found } from './errors.js';
import { normalizedPhoto } from './photos.js';
import { persistInquiry } from './inquiries.js';

const invalidProof = () => new AppError(409, 'INVALID_PROOF', 'Tautan sudah digunakan atau kedaluwarsa. Minta email baru.');
const lockAddress = (db, email) => db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 57))', [email]);

export async function queueChallenge(db, purpose, email, { userId = null, businessId = null, draft = null, browserDigest = null } = {}) {
  return one(db, `INSERT INTO account_challenges(purpose,email,user_id,business_id,draft,draft_key,browser_digest,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,now() + CASE $1 WHEN 'invite' THEN interval '48 hours' ELSE interval '30 minutes' END)
    RETURNING id`, [purpose,email,userId,businessId,draft,draft?.key ?? null,browserDigest]);
}

export function requestProof(pool, purpose, address, draft = null, browserDigest = null) {
  return transaction(pool, async db => {
    const email = await fixtureEmail(db,address);
    await lockAddress(db, email);
    if (draft) {
      const existing = await one(db, `SELECT id,draft,browser_digest,consumed_at,expires_at > now() AS valid
        FROM account_challenges WHERE email=$1 AND draft_key=$2`, [email, draft.key]);
      if (existing) {
        if (existing.browser_digest !== browserDigest || !existing.valid || existing.consumed_at
          || digest(JSON.stringify(draft, Object.keys(draft).sort())) !== digest(JSON.stringify(existing.draft, Object.keys(draft).sort()))) {
          conflict('Mulai draf baru untuk mengirim permintaan ini.');
        }
        return { draftId: existing.id };
      }
      found(await one(db, `SELECT s.id FROM services s JOIN businesses b ON b.id=s.business_id
        WHERE s.id=$1 AND s.active AND b.published`, [draft.serviceId]));
    }
    const recent = await one(db, `SELECT count(*)::int AS n FROM account_challenges
      WHERE email=$1 AND purpose=$2 AND created_at > now() - interval '1 hour'`, [email,purpose]);
    if (recent.n >= 6) {
      if (draft) throw new AppError(429,'RATE_LIMITED','Coba lagi setelah satu jam.');
      return {};
    }
    const user = await one(db, 'SELECT id FROM users WHERE email=$1', [email]);
    if (purpose === 'recovery' && !user) return {};
    const challenge = await queueChallenge(db, purpose, email, { userId:user?.id, draft, browserDigest });
    return draft ? { draftId: challenge.id } : {};
  });
}

export async function addGuestPhoto(pool, id, browserDigest, bytes) {
  const scope = `id=$1 AND browser_digest=$2 AND purpose='guest' AND consumed_at IS NULL AND expires_at > clock_timestamp()`;
  found(await one(pool, 'SELECT id FROM account_challenges WHERE ' + scope, [id,browserDigest]));
  const content = await normalizedPhoto(bytes);
  return transaction(pool, async db => {
    found(await one(db, 'SELECT id FROM account_challenges WHERE ' + scope + ' FOR UPDATE', [id,browserDigest]));
    await db.query(`INSERT INTO guest_photos(challenge_id,content) VALUES ($1,$2)
      ON CONFLICT(challenge_id) DO UPDATE SET content=EXCLUDED.content`, [id,content]);
  });
}

export async function inspectProof(db, raw) {
  const row = await one(db, `SELECT c.purpose, c.draft, b.name AS business, s.name AS service,
      EXISTS(SELECT 1 FROM users u WHERE u.email=c.email) AS existing
    FROM account_challenges c LEFT JOIN services s ON s.id=(c.draft->>'serviceId')::uuid
    LEFT JOIN businesses b ON b.id=COALESCE(c.business_id,s.business_id)
    WHERE c.code_digest=$1 AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp()`, [digest(raw)]);
  if (!row) throw invalidProof();
  return row;
}

export function redeemProof(pool, raw, { password, name }, sessionRaw) {
  return transaction(pool, async db => {
    const code = digest(raw);
    const candidate = await one(db,'SELECT email,business_id FROM account_challenges WHERE code_digest=$1',[code]);
    if (!candidate) throw invalidProof();
    if (candidate.business_id) await db.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[candidate.business_id]);
    await lockAddress(db,candidate.email);
    const c = await one(db, `SELECT * FROM account_challenges WHERE code_digest=$1 AND consumed_at IS NULL
      AND expires_at > clock_timestamp() FOR UPDATE`, [code]);
    if (!c) throw invalidProof();
    const user = await one(db,'SELECT * FROM users WHERE email=$1 FOR UPDATE',[c.email]);
    if (c.purpose === 'recovery') {
      if (!user || user.id !== c.user_id) throw invalidProof();
      await db.query('UPDATE users SET password_digest=$2 WHERE id=$1',[user.id,await hashPassword(password)]);
      await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
      await db.query(`UPDATE account_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='recovery' AND consumed_at IS NULL`,[user.id]);
      return { reset:true };
    }
    const role = c.purpose === 'invite' ? 'provider' : 'customer';
    if (user && (user.role !== role || !(await verifyPassword(user.password_digest,password)))) {
      throw new AppError(403,'ACCOUNT_MISMATCH','Gunakan akun dan kata sandi yang sesuai dengan undangan atau permintaan.');
    }
    if (!user && !name?.trim()) throw new AppError(422,'NAME_REQUIRED','Isi nama Anda.');
    const owner = user ?? await one(db, `INSERT INTO users(email,display_name,password_digest,role,verified_at)
      VALUES ($1,$2,$3,$4,now()) RETURNING id,role`, [c.email,name.trim(),await hashPassword(password),role]);
    if (role === 'provider') {
      if (await one(db,'SELECT 1 FROM provider_memberships WHERE active AND (user_id=$1 OR business_id=$2)',[owner.id,c.business_id])) {
        conflict('Undangan ini sudah tidak tersedia.');
      }
      await db.query(`INSERT INTO provider_memberships(business_id,user_id) VALUES ($1,$2)
        ON CONFLICT(business_id,user_id) DO UPDATE SET active=true`,[c.business_id,owner.id]);
      await db.query('UPDATE businesses SET moderation_revision=moderation_revision+1 WHERE id=$1',[c.business_id]);
      await db.query("INSERT INTO operator_events(actor_id,action,target_id) VALUES ($1,'INVITE_ACCEPTED',$2)",[owner.id,c.business_id]);
    }
    let inquiryId;
    if (c.draft) {
      const result = await persistInquiry(db, owner, c.draft);
      inquiryId = result.id;
      if (result.created) {
        await db.query('INSERT INTO inquiry_photos(inquiry_id,content) SELECT $2,content FROM guest_photos WHERE challenge_id=$1',[c.id,inquiryId]);
      }
      await db.query('DELETE FROM guest_photos WHERE challenge_id=$1',[c.id]);
    }
    await db.query('UPDATE account_challenges SET consumed_at=now(), draft=NULL,browser_digest=NULL WHERE id=$1',[c.id]);
    await endSession(db,sessionRaw);
    const session = await startSession(db, owner.id);
    return { session, inquiryId, role };
  });
}
