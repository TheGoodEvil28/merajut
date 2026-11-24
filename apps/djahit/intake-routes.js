import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { publicCatalog } from './catalog.js';
import { AppError } from './errors.js';
import { digest } from './identity.js';
import { enqueueSimulation, beginBinding, confirmBinding, intakeThread, intakeWorkspace, actOnThread, unlinkSender } from './inbound.js';
import { id, parse } from './validation.js';

const eventSchema = z.discriminatedUnion('kind', [
  z.object({ eventId: id, kind: z.literal('text'), text: z.string() }),
  z.object({ eventId: id, kind: z.literal('details'), text: z.string(),
    quantity: z.coerce.number().int().min(1).max(50).optional(),
    desiredDate: z.union([z.iso.date(),z.literal('')]).optional().transform(value => value || undefined),
    fitNotes: z.string().trim().max(500).optional().transform(value => value || undefined) }),
  z.object({ eventId: id, kind: z.literal('select_service'), serviceId: id }),
  z.object({ eventId: id, kind: z.literal('handoff') }),
  z.object({ eventId: id, kind: z.literal('binding_proof'), code: z.string() })
]);
const threadAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['claim', 'return', 'resolve', 'convert', 'close']) }),
  z.object({ kind: z.literal('reply'), text: z.string().trim().min(1).max(1500) }),
  z.object({ kind: z.literal('link'), inquiryId: id })
]);
const intakePath = '/workspace/intake';

export function createIntakeRouter(pool, { authenticated, customer, finish, sessionValue }) {
  const router = Router();
  const sessionKey = req => digest(sessionValue(req));
  const localLimit = rateLimit({
    windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.'))
  });

  router.get(intakePath, authenticated, async (req, res) => {
    const workspace = await intakeWorkspace(pool, req.actor, sessionKey(req));
    const services = req.actor.role === 'customer' ? await publicCatalog(pool) : [];
    res.render('intake', { title: 'Simulasi WhatsApp', ...workspace, services, newKey: randomUUID });
  });
  router.get('/api/v1/intake', authenticated, async (req, res) =>
    res.json(await intakeWorkspace(pool, req.actor, sessionKey(req))));
  router.post('/api/v1/intake/events', localLimit, customer, async (req, res) => {
    const receipt = await enqueueSimulation(pool, req.actor, parse(eventSchema, req.body));
    finish(req, res, receipt, intakePath, 202);
  });
  router.post('/api/v1/intake/binding/start', localLimit, customer, async (req, res) => {
    const { senderId } = parse(z.object({ senderId: id }), req.body);
    const challenge = await beginBinding(pool, req.actor, senderId, sessionKey(req));
    if (req.is('application/json') || req.get('accept')?.includes('application/json')) {
      return res.status(201).json(challenge);
    }
    res.render('intake-bind', { title: 'Tautkan pengirim simulasi', challenge, proofKey: randomUUID() });
  });
  router.post('/api/v1/intake/binding/confirm', localLimit, customer, async (req, res) => {
    const { challengeId } = parse(z.object({ challengeId: id }), req.body);
    const result = await confirmBinding(pool, req.actor, challengeId, sessionKey(req));
    finish(req, res, result, intakePath);
  });
  router.post('/api/v1/intake/binding/unlink', localLimit, customer,async(req,res) => {
    await unlinkSender(pool,req.actor,parse(id,req.body.senderId));
    finish(req,res,{unlinked:true},intakePath);
  });
  router.get(intakePath + '/:id', authenticated, async (req, res) => {
    const detail = await intakeThread(pool, req.actor, parse(id, req.params.id));
    res.render('intake-thread', { title: 'Percakapan simulasi', ...detail });
  });
  router.get('/api/v1/intake/threads/:id', authenticated, async (req, res) =>
    res.json(await intakeThread(pool, req.actor, parse(id, req.params.id))));
  router.post('/api/v1/intake/threads/:id/actions', localLimit, authenticated, async (req, res) => {
    const threadId = parse(id, req.params.id);
    const action = parse(threadAction, req.body);
    const result = await actOnThread(pool, req.actor, threadId, action);
    const target = result.inquiryId ? '/requests/' + result.inquiryId
      : ['return', 'resolve', 'close'].includes(action.kind) ? intakePath : intakePath + '/' + threadId;
    finish(req, res, result, target);
  });
  return router;
}
