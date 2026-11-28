import { activeBusiness } from './catalog.js';
import { one, transaction } from './db.js';
import { conflict, found } from './errors.js';
import { digest } from './identity.js';

export async function event(db, inquiryId, actor, kind, oldStatus, newStatus, detail = null, orderId = null) {
  return one(db, `INSERT INTO domain_events
    (inquiry_id, actor_id, kind, old_status, new_status, detail, order_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
  [inquiryId, actor?.id ?? null, kind, oldStatus, newStatus, detail, orderId]);
}

export async function createInquiry(pool, actor, input) {
  return transaction(pool, db => persistInquiry(db, actor, input));
}

export async function persistInquiry(db, actor, input, customerId = actor.id) {
  const quantity = input.quantity ?? null;
  const fitNotes = input.fitNotes ?? null;
  const fields = [input.serviceId, input.description, input.desiredDate ?? null];
  if (quantity !== null || fitNotes !== null) fields.push(quantity, fitNotes);
  const handover = input.requestedHandover ?? null;
  const fitting = input.fittingRequested ?? null;
  if (handover !== null || fitting !== null) fields.push({ handover, fitting });
  const fingerprint = digest(JSON.stringify(fields));
  const args = [customerId, input.key, fingerprint, input.serviceId, input.description, input.desiredDate ?? null,
    quantity, fitNotes, handover, fitting];
  const created = await one(db, `INSERT INTO inquiries
    (customer_id, request_key, request_digest, business_id, service_id, description, desired_date, quantity, fit_notes, estimate, requested_handover, fitting_requested)
    SELECT $1, $2, $3, s.business_id, s.id, $5, $6, $7, $8, NULLIF(s.price_hint,0)::bigint * COALESCE($7::integer,1), $9, $10
    FROM services s JOIN businesses b ON b.id = s.business_id
    WHERE s.id = $4 AND s.active AND b.published
    ON CONFLICT (customer_id, request_key) DO NOTHING RETURNING id`, args);
  if (created) {
    await event(db, created.id, actor, 'INQUIRY_CREATED', null, 'NEW');
    return { id: created.id, created: true };
  }
  const existing = found(await one(db, `SELECT id, request_digest FROM inquiries
    WHERE customer_id = $1 AND request_key = $2`, args.slice(0, 2)));
  if (existing.request_digest !== fingerprint) conflict('This request key was already used for different details.');
  return { id: existing.id, created: false };
}

export async function lockInquiry(db, actor, id) {
  if (actor.manager) return found(await one(db, 'SELECT * FROM inquiries WHERE id=$1 FOR UPDATE', [id]));
  if (actor.role === 'provider') {
    const business = await activeBusiness(db, actor, true);
    const inquiry = found(await one(db, 'SELECT * FROM inquiries WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, business.id]));
    if (inquiry.dispatch_state) conflict('Permintaan ini ditangani oleh admin.');
    return inquiry;
  }
  return found(await one(db, 'SELECT * FROM inquiries WHERE id = $1 AND customer_id = $2 FOR UPDATE', [id, actor.id]));
}

export const orderIndex = `SELECT i.id, i.customer_id, i.status, i.dispatch_state, i.created_at, i.estimate,
  s.name AS service, b.name AS business, o.status AS order_status, accepted.handover, o.fitting_state, o.fitting_at,
  o.shipped_at, o.amount, o.tailor_blocked, COALESCE(o.eta,CASE WHEN latest.status='SENT' AND latest.expires_at > now() THEN latest.eta END,i.desired_date)::text AS due_date, payment.state AS payment_state,
  payment.mode AS payment_mode, o.complaint IS NOT NULL AND o.resolution IS NULL AS complaint_open,
  (SELECT id FROM inquiries replacement WHERE replacement.previous_inquiry_id=i.id) AS replacement_id,
  CASE WHEN latest.status='SENT' AND latest.expires_at <= now() THEN 'EXPIRED' ELSE latest.status END AS quote_status,
  COALESCE(latest.status='SENT' AND latest.expires_at <= now(), false) AS quote_expired,
  latest.amount AS quote_amount
  FROM inquiries i JOIN services s ON s.id=i.service_id JOIN businesses b ON b.id=i.business_id
  LEFT JOIN orders o ON o.inquiry_id=i.id LEFT JOIN quotes accepted ON accepted.id=o.quote_id
  LEFT JOIN LATERAL (SELECT status, expires_at, amount, eta FROM quotes WHERE inquiry_id=i.id ORDER BY version DESC LIMIT 1) latest ON true
  LEFT JOIN LATERAL (SELECT state, mode FROM order_payments WHERE order_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1) payment ON true`;

export async function listInquiries(pool, actor) {
  const scope = actor.role === 'provider'
    ? 'EXISTS (SELECT 1 FROM provider_memberships m WHERE m.user_id = $1 AND m.business_id = i.business_id AND m.active)'
    : 'i.customer_id = $1';
  return (await pool.query(`${orderIndex} WHERE ${scope}
    ORDER BY i.created_at DESC, i.id LIMIT 100`, [actor.id])).rows;
}

export async function inquiryDetail(pool, actor, id) {
  const scope = actor.manager ? 'EXISTS (SELECT 1 FROM platform_managers WHERE user_id=$2)' : actor.role === 'provider'
    ? 'EXISTS (SELECT 1 FROM provider_memberships m WHERE m.user_id = $2 AND m.business_id = i.business_id AND m.active)'
    : 'i.customer_id = $2';
  const inquiry = found(await one(pool, `SELECT i.id, i.status, i.revision, i.description, i.quantity, i.fit_notes,
    i.desired_date::text, i.created_at, i.dispatch_state, i.business_id, i.estimate, i.previous_inquiry_id,
    i.requested_handover, i.fitting_requested, s.category, b.slug, b.published,
    (SELECT id FROM inquiries replacement WHERE replacement.previous_inquiry_id=i.id) AS replacement_id, s.name AS service, b.name AS business
    FROM inquiries i JOIN services s ON s.id = i.service_id JOIN businesses b ON b.id = i.business_id
    WHERE i.id = $1 AND ${scope}`, [id, actor.id]));
  const [quotes, order, events, conversation, photos] = await Promise.all([
    pool.query(`SELECT id, version, amount, currency, eta::text, terms, expires_at, line_items, fitting_at, fitting_place, handover,
      CASE WHEN status = 'SENT' AND expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE status END AS status
      FROM quotes WHERE inquiry_id = $1 ORDER BY version DESC`, [id]),
    one(pool, `SELECT o.id, o.status, o.revision, o.amount, o.currency, o.eta::text, o.terms, o.cash_revision,
      EXISTS(SELECT 1 FROM order_reviews r WHERE r.order_id=o.id AND r.state='OPEN') AS review_pending,
      (SELECT jsonb_agg(jsonb_build_object('id',r.id,'amount',r.amount,'at',r.recorded_at,'actor',u.display_name,
        'voidAt',r.voided_at,'reason',r.void_reason) ORDER BY r.recorded_at DESC)
        FROM cash_receipts r JOIN users u ON u.id=r.recorded_by WHERE r.order_id=o.id) AS cash_receipts,
      o.fee_bps, o.complaint, o.resolution, o.tailor_blocked, COALESCE(o.fitting_at,q.fitting_at) AS fitting_at,
      COALESCE(o.fitting_place,q.fitting_place) AS fitting_place, o.fitting_state, o.shipped_at, o.shipping_note, q.handover,
      (SELECT jsonb_build_object('id',p.id,'amount',p.amount,'fee',p.fee,'mode',p.mode,'state',p.state,'va_number',p.va_number,'checked_at',p.checked_at)
        FROM order_payments p WHERE p.order_id=o.id ORDER BY p.created_at DESC,p.id DESC LIMIT 1) AS payment,
      q.version AS quote_version, q.line_items
      FROM orders o JOIN quotes q ON q.id = o.quote_id WHERE o.inquiry_id = $1`, [id]),
    pool.query(`SELECT e.sequence::text, e.kind, e.old_status, e.new_status, e.detail, e.created_at, COALESCE(u.display_name,'Sistem Marajut') AS actor
      FROM domain_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.inquiry_id = $1 ORDER BY e.sequence`, [id]),
    one(pool, `SELECT t.id, t.state, CASE WHEN i.request_key = t.id THEN 'whatsapp' ELSE 'web' END AS source,
      COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM (
        SELECT id, direction, body, created_at FROM inbound_messages
        WHERE thread_id = t.id AND direction <> 'SYSTEM' ORDER BY id DESC LIMIT 5
      ) m), '[]'::jsonb) AS messages
      FROM inbound_threads t JOIN inbound_senders sender ON sender.id = t.sender_id
      JOIN inquiries i ON i.id = t.inquiry_id AND i.business_id = t.business_id
      WHERE i.id = $1 AND t.customer_id = i.customer_id AND ${scope}`, [id, actor.id]),
    pool.query('SELECT id FROM inquiry_photos WHERE inquiry_id = $1 ORDER BY created_at, id', [id])
  ]);
  return { inquiry, quotes: quotes.rows, order, events: events.rows, photos: photos.rows,
    conversation: conversation ?? null };
}

const inquiryActions = {
  review: { role: 'provider', from: ['NEW','EXPIRED'], to: 'UNDER_REVIEW' },
  question: { role: 'customer', from: ['QUOTED'], to: 'UNDER_REVIEW' },
  clarify: { role: 'provider', from: ['NEW', 'UNDER_REVIEW'], to: 'NEEDS_DETAILS' },
  respond: { role: 'customer', from: ['NEEDS_DETAILS'], to: 'UNDER_REVIEW' },
  decline: { role: 'provider', from: ['NEW', 'NEEDS_DETAILS', 'UNDER_REVIEW', 'QUOTED','EXPIRED'], to: 'DECLINED' },
  cancel: { role: 'customer', from: ['NEW', 'NEEDS_DETAILS', 'UNDER_REVIEW', 'QUOTED','EXPIRED'], to: 'CANCELLED' }
};

export async function actOnInquiry(pool, actor, id, input) {
  return transaction(pool, async db => {
    const inquiry = await lockInquiry(db, actor, id);
    const action = inquiryActions[input.action];
    if (action.role !== (actor.manager ? 'provider' : actor.role) || !action.from.includes(inquiry.status) || inquiry.revision !== input.revision) {
      conflict('This request changed or the requested action is unavailable.');
    }
    if (['DECLINED', 'CANCELLED'].includes(action.to) || input.action==='question') {
      await db.query("UPDATE quotes SET status = 'WITHDRAWN' WHERE inquiry_id = $1 AND status = 'SENT'", [id]);
    }
    await db.query('UPDATE inquiries SET status = $2, revision = revision + 1 WHERE id = $1', [id, action.to]);
    await event(db, id, actor, 'INQUIRY_UPDATED', inquiry.status, action.to, input.detail);
    return { id, status: action.to };
  });
}
