import { randomUUID } from 'node:crypto';
import { one } from './db.js';

const maxAttempts = 4;

export function messagingMode(value = process.env.MESSAGING_MODE ?? 'simulated') {
  if (value === 'simulated' || value === 'disabled') return value;
  throw new Error('Messaging mode must be simulated or disabled. Live delivery is unavailable.');
}

export async function enqueue(db, eventId, recipientId, purpose, mode) {
  if (mode === 'disabled') return;
  await db.query(`INSERT INTO notification_outbox (event_id, recipient_id, purpose, mode)
    VALUES ($1, $2, $3, $4) ON CONFLICT (event_id, recipient_id, purpose) DO NOTHING`,
  [eventId, recipientId, purpose, mode]);
}

export async function setSimulationPreference(pool, actor, enabled) {
  await pool.query(`INSERT INTO simulation_preferences (customer_id, enabled) VALUES ($1, $2)
    ON CONFLICT (customer_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, [actor.id, enabled]);
}

export async function simulationInbox(pool, actor) {
  const [preference, messages] = await Promise.all([
    one(pool, 'SELECT enabled FROM simulation_preferences WHERE customer_id = $1', [actor.id]),
    pool.query(`SELECT o.purpose, o.state, o.updated_at, e.inquiry_id
      FROM notification_outbox o JOIN domain_events e ON e.id = o.event_id
      WHERE o.recipient_id = $1 AND o.mode = 'simulated' ORDER BY o.updated_at DESC, o.id LIMIT 50`,
    [actor.id])
  ]);
  return { enabled: preference?.enabled ?? false, messages: messages.rows };
}

// An adapter must declare whether repeating the same intent ID is safe after a lost response.
export function simulator(pool, fault = 'none') {
  return {
    mode: 'simulated',
    replaySafe: true,
    async send(intent) {
      if (fault === 'transient' || (fault === 'first' && intent.attempts === 1)) return 'retry';
      if (fault === 'permanent') return 'failed';
      return (await one(pool, `WITH eligible AS (
        SELECT customer_id FROM simulation_preferences WHERE customer_id = $2 AND enabled FOR SHARE
      ), inserted AS (
        INSERT INTO simulated_messages (intent_id) SELECT $1 FROM eligible
        ON CONFLICT DO NOTHING RETURNING intent_id
      )
      SELECT CASE WHEN EXISTS (SELECT 1 FROM inserted)
        OR EXISTS (SELECT 1 FROM simulated_messages WHERE intent_id = $1)
        THEN 'simulated' ELSE 'suppressed' END AS outcome`, [intent.id, intent.recipient_id])).outcome;
    }
  };
}

export async function processNext(pool, adapter, retrySeconds = attempt => 2 ** attempt + Math.random()) {
  const lease = randomUUID();
  if (!adapter.replaySafe) {
    await pool.query(`UPDATE notification_outbox SET state = 'NEEDS_REVIEW', lease_until = NULL,
      lease_token = NULL, last_error = 'EXPIRED_LEASE', updated_at = now()
      WHERE mode = $1 AND state = 'SENDING' AND lease_until <= now()`, [adapter.mode]);
  }
  const intent = await one(pool, `WITH next_job AS (
    SELECT id FROM notification_outbox WHERE mode = $1 AND (
      (state IN ('QUEUED', 'RETRY_WAIT') AND next_attempt_at <= now()) OR
      ($3 AND state = 'SENDING' AND lease_until <= now())
    ) ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE notification_outbox o SET state = 'SENDING', attempts = attempts + 1, lease_token = $2,
    lease_until = now() + interval '30 seconds', updated_at = now()
  FROM next_job WHERE next_job.id = o.id RETURNING o.*`, [adapter.mode, lease, adapter.replaySafe]);
  if (!intent) return false;

  const eligible = await one(pool, 'SELECT enabled FROM simulation_preferences WHERE customer_id = $1',
    [intent.recipient_id]);
  let outcome = 'suppressed';
  if (eligible?.enabled) {
    try {
      outcome = await adapter.send(intent);
    } catch {
      outcome = adapter.replaySafe ? 'retry' : 'unknown';
    }
  }
  const states = { simulated: 'SIMULATED', suppressed: 'SUPPRESSED', failed: 'FAILED', unknown: 'NEEDS_REVIEW' };
  const state = outcome === 'retry'
    ? (intent.attempts < maxAttempts ? 'RETRY_WAIT' : 'FAILED')
    : (states[outcome] ?? 'NEEDS_REVIEW');
  await pool.query(`UPDATE notification_outbox SET state = $3, lease_until = NULL, lease_token = NULL,
    updated_at = now(), next_attempt_at = now() + $4 * interval '1 second', last_error = $5
    WHERE id = $1 AND lease_token = $2`, [
    intent.id, lease, state, state === 'RETRY_WAIT' ? retrySeconds(intent.attempts) : 0,
    ['RETRY_WAIT', 'FAILED', 'NEEDS_REVIEW'].includes(state) ? outcome.toUpperCase() : null
  ]);
  return true;
}
