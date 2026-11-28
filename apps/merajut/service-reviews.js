import { z } from 'zod';
import { activeBusiness } from './catalog.js';
import { one, transaction } from './db.js';
import { conflict, found } from './errors.js';
import { event } from './inquiries.js';

export const serviceReviewInput = z.object({
  rating: z.union([z.number(), z.string().regex(/^[1-5]$/)]).pipe(z.coerce.number().int().min(1).max(5)),
  comment: z.string().trim().max(500).default('')
});
export const reviewReplyInput = z.object({ reply: z.string().trim().min(1).max(500) });

export function serviceReview(pool, orderId) {
  return one(pool, 'SELECT rating,comment,created_at,reply,replied_at FROM service_reviews WHERE order_id=$1', [orderId]);
}

export async function businessFeedback(pool, businessId, before = null) {
  const [summary, { rows }] = await Promise.all([
    one(pool, `SELECT count(*)::int AS count, round(avg(r.rating),1)::float AS average
      FROM orders o JOIN service_reviews r ON r.order_id=o.id WHERE o.business_id=$1`, [businessId]),
    pool.query(`SELECT r.rating,r.comment,r.created_at,r.reply,r.replied_at,o.id AS order_id,o.inquiry_id,s.name AS service
      FROM orders o JOIN service_reviews r ON r.order_id=o.id JOIN inquiries i ON i.id=o.inquiry_id
      JOIN services s ON s.id=i.service_id WHERE o.business_id=$1
      AND ($2::uuid IS NULL OR (r.created_at,r.order_id) <
        (SELECT sr.created_at,sr.order_id FROM service_reviews sr JOIN orders so ON so.id=sr.order_id
         WHERE sr.order_id=$2 AND so.business_id=$1))
      ORDER BY r.created_at DESC,r.order_id DESC LIMIT 21`, [businessId, before])
  ]);
  const items = rows.slice(0, 20);
  return { summary, items, next: rows.length > 20 ? items.at(-1).order_id : null };
}

export function submitServiceReview(pool, actor, orderId, { rating, comment }) {
  return transaction(pool, async db => {
    const order = found(await one(db, `SELECT o.id,o.status,o.inquiry_id FROM orders o
      JOIN inquiries i ON i.id=o.inquiry_id WHERE o.id=$1 AND i.customer_id=$2 FOR UPDATE OF o`, [orderId, actor.id]));
    if (order.status !== 'COMPLETED') conflict('Ulasan dapat dikirim setelah pesanan selesai.');
    const review = await one(db, `INSERT INTO service_reviews (order_id,rating,comment)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING order_id`, [orderId, rating, comment]);
    if (!review) conflict('Ulasan untuk pesanan ini sudah dikirim.');
    return { ...review, inquiry_id: order.inquiry_id };
  });
}

export function replyToServiceReview(pool, actor, orderId, { reply }) {
  return transaction(pool, async db => {
    const business = await activeBusiness(db, actor, true);
    const order = found(await one(db, `SELECT o.id,o.inquiry_id,o.status FROM orders o
      JOIN service_reviews r ON r.order_id=o.id WHERE o.business_id=$1 AND o.id=$2`, [business.id, orderId]));
    const result = await one(db, `UPDATE service_reviews SET reply=$2,replied_at=now()
      WHERE order_id=$1 AND reply IS NULL RETURNING order_id`, [orderId, reply]);
    if (!result) conflict('Tanggapan untuk ulasan ini sudah dikirim.');
    await event(db, order.inquiry_id, actor, 'SERVICE_REVIEW_REPLIED', order.status, order.status, null, orderId);
    return { ...result, inquiry_id: order.inquiry_id };
  });
}
