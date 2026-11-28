import { createHash, randomUUID } from 'node:crypto';
import { one, transaction } from './db.js';
import { AppError, conflict, found } from './errors.js';
import { lockInquiry } from './inquiries.js';
import { orderReference } from './order-flow.js';
import { canonicalChat } from './whatsapp-config.js';
import { followupDrafts, followupLabels, readDispatchWorkflow } from './whatsapp-followup.js';
import { partnerQuoteForm, quoteReplyDraft } from './whatsapp-quote.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blockingStates = ['QUEUED','SENDING','RETRY_WAIT','SENT','NEEDS_REVIEW','CONFIRMED_MANUALLY'];
export const dispatchLabels = {
  QUEUED:'Dalam antrean', SENDING:'Sedang dikirim', RETRY_WAIT:'Menunggu percobaan berikutnya',
  SENT:'Diterima gateway', NEEDS_REVIEW:'Perlu diperiksa', FAILED:'Gagal sebelum dikirim',
  CANCELLED:'Dibatalkan', CONFIRMED_MANUALLY:'Dikonfirmasi melalui WhatsApp'
};

export function requireDispatchManager(actor) {
  if (actor?.role !== 'operator' || !actor.manager) throw new AppError(403,'FORBIDDEN','Akses pengelola diperlukan.');
}

export function dispatchAudit(db, actor, action, target, reason = null) {
  return db.query('INSERT INTO operator_events(actor_id,action,target_id,reason) VALUES($1,$2,$3,$4)',
    [actor.id, action, target, reason]);
}

export async function permissionFor(db, settings, businessId = null, lock = false) {
  return one(db, `SELECT * FROM whatsapp_dispatch_permissions WHERE mode=$1 AND session_id=$2 AND scope_key=$3 ${lock ? 'FOR SHARE' : ''}`,
    [settings.mode, settings.sessionId, businessId ? 'partner:'+businessId : 'group']);
}

export function hasDispatchPermission(permission, chatId) {
  return Boolean(chatId && permission?.chat_id === chatId && !permission.revoked_at);
}

export function saveDispatchPermission(pool, actor, settings, businessId, input) {
  requireDispatchManager(actor);
  if (settings.mode === 'disabled') conflict('Aktifkan konfigurasi dispatch sebelum mencatat persetujuan.');
  return transaction(pool, async db => {
    // Permission edits and preflight take the business lock before the permission lock.
    const business = businessId ? found(await one(db, 'SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [businessId])) : null;
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [settings.mode+settings.sessionId+(businessId || 'group')]);
    const previous = await permissionFor(db, settings, businessId);
    if ((previous?.version || 0) !== input.version) conflict('Persetujuan telah berubah.');
    const chat = business ? canonicalChat(business.whatsapp+'@c.us') : settings.groupChatId;
    if (!chat) conflict('Lengkapi tujuan WhatsApp terlebih dahulu.');
    if (input.action === 'grant' && input.confirmed !== 'yes') conflict('Konfirmasi persetujuan penerima diperlukan.');
    const senderAlias = input.senderAlias || null;
    if (senderAlias && !/^\d+@lid$/.test(senderAlias)) conflict('Identitas WhatsApp alternatif tidak valid.');
    const group = business && input.groupMember === 'yes' ? await permissionFor(db,settings,null,true) : null;
    if (input.action === 'grant' && business && input.groupMember === 'yes' && !hasDispatchPermission(group, settings.groupChatId)) {
      conflict('Setujui grup terlebih dahulu sebelum mencatat keanggotaan mitra.');
    }
    const permission = await one(db, `INSERT INTO whatsapp_dispatch_permissions
      (mode,session_id,scope_key,channel,business_id,chat_id,evidence,verified_by,revoked_at,sender_alias,verified_group,verified_group_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN now() END,$10,$11,$12)
      ON CONFLICT(mode,session_id,scope_key) DO UPDATE SET chat_id=EXCLUDED.chat_id,evidence=EXCLUDED.evidence,
        verified_by=EXCLUDED.verified_by,revoked_at=EXCLUDED.revoked_at,sender_alias=EXCLUDED.sender_alias,
        verified_group=EXCLUDED.verified_group,verified_group_version=EXCLUDED.verified_group_version,
        version=whatsapp_dispatch_permissions.version+1,granted_at=now()
      RETURNING *`, [settings.mode,settings.sessionId,businessId ? 'partner:'+businessId : 'group',
      businessId ? 'partner' : 'group',businessId,chat,input.evidence,actor.id,input.action === 'revoke',senderAlias,
      group?.chat_id || null,group?.version || null]);
    await dispatchAudit(db, actor, input.action === 'grant' ? 'WHATSAPP_PERMISSION_GRANTED' : 'WHATSAPP_PERMISSION_REVOKED',
      permission.id, input.evidence);
    return permission;
  });
}

export async function dispatchPaused(db, settings, lock = false) {
  const scope = [settings.mode,settings.sessionId];
  if (lock) await db.query('INSERT INTO whatsapp_dispatch_control(mode,session_id) VALUES($1,$2) ON CONFLICT DO NOTHING',scope);
  const control = await one(db, `SELECT paused FROM whatsapp_dispatch_control WHERE mode=$1 AND session_id=$2 ${lock ? 'FOR SHARE' : ''}`,scope);
  return control?.paused ?? false;
}

export function pauseDispatch(pool, actor, settings, paused, reason) {
  requireDispatchManager(actor);
  return transaction(pool, async db => {
    await db.query(`INSERT INTO whatsapp_dispatch_control(mode,session_id,paused) VALUES($1,$2,$3)
      ON CONFLICT(mode,session_id) DO UPDATE SET paused=EXCLUDED.paused,updated_at=now()`,
      [settings.mode,settings.sessionId,paused]);
    await dispatchAudit(db, actor, paused ? 'WHATSAPP_PAUSED' : 'WHATSAPP_RESUMED', actor.id, reason);
  });
}

async function groupTakenDraft(db, inquiry, settings, fields, workflow) {
  if (settings.mode==='disabled' || !settings.groupChatId || inquiry.dispatch_state!=='AVAILABLE' ||
      ['DECLINED','CANCELLED'].includes(inquiry.status) || ['COMPLETED','CANCELLED'].includes(workflow.order_status)) return null;
  const announcement = await one(db, `SELECT d.id FROM whatsapp_dispatches d
    WHERE d.inquiry_id=$1 AND d.business_id=$2 AND d.mode=$3 AND d.session_id=$4 AND d.recipient=$5
      AND d.channel='group' AND d.purpose='contact' AND d.state IN ('SENT','CONFIRMED_MANUALLY')
      AND EXISTS (SELECT 1 FROM whatsapp_dispatch_inbox n WHERE n.inquiry_id=d.inquiry_id AND n.business_id=d.business_id
        AND n.mode=d.mode AND n.session_id=d.session_id AND n.state='LINKED' AND n.event_kind='message.received'
        AND n.chat_id=$6 AND n.sender_chat=n.chat_id)
    ORDER BY d.created_at,d.id LIMIT 1`, [inquiry.id,inquiry.business_id,settings.mode,settings.sessionId,
    settings.groupChatId,canonicalChat(fields.whatsapp+'@c.us')]);
  if (!announcement) return null;
  return {channel:'group',contextKey:announcement.id,text:[
    '🧵 *MERAJUT — PESANAN SUDAH DIAMBIL*',
    '',
    '*Kode pesanan*',
    '```',
    orderReference(inquiry.id),
    '```',
    '',
    'Admin sudah mengonfirmasi mitra untuk pesanan ini. Mohon hentikan pengajuan untuk kode ini.',
    'Mitra yang menangani pesanan, lanjutkan koordinasi dengan admin lewat chat pribadi.'
  ].join('\n')};
}

async function dispatchInputs(db, inquiry, settings, lock) {
  const paused = settings.mode !== 'disabled' && await dispatchPaused(db,settings,lock);
  const fields = found(await one(db, `SELECT b.name AS business,b.whatsapp,s.name AS service,i.desired_date::text AS desired_date
    FROM inquiries i JOIN businesses b ON b.id=i.business_id JOIN services s ON s.id=i.service_id
    WHERE i.id=$1 ${lock ? 'FOR SHARE OF b,s' : ''}`, [inquiry.id]));
  const workflow = await readDispatchWorkflow(db,inquiry.id,lock);
  const followups = followupDrafts(inquiry,fields,workflow);
  const taken = await groupTakenDraft(db,inquiry,settings,fields,workflow);
  if (taken) followups.group_taken = taken;
  return {paused,fields,workflow,followups};
}

export async function dispatchSnapshot(db, inquiry, channel, settings, {
  purpose = 'contact', lock = false, excludeId = null, inputs = null
} = {}) {
  const {paused,fields,workflow,followups} = inputs ?? await dispatchInputs(db,inquiry,settings,lock);
  const contact = purpose==='contact';
  const followup = followups[purpose];
  const contextKey = followup?.contextKey || 'initial';
  let reason = null;
  if (settings.mode === 'disabled') reason = 'Pengiriman otomatis dinonaktifkan. Gunakan tautan WhatsApp untuk koordinasi manual.';
  else if (paused) reason = 'Pengiriman dijeda oleh pengelola.';
  const allowed = channel === 'group' ? ['OPEN','CONTACTED','UNAVAILABLE'] : ['OPEN','AVAILABLE'];
  const contactEligible = ['NEW','UNDER_REVIEW','NEEDS_DETAILS','QUOTED','EXPIRED'].includes(inquiry.status) &&
    allowed.includes(inquiry.dispatch_state) && !workflow.quote_active && !workflow.order_id;
  if (contact ? !contactEligible : !followup || channel!==(followup.channel || 'partner')) {
    reason ||= 'Status permintaan belum mengizinkan pengiriman ini.';
  }
  const permission = await permissionFor(db, settings, channel === 'partner' ? inquiry.business_id : null, lock);
  const recipient = channel === 'partner' ? canonicalChat(fields.whatsapp+'@c.us') : settings.groupChatId;
  if (!hasDispatchPermission(permission, recipient)) {
    reason ||= 'Persetujuan untuk tujuan WhatsApp saat ini diperlukan.';
  }
  const manual = contact && await one(db, 'SELECT id FROM domain_events WHERE inquiry_id=$1 AND kind=$2 LIMIT 1',
    [inquiry.id,channel === 'group' ? 'GROUP_POSTED' : 'DISPATCH_CONTACTED']);
  const earlier = await one(db, `SELECT id FROM whatsapp_dispatches WHERE inquiry_id=$1 AND channel=$2
    AND ($4::uuid IS NULL OR id<>$4) AND (
      (purpose=$5 AND context_key=$6 AND state=ANY($3::text[]))
      OR (recipient=$7 AND (state='NEEDS_REVIEW' OR late_evidence))
    ) LIMIT 1`, [inquiry.id,channel,blockingStates,excludeId,purpose,contextKey,recipient]);
  if (manual || earlier) reason ||= 'Pengiriman untuk tahap ini sudah tercatat, sedang diproses, atau perlu diperiksa.';
  const ancestor = await one(db, `WITH RECURSIVE ancestors AS (
      SELECT previous_inquiry_id AS id FROM inquiries WHERE id=$1
      UNION ALL SELECT i.previous_inquiry_id FROM inquiries i JOIN ancestors a ON i.id=a.id WHERE i.previous_inquiry_id IS NOT NULL
    ) SELECT d.id FROM whatsapp_dispatches d JOIN ancestors a ON a.id=d.inquiry_id
      WHERE d.recipient=$2 AND (d.state IN ('SENDING','NEEDS_REVIEW') OR d.late_evidence) LIMIT 1`, [inquiry.id,recipient]);
  if (ancestor) reason ||= 'Periksa pengiriman pada permintaan sebelumnya sebelum menghubungi tujuan ini kembali.';
  const reference = orderReference(inquiry.id);
  const groupText = [
    '🧵 *MERAJUT — PERMINTAAN JAHIT*',
    `🪡 ${fields.service} · ${inquiry.quantity ?? 1} pakaian`,
    '',
    '*Kode pesanan*',
    '```',
    reference,
    '```',
    '',
    'Jika bersedia, salin kode di atas dan kirim ke admin lewat chat pribadi.'
  ].join('\n');
  const contactText = channel === 'group' ? groupText : partnerQuoteForm(inquiry,fields);
  const text = contact ? contactText : followup?.text || '';
  const snapshot = [1,text,recipient,settings.mode,settings.sessionId,permission?.id,permission?.version,inquiry.business_id];
  // Existing approvals keep their snapshot digest through the migration.
  if (!contact) snapshot.push(purpose,contextKey);
  const snapshotDigest = hash(snapshot);
  const previewDigest = hash([snapshotDigest,inquiry.revision,channel]);
  const label = contact ? (channel==='group' ? 'Kirim ke grup' : 'Hubungi mitra') : followupLabels[purpose];
  return {channel,purpose,contextKey,label,recipient,
    destination:channel==='group' ? settings.groupLabel || 'Grup penjahit yang disetujui' : fields.business,
    masked: channel==='partner' && recipient ? recipient.split('@')[0].replace(/.(?=.{4})/g,'•') : '',
    text,reason,permission,snapshotDigest,previewDigest,revision:inquiry.revision,requestKey:randomUUID()};
}

async function insertDispatch(db, actor, inquiry, preview, settings, requestKey, reason = null) {
  const job = await one(db, `INSERT INTO whatsapp_dispatches
    (inquiry_id,business_id,actor_id,channel,approved_revision,request_key,preview_digest,snapshot_digest,
     mode,session_id,recipient,permission_id,permission_version,rendered_text,purpose,context_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [inquiry.id,inquiry.business_id,actor.id,preview.channel,inquiry.revision,requestKey,preview.previewDigest,
    preview.snapshotDigest,settings.mode,settings.sessionId,preview.recipient,preview.permission.id,
    preview.permission.version,preview.text,preview.purpose,preview.contextKey]);
  await dispatchAudit(db,actor,'WHATSAPP_DISPATCH_APPROVED',job.id,reason);
  return job;
}

export async function queueGroupTaken(db, actor, inquiry, settings) {
  if (!settings?.groupChatId || settings.mode==='disabled') return;
  const preview = await dispatchSnapshot(db,inquiry,'group',settings,{lock:true,purpose:'group_taken'});
  if (preview.reason) return;
  await insertDispatch(db,actor,inquiry,preview,settings,preview.requestKey,'Penjahit bersedia');
}

export function approveDispatch(pool, actor, inquiryId, input, settings) {
  requireDispatchManager(actor);
  return transaction(pool, async db => {
    const purpose = input.purpose || 'contact';
    const inquiry = found(await one(db,'SELECT * FROM inquiries WHERE id=$1 FOR NO KEY UPDATE',[inquiryId]));
    const previous = await one(db,'SELECT * FROM whatsapp_dispatches WHERE inquiry_id=$1 AND request_key=$2',[inquiryId,input.requestKey]);
    if (previous) {
      if (previous.channel !== input.channel || previous.purpose !== purpose || previous.approved_revision !== input.revision || previous.preview_digest !== input.previewDigest) {
        conflict('Kunci persetujuan sudah digunakan untuk pesan lain.');
      }
      return {id:previous.id,inquiryId,replayed:true};
    }
    if (inquiry.revision !== input.revision) conflict('Permintaan telah berubah. Muat ulang pratinjau.');
    const preview = await dispatchSnapshot(db,inquiry,input.channel,settings,{lock:true,purpose});
    if (preview.reason) conflict(preview.reason);
    if (preview.previewDigest !== input.previewDigest) conflict('Pesan atau tujuan telah berubah. Muat ulang pratinjau.');
    const job = await insertDispatch(db,actor,inquiry,preview,settings,input.requestKey);
    await db.query('UPDATE inquiries SET revision=revision+1 WHERE id=$1',[inquiryId]);
    return {id:job.id,inquiryId,replayed:false};
  });
}

export function reviewDispatch(pool, actor, inquiryId, dispatchId, input) {
  requireDispatchManager(actor);
  return transaction(pool, async db => {
    const inquiry = await lockInquiry(db, actor, inquiryId);
    const job = found(await one(db, 'SELECT * FROM whatsapp_dispatches WHERE id=$1 AND inquiry_id=$2 FOR UPDATE', [dispatchId,inquiryId]));
    if (inquiry.revision !== input.revision || (job.state !== 'NEEDS_REVIEW' && !job.late_evidence)) conflict('Pengiriman telah berubah.');
    if (job.lease_until && new Date(job.lease_until) > new Date()) conflict('Tunggu percobaan yang sedang berjalan selesai.');
    if (input.disposition === 'unsent' && job.delivery_level >= 2) conflict('WhatsApp sudah mengonfirmasi penerimaan pesan ini.');
    await db.query(`UPDATE whatsapp_dispatches SET state=$2,reviewed_at=now(),finished_at=now(),updated_at=now(),
      lease_token=NULL,lease_until=NULL,late_evidence=false,last_error=$3 WHERE id=$1`,
      [dispatchId,input.disposition === 'sent' ? 'CONFIRMED_MANUALLY' : 'CANCELLED',input.disposition === 'sent' ? 'MANUALLY_CONFIRMED' : 'MANUALLY_UNSENT']);
    await db.query('UPDATE inquiries SET revision=revision+1 WHERE id=$1',[inquiryId]);
    await dispatchAudit(db, actor, 'WHATSAPP_DISPATCH_REVIEWED', dispatchId, input.disposition+' · '+input.reason);
    return {id:dispatchId,inquiryId};
  });
}

export async function dispatchPanel(pool, actor, inquiryId, settings) {
  requireDispatchManager(actor);
  const inquiry = found(await one(pool, 'SELECT * FROM inquiries WHERE id=$1', [inquiryId]));
  const inputs = await dispatchInputs(pool,inquiry,settings,false);
  const previews = [];
  for (const channel of ['group','partner']) previews.push(await dispatchSnapshot(pool,inquiry,channel,settings,{inputs}));
  const followups = [];
  for (const [purpose,draft] of Object.entries(inputs.followups)) {
    followups.push(await dispatchSnapshot(pool,inquiry,draft.channel || 'partner',settings,{inputs,purpose}));
  }
  const history = (await pool.query('SELECT * FROM whatsapp_dispatches WHERE inquiry_id=$1 ORDER BY created_at,id',[inquiryId])).rows;
  const replies = (await pool.query(`SELECT n.*,b.name AS business FROM whatsapp_dispatch_inbox n
    LEFT JOIN businesses b ON b.id=n.business_id WHERE n.inquiry_id=$1 AND n.event_kind='message.received'
    ORDER BY n.message_at,n.received_at,n.id`,[inquiryId])).rows;
  const quotePreview = followups.find(item => item.purpose==='quote_request');
  const {workflow,fields} = inputs;
  const firstContact = !workflow.quote_id && !workflow.order_id && ['NEW','UNDER_REVIEW','NEEDS_DETAILS'].includes(inquiry.status)
    ? previews.find(item => item.channel==='partner') : null;
  const quoteReply = quoteReplyDraft(inquiry,quotePreview ?? firstContact,history,replies,settings,workflow,fields.service);
  return {previews,followups,history,replies,quoteReply,mode:settings.mode};
}

export async function dispatchOperations(pool, settings) {
  const health = await one(pool, `SELECT
    (SELECT seen_at FROM whatsapp_dispatch_heartbeats WHERE mode=$1 AND session_id=$2) AS heartbeat,
    (SELECT gateway_state FROM whatsapp_dispatch_heartbeats WHERE mode=$1 AND session_id=$2) AS gateway_state,
    (SELECT min(created_at) FROM whatsapp_dispatches WHERE state IN ('QUEUED','RETRY_WAIT','SENDING')) AS oldest,
    (SELECT count(*)::int FROM whatsapp_dispatches WHERE state='NEEDS_REVIEW' OR late_evidence) AS review_count`, [settings.mode,settings.sessionId]);
  const groupPermission = await permissionFor(pool,settings);
  return {health,mode:settings.mode,groupChatId:settings.groupChatId,groupLabel:settings.groupLabel,paused:await dispatchPaused(pool,settings),
    groupPermission,groupApproved:hasDispatchPermission(groupPermission, settings.groupChatId)};
}

export async function dispatchInbox(pool) {
  return (await pool.query(`SELECT n.*,b.name AS business FROM whatsapp_dispatch_inbox n
    LEFT JOIN businesses b ON b.id=n.business_id WHERE n.state='REVIEW' ORDER BY received_at DESC LIMIT 100`)).rows;
}

export function resolveDispatchInbox(pool, actor, id, reason) {
  requireDispatchManager(actor);
  return transaction(pool,async db => {
    const row = await one(db, `UPDATE whatsapp_dispatch_inbox SET state='RESOLVED',processed_at=now(),correlation='ADMIN_REVIEWED'
      WHERE id=$1 AND state='REVIEW' RETURNING id`,[id]);
    if (!row) conflict('Pesan telah ditinjau.');
    await dispatchAudit(db,actor,'WHATSAPP_INBOX_REVIEWED',id,reason);
  });
}
