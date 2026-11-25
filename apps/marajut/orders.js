import { activeBusiness } from './catalog.js';
import { one, transaction } from './db.js';
import { AppError, conflict, found } from './errors.js';
import { event } from './inquiries.js';
import { enqueue } from './outbox.js';
import { formatTime } from './ui-copy.js';

const transitions = {
  start: { from: 'CONFIRMED', to: 'IN_PROGRESS' },
  ready: { from: 'IN_PROGRESS', to: 'READY' },
  ship: { from: 'READY', to: 'READY' },
  complete: { from: 'READY', to: 'COMPLETED' },
  cancel: { from: 'CONFIRMED', to: 'CANCELLED' }
};

export async function transitionOrder(pool, actor, id, input, mode) {
  return transaction(pool, async db => {
    const business = actor.manager ? null : await activeBusiness(db, actor, true);
    const order = found(await one(db, `SELECT o.id, o.status, o.revision, o.inquiry_id, o.fitting_state, o.shipped_at,
      i.customer_id, i.dispatch_state, q.handover
      FROM orders o JOIN inquiries i ON i.id = o.inquiry_id JOIN quotes q ON q.id=o.quote_id
      WHERE o.id = $1 AND ($2::uuid IS NULL OR o.business_id = $2) FOR UPDATE OF o`, [id, business?.id ?? null]));
    if (order.dispatch_state && !actor.manager) conflict('Pesanan ini ditangani oleh admin.');
    const transition = transitions[input.action];
    if (order.status !== transition.from || order.revision !== input.revision) {
      conflict('This order changed or the requested transition is unavailable.');
    }
    const shipping = input.action === 'ship';
    if (shipping && (!order.dispatch_state || order.handover !== 'delivery' || order.shipped_at)) {
      throw new AppError(409, 'WORK_UNAVAILABLE', 'Pengiriman sudah dicatat atau pesanan diambil langsung.');
    }
    if (order.dispatch_state) {
      if (input.action === 'ready' && order.fitting_state && order.fitting_state !== 'DONE') {
        throw new AppError(409, 'WORK_UNAVAILABLE', 'Catat bahwa fitting sudah selesai sebelum menandai jahitan siap.');
      }
      if ((shipping || input.action === 'complete') &&
          !await one(db, "SELECT id FROM order_payments WHERE order_id=$1 AND state='PAID'", [id])) {
        throw new AppError(409, 'WORK_UNAVAILABLE', 'Verifikasi pembayaran sebelum serah terima.');
      }
      if (input.action === 'complete' && order.handover === 'delivery' && !order.shipped_at) {
        throw new AppError(409, 'WORK_UNAVAILABLE', 'Catat pengiriman sebelum menyelesaikan pesanan.');
      }
    }
    if (shipping) {
      await db.query('UPDATE orders SET shipped_at=now(), shipping_note=$2, revision=revision+1 WHERE id=$1', [id,input.detail]);
    } else {
      await db.query('UPDATE orders SET status=$2, revision=revision+1 WHERE id=$1', [id,transition.to]);
    }
    await db.query("UPDATE order_reviews SET state='SUPERSEDED',decided_at=now() WHERE order_id=$1 AND state='OPEN'",[id]);
    const changed = await event(db, order.inquiry_id, actor, shipping ? 'ORDER_SHIPPED' : 'ORDER_UPDATED', order.status, transition.to,
      input.detail, id);
    if (input.action === 'ready') await enqueue(db, changed.id, order.customer_id, 'ORDER_READY', mode);
    return { id, inquiryId: order.inquiry_id, status: transition.to, revision: order.revision + 1 };
  });
}

const fittingChanges = {
  request: { from:['SCHEDULED','PROPOSED'], to:'REQUESTED', event:'FITTING_CHANGE_REQUESTED', role:'customer' },
  propose: { from:['SCHEDULED','REQUESTED','PROPOSED'], to:'PROPOSED', event:'FITTING_PROPOSED', role:'admin' },
  confirm: { from:['PROPOSED'], to:'SCHEDULED', event:'FITTING_CONFIRMED', role:'customer' },
  done: { from:['SCHEDULED'], to:'DONE', event:'FITTING_DONE', role:'admin' }
};

export function updateFitting(pool, actor, id, input) {
  return transaction(pool, async db => {
    const admin = Boolean(actor.manager);
    const order = found(await one(db, `SELECT o.*, clock_timestamp() AS now
      FROM orders o JOIN inquiries i ON i.id=o.inquiry_id
      WHERE o.id=$1 AND ($2 OR i.customer_id=$3) FOR UPDATE OF o`, [id,admin,actor.id]));
    const change = fittingChanges[input.action];
    if (change.role !== (admin ? 'admin' : actor.role) || order.fee_bps === null
      || !['CONFIRMED','IN_PROGRESS'].includes(order.status) || !change.from.includes(order.fitting_state)
      || order.revision !== input.revision) {
      throw new AppError(409,'WORK_UNAVAILABLE','Jadwal fitting sudah berubah. Periksa jadwal terbaru.');
    }
    const at = input.action === 'propose' ? new Date(input.fittingAt + '+07:00') : order.fitting_at;
    if (['propose','confirm'].includes(input.action) && !(at > order.now)) {
      throw new AppError(422,'WORK_UNAVAILABLE','Pilih jadwal fitting yang masih akan datang.');
    }
    const place = input.action === 'propose' ? input.fittingPlace : order.fitting_place;
    await db.query(`UPDATE orders SET fitting_at=$2, fitting_place=$3, fitting_state=$4, revision=revision+1
      WHERE id=$1`, [id,at,place,change.to]);
    const detail = input.action === 'propose' ? [formatTime(at),place,input.note].filter(Boolean).join(' · ') : input.note;
    await event(db,order.inquiry_id,actor,change.event,order.status,order.status,detail,id);
    return { inquiryId:order.inquiry_id, fittingState:change.to, revision:order.revision+1 };
  });
}
