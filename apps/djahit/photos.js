import sharp from 'sharp';
import { one, transaction } from './db.js';
import { AppError, conflict, found } from './errors.js';
import { lockInquiry } from './inquiries.js';

export const photoLimit = 3 * 1024 * 1024;
const formats = new Set(['jpeg', 'png', 'webp']);
const editable = new Set(['NEW', 'NEEDS_DETAILS', 'UNDER_REVIEW']);

export async function normalizedPhoto(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(422, 'INVALID_PHOTO', 'Choose a JPEG, PNG or WebP photo.');
  }
  try {
    const image = sharp(buffer, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!formats.has(metadata.format) || (metadata.pages ?? 1) > 1) throw new Error('Unsupported image');
    const output = await image.rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
    if (output.length > photoLimit) throw new Error('Normalized photo exceeds the limit');
    return output;
  } catch {
    throw new AppError(422, 'INVALID_PHOTO', 'Choose a readable, non-animated JPEG, PNG or WebP photo.');
  }
}

function ensureEditable(inquiry) {
  if (!editable.has(inquiry.status)) conflict('Photos can be changed before a quote is issued.');
}

export async function addPhoto(pool, actor, inquiryId, buffer) {
  const owned = found(await one(pool, `SELECT status FROM inquiries WHERE id = $1 AND customer_id = $2`,
    [inquiryId, actor.id]));
  ensureEditable(owned);
  const output = await normalizedPhoto(buffer);
  return transaction(pool, async db => {
    ensureEditable(await lockInquiry(db, actor, inquiryId));
    const { count } = await one(db, 'SELECT count(*)::int AS count FROM inquiry_photos WHERE inquiry_id = $1', [inquiryId]);
    if (count >= 3) conflict('This request already has three photos.');
    return one(db, 'INSERT INTO inquiry_photos (inquiry_id, content) VALUES ($1, $2) RETURNING id',
      [inquiryId, output]);
  });
}

export async function readPhoto(pool, actor, inquiryId, photoId) {
  return found(await one(pool, `SELECT p.content FROM inquiry_photos p
    JOIN inquiries i ON i.id = p.inquiry_id
    WHERE i.id = $1 AND p.id = $2 AND (
      ($3 = 'customer' AND i.customer_id = $4) OR
      ($3 = 'provider' AND EXISTS (SELECT 1 FROM provider_memberships m
        WHERE m.active AND m.business_id = i.business_id AND m.user_id = $4))
    )`, [inquiryId, photoId, actor.role, actor.id]));
}

export async function removePhoto(pool, actor, inquiryId, photoId) {
  return transaction(pool, async db => {
    ensureEditable(await lockInquiry(db, actor, inquiryId));
    return found(await one(db, 'DELETE FROM inquiry_photos WHERE inquiry_id = $1 AND id = $2 RETURNING id',
      [inquiryId, photoId]));
  });
}
