import { one } from './db.js';
import { orderReference } from './order-flow.js';
import { formatDate, formatTime } from './ui-copy.js';

export const followupLabels = {
  quote_request:'Minta penawaran dari mitra',
  start_work:'Konfirmasi mulai pengerjaan',
  fitting:'Koordinasikan fitting',
  work_update:'Minta kabar pengerjaan',
  overdue:'Minta pembaruan lewat tenggat',
  await_payment:'Kabari pembayaran masih ditunggu',
  paid:'Kabari pembayaran lunas',
  handover:'Koordinasikan serah terima'
};

export async function readDispatchWorkflow(db, inquiryId, lock) {
  // Read after obtaining the order lock so fitting and payment data reflect the committed transition.
  if (lock) await db.query('SELECT id FROM orders WHERE inquiry_id=$1 FOR SHARE',[inquiryId]);
  return one(db, `SELECT
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date::text AS today,
      latest.id AS quote_id,COALESCE(latest.active,false) AS quote_active,
      o.id AS order_id,o.status AS order_status,o.eta::text AS eta,o.fitting_at,o.fitting_state,
      o.shipped_at,accepted.handover,p.id AS payment_id,p.state AS payment_state,p.mode AS payment_mode,
      (SELECT e.sequence FROM domain_events e WHERE e.order_id=o.id AND e.kind IN
        ('FITTING_CHANGE_REQUESTED','FITTING_PROPOSED','FITTING_CONFIRMED','FITTING_DONE')
        ORDER BY e.sequence DESC LIMIT 1) AS fitting_event
    FROM inquiries i LEFT JOIN orders o ON o.inquiry_id=i.id LEFT JOIN quotes accepted ON accepted.id=o.quote_id
    LEFT JOIN LATERAL (SELECT id,status='SENT' AND expires_at>now() AS active
      FROM quotes WHERE inquiry_id=i.id ORDER BY version DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL (SELECT id,state,mode FROM order_payments WHERE order_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1) p ON true
    WHERE i.id=$1`,[inquiryId]);
}

export function followupDrafts(inquiry, fields, workflow) {
  const drafts = {};
  const reference = orderReference(inquiry.id);
  const add = (purpose, contextKey, ...lines) => {
    const text = [
      `Marajut · ${followupLabels[purpose]} · ${reference}`,
      `${fields.service} · ${inquiry.quantity ?? 1} pakaian.`,
      ...lines,
      `Mohon balas dengan referensi ${reference}.`
    ].filter(Boolean).join('\n');
    drafts[purpose] = {contextKey,text};
  };
  if (!workflow.order_id) {
    if (inquiry.dispatch_state==='AVAILABLE' && !workflow.quote_active &&
        ['NEW','UNDER_REVIEW','QUOTED','EXPIRED'].includes(inquiry.status)) {
      add('quote_request',workflow.quote_id || 'initial',
        'Terima kasih sudah menyanggupi permintaan ini. Mohon kirim usulan harga, perkiraan selesai, dan jadwal fitting jika diperlukan.');
    }
    return drafts;
  }
  const {order_id:id,order_status:status,eta,fitting_state:fittingState,fitting_at:fittingAt} = workflow;
  if (['CONFIRMED','IN_PROGRESS'].includes(status)) {
    if (eta < workflow.today) {
      add('overdue',`${id}:${eta}`,`Perkiraan selesai ${formatDate(eta)} sudah terlewati. Mohon kabari progres dan tanggal selesai terbaru.`);
    } else if (status==='CONFIRMED') {
      add('start_work',id,'Pelanggan telah menyetujui penawaran di Marajut. Mohon konfirmasi kapan pekerjaan bisa dimulai.',
        `Perkiraan selesai ${formatDate(eta)}.`);
    } else {
      add('work_update',id,`Mohon kabari progres pengerjaan sebelum perkiraan selesai ${formatDate(eta)} dan konfirmasi saat jahitan siap.`);
    }
    if (['REQUESTED','PROPOSED','SCHEDULED'].includes(fittingState)) {
      const message = fittingState==='REQUESTED' ? 'Pelanggan meminta jadwal fitting lain. Mohon usulkan waktu yang tersedia.'
        : fittingState==='PROPOSED' ? `Usulan fitting ${formatTime(fittingAt)} sedang menunggu konfirmasi pelanggan di Marajut.`
        : `Fitting dijadwalkan ${formatTime(fittingAt)}. Mohon konfirmasi kesiapan dan kabari admin setelah fitting selesai.`;
      add('fitting',`${id}:${fittingState}:${workflow.fitting_event || 'initial'}`,message);
    }
  }
  if (status==='READY' && workflow.payment_state!=='PAID') {
    add('await_payment',id,'Jahitan sudah siap. Pembayaran pelanggan masih menunggu verifikasi di Marajut. Mohon tunggu konfirmasi admin sebelum serah terima.');
  }
  if (['READY','COMPLETED'].includes(status) && workflow.payment_state==='PAID') {
    const payment = workflow.payment_mode==='live' ? 'Pembayaran pelanggan telah diverifikasi lunas.'
      : 'Pembayaran simulasi telah ditandai lunas untuk latihan.';
    if (status==='READY' && !workflow.shipped_at) add('paid',workflow.payment_id,payment);
    const phase = status==='COMPLETED' ? 'completed' : workflow.shipped_at ? 'shipped' : 'ready';
    const method = workflow.handover==='delivery' ? 'pengiriman' : 'pengambilan';
    const next = {ready:`Mohon koordinasikan ${method} dengan admin sesuai kesepakatan.`,
      shipped:'Pengiriman sudah tercatat di Marajut. Mohon kabari admin jika ada kendala.',
      completed:'Serah terima sudah dicatat selesai di Marajut. Terima kasih.'};
    add('handover',`${id}:${phase}`,payment,next[phase]);
  }
  return drafts;
}
