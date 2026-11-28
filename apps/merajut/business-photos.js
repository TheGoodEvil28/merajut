import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { activeBusiness } from './catalog.js';
import { one, transaction } from './db.js';
import { found } from './errors.js';
import { normalizedPhoto, photoLimit } from './photos.js';

export const businessPhotoUpload = [
  rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false }),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: photoLimit, inflate: false })
];

export function publicBusinessPhoto(pool, slug) {
  return one(pool, `SELECT p.content FROM business_photos p JOIN businesses b ON b.id=p.business_id
    WHERE b.slug=$1 AND b.published`, [slug]).then(found);
}

// Managed routes supply a business ID after the manager guard. A tailor always resolves their own active membership.
async function photoBusiness(db, actor, managedId, lock = false) {
  if (!managedId) return activeBusiness(db, actor, lock);
  const sql = 'SELECT id FROM businesses WHERE id=$1';
  return found(await one(db, sql + (lock ? ' FOR NO KEY UPDATE' : ''), [managedId]));
}

export async function readBusinessPhoto(pool, actor, managedId) {
  const business = await photoBusiness(pool, actor, managedId);
  return found(await one(pool, 'SELECT content FROM business_photos WHERE business_id=$1', [business.id]));
}

export async function saveBusinessPhoto(pool, actor, managedId, buffer) {
  await photoBusiness(pool, actor, managedId);
  const content = await normalizedPhoto(buffer);
  await transaction(pool, async db => {
    const business = await photoBusiness(db, actor, managedId, true);
    await db.query(`INSERT INTO business_photos (business_id,content) VALUES ($1,$2)
      ON CONFLICT (business_id) DO UPDATE SET content=EXCLUDED.content`, [business.id, content]);
  });
}

export async function removeBusinessPhoto(pool, actor, managedId) {
  await transaction(pool, async db => {
    const business = await photoBusiness(db, actor, managedId, true);
    await db.query('DELETE FROM business_photos WHERE business_id=$1', [business.id]);
  });
}
