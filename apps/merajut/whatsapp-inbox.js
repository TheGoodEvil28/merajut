import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { one, transaction } from './db.js';
import { AppError } from './errors.js';
import { canonicalChat, providerMessageId } from './whatsapp-config.js';
import { quoteFormReference } from './whatsapp-quote.js';
import { applyWhatsAppOrderReply, parseOrderReply } from './whatsapp-order-reply.js';

const envelopeSchema = z.object({event:z.string().max(100),sessionId:z.string().min(1).max(100),
  idempotencyKey:z.string().min(1).max(512),timestamp:z.iso.datetime({offset:true}),data:z.record(z.string(),z.unknown())});
const supported = ['message.ack','message.failed','message.received'];

export function verifyDispatchWebhook(raw, signature, settings) {
  if (!Buffer.isBuffer(raw) || !settings.webhookSecret || !/^sha256=[a-f\d]{64}$/.test(signature || '')) {
    throw new AppError(401,'INVALID_SIGNATURE','Invalid webhook signature.');
  }
  const expected = createHmac('sha256',settings.webhookSecret).update(raw).digest();
  if (!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'))) throw new AppError(401,'INVALID_SIGNATURE','Invalid webhook signature.');
  let parsed;
  try { parsed = envelopeSchema.safeParse(JSON.parse(raw.toString('utf8'))); } catch { parsed = {success:false}; }
  if (!parsed.success) throw new AppError(400,'INVALID_WEBHOOK','Malformed webhook envelope.');
  const event = parsed.data;
  const age = Date.now()-Date.parse(event.timestamp);
  if (age > 30*86400_000 || age < -300_000 || event.sessionId !== settings.sessionId || !supported.includes(event.event)) return null;
  return event;
}

async function resolveChat(db, chat, settings) {
  const canonical = canonicalChat(chat);
  if (!canonical?.endsWith('@lid')) return canonical;
  const permission = await one(db, `SELECT p.chat_id FROM whatsapp_dispatch_permissions p JOIN businesses b ON b.id=p.business_id
    WHERE p.mode=$1 AND p.session_id=$2 AND p.sender_alias=$3 AND p.revoked_at IS NULL
      AND p.chat_id=b.whatsapp||'@c.us'`,[settings.callbackMode,settings.sessionId,canonical]);
  return permission?.chat_id || null;
}

export async function recordDispatchWebhook(pool, event, settings) {
  if (!event) return;
  return transaction(pool,async db => {
    const data = event.data;
    const received = event.event === 'message.received';
    if (received && (data.fromMe !== false || data.type !== 'text')) return;
    const chat = await resolveChat(db,data.chatId,settings);
    if (!chat) {
      // Retain only receipt metadata when its chat cannot be verified. It is never applied automatically.
      if (!received) await db.query(`INSERT INTO whatsapp_dispatch_inbox
        (mode,session_id,delivery_key,event_kind,chat_id,event_at,state,correlation)
        VALUES($1,$2,$3,$4,'',$5,'REVIEW','MISSING_CHAT') ON CONFLICT DO NOTHING`,
        [settings.callbackMode,settings.sessionId,event.idempotencyKey,event.event,event.timestamp]);
      return;
    }
    const permitted = await one(db, `SELECT id FROM whatsapp_dispatch_permissions WHERE mode=$1 AND session_id=$2
      AND chat_id=$3 AND revoked_at IS NULL UNION ALL SELECT id FROM whatsapp_dispatches
      WHERE mode=$1 AND session_id=$2 AND recipient=$3 LIMIT 1`,[settings.callbackMode,settings.sessionId,chat]);
    if (!permitted) return;
    let sender = null;
    let permission = null;
    let messageAt = null;
    let body = null;
    if (received) {
      sender = await resolveChat(db,chat.endsWith('@g.us') ? data.author : data.from,settings);
      permission = sender && await one(db, `SELECT p.* FROM whatsapp_dispatch_permissions p JOIN businesses b ON b.id=p.business_id
        WHERE p.mode=$1 AND p.session_id=$2 AND p.chat_id=$3 AND p.revoked_at IS NULL AND p.channel='partner'
          AND p.chat_id=b.whatsapp||'@c.us'`,[settings.callbackMode,settings.sessionId,sender]);
      if (!permission || (!chat.endsWith('@g.us') && chat !== sender)) return;
      if (chat.endsWith('@g.us')) {
        const group = await one(db, `SELECT id,version FROM whatsapp_dispatch_permissions WHERE mode=$1 AND session_id=$2 AND channel='group'
          AND chat_id=$3 AND revoked_at IS NULL`,[settings.callbackMode,settings.sessionId,chat]);
        if (!group || permission.verified_group !== chat || permission.verified_group_version !== group.version || chat !== settings.groupChatId) return;
      }
      if (typeof data.body !== 'string' || !data.body.trim() || data.body.length > 4096 ||
          !Number.isFinite(data.timestamp) || data.timestamp <= 0 || data.timestamp*1000 > Date.now()+300_000) {
        throw new AppError(400,'INVALID_WEBHOOK','Malformed text message.');
      }
      body = data.body;
      messageAt = new Date(data.timestamp*1000);
    }
    const originalChat = canonicalChat(data.chatId);
    const messageId = providerMessageId(data.messageId || data.id,originalChat);
    const alternate = data.messageId && data.id ? providerMessageId(data.id,originalChat) : messageId;
    const unambiguous = messageId && alternate === messageId;
    if (received && !unambiguous) throw new AppError(400,'INVALID_WEBHOOK','Malformed message identifier.');
    const level = {sent:1,delivered:2,read:3,played:3}[data.status] || 0;
    if (event.event === 'message.ack' && !level) throw new AppError(400,'INVALID_WEBHOOK','Malformed delivery status.');
    await db.query(`INSERT INTO whatsapp_dispatch_inbox
      (mode,session_id,delivery_key,event_kind,provider_message_id,chat_id,sender_chat,business_id,body,receipt_level,
       event_at,message_at,state,correlation)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
      [settings.callbackMode,settings.sessionId,event.idempotencyKey,event.event,unambiguous ? messageId : null,chat,sender,
      permission?.business_id || null,body,level,event.timestamp,messageAt,unambiguous ? 'PENDING' : 'REVIEW',
      unambiguous ? null : 'AMBIGUOUS_MESSAGE_ID']);
  });
}

export async function processDispatchInbox(pool, {settings, mode = 'simulated'} = {}) {
  return transaction(pool,async db => {
    // Revisit early receipts after the send response has stored its provider ID.
    const item = await one(db, `SELECT n.* FROM whatsapp_dispatch_inbox n WHERE state='PENDING'
      OR (state='REVIEW' AND correlation='UNMATCHED_RECEIPT' AND EXISTS (
        SELECT 1 FROM whatsapp_dispatches d WHERE d.mode=n.mode AND d.session_id=n.session_id
          AND d.provider_message_id=n.provider_message_id AND d.recipient=n.chat_id))
      ORDER BY received_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!item) return false;
    let job = null;
    let correlation = 'UNMATCHED_RECEIPT';
    if (item.event_kind === 'message.received') {
      const orderReply = parseOrderReply(item.body);
      const formReference = quoteFormReference(item.body);
      const explicitReference = orderReply?.reference || formReference;
      const references = explicitReference ? [explicitReference] : [...new Set((item.body || '').toUpperCase().match(/\b[A-F\d]{8}\b/g) || [])];
      const candidates = (await db.query(`SELECT DISTINCT ON (d.inquiry_id) d.* FROM whatsapp_dispatches d
        JOIN whatsapp_dispatch_permissions p ON p.business_id=$1 AND p.mode=d.mode AND p.session_id=d.session_id
        WHERE p.channel='partner' AND p.revoked_at IS NULL AND p.chat_id=$2 AND d.mode=$3 AND d.session_id=$4
          AND upper(left(d.inquiry_id::text,8))=ANY($5::text[])
          AND d.state IN ('SENDING','SENT','NEEDS_REVIEW','CONFIRMED_MANUALLY')
          AND d.attempt_started_at IS NOT NULL AND date_trunc('second',d.attempt_started_at)<=$6
          AND ((d.channel='partner' AND d.business_id=$1 AND d.recipient=$2 AND $7=$2)
            OR (d.channel='group' AND d.purpose='contact' AND d.recipient=p.verified_group AND ($7=$2 OR $7=p.verified_group)
              AND EXISTS(SELECT 1 FROM whatsapp_dispatch_permissions g WHERE g.mode=d.mode AND g.session_id=d.session_id
                AND g.channel='group' AND g.chat_id=d.recipient AND g.version=p.verified_group_version AND g.revoked_at IS NULL)))
        ORDER BY d.inquiry_id,(d.channel='partner') DESC,(d.purpose='quote_request' AND $8::boolean) DESC,d.created_at DESC`,
        [item.business_id,item.sender_chat,item.mode,item.session_id,references,item.message_at,item.chat_id,Boolean(formReference)])).rows;
      if (candidates.length === 1) job = candidates[0];
      correlation = job ? 'REFERENCE_MATCHED' : 'REFERENCE_REVIEW_REQUIRED';
      if (job && orderReply && item.chat_id===item.sender_chat && item.mode===settings?.mode && item.session_id===settings.sessionId) {
        correlation = await applyWhatsAppOrderReply(db,item,job,orderReply,mode) ? 'ORDER_UPDATE_APPLIED' : 'ORDER_UPDATE_REVIEW_REQUIRED';
      }
    } else {
      job = await one(db, `SELECT * FROM whatsapp_dispatches WHERE mode=$1 AND session_id=$2
        AND provider_message_id=$3 AND recipient=$4 FOR UPDATE`,[item.mode,item.session_id,item.provider_message_id,item.chat_id]);
      if (job) {
        const failed = item.event_kind === 'message.failed';
        const level = job.channel === 'partner' ? item.receipt_level : 0;
        const late = ['CANCELLED','FAILED'].includes(job.state) && !failed;
        await db.query(`UPDATE whatsapp_dispatches SET delivery_level=greatest(delivery_level,$2),
          delivery_at=CASE WHEN $2>delivery_level THEN $3 ELSE delivery_at END,
          late_evidence=late_evidence OR $4,
          state=CASE WHEN $5 AND delivery_level<2 AND state IN ('SENT','SENDING') THEN 'NEEDS_REVIEW'
            WHEN $2>=2 AND state='NEEDS_REVIEW' AND last_error='RECEIPT_FAILED' THEN 'SENT' ELSE state END,
          last_error=CASE WHEN $5 AND delivery_level<2 THEN 'RECEIPT_FAILED' ELSE last_error END,updated_at=now()
          WHERE id=$1`,[job.id,level,item.event_at,late,failed]);
        correlation = late ? 'LATE_DELIVERY_REVIEW' : 'RECEIPT_MATCHED';
      }
    }
    await db.query(`UPDATE whatsapp_dispatch_inbox SET state=$2,dispatch_id=$3,inquiry_id=$4,correlation=$5,processed_at=now() WHERE id=$1`,
      [item.id,job && correlation!=='ORDER_UPDATE_REVIEW_REQUIRED' ? 'LINKED' : 'REVIEW',job?.id || null,job?.inquiry_id || null,correlation]);
    return true;
  });
}
