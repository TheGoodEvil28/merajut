import { randomUUID } from 'node:crypto';
import { one, transaction } from './db.js';
import { activeBusiness } from './catalog.js';
import { queueChallenge } from './accounts.js';
import { fixtureEmail, verifyPassword } from './identity.js';
import { AppError, conflict, found } from './errors.js';
import { event } from './inquiries.js';

const unavailable = () => { throw new AppError(409,'WORK_UNAVAILABLE','Status berubah atau tindakan sudah diproses. Muat ulang dan periksa kembali.'); };
async function manager(db,actor,password) {
  const account = await one(db,`SELECT u.password_digest FROM users u JOIN platform_managers m ON m.user_id=u.id
    WHERE u.id=$1 AND u.role='operator' FOR SHARE OF m,u`,[actor.id]);
  if (!account) throw new AppError(403,'FORBIDDEN','Akses pengelola diperlukan.');
  if (!await verifyPassword(account.password_digest,password)) throw new AppError(403,'REAUTH_REQUIRED','Periksa kata sandi pengelola.');
}
const audit = (db,actor,action,id,reason=null) => db.query(
  'INSERT INTO operator_events(actor_id,action,target_id,reason) VALUES($1,$2,$3,$4)',[actor.id,action,id,reason]);

export async function partnerDirectory(pool) {
  return (await pool.query(`SELECT b.*,u.display_name AS operator,
    (SELECT count(*)::int FROM services s WHERE s.business_id=b.id AND s.active) AS offers,
    (SELECT max(expires_at) FROM account_challenges c WHERE c.business_id=b.id AND consumed_at IS NULL AND expires_at>now()) AS invited_until
    FROM businesses b LEFT JOIN provider_memberships m ON m.business_id=b.id AND m.active LEFT JOIN users u ON u.id=m.user_id
    ORDER BY b.published,b.name,b.id`)).rows;
}

export async function operationsBoard(pool) {
  const [shops,reviews,failures,health,events] = await Promise.all([
    partnerDirectory(pool),
    pool.query(`SELECT r.id,r.reason,r.requested_at,o.status,b.name AS business,s.name AS service
      FROM order_reviews r JOIN orders o ON o.id=r.order_id JOIN inquiries i ON i.id=o.inquiry_id
      JOIN services s ON s.id=i.service_id JOIN businesses b ON b.id=o.business_id WHERE r.state='OPEN' ORDER BY r.requested_at`),
    pool.query(`SELECT id,purpose,state,attempts,updated_at FROM notification_outbox WHERE state IN ('NEEDS_REVIEW','FAILED') ORDER BY updated_at LIMIT 50`),
    one(pool,`SELECT (SELECT max(seen_at) FROM worker_heartbeats) AS heartbeat,
      (SELECT count(*) FROM inbound_inbox WHERE state='FAILED')::int AS inbound_failed,
      (SELECT count(*) FROM account_challenges WHERE mail_state='FAILED' AND expires_at>now() AND consumed_at IS NULL)::int AS mail_failed,
      (SELECT count(*) FROM notification_outbox WHERE state IN ('QUEUED','RETRY_WAIT','SENDING'))::int AS pending`),
    pool.query(`SELECT e.action,e.reason,e.created_at,u.display_name FROM operator_events e JOIN users u ON u.id=e.actor_id ORDER BY e.id DESC LIMIT 30`)
  ]);
  return { shops,reviews:reviews.rows,failures:failures.rows,health,events:events.rows };
}

export function inviteTailor(pool,actor,input) {
  return transaction(pool,async db => {
    await manager(db,actor,input.password);
    let business;
    if (input.businessId) {
      business = found(await one(db,'SELECT * FROM businesses WHERE id=$1 FOR UPDATE',[input.businessId]));
      if (business.moderation_revision!==input.revision) unavailable();
    }
    const email = await fixtureEmail(db,input.email);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,57))',[email]);
    const user = await one(db,'SELECT id,role FROM users WHERE email=$1',[email]);
    if (user && (user.role!=='provider' || await one(db,'SELECT 1 FROM provider_memberships WHERE user_id=$1 AND active',[user.id]))) {
      throw new AppError(409,'WORK_UNAVAILABLE','Email ini sudah terhubung ke akun lain atau penjahit aktif.');
    }
    if (!business) {
      if (await one(db,`SELECT 1 FROM account_challenges WHERE purpose='invite' AND email=$1 AND consumed_at IS NULL AND expires_at>now()`,[email])) {
        throw new AppError(409,'WORK_UNAVAILABLE','Undangan masih berlaku. Buka usaha yang telah dibuat untuk mengirim ulang.');
      }
      const slug = (input.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48) || 'penjahit')+'-'+randomUUID().slice(0,8);
      business=await one(db,`INSERT INTO businesses(name,area,description,slug) VALUES ($1,$2,$3,$4) RETURNING *`,
        [input.name,input.area,input.description,slug]);
    }
    if (await one(db,'SELECT 1 FROM provider_memberships WHERE business_id=$1 AND active',[business.id])) unavailable();
    await db.query('UPDATE account_challenges SET consumed_at=now() WHERE business_id=$1 AND consumed_at IS NULL',[business.id]);
    await queueChallenge(db,'invite',email,{businessId:business.id});
    await db.query('UPDATE businesses SET moderation_revision=moderation_revision+1 WHERE id=$1',[business.id]);
    await audit(db,actor,'INVITE_SENT',business.id);
    return {id:business.id};
  });
}

export function moderateShop(pool,actor,id,input) {
  return transaction(pool,async db => {
    await manager(db,actor,input.password);
    const b=found(await one(db,'SELECT * FROM businesses WHERE id=$1 FOR UPDATE',[id]));
    if (b.moderation_revision!==input.revision) unavailable();
    const member=await one(db,'SELECT user_id FROM provider_memberships WHERE business_id=$1 AND active FOR UPDATE',[id]);
    if (input.action==='publish') {
      if ((!member && !b.whatsapp) || b.published || !await one(db,'SELECT 1 FROM services WHERE business_id=$1 AND active',[id])) unavailable();
    } else if (input.action==='hide' && !b.published) unavailable();
    else if (input.action==='revoke') {
      if (!member) unavailable();
      await db.query('UPDATE provider_memberships SET active=false WHERE business_id=$1 AND user_id=$2',[id,member.user_id]);
      await db.query('DELETE FROM sessions WHERE user_id=$1',[member.user_id]);
      await db.query("UPDATE inbound_threads SET state='AWAITING_HUMAN',handled_by=NULL WHERE business_id=$1 AND handled_by=$2 AND state='HUMAN'",[id,member.user_id]);
    }
    await db.query('UPDATE businesses SET published=$2,moderation_revision=moderation_revision+1 WHERE id=$1',[id,input.action==='publish']);
    await audit(db,actor,{publish:'PUBLISHED',hide:'UNPUBLISHED',revoke:'ACCESS_REVOKED'}[input.action],id,input.reason);
  });
}

export async function requestCancellation(pool,actor,id,input) {
  return transaction(pool,async db => {
    const b=await activeBusiness(db,actor,true);
    const order=found(await one(db,'SELECT * FROM orders WHERE id=$1 AND business_id=$2 FOR UPDATE',[id,b.id]));
    if (order.fee_bps != null || !['IN_PROGRESS','READY'].includes(order.status) || input.revision!==order.revision) unavailable();
    const review=await one(db,`INSERT INTO order_reviews(order_id,order_revision,requested_by,reason) VALUES($1,$2,$3,$4)
      ON CONFLICT DO NOTHING RETURNING id`,[id,order.revision,actor.id,input.reason]);
    if (!review) unavailable();
    await event(db,order.inquiry_id,actor,'CANCEL_REVIEW',order.status,order.status,input.reason,id);
    return {inquiryId:order.inquiry_id};
  });
}

export function decideCancellation(pool,actor,id,input) {
  return transaction(pool,async db => {
    await manager(db,actor,input.password);
    const candidate=found(await one(db,'SELECT order_id FROM order_reviews WHERE id=$1',[id]));
    const order=await one(db,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[candidate.order_id]);
    const review=await one(db,'SELECT * FROM order_reviews WHERE id=$1 FOR UPDATE',[id]);
    if (review.state!=='OPEN' || review.order_revision!==order.revision || !['IN_PROGRESS','READY'].includes(order.status)) unavailable();
    const approved=input.action==='approve';
    if (approved) {
      if (await one(db,'SELECT 1 FROM cash_receipts WHERE order_id=$1 AND voided_at IS NULL',[order.id])) {
        throw new AppError(409,'WORK_UNAVAILABLE','Periksa catatan tunai bersama penjahit sebelum membatalkan pesanan.');
      }
      await db.query("UPDATE orders SET status='CANCELLED',revision=revision+1 WHERE id=$1",[order.id]);
    }
    await db.query('UPDATE order_reviews SET state=$2,decided_by=$3,decided_at=now(),decision_reason=$4 WHERE id=$1',
      [id,approved?'APPROVED':'DECLINED',actor.id,input.reason]);
    await event(db,order.inquiry_id,actor,approved?'CANCEL_APPROVED':'CANCEL_DECLINED',order.status,approved?'CANCELLED':order.status,input.reason,order.id);
    await audit(db,actor,approved?'CANCEL_APPROVED':'CANCEL_DECLINED',id,input.reason);
  });
}

export function recordCash(pool,actor,id,input) {
  return transaction(pool,async db => {
    const b=await activeBusiness(db,actor,true);
    const order=found(await one(db,'SELECT * FROM orders WHERE id=$1 AND business_id=$2 FOR UPDATE',[id,b.id]));
    if (order.fee_bps != null || !['READY','COMPLETED'].includes(order.status) || order.cash_revision!==input.revision) unavailable();
    const current=await one(db,'SELECT id FROM cash_receipts WHERE order_id=$1 AND voided_at IS NULL',[id]);
    if (input.action==='record') {
      if (current) unavailable();
      await db.query('INSERT INTO cash_receipts(order_id,amount,recorded_by) VALUES($1,$2,$3)',[id,order.amount,actor.id]);
    } else {
      if (!current) unavailable();
      await db.query('UPDATE cash_receipts SET voided_at=now(),voided_by=$2,void_reason=$3 WHERE id=$1',[current.id,actor.id,input.reason]);
    }
    await db.query('UPDATE orders SET cash_revision=cash_revision+1 WHERE id=$1',[id]);
    await event(db,order.inquiry_id,actor,input.action==='record'?'CASH_RECORDED':'CASH_VOIDED',order.status,order.status,input.reason,id);
    return {inquiryId:order.inquiry_id};
  });
}

export function reconcileNotification(pool,actor,id,input) {
  return transaction(pool,async db => {
    await manager(db,actor,input.password);
    const intent=found(await one(db,`SELECT o.state,EXISTS(SELECT 1 FROM simulated_messages s WHERE s.intent_id=o.id) AS received
      FROM notification_outbox o WHERE o.id=$1 AND o.mode='simulated' FOR UPDATE OF o`,[id]));
    if (!['FAILED','NEEDS_REVIEW'].includes(intent.state)) unavailable();
    // A durable simulation receipt wins over a retry or a stale worker's reported failure.
    const state=intent.received?'SIMULATED':input.action==='retry'?'QUEUED':'SUPPRESSED';
    await db.query(`UPDATE notification_outbox SET state=$2,attempts=CASE WHEN $2='QUEUED' THEN 0 ELSE attempts END,
      lease_until=NULL,lease_token=NULL,next_attempt_at=now(),updated_at=now(),last_error=NULL WHERE id=$1`,[id,state]);
    await audit(db,actor,'NOTICE_'+state,id,input.reason);
  });
}
