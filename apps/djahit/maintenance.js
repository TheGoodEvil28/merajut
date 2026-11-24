import { pathToFileURL } from 'node:url';
import { createPool, one, transaction } from './db.js';

export function pruneExpiredCredentials(pool) {
  return transaction(pool, async db => {
    await db.query(`DELETE FROM sessions WHERE token_digest IN (
      SELECT token_digest FROM sessions WHERE expires_at<=now() LIMIT 500)`);
    await db.query(`DELETE FROM inbound_binding_challenges WHERE id IN (
      SELECT id FROM inbound_binding_challenges WHERE expires_at<=now() LIMIT 500)`);
    await db.query(`DELETE FROM account_challenges WHERE id IN (
      SELECT id FROM account_challenges WHERE expires_at<=now() LIMIT 500)`);
  });
}

const closedMedia = `
  SELECT p.id FROM inquiry_photos p JOIN inquiries i ON i.id=p.inquiry_id
  LEFT JOIN orders o ON o.inquiry_id=i.id
  JOIN LATERAL (SELECT max(e.created_at) AS closed_at FROM domain_events e WHERE e.inquiry_id=i.id
    AND e.new_status IN ('COMPLETED','CANCELLED','DECLINED')
    AND e.kind IN ('INQUIRY_UPDATED','ORDER_UPDATED','CANCEL_APPROVED')) closing ON true
  WHERE COALESCE(o.status,i.status) IN ('CANCELLED','DECLINED','COMPLETED')
    AND closing.closed_at <= now()-interval '90 days'`;

const abandoned = `SELECT t.id FROM inbound_threads t WHERE t.inquiry_id IS NULL
  AND t.state <> 'HUMAN' AND t.updated_at <= now()-interval '30 days'
  AND (t.details IS NOT NULL OR t.state <> 'RESOLVED' OR EXISTS(SELECT 1 FROM inbound_messages m WHERE m.thread_id=t.id))`;

export function retentionSweep(pool, apply = false) {
  return transaction(pool, async db => {
    if (!apply) return one(db,`SELECT (SELECT count(*)::int FROM (${closedMedia}) p) AS closed_photos,
      (SELECT count(*)::int FROM (${abandoned}) t) AS abandoned_threads`);
    const photos = await db.query(`DELETE FROM inquiry_photos WHERE id IN (${closedMedia})`);
    const threads = await db.query(`UPDATE inbound_threads t SET details=NULL,draft_at=NULL,handled_by=NULL,state='RESOLVED',
      quantity=NULL,desired_date=NULL,fit_notes=NULL WHERE id IN (${abandoned}) AND inquiry_id IS NULL
      AND updated_at <= now()-interval '30 days' AND state <> 'HUMAN' RETURNING id`);
    await db.query('DELETE FROM inbound_messages WHERE thread_id=ANY($1::uuid[])',[threads.rows.map(row => row.id)]);
    return { closed_photos:photos.rowCount, abandoned_threads:threads.rowCount };
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const apply = process.argv.includes('--apply');
  if (apply && process.env.DJAHIT_RETENTION_POLICY !== 'approved-90-30') {
    throw new Error('Apply requires explicit approval of the 90/30-day retention policy.');
  }
  const pool=createPool();
  try { console.log(JSON.stringify({apply,...await retentionSweep(pool,apply)})); }
  finally { await pool.end(); }
}
