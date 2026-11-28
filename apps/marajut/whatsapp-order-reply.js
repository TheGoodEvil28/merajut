import { z } from 'zod';
import { one } from './db.js';
import { AppError } from './errors.js';
import { event } from './inquiries.js';
import { applyFittingChange, applyOrderTransition, lockOrder } from './orders.js';
import { formatDate } from './ui-copy.js';

const system = {manager:true,id:null};
const activeOrderStates = ['CONFIRMED','IN_PROGRESS','READY'];
const commands = new Map([
  ['sudah mulai','start'],
  ['jahitan sudah siap','ready'],
  ['fitting selesai','fitting_done'],
  ['saya siap untuk jadwal fitting tersebut','fitting_ack'],
  ['tidak bisa lanjut','blocked'],
  ['lanjut pengerjaan','resume'],
  ['paket sudah dikirim','ship'],
  ['pelanggan sudah menerima pesanan','delivered'],
  ['pelanggan sudah mengambil pesanan','picked_up']
]);
const progressStages = new Map([['potong','Pemotongan kain'],['jahit','Penjahitan'],['finishing','Penyelesaian akhir']]);

function dateValue(text) {
  const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const date = dayFirst ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}` : text;
  return z.iso.date().safeParse(date).success ? date : null;
}

export function parseOrderReply(body) {
  const text = body?.trim().replace(/^```\r?\n([\s\S]+)\r?\n```$/,'$1');
  const [reference,line,...extra] = (text ?? '').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  if (!/^[a-f\d]{8}$/i.test(reference ?? '') || !line) return null;
  const ref = reference.toUpperCase();
  const action = commands.get(line.replace(/\.$/,'').toLowerCase());
  const optionalNote = extra.length===0 || (extra.length===1 && /^Catatan:/i.test(extra[0]));
  if (action && optionalNote) {
    return {reference:ref,action};
  }
  const start = /^(?:Siap|Usulan) mulai:\s*(\S+)$/i.exec(line);
  if (start && optionalNote) {
    const date = dateValue(start[1]);
    return date ? {reference:ref,action:'plan_start',date} : null;
  }
  const fitting = /^Usulan fitting:\s*(\S+)\s+([01]\d|2[0-3]):([0-5]\d)(?:\s+WIB)?$/i.exec(line);
  if (fitting && extra.length===0) {
    const date = dateValue(fitting[1]);
    return date ? {reference:ref,action:'fitting_propose',at:`${date}T${fitting[2]}:${fitting[3]}`} : null;
  }
  const progress = /^Progres:\s*(\S.*)$/i.exec(line);
  if (!progress || /^\[.*\]$/.test(progress[1]) || extra.length>2) return null;
  let date = null;
  for (const field of extra) {
    if (/^Kendala:/i.test(field)) continue;
    const due = /^Perkiraan selesai(?: terbaru)?:\s*(\S+)$/i.exec(field);
    if (!due || date) return null;
    date = dateValue(due[1]);
    if (!date) return null;
  }
  return {reference:ref,action:'progress',date,stage:progressStages.get(progress[1].toLowerCase()) ?? null};
}

async function recordUpdate(db, order, kind, detail = null) {
  await db.query('UPDATE orders SET revision=revision+1 WHERE id=$1',[order.id]);
  await event(db,order.inquiry_id,system,kind,order.status,order.status,detail,order.id);
}

async function applyReply(db, order, reply, mode) {
  const revision = order.revision;
  if (order.tailor_blocked && reply.action!=='resume') return false;
  switch (reply.action) {
    case 'blocked':
      await db.query('UPDATE orders SET tailor_blocked=true WHERE id=$1',[order.id]);
      await recordUpdate(db,order,'TAILOR_BLOCKED');
      break;
    case 'resume':
      await applyOrderTransition(db,system,order,{action:'resume',revision},mode);
      break;
    case 'plan_start':
      if (order.status!=='CONFIRMED' || new Date(reply.date+'T23:59:59+07:00') < order.now) return false;
      await recordUpdate(db,order,'TAILOR_START_PLANNED',formatDate(reply.date));
      break;
    case 'progress':
      if (order.status!=='IN_PROGRESS') return false;
      await recordUpdate(db,order,'TAILOR_PROGRESS',[
        reply.stage,reply.date && 'Perkiraan terbaru dari mitra '+formatDate(reply.date)
      ].filter(Boolean).join(' · ') || null);
      break;
    case 'fitting_ack':
      if (!['CONFIRMED','IN_PROGRESS'].includes(order.status) ||
          !['SCHEDULED','PROPOSED'].includes(order.fitting_state) || !(order.fitting_at>order.now)) return false;
      await recordUpdate(db,order,'TAILOR_FITTING_ACK');
      break;
    case 'fitting_propose':
      if (!order.fitting_place) return false;
      await applyFittingChange(db,system,order,{action:'propose',revision,fittingAt:reply.at,
        fittingPlace:order.fitting_place,note:'Usulan mitra melalui WhatsApp.'});
      break;
    case 'fitting_done':
      await applyFittingChange(db,system,order,{action:'done',revision,note:'Mitra mengonfirmasi fitting selesai.'});
      break;
    case 'delivered':
    case 'picked_up':
      if (order.handover!==(reply.action==='delivered' ? 'delivery' : 'pickup')) return false;
      await applyOrderTransition(db,system,order,{action:'complete',revision,detail:'Mitra mengonfirmasi pakaian sudah diterima pelanggan.'},mode);
      break;
    default: {
      const details = {start:'Mitra mengonfirmasi pengerjaan sudah dimulai.',
        ready:'Mitra mengonfirmasi jahitan sudah siap.',ship:'Mitra mengonfirmasi paket sudah dikirim.'};
      await applyOrderTransition(db,system,order,{action:reply.action,revision,detail:details[reply.action]},mode);
    }
  }
  return true;
}

export async function applyWhatsAppOrderReply(db, item, job, reply, mode) {
  if (!['SENT','CONFIRMED_MANUALLY'].includes(job.state)) return false;
  const inquiry = await one(db,`SELECT i.id FROM inquiries i JOIN businesses b ON b.id=i.business_id
    WHERE i.id=$1 AND i.business_id=$2 AND i.dispatch_state='AVAILABLE' AND i.status='ACCEPTED'
      AND b.whatsapp||'@c.us'=$3 FOR NO KEY UPDATE OF i FOR SHARE OF b`,[job.inquiry_id,item.business_id,item.sender_chat]);
  if (!inquiry) return false;
  const target = await one(db,'SELECT id FROM orders WHERE inquiry_id=$1 AND business_id=$2',[inquiry.id,item.business_id]);
  const order = target && await lockOrder(db,target.id,{businessId:item.business_id});
  if (!order || !activeOrderStates.includes(order.status) || !item.message_at ||
      (order.tailor_reply_at && item.message_at<order.tailor_reply_at)) return false;
  const permission = await one(db,`SELECT id FROM whatsapp_dispatch_permissions WHERE business_id=$1 AND mode=$2 AND session_id=$3
    AND channel='partner' AND chat_id=$4 AND revoked_at IS NULL FOR SHARE`,[item.business_id,item.mode,item.session_id,item.sender_chat]);
  if (!permission) return false;
  const newerStage = await one(db,`SELECT id FROM domain_events WHERE inquiry_id=$1 AND order_id=$2
    AND kind IN ('ORDER_CONFIRMED','ORDER_UPDATED','ORDER_SHIPPED','FITTING_CHANGE_REQUESTED','FITTING_PROPOSED','FITTING_CONFIRMED','FITTING_DONE')
    AND created_at >= $3::timestamptz + interval '1 second' LIMIT 1`,[inquiry.id,order.id,item.message_at]);
  if (newerStage) return false;
  try {
    if (!await applyReply(db,order,reply,mode)) return false;
  } catch (error) {
    // Shared order guards reject invalid transitions before writing any changes.
    if (error instanceof AppError && [409,422].includes(error.status)) return false;
    throw error;
  }
  await db.query('UPDATE orders SET tailor_reply_at=$2 WHERE id=$1',[order.id,item.message_at]);
  return true;
}
