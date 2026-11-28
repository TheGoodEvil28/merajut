import { one } from './db.js';
import { eventLabel } from './ui-copy.js';

const updates = [
  'QUOTE_ISSUED', 'ORDER_CONFIRMED', 'ORDER_UPDATED', 'ORDER_SHIPPED',
  'TAILOR_START_PLANNED', 'TAILOR_PROGRESS', 'TAILOR_BLOCKED', 'TAILOR_RESUMED',
  'FITTING_PROPOSED', 'TAILOR_FITTING_ACK', 'FITTING_DONE', 'PAYMENT_PAID', 'CANCEL_APPROVED',
  'SERVICE_REVIEW_REPLIED'
];

const orderTitles = {
  IN_PROGRESS: 'Pesanan mulai dikerjakan', COMPLETED: 'Pesanan selesai'
};

const customerEvents = `FROM inquiries i JOIN domain_events e ON e.inquiry_id=i.id
  LEFT JOIN customer_notification_reads r ON r.event_id=e.id
  WHERE i.customer_id=$1 AND e.kind=ANY($2::text[])`;

export async function unreadNotifications(pool, customerId) {
  const { count } = await one(pool, `SELECT count(*)::int AS count ${customerEvents} AND r.event_id IS NULL`,
    [customerId, updates]);
  return count;
}

export async function customerNotifications(pool, customerId, before) {
  const { rows } = await pool.query(`SELECT e.sequence, e.kind, e.new_status, e.created_at,
    i.id AS inquiry_id, r.event_id IS NULL AS unread,
    (SELECT name FROM services WHERE id=i.service_id) AS service,
    (SELECT q.handover FROM orders o JOIN quotes q ON q.id=o.quote_id WHERE o.id=e.order_id) AS handover
    ${customerEvents} AND ($3::bigint IS NULL OR e.sequence < $3)
    ORDER BY e.sequence DESC LIMIT 31`, [customerId, updates, before]);
  const items = rows.slice(0, 30).map(item => ({
    ...item,
    title: item.kind === 'ORDER_UPDATED'
      ? item.new_status === 'READY'
        ? (item.handover === 'delivery' ? 'Pesanan siap dikirim' : 'Pesanan siap diambil')
        : orderTitles[item.new_status] ?? eventLabel(item.kind)
      : eventLabel(item.kind)
  }));
  return { items, next: rows.length > 30 ? items.at(-1).sequence : null };
}

export function markNotificationsRead(pool, customerId) {
  return pool.query(`INSERT INTO customer_notification_reads (event_id)
    SELECT e.id ${customerEvents} AND r.event_id IS NULL ON CONFLICT DO NOTHING`, [customerId, updates]);
}
