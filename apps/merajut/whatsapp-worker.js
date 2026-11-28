import { randomUUID } from 'node:crypto';
import { one, transaction } from './db.js';
import { dispatchPaused, dispatchSnapshot } from './whatsapp-dispatch.js';

export async function recoverDispatchLeases(pool) {
  await pool.query(`UPDATE whatsapp_dispatches SET state='NEEDS_REVIEW',last_error='EXPIRED_STARTED_LEASE',
    lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE state='SENDING' AND lease_until<=now() AND attempt_started_at IS NOT NULL`);
}

async function preflight(pool, job, settings, startAttempt) {
  return transaction(pool, async db => {
    // All paths needing both locks use inquiry first, then dispatch.
    const inquiry = await one(db, 'SELECT * FROM inquiries WHERE id=$1 FOR NO KEY UPDATE', [job.inquiry_id]);
    const current = await one(db, `SELECT * FROM whatsapp_dispatches WHERE id=$1 AND lease_token=$2
      AND state='SENDING' AND lease_until>clock_timestamp() FOR UPDATE`,[job.id,job.lease_token]);
    if (!current) return false;
    const preview = await dispatchSnapshot(db,inquiry,job.channel,settings,{lock:true,excludeId:job.id,purpose:job.purpose});
    if (preview.reason || preview.snapshotDigest !== job.snapshot_digest || job.session_id !== settings.sessionId) {
      await db.query(`UPDATE whatsapp_dispatches SET state='CANCELLED',last_error='PREFLIGHT_CHANGED',
        lease_token=NULL,lease_until=NULL,finished_at=now(),updated_at=now() WHERE id=$1`,[job.id]);
      return false;
    }
    if (!startAttempt) return true;
    const started = await one(db, `UPDATE whatsapp_dispatches SET attempt_started_at=clock_timestamp()
      WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id`,[job.id,job.lease_token]);
    return Boolean(started);
  });
}

export async function finishDispatch(pool, job, result) {
  const delay = Math.max(job.attempts === 1 ? 30 : 120, result.retryAfter || 0);
  const deadline = new Date(job.created_at).getTime()+15*60_000;
  let state = {sent:'SENT',retry:'RETRY_WAIT',failed:'FAILED',review:'NEEDS_REVIEW'}[result.outcome] || 'NEEDS_REVIEW';
  let reason = result.reason || null;
  if (state === 'RETRY_WAIT' && (job.attempts >= 3 || Date.now()+delay*1000 >= deadline)) {
    state = 'FAILED';
    reason = 'RETRY_BUDGET_EXHAUSTED';
  }
  return one(pool, `UPDATE whatsapp_dispatches SET state=$3,last_error=$4,provider_message_id=$5,
    lease_token=NULL,lease_until=NULL,updated_at=now(),next_attempt_at=now()+$6*interval '1 second',
    attempt_started_at=CASE WHEN $3='RETRY_WAIT' THEN NULL ELSE attempt_started_at END,
    finished_at=CASE WHEN $3 IN ('SENT','FAILED','CANCELLED') THEN now() END
    WHERE id=$1 AND lease_token=$2 AND state='SENDING' AND lease_until>clock_timestamp() RETURNING id`,
    [job.id,job.lease_token,state,reason,result.messageId || null,delay]);
}

export async function processDispatch(pool, settings, gateway) {
  await recoverDispatchLeases(pool);
  if (settings.mode === 'disabled') return false;
  if (gateway.mode !== settings.mode) throw new Error('Dispatch adapter mode mismatch.');
  // Rotating the configured session never moves an old job onto the new linked account.
  await pool.query(`UPDATE whatsapp_dispatches SET state='CANCELLED',last_error='SESSION_RETIRED',finished_at=now(),updated_at=now()
    WHERE mode=$1 AND session_id<>$2 AND (state IN ('QUEUED','RETRY_WAIT')
      OR (state='SENDING' AND lease_until<=now() AND attempt_started_at IS NULL))`,[settings.mode,settings.sessionId]);
  if (await dispatchPaused(pool,settings)) return false;
  const lease = randomUUID();
  const job = await one(pool, `WITH candidate AS (
    SELECT id FROM whatsapp_dispatches WHERE mode=$1 AND session_id=$2 AND (
      (state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=now()) OR
      (state='SENDING' AND lease_until<=now() AND attempt_started_at IS NULL)
    ) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE whatsapp_dispatches d SET state='SENDING',attempts=attempts+CASE WHEN d.state='SENDING' THEN 0 ELSE 1 END,lease_token=$3,
    lease_until=now()+interval '60 seconds',attempt_started_at=NULL,updated_at=now()
    FROM candidate WHERE d.id=candidate.id RETURNING d.*`,[settings.mode,settings.sessionId,lease]);
  if (!job) return false;
  if (job.attempts > 3 || Date.now()-new Date(job.created_at).getTime() >= 15*60_000) {
    await finishDispatch(pool,job,{outcome:'failed',reason:'RETRY_BUDGET_EXHAUSTED'});
    return true;
  }
  if (!await preflight(pool,job,settings,false)) return true;
  const ready = await gateway.ready();
  if (ready.outcome !== 'ready') {
    await finishDispatch(pool,job,ready);
    return true;
  }
  if (!await preflight(pool,job,settings,true)) return true;
  let result;
  try { result = await gateway.send(job); }
  catch { result = {outcome:'review',reason:'GATEWAY_OUTCOME_UNKNOWN'}; }
  await finishDispatch(pool,job,result);
  return true;
}
