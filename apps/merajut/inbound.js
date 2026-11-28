import { randomBytes, randomUUID } from 'node:crypto';
import { activeBusiness } from './catalog.js';
import { one, transaction } from './db.js';
import { AppError, conflict, found } from './errors.js';
import { digest } from './identity.js';
import { persistInquiry } from './inquiries.js';
import { normalizeSimulation, recordSimulationReply } from './inbound-adapter.js';

export async function enqueueInbound(db, event) {
  await db.query(`INSERT INTO inbound_senders (adapter, external_id) VALUES ($1, $2)
    ON CONFLICT (adapter, external_id) DO NOTHING`, [event.adapter, event.sender]);
  const sender = await one(db, 'SELECT id FROM inbound_senders WHERE adapter = $1 AND external_id = $2',
    [event.adapter, event.sender]);
  await db.query(`SELECT id FROM inbound_senders WHERE id = $1 FOR UPDATE`, [sender.id]);
  const created = await one(db, `INSERT INTO inbound_inbox
    (sender_id, adapter, external_event_id, fingerprint, kind, payload)
    VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (adapter, external_event_id) DO NOTHING RETURNING id`,
  [sender.id, event.adapter, event.eventId, event.fingerprint, event.kind, event.payload]);
  if (created) return { id: created.id, duplicate: false };
  const existing = await one(db, 'SELECT id, fingerprint FROM inbound_inbox WHERE adapter = $1 AND external_event_id = $2',
    [event.adapter, event.eventId]);
  if (existing.fingerprint !== event.fingerprint) conflict('That simulation event ID is already in use.');
  return { id: existing.id, duplicate: true };
}

export async function enqueueSimulation(pool, actor, input) {
  return transaction(pool, async db => {
    await db.query(`INSERT INTO inbound_senders (adapter, external_id, simulator_owner_id)
      VALUES ('simulated', $1, $2) ON CONFLICT (simulator_owner_id) DO NOTHING`, ['demo:' + randomUUID(), actor.id]);
    const sender = await one(db, 'SELECT external_id FROM inbound_senders WHERE simulator_owner_id = $1', [actor.id]);
    return enqueueInbound(db, normalizeSimulation({ ...input, sender: sender.external_id }));
  });
}

export async function beginBinding(pool, actor, senderId, sessionDigest) {
  return transaction(pool, async db => {
    const sender = found(await one(db, `SELECT id, customer_id FROM inbound_senders
      WHERE id = $1 AND (simulator_owner_id IS NULL OR simulator_owner_id = $2)
      FOR UPDATE`, [senderId, actor.id]));
    if (sender.customer_id) conflict('This sender is already linked.');
    const existing = await one(db, `SELECT id FROM inbound_binding_challenges
      WHERE sender_id = $1 AND customer_id = $2 AND session_digest = $3
        AND expires_at > clock_timestamp() AND consumed_at IS NULL`, [senderId, actor.id, sessionDigest]);
    if (existing) {
      await db.query('UPDATE inbound_binding_challenges SET expires_at = clock_timestamp() WHERE id = $1', [existing.id]);
    }
    const code = randomBytes(24).toString('hex');
    const challenge = await one(db, `INSERT INTO inbound_binding_challenges
      (sender_id, customer_id, session_digest, code_digest, expires_at)
      VALUES ($1, $2, $3, $4, clock_timestamp() + interval '10 minutes') RETURNING id`,
    [senderId, actor.id, sessionDigest, digest(code)]);
    return { id: challenge.id, code };
  });
}

export async function confirmBinding(pool, actor, challengeId, sessionDigest) {
  return transaction(pool, async db => {
    const params = [challengeId, actor.id, sessionDigest];
    const scope = 'id = $1 AND customer_id = $2 AND session_digest = $3';
    const candidate = found(await one(db, 'SELECT sender_id FROM inbound_binding_challenges WHERE ' + scope, params));
    const sender = await one(db, 'SELECT id, customer_id FROM inbound_senders WHERE id = $1 FOR UPDATE', [candidate.sender_id]);
    const challenge = found(await one(db, `SELECT proved_at, consumed_at, expires_at > clock_timestamp() AS valid
      FROM inbound_binding_challenges WHERE ${scope} FOR UPDATE`, params));
    if (!challenge.valid || !challenge.proved_at || challenge.consumed_at || sender.customer_id) {
      conflict('This binding is unavailable. Send a current proof and try again.');
    }
    await db.query('UPDATE inbound_binding_challenges SET consumed_at = clock_timestamp() WHERE id = $1', [challengeId]);
    await db.query('UPDATE inbound_senders SET customer_id = $2, bound_at = clock_timestamp() WHERE id = $1',
      [sender.id, actor.id]);
    await db.query(`UPDATE inbound_threads SET customer_id=$2,
      draft_at=CASE WHEN service_id IS NOT NULL AND details IS NOT NULL THEN COALESCE(draft_at,now()) END, updated_at=now()
      WHERE sender_id=$1 AND state <> 'RESOLVED'`,[sender.id,actor.id]);
    return { bound: true };
  });
}

async function storeProof(db, job) {
  const result = await db.query(`UPDATE inbound_binding_challenges SET proved_at = clock_timestamp()
    WHERE sender_id = $1 AND code_digest = $2 AND expires_at > clock_timestamp()
      AND consumed_at IS NULL AND proved_at IS NULL`, [job.sender_id, job.payload.proofDigest]);
  if (!result.rowCount) throw new AppError(409, 'INVALID_BINDING_PROOF', 'This proof is unavailable.');
}

async function recordMessage(db, threadId, direction, body, { inboxId = null, actorId = null } = {}) {
  await db.query(`INSERT INTO inbound_messages (thread_id, direction, body, inbox_id, actor_id)
    VALUES ($1, $2, $3, $4, $5)`, [threadId, direction, body, inboxId, actorId]);
}

export function unlinkSender(pool,actor,id) {
  return transaction(pool,async db => {
    found(await one(db,'SELECT id FROM inbound_senders WHERE id=$1 AND customer_id=$2 FOR UPDATE',[id,actor.id]));
    await db.query('DELETE FROM inbound_binding_challenges WHERE sender_id=$1',[id]);
    await db.query(`UPDATE inbound_threads SET state='RESOLVED',handled_by=NULL,updated_at=now()
      WHERE sender_id=$1 AND state<>'RESOLVED'`,[id]);
    await db.query('UPDATE inbound_senders SET customer_id=NULL,bound_at=NULL WHERE id=$1',[id]);
    await db.query('UPDATE simulation_preferences SET enabled=false,updated_at=now() WHERE customer_id=$1',[actor.id]);
  });
}

async function getActiveThread(db, senderId, customerId) {
  const thread = await one(db, "SELECT * FROM inbound_threads WHERE sender_id = $1 AND state <> 'RESOLVED' FOR UPDATE",
    [senderId]);
  if (thread) return thread;
  return one(db, 'INSERT INTO inbound_threads (sender_id,customer_id) VALUES ($1,$2) RETURNING *', [senderId,customerId]);
}

async function applyInbound(db, job) {
  const sender = await one(db, 'SELECT customer_id FROM inbound_senders WHERE id = $1 FOR UPDATE', [job.sender_id]);
  if (job.kind === 'binding_proof') return storeProof(db, job);
  const thread = await getActiveThread(db, job.sender_id, sender.customer_id);
  let { state, business_id: businessId, service_id: serviceId, details } = thread;
  let { quantity, desired_date: desiredDate, fit_notes: fitNotes } = thread;
  let message;

  switch (job.kind) {
    case 'select_service': {
      if (state === 'HUMAN' || thread.inquiry_id || (state === 'AWAITING_HUMAN' && serviceId)) {
        conflict('The selected service is locked during handoff or after conversion.');
      }
      const service = found(await one(db, `SELECT s.id, s.business_id, s.name FROM services s
        JOIN businesses b ON b.id = s.business_id WHERE s.id = $1 AND s.active AND b.published`,
      [job.payload.serviceId]));
      if (businessId && businessId !== service.business_id) {
        conflict('Start a new conversation to choose a different business.');
      }
      businessId = service.business_id;
      serviceId = service.id;
      message = 'Pilihan layanan: ' + service.name;
      break;
    }
    case 'details':
      if (thread.inquiry_id) conflict('This conversation already has a service request.');
      details = job.payload.text;
      ({quantity=null,desiredDate=null,fitNotes=null}=job.payload);
      message = details;
      break;
    case 'handoff':
      if (state !== 'HUMAN') state = 'AWAITING_HUMAN';
      message = 'Bantuan penjahit diminta.';
      break;
    default:
      message = job.payload.text;
  }
  if (state === 'AUTOMATED' || state === 'AWAITING_CUSTOMER') {
    state = serviceId && details ? 'AUTOMATED' : 'AWAITING_CUSTOMER';
  }
  const draftReady = Boolean(serviceId && details && sender.customer_id);
  await db.query(`UPDATE inbound_threads SET state = $2, business_id = $3, service_id = $4, details = $5,
    draft_at = CASE WHEN $6 THEN COALESCE(draft_at, now()) ELSE NULL END, updated_at = now(),
    quantity=$7, desired_date=$8, fit_notes=$9 WHERE id = $1`,
  [thread.id, state, businessId, serviceId, details, draftReady,quantity,desiredDate,fitNotes]);
  await recordMessage(db, thread.id, 'INBOUND', message, { inboxId: job.id });
}

export async function processInbound(pool, { apply = applyInbound, delaySeconds = attempt => 2 ** attempt } = {}) {
  return transaction(pool, async db => {
    const job = await one(db, `SELECT q.* FROM inbound_inbox q
      WHERE q.state IN ('QUEUED', 'RETRY_WAIT') AND q.next_attempt_at <= now()
        AND NOT EXISTS (SELECT 1 FROM inbound_inbox preceding
          WHERE preceding.sender_id = q.sender_id AND preceding.sequence < q.sequence
            AND preceding.state IN ('QUEUED', 'RETRY_WAIT'))
      ORDER BY q.sequence LIMIT 1 FOR UPDATE OF q SKIP LOCKED`);
    if (!job) return false;
    await db.query('SAVEPOINT process_inbound');
    let state = 'PROCESSED';
    let errorCode = null;
    const attempt = job.attempts + 1;
    try {
      await apply(db, job);
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT process_inbound');
      state = error instanceof AppError ? 'REJECTED' : attempt < 4 ? 'RETRY_WAIT' : 'FAILED';
      errorCode = error instanceof AppError ? error.code : 'PROCESSING_ERROR';
    }
    await db.query(`UPDATE inbound_inbox SET attempts = $2, state = $3, last_error = $4,
      next_attempt_at = now() + $5 * interval '1 second',
      finished_at = CASE WHEN $3 = 'RETRY_WAIT' THEN NULL ELSE now() END,
      payload = CASE WHEN $3 = 'RETRY_WAIT' THEN payload ELSE '{}'::jsonb END WHERE id = $1`,
    [job.id, attempt, state, errorCode, state === 'RETRY_WAIT' ? delaySeconds(attempt) : 0]);
    return true;
  });
}

const staffStates = "('AWAITING_HUMAN', 'HUMAN')";
const staffScope = {
  provider: `t.business_id IS NOT NULL AND t.customer_id IS NOT NULL AND t.state IN ${staffStates}
    AND EXISTS (SELECT 1 FROM provider_memberships m
      WHERE m.business_id = t.business_id AND m.user_id = $1 AND m.active)`,
  operator: `t.business_id IS NULL AND t.state IN ${staffStates}`,
  customer: '(t.customer_id = $1 OR (t.customer_id IS NULL AND s.simulator_owner_id = $1))'
};
const threadProjection = `t.id, t.state, t.details, t.draft_at, t.inquiry_id, t.service_id, t.updated_at,
  t.quantity,t.desired_date::text,t.fit_notes,b.name AS business, v.name AS service, (t.customer_id IS NOT NULL) AS bound`;
const threadJoins = `FROM inbound_threads t JOIN inbound_senders s ON s.id = t.sender_id
  LEFT JOIN businesses b ON b.id = t.business_id LEFT JOIN services v ON v.id = t.service_id`;

export async function intakeWorkspace(pool, actor, sessionDigest) {
  const scope = staffScope[actor.role];
  const threads = (await pool.query(`SELECT ${threadProjection} ${threadJoins}
    WHERE $1::uuid IS NOT NULL AND ${scope} ORDER BY t.updated_at DESC, t.id LIMIT 50`, [actor.id])).rows;
  if (actor.role !== 'customer') return { threads };
  const sender = await one(pool, `SELECT id, (customer_id IS NOT NULL) AS bound FROM inbound_senders
    WHERE simulator_owner_id = $1`, [actor.id]);
  if (!sender) return { threads, sender: null, challenge: null, jobs: [] };
  const [challenge, jobs] = await Promise.all([
    one(pool, `SELECT id, (proved_at IS NOT NULL) AS proved FROM inbound_binding_challenges
      WHERE sender_id = $1 AND customer_id = $2 AND session_digest = $3
        AND expires_at > clock_timestamp() AND consumed_at IS NULL ORDER BY expires_at DESC LIMIT 1`,
    [sender.id, actor.id, sessionDigest]),
    pool.query(`SELECT kind, state, last_error FROM inbound_inbox WHERE sender_id = $1
      ORDER BY sequence DESC LIMIT 6`, [sender.id])
  ]);
  return { threads, sender, challenge, jobs: jobs.rows };
}

export async function intakeThread(pool, actor, id) {
  const thread = found(await one(pool, `SELECT ${threadProjection}, t.handled_by = $1 AS handler
    ${threadJoins} WHERE t.id = $2 AND ${staffScope[actor.role]}`, [actor.id, id]));
  const messages = (await pool.query(`SELECT message.direction, message.body, message.created_at
    FROM (SELECT id, direction, body, created_at FROM inbound_messages
      WHERE thread_id = $1 ORDER BY id DESC LIMIT 100) message ORDER BY message.id`, [id])).rows;
  return { thread, messages };
}

export async function actOnThread(pool, actor, id, action) {
  return transaction(pool, async db => {
    const business = actor.role === 'provider' ? await activeBusiness(db, actor, true) : null;
    const candidate = found(await one(db, 'SELECT sender_id FROM inbound_threads WHERE id = $1', [id]));
    const sender = await one(db, 'SELECT * FROM inbound_senders WHERE id = $1 FOR UPDATE', [candidate.sender_id]);
    const thread = await one(db, 'SELECT * FROM inbound_threads WHERE id = $1 FOR UPDATE', [id]);
    const isCustomer = actor.role === 'customer';
    const ownsThread = isCustomer ? thread.customer_id === actor.id
      || (action.kind === 'close' && !sender.customer_id && sender.simulator_owner_id === actor.id) :
      ['AWAITING_HUMAN', 'HUMAN'].includes(thread.state)
      && (business ? thread.business_id === business.id && sender.customer_id : thread.business_id === null);
    found(ownsThread ? thread : null);

    if (action.kind === 'convert' && thread.inquiry_id) return { id, inquiryId: thread.inquiry_id };
    if (action.kind === 'convert' || action.kind === 'link') {
      if (!thread.draft_at || !sender.customer_id || !thread.business_id) conflict('Complete the draft and bind the sender first.');
      if (thread.customer_id !== sender.customer_id) conflict('This sender is no longer linked to this conversation.');
      if (thread.state === 'RESOLVED') conflict('This conversation is resolved.');
      if (!isCustomer && (thread.state !== 'HUMAN' || thread.handled_by !== actor.id)) {
        conflict('Take ownership of this handoff first.');
      }
      if (thread.inquiry_id) conflict('A service request is already linked.');
      const inquiry = action.kind === 'link'
        ? found(await one(db, `SELECT id FROM inquiries WHERE id = $1 AND business_id = $2
          AND service_id = $3 AND customer_id = $4 FOR UPDATE`, [action.inquiryId, thread.business_id, thread.service_id, sender.customer_id]))
        : await persistInquiry(db, actor, { serviceId: thread.service_id, description: thread.details, key: id,
          quantity:thread.quantity,desiredDate:thread.desired_date,fitNotes:thread.fit_notes },
          sender.customer_id);
      const linked = await one(db, 'SELECT id FROM inbound_threads WHERE inquiry_id = $1', [inquiry.id]);
      if (linked) conflict('That request is already attached to a conversation.');
      await db.query('UPDATE inbound_threads SET inquiry_id = $2, updated_at = now() WHERE id = $1', [id, inquiry.id]);
      await recordMessage(db, id, 'SYSTEM', 'Permintaan layanan ditautkan.', { actorId: actor.id });
      return { id, inquiryId: inquiry.id };
    }

    if (isCustomer && action.kind === 'close') {
      if (!['AUTOMATED', 'AWAITING_CUSTOMER'].includes(thread.state) || thread.inquiry_id) {
        conflict('Only an intake without an active handoff or linked request can be closed here.');
      }
      await finishThread(db, id, actor, 'RESOLVED');
      return { id, state: 'RESOLVED' };
    }
    if (isCustomer || action.kind === 'close') {
      throw new AppError(403, 'FORBIDDEN', 'This account cannot perform the requested handling action.');
    }
    if (action.kind === 'claim') {
      if (thread.state !== 'AWAITING_HUMAN') conflict('This handoff is no longer available.');
      await db.query("UPDATE inbound_threads SET state = 'HUMAN', handled_by = $2, updated_at = now() WHERE id = $1",
        [id, actor.id]);
      await recordMessage(db, id, 'SYSTEM', 'Percakapan mulai ditangani.', { actorId: actor.id });
      return { id, state: 'HUMAN' };
    }
    if (thread.state !== 'HUMAN' || thread.handled_by !== actor.id) conflict('Take ownership of this handoff first.');
    if (action.kind === 'reply') {
      await recordSimulationReply(db, id, actor.id, action.text);
      await db.query('UPDATE inbound_threads SET updated_at = now() WHERE id = $1', [id]);
      return { id, state: 'HUMAN' };
    }
    const next = action.kind === 'resolve' ? 'RESOLVED'
      : thread.service_id && thread.details ? 'AUTOMATED' : 'AWAITING_CUSTOMER';
    await finishThread(db, id, actor, next);
    return { id, state: next };
  });
}

async function finishThread(db, id, actor, next) {
  await db.query('UPDATE inbound_threads SET state = $2, handled_by = NULL, updated_at = now() WHERE id = $1', [id, next]);
  await recordMessage(db, id, 'SYSTEM', next === 'RESOLVED' ? 'Percakapan telah diselesaikan.' : 'Kembali ke pengisian otomatis.',
    { actorId: actor.id });
}
