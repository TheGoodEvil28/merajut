import { activeBusiness } from './catalog.js';
import { one, transaction } from './db.js';
import { conflict, found } from './errors.js';
import { event } from './inquiries.js';
import { enqueue } from './outbox.js';

const transitions = {
  start: { from: 'CONFIRMED', to: 'IN_PROGRESS' },
  ready: { from: 'IN_PROGRESS', to: 'READY' },
  complete: { from: 'READY', to: 'COMPLETED' },
  cancel: { from: 'CONFIRMED', to: 'CANCELLED' }
};

export async function transitionOrder(pool, actor, id, input, mode) {
  return transaction(pool, async db => {
    const business = actor.manager ? null : await activeBusiness(db, actor, true);
    const order = found(await one(db, `SELECT o.id, o.status, o.revision, o.inquiry_id, i.customer_id, i.dispatch_state
      FROM orders o JOIN inquiries i ON i.id = o.inquiry_id
      WHERE o.id = $1 AND ($2::uuid IS NULL OR o.business_id = $2) FOR UPDATE OF o`, [id, business?.id ?? null]));
    if (order.dispatch_state && !actor.manager) conflict('Pesanan ini ditangani oleh admin.');
    if (order.dispatch_state && input.action === 'complete' &&
        !await one(db, "SELECT id FROM order_payments WHERE order_id=$1 AND state='PAID'", [id])) {
      conflict('Verifikasi pembayaran sebelum serah terima.');
    }
    const transition = transitions[input.action];
    if (order.status !== transition.from || order.revision !== input.revision) {
      conflict('This order changed or the requested transition is unavailable.');
    }
    await db.query('UPDATE orders SET status = $2, revision = revision + 1 WHERE id = $1', [id, transition.to]);
    await db.query("UPDATE order_reviews SET state='SUPERSEDED',decided_at=now() WHERE order_id=$1 AND state='OPEN'",[id]);
    const changed = await event(db, order.inquiry_id, actor, 'ORDER_UPDATED', order.status, transition.to,
      input.detail, id);
    if (transition.to === 'READY') await enqueue(db, changed.id, order.customer_id, 'ORDER_READY', mode);
    return { id, inquiryId: order.inquiry_id, status: transition.to, revision: order.revision + 1 };
  });
}
