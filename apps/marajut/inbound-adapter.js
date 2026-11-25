import { createHmac, timingSafeEqual } from 'node:crypto';
import { isFixtureEnvironment } from './environment.js';
import { z } from 'zod';
import { AppError } from './errors.js';
import { digest } from './identity.js';
import { parse } from './validation.js';

const base = {
  eventId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
  sender: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/)
};
const schema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('text'), text: z.string().trim().min(1).max(1500) }),
  z.strictObject({ ...base, kind: z.literal('details'), text: z.string().trim().min(10).max(1500),
    quantity: z.coerce.number().int().min(1).max(50).optional(),
    desiredDate: z.iso.date().optional(), fitNotes: z.string().trim().max(500).optional() }),
  z.strictObject({ ...base, kind: z.literal('select_service'), serviceId: z.uuid() }),
  z.strictObject({ ...base, kind: z.literal('handoff') }),
  z.strictObject({ ...base, kind: z.literal('binding_proof'), code: z.string().regex(/^[a-f0-9]{48}$/) })
]);

export function simulatedInbound() {
  return process.env.MESSAGING_MODE !== 'disabled' && isFixtureEnvironment();
}

export function normalizeSimulation(envelope) {
  const { eventId, sender, kind, ...payload } = parse(schema, envelope);
  const safe = kind === 'binding_proof' ? { proofDigest: digest(payload.code) } : payload;
  const fingerprint = digest(JSON.stringify([sender, kind, safe]));
  return { adapter: 'simulated', eventId, sender, kind, payload: safe, fingerprint };
}

export function verifySimulation(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || !/^[a-f0-9]{64}$/.test(signature ?? '') || !secret || secret.length < 32) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'The simulation signature is invalid.');
  }
  const expected = createHmac('sha256', secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'The simulation signature is invalid.');
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AppError(422, 'INVALID_EVENT', 'The simulation event could not be read.');
  }
  return normalizeSimulation(payload);
}

// Human responses are simulated message records. A future live transport needs its own outbox.
export async function recordSimulationReply(db, threadId, actorId, text) {
  await db.query(`INSERT INTO inbound_messages (thread_id, direction, actor_id, body)
    VALUES ($1, 'OUTBOUND', $2, $3)`, [threadId, actorId, text]);
}
