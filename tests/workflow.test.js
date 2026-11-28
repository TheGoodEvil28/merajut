import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import sharp from 'sharp';
import { createApp } from '../apps/marajut/app.js';
import { migrate } from '../apps/marajut/migrate.js';
import { seed, seedEmails } from '../apps/marajut/seed.js';
import { seedWorkday } from '../apps/marajut/demo-workday.js';
import { createInquiry } from '../apps/marajut/inquiries.js';
import { updateDispatch } from '../apps/marajut/dispatch.js';
import { enqueue, messagingMode, processNext, simulator } from '../apps/marajut/outbox.js';
import { normalizeSimulation } from '../apps/marajut/inbound-adapter.js';
import { processInbound } from '../apps/marajut/inbound.js';
import { processAccountMail } from '../apps/marajut/mail.js';
import { midtrans } from '../apps/marajut/payments.js';
import { createServer } from 'node:http';
import { decideQuote, expireQuotes, issueQuote } from '../apps/marajut/quotes.js';
import { retentionSweep } from '../apps/marajut/maintenance.js';
import { dispatchSettings } from '../apps/marajut/whatsapp-config.js';
import { dispatchPanel } from '../apps/marajut/whatsapp-dispatch.js';
import { mockDispatchGateway, openwaGateway } from '../apps/marajut/whatsapp-gateway.js';
import { finishDispatch, processDispatch } from '../apps/marajut/whatsapp-worker.js';
import { processDispatchInbox } from '../apps/marajut/whatsapp-inbox.js';

function browserClient(base) {
  const cookies = new Map();
  return {
    async request(path, { body, status = 200, headers = {}, raw = false } = {}) {
      if (!raw) headers.accept = 'application/json';
      headers.cookie = [...cookies].map(([name, value]) => name + '=' + value).join('; ');
      if (body) {
        headers['content-type'] ??= 'application/json';
        headers.origin ??= base;
        headers['x-csrf-token'] ??= cookies.get('marajut_csrf') ?? '';
      }
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
        body: Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined, headers, redirect: 'manual' });
      for (const item of response.headers.getSetCookie()) {
        const [name, value] = item.split(';')[0].split('=');
        cookies.set(name, value);
      }
      const result = raw === 'bytes' ? Buffer.from(await response.arrayBuffer())
        : raw ? await response.text() : await response.json();
      assert.equal(response.status, status, `${path} returned ${JSON.stringify(result).slice(0, 250)}`);
      return result;
    }
  };
}

test('Live messaging cannot be selected', () => {
  assert.throws(() => messagingMode('live'), /unavailable/);
});

async function isolatedDatabase(t) {
  assert.equal(process.env.MARAJUT_ENV, 'test', 'Run in the isolated test environment documented in README.');
  const schema = 'test_' + randomBytes(12).toString('hex');
  const administration = new pg.Pool();
  await administration.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ options: '-c search_path=' + schema });
  t.after(async () => {
    await pool.end();
    await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
    await administration.end();
  });

  return {pool,schema};
}

async function serve(t,pool,options) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  server.on('request',createApp(pool,{origin:base,mode:'simulated',...options}));
  t.after(() => new Promise(resolve=>server.close(resolve)));
  return base;
}

test('Express and PostgreSQL workflow', async t => {
  const {pool,schema}=await isolatedDatabase(t);
  const fixtureSecret = randomBytes(24).toString('hex');
  process.env.SIMULATION_WEBHOOK_SECRET = fixtureSecret;
  const base=await serve(t,pool);
  const client = browserClient(base);
  const customer = browserClient(base);
  const foreignCustomer = browserClient(base);
  const tailor = browserClient(base);
  const foreignTailor = browserClient(base);
  const password = randomBytes(18).toString('hex');

  await t.test('fresh migration, rerun, seeded catalog and protected cookie sign-in', async () => {
    await client.request('/health/ready', { status: 503 });
    await migrate(pool);
    await migrate(pool);
    // Exercise the compatibility paths for inquiries already in flight at migration time.
    // The managed workflow suite uses the production OPEN default in a separate schema.
    await pool.query('ALTER TABLE inquiries ALTER COLUMN dispatch_state DROP DEFAULT');
    await seed(pool, password);
    await seed(pool, password);
    await client.request('/health/ready');
    const page = await client.request('/', { raw: true });
    assert.match(page, /Layanan jahit di sekitar Anda/);
    assert.equal((await client.request('/api/v1/services')).length, 3);
    await customer.request('/api/v1/inquiries', { status: 401 });
    await customer.request('/api/v1/session', {
      body: { email: seedEmails.customer, password }, headers: { origin: 'https://other.invalid' }, status: 403
    });
    await customer.request('/api/v1/session', { body: { email: seedEmails.customer, password: 'wrong' }, status: 401 });
    for (const [session, email] of [[customer, seedEmails.customer], [foreignCustomer, seedEmails.otherCustomer],
      [tailor, seedEmails.provider], [foreignTailor, seedEmails.otherProvider]]) {
      await session.request('/api/v1/session');
      await session.request('/api/v1/session', { body: { email, password } });
    }
    await customer.request('/api/v1/messages/preference', { body: { enabled: true } });
  });

  await t.test('Marajut offers a local chat destination only when intake is enabled', async () => {
    const home = await client.request('/', { raw: true });
    assert.match(home, /Marajut/);
    assert.match(home, /Buka simulasi WhatsApp/);
    const chatLogin = await client.request('/login?next=%2Fworkspace%2Fintake', { raw:true });
    assert.match(chatLogin, /name="next" value="\/workspace\/intake"/);
    const external = await client.request('/login?next=https%3A%2F%2Fexample.invalid', { raw:true });
    assert.doesNotMatch(external, /name="next"/);

    const webOnly = createServer(createApp(pool, { mode:'disabled' }));
    webOnly.listen(0, '127.0.0.1');
    await once(webOnly, 'listening');
    try {
      const guest = browserClient('http://127.0.0.1:' + webOnly.address().port);
      const page = await guest.request('/', { raw:true });
      assert.match(page, /Minta penawaran/);
      assert.doesNotMatch(page, /href="\/workspace\/intake"/);
      assert.doesNotMatch(await guest.request('/login?next=%2Fworkspace%2Fintake', { raw:true }), /name="next"/);
      await guest.request('/workspace/intake', { raw:true, status:404 });
    } finally {
      await new Promise(resolve => webOnly.close(resolve));
    }
  });

  let serviceId;
  let requestId;
  const createRequest = () => ({
    serviceId, description: 'Shorten two pairs of trousers by three centimeters.', key: randomUUID()
  });
  const details = (session, id, status) => session.request('/api/v1/inquiries/' + id, { status });
  const newQuote = (session, id, amount, revision, status = 201) =>
    session.request('/api/v1/provider/inquiries/' + id + '/quotes', {
      body: { amount, eta: '2099-12-04', terms: 'Adjust hems and collect in store.', validHours: 48, revision }, status
    });

  await t.test('catalog management and repeat-safe inquiry stay within owner scope', async () => {
    const { services } = await tailor.request('/api/v1/provider/services');
    assert.equal(services.length, 2);
    const body = { name: 'Sleeve repair', description: 'Repair a loose sleeve seam.', price: 20000, active: true };
    await foreignTailor.request('/api/v1/provider/services/' + services[0].id, { body, status: 404 });
    await customer.request('/api/v1/provider/services', { body, status: 403 });
    const service = await tailor.request('/api/v1/provider/services', { body, status: 201 });
    serviceId = service.id;
    await tailor.request('/api/v1/provider/services/' + serviceId, { body: { ...body, price: 22000 } });
    const inquiry = createRequest();
    const result = await customer.request('/api/v1/inquiries', { body: inquiry, status: 201 });
    requestId = result.id;
    assert.equal((await customer.request('/api/v1/inquiries', { body: inquiry })).id, requestId);
    await customer.request('/api/v1/inquiries', { body: { ...inquiry, description: 'Changed request.' }, status: 409 });
    assert.equal((await tailor.request('/api/v1/inquiries')).length, 1);
    assert.equal((await foreignTailor.request('/api/v1/inquiries')).length, 0);
    assert.equal((await foreignCustomer.request('/api/v1/inquiries')).length, 0);
    await details(foreignTailor, requestId, 404);
    await details(foreignCustomer, requestId, 404);
    await newQuote(foreignTailor, requestId, 25000, 1, 404);
    assert.equal((await details(tailor, requestId)).events.length, 1);
  });

  let orderId;
  await t.test('explicit acceptance rejects stale, incorrect and expired quote versions', async () => {
    const first = await newQuote(tailor, requestId, 25000, 1);
    const second = await newQuote(tailor, requestId, 27000, 2);
    assert.equal(second.version, 2);
    const decide = (session, quote, version, status) => session.request('/api/v1/quotes/' + quote.id + '/decisions',
      { body: { version, decision: 'ACCEPTED' }, status });
    await decide(customer, first, 1, 409);
    await decide(customer, second, 1, 409);
    await decide(foreignCustomer, second, 2, 404);
    const accepted = await Promise.all([decide(customer, second, 2, 200), decide(customer, second, 2, 200)]);
    orderId = accepted[0].orderId;
    assert.ok(orderId);
    assert.equal(accepted[1].orderId, orderId);
    assert.deepEqual(accepted.map(row => row.replay).sort(), [false, true]);
    const privateDetail = await details(customer, requestId);
    assert.deepEqual(privateDetail.quotes.map(row => row.status), ['ACCEPTED', 'SUPERSEDED']);
    assert.equal(privateDetail.order.amount, 27000);
    assert.equal(privateDetail.events.filter(row => row.kind === 'ORDER_CONFIRMED').length, 1);

    const other = await customer.request('/api/v1/inquiries', { body: createRequest(), status: 201 });
    const expired = await newQuote(tailor, other.id, 35000, 1);
    await pool.query("UPDATE quotes SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
    const listedQuote = async () => (await customer.request('/api/v1/inquiries')).find(item => item.id === other.id);
    assert.equal((await listedQuote()).quote_expired, true);
    await decide(customer, expired, 1, 409);
    const reissued = await newQuote(tailor, other.id, 37000, 2);
    assert.equal(reissued.version, 2);
    assert.equal((await listedQuote()).quote_expired, false);
    assert.ok(!(await details(customer, other.id)).order);
  });

  await t.test('legal order transitions and event history persist across pools', async () => {
    const path = '/api/v1/provider/orders/' + orderId + '/transitions';
    await tailor.request(path, { body: { action: 'complete', revision: 1 }, status: 409 });
    await foreignTailor.request(path, { body: { action: 'start', revision: 1 }, status: 404 });
    await tailor.request(path, { body: { action: 'start', revision: 1 } });
    await tailor.request(path, { body: { action: 'ready', revision: 1 }, status: 409 });
    await tailor.request(path, { body: { action: 'ready', revision: 2 } });
    await tailor.request(path, { body: { action: 'complete', revision: 3 } });
    const freshReader = new pg.Pool({ options: '-c search_path=' + schema });
    try {
      assert.equal((await freshReader.query('SELECT status FROM orders WHERE id = $1', [orderId])).rows[0].status,
        'COMPLETED');
    } finally {
      await freshReader.end();
    }
    const completed = await details(customer, requestId);
    assert.equal(completed.order.status, 'COMPLETED');
    assert.deepEqual(completed.events.filter(row => row.kind === 'ORDER_UPDATED').map(row => row.new_status),
      ['IN_PROGRESS', 'READY', 'COMPLETED']);
    const page = await customer.request('/requests/' + requestId, { raw: true });
    assert.match(page, /Detail pesanan/);
    assert.match(page, /Versi sebelumnya/);
    assert.doesNotMatch(page, /payment successful/i);
  });

  await t.test('duplicate intents, retry, failure, and lost responses preserve the order', async () => {
    const { rows: [original] } = await pool.query(`SELECT * FROM notification_outbox
      WHERE purpose = 'ORDER_READY'`);
    await enqueue(pool, original.event_id, original.recipient_id, original.purpose, 'simulated');
    const count = async () => Number((await pool.query('SELECT count(*) FROM notification_outbox')).rows[0].count);
    assert.equal(await count(), 5);
    while (await processNext(pool, simulator(pool, 'first'), () => 0)) {}
    const { rows } = await pool.query('SELECT state, attempts FROM notification_outbox');
    assert.ok(rows.every(row => row.state === 'SIMULATED' && row.attempts === 2));
    await pool.query(`UPDATE notification_outbox SET state = 'SENDING', lease_until = now() - interval '1 second'
      WHERE id = $1`, [original.id]);
    await Promise.all([processNext(pool, simulator(pool)), processNext(pool, simulator(pool))]);
    assert.equal(Number((await pool.query('SELECT count(*) FROM simulated_messages')).rows[0].count), 5);

    const next = await customer.request('/api/v1/inquiries', { body: createRequest(), status: 201 });
    await newQuote(tailor, next.id, 45000, 1);
    while (await processNext(pool, simulator(pool, 'transient'), () => 0)) {}
    const failed = (await customer.request('/api/v1/messages')).messages.find(row => row.inquiry_id === next.id);
    assert.equal(failed.state, 'FAILED');
    assert.equal((await details(customer, requestId)).order.status, 'COMPLETED');
    assert.equal(await count(), 6);

    await customer.request('/api/v1/messages/preference', { body: { enabled: false } });
    const disabled = await customer.request('/api/v1/inquiries', { body: createRequest(), status: 201 });
    await newQuote(tailor, disabled.id, 46000, 1);
    await processNext(pool, simulator(pool));
    const suppressed = (await customer.request('/api/v1/messages')).messages.find(row => row.inquiry_id === disabled.id);
    assert.equal(suppressed.state, 'SUPPRESSED');
    assert.equal((await foreignCustomer.request('/api/v1/messages')).messages.length, 0);
    await customer.request('/api/v1/session/logout', { body: {} });
    await customer.request('/api/v1/inquiries', { status: 401 });
  });

  const operator = browserClient(base);
  const secondSession = browserClient(base);
  const login = async (agent, email) => {
    await agent.request('/api/v1/session');
    await agent.request('/api/v1/session', { body: { email, password } });
  };
  const inbound = (agent, body, status = 202) => agent.request('/api/v1/intake/events', {
    body: { eventId: randomUUID(), ...body }, status
  });
  const state = agent => agent.request('/api/v1/intake');
  const action = (agent, threadId, kind, payload = {}, status = 200) =>
    agent.request('/api/v1/intake/threads/' + threadId + '/actions', { body: { kind, ...payload }, status });
  const start = (agent, senderId, status = 201) =>
    agent.request('/api/v1/intake/binding/start', { body: { senderId }, status });
  const confirm = (agent, challengeId, status = 200) =>
    agent.request('/api/v1/intake/binding/confirm', { body: { challengeId }, status });
  const drain = async () => { while (await processInbound(pool)) {} };
  const webhook = async (value, status, signed = true) => {
    const body = JSON.stringify(value);
    const signature = signed ? createHmac('sha256', fixtureSecret).update(body).digest('hex') : '0'.repeat(64);
    const response = await fetch(base + '/simulated/webhooks/whatsapp', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-simulation-signature': signature }, body
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };

  await t.test('signed ingress normalizes, deduplicates and retries without partial writes', async () => {
    const envelope = { eventId: 'fixture-1', sender: 'fixture:unassigned', kind: 'text', text: '  Need help  ' };
    assert.equal(normalizeSimulation(envelope).payload.text, 'Need help');
    await webhook(envelope, 401, false);
    await webhook({ ...envelope, kind: 'unsupported' }, 422);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM inbound_inbox')).rows[0].count, 0);
    const first = await webhook(envelope, 202);
    assert.deepEqual(await webhook(envelope, 202), { id: first.id, duplicate: true });
    await webhook({ ...envelope, text: 'Different payload' }, 409);
    await processInbound(pool, {
      delaySeconds: () => 0,
      async apply(db, job) {
        await db.query('INSERT INTO inbound_threads (sender_id) VALUES ($1)', [job.sender_id]);
        throw new Error('Temporary fixture failure');
      }
    });
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM inbound_threads')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT state FROM inbound_inbox WHERE id = $1', [first.id])).rows[0].state, 'RETRY_WAIT');
    await Promise.all([processInbound(pool), processInbound(pool)]);
    const row = (await pool.query('SELECT state, attempts FROM inbound_inbox WHERE id = $1', [first.id])).rows[0];
    assert.deepEqual(row, { state: 'PROCESSED', attempts: 2 });
    const messages = (await pool.query('SELECT body FROM inbound_messages WHERE inbox_id = $1', [first.id])).rows;
    assert.deepEqual(messages, [{ body: 'Need help' }]);
    await webhook({ ...envelope, eventId: 'fixture-2', kind: 'handoff', text: undefined }, 202);
    await drain();
    await login(operator, seedEmails.operator);
    const [unassigned] = (await state(operator)).threads;
    assert.equal(unassigned.state, 'AWAITING_HUMAN');
    assert.equal((await state(tailor)).threads.length, 0);
    await action(operator, unassigned.id, 'claim');
    await action(operator, unassigned.id, 'reply', { text: 'Choose a service so we can route this request.' });
    assert.equal((await operator.request('/api/v1/intake/threads/' + unassigned.id)).messages.at(-1).direction, 'OUTBOUND');
    await action(operator, unassigned.id, 'return');
    assert.equal((await state(operator)).threads.length, 0);
  });

  let convertedRequest;
  await t.test('sender proof and confirmation enforce identity, session, expiry and single use', async () => {
    await login(customer, seedEmails.customer);
    await login(secondSession, seedEmails.customer);
    await inbound(customer, { kind: 'text', text: 'I need to shorten jeans.' });
    await inbound(foreignCustomer, { kind: 'text', text: 'Separate customer conversation.' });
    await inbound(tailor, { kind: 'text', text: 'Not a customer.' }, 403);
    await drain();
    const { sender, threads: [thread] } = await state(customer);
    assert.equal(thread.state, 'AWAITING_CUSTOMER');
    await start(foreignCustomer, sender.id, 404);
    await inbound(customer, { kind: 'select_service', serviceId });
    await inbound(customer, { kind: 'details', text: 'Shorten both trouser legs by three centimetres.' });
    await drain();
    assert.equal((await state(customer)).threads[0].draft_at, null);
    await action(customer, thread.id, 'convert', {}, 404);
    const expired = await start(customer, sender.id);
    await pool.query("UPDATE inbound_binding_challenges SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
    const expiredReceipt = await inbound(customer, { kind: 'binding_proof', code: expired.code });
    await drain();
    assert.equal((await pool.query('SELECT state FROM inbound_inbox WHERE id = $1', [expiredReceipt.id])).rows[0].state, 'REJECTED');
    await confirm(customer, expired.id, 409);
    const challenge = await start(customer, sender.id);
    await confirm(customer, challenge.id, 409);
    const mismatched = await inbound(foreignCustomer, { kind: 'binding_proof', code: challenge.code });
    await drain();
    assert.equal((await pool.query('SELECT state FROM inbound_inbox WHERE id = $1', [mismatched.id])).rows[0].state, 'REJECTED');
    const proof = { eventId: randomUUID(), kind: 'binding_proof', code: challenge.code };
    const receipt = await inbound(customer, proof);
    assert.deepEqual(await inbound(customer, proof), { id: receipt.id, duplicate: true });
    await drain();
    await confirm(foreignCustomer, challenge.id, 404);
    await confirm(secondSession, challenge.id, 404);
    await confirm(customer, challenge.id);
    await confirm(customer, challenge.id, 409);
    const row = (await pool.query('SELECT state, payload FROM inbound_inbox WHERE id = $1', [receipt.id])).rows[0];
    assert.deepEqual(row, { state: 'PROCESSED', payload: {} });
    assert.ok((await state(customer)).threads[0].draft_at);
    assert.equal((await state(tailor)).threads.length, 0);
  });

  await t.test('assigned handoff isolates providers and converts once into the web order workflow', async () => {
    const [thread] = (await state(customer)).threads;
    await inbound(customer, { kind: 'handoff' });
    await drain();
    assert.equal((await state(tailor)).threads[0].state, 'AWAITING_HUMAN');
    assert.equal((await state(foreignTailor)).threads.length, 0);
    assert.equal((await state(operator)).threads.length, 0);
    await foreignTailor.request('/api/v1/intake/threads/' + thread.id, { status: 404 });
    await action(foreignTailor, thread.id, 'claim', {}, 404);
    await action(customer, thread.id, 'claim', {}, 403);
    await action(tailor, thread.id, 'claim');
    await action(tailor, thread.id, 'reply', { text: 'I can work on this alteration.' });
    const conversation = await customer.request('/api/v1/intake/threads/' + thread.id);
    assert.ok(conversation.messages.some(message => message.body === 'I can work on this alteration.'));
    await action(tailor, thread.id, 'return');
    assert.equal((await state(tailor)).threads.length, 0);
    const [foreignService] = (await foreignTailor.request('/api/v1/provider/services')).services;
    const reassignment = await inbound(customer, { kind: 'select_service', serviceId: foreignService.id });
    await drain();
    assert.equal((await pool.query('SELECT state FROM inbound_inbox WHERE id = $1', [reassignment.id])).rows[0].state,
      'REJECTED');
    assert.equal((await state(customer)).threads[0].service_id, serviceId);
    await inbound(customer, { kind: 'handoff' });
    await drain();
    await action(tailor, thread.id, 'claim');
    await action(tailor, thread.id, 'link', { inquiryId: randomUUID() }, 404);
    const results = await Promise.all([action(tailor, thread.id, 'convert'), action(customer, thread.id, 'convert')]);
    convertedRequest = results[0].inquiryId;
    assert.equal(results[1].inquiryId, convertedRequest);
    const inquiry = await details(customer, convertedRequest);
    assert.match(inquiry.inquiry.description, /Shorten both trouser legs/);
    assert.equal(inquiry.events.length, 1);
    await action(tailor, thread.id, 'resolve');
    assert.equal((await state(customer)).threads.find(item => item.id === thread.id).state, 'RESOLVED');
    const quote = await newQuote(tailor, convertedRequest, 28000, 1);
    const decision = await customer.request('/api/v1/quotes/' + quote.id + '/decisions',
      { body: { version: quote.version, decision: 'ACCEPTED' } });
    assert.ok(decision.orderId);
  });

  await t.test('authorized staff can link a matching existing request', async () => {
    await inbound(customer, { kind: 'select_service', serviceId });
    await inbound(customer, { kind: 'details', text: 'Follow up on an existing web request.' });
    await inbound(customer, { kind: 'handoff' });
    await drain();
    const [newThread] = (await state(tailor)).threads;
    await action(tailor, newThread.id, 'claim');
    await action(tailor, newThread.id, 'link', { inquiryId: convertedRequest }, 409);
    const linked = await action(tailor, newThread.id, 'link', { inquiryId: requestId });
    assert.equal(linked.inquiryId, requestId);
    assert.equal((await details(customer, requestId)).order.status, 'COMPLETED');
  });

  await t.test('provider profile edits and service visibility are reflected in public discovery', async () => {
    const profile = { name: 'Jahit Rina Semarang', area: 'Semarang Tengah dan sekitarnya',
      description: 'Permak dan perbaikan pakaian harian. Ceritakan kebutuhan Anda saat meminta penawaran.' };
    const profilePath = '/api/v1/provider/profile';
    await customer.request(profilePath, { body: profile, status: 403 });
    const business = await tailor.request(profilePath, { body: { ...profile, published: false } });
    assert.equal(business.published, true);
    const publicPage = await client.request('/penjahit/jahit-rina', { raw: true });
    assert.match(publicPage, /Jahit Rina Semarang/);
    assert.match(publicPage, /Semarang Tengah dan sekitarnya/);
    assert.ok(!publicPage.includes(seedEmails.provider));
    const catalog = await client.request('/api/v1/services');
    assert.ok(catalog.some(row => row.business === profile.name && row.about === profile.description));
    const other = await client.request('/penjahit/ruang-jahit-dewi', { raw: true });
    assert.doesNotMatch(other, /Jahit Rina Semarang/);
    const listing = { name: 'Sleeve repair', description: 'Repair a loose sleeve seam.', price: 22000, active: false };
    await tailor.request('/api/v1/provider/services/' + serviceId, { body: listing });
    assert.doesNotMatch(await client.request('/penjahit/jahit-rina', { raw: true }), /Sleeve repair/);
    await customer.request('/api/v1/inquiries', { body: createRequest(), status: 404 });
    await tailor.request('/api/v1/provider/services/' + serviceId, { body: { ...listing, active: true } });
    assert.match(await client.request('/penjahit/jahit-rina', { raw: true }), /Sleeve repair/);
    await pool.query('UPDATE businesses SET published = false WHERE slug = $1', ['jahit-rina']);
    await client.request('/penjahit/jahit-rina', { raw: true, status: 404 });
    await pool.query('UPDATE businesses SET published = true WHERE slug = $1', ['jahit-rina']);
  });

  await t.test('workspace reflects live state, due-date order and authorized conversation context', async () => {
    const board = (agent, view, status) => agent.request('/api/v1/provider/workspace' + (view ? '?view=' + view : ''), { status });
    const initial = await board(tailor, 'work');
    assert.ok(initial.items.some(item => item.id === convertedRequest && item.source === 'whatsapp'));
    const context = (await details(tailor, convertedRequest)).conversation;
    assert.ok(context.messages.some(message => message.body === 'I can work on this alteration.'));
    await details(foreignTailor, convertedRequest, 404);
    await board(customer, null, 403);
    const otherBoard = await board(foreignTailor, 'history');
    assert.deepEqual(otherBoard.items, []);
    assert.deepEqual(otherBoard.counts, {});
    const requested = await customer.request('/api/v1/inquiries', { body: { ...createRequest(),
      desiredDate: '2099-12-03' }, status: 201 });
    let queue = await board(tailor, 'inbox');
    assert.equal(queue.counts.inbox, queue.items.length);
    const queueRow = queue.items.find(item => item.id === requested.id);
    assert.equal(queueRow.customer_name, 'Ayu');
    assert.equal(queueRow.brief, createRequest().description);
    const clarifyPath = '/api/v1/inquiries/' + requested.id + '/actions';
    await tailor.request(clarifyPath, { body: { action: 'clarify', revision: 1, detail: 'Confirm the length.' } });
    assert.ok((await board(tailor, 'clarify')).items.some(item => item.id === requested.id));
    await customer.request(clarifyPath, { body: { action: 'respond', revision: 2, detail: 'Final length 90 cm.' } });
    const quote = await newQuote(tailor, requested.id, 30000, 3);
    assert.ok((await board(tailor, 'quotes')).items.some(item => item.id === requested.id));
    const accepted = await customer.request('/api/v1/quotes/' + quote.id + '/decisions',
      { body: { version: quote.version, decision: 'ACCEPTED' } });
    queue = await board(tailor, 'work');
    assert.equal(queue.counts.work, queue.items.length);
    assert.ok(queue.items.every((item, index) => !index || queue.items[index - 1].due_date <= item.due_date));
    const progress = '/api/v1/provider/orders/' + accepted.orderId + '/transitions';
    await tailor.request(progress, { body: { action: 'start', revision: 1 } });
    await tailor.request(progress, { body: { action: 'ready', revision: 2 } });
    assert.ok((await board(tailor, 'ready')).items.some(item => item.id === requested.id));
    assert.ok(!(await board(tailor, 'work')).items.some(item => item.id === requested.id));
  });

  await t.test('service categories, intake details and itemized quote revisions stay consistent', async () => {
    const service = { name: 'Permak gaun', description: 'Permak gaun untuk acara.', price: 42000, active: true,
      category: 'alteration', leadDays: 4, intakeHint: 'Sebutkan panjang yang diinginkan.' };
    const selected = await tailor.request('/api/v1/provider/services', { body: service, status: 201 });
    const matching = await client.request('/api/v1/services?q=gaun&category=alteration');
    assert.equal(matching[0].id, selected.id);
    assert.equal(matching[0].lead_days, 4);
    assert.equal(matching[0].intake_hint, service.intakeHint);
    assert.deepEqual(await client.request('/api/v1/services?q=gaun&category=repair'), []);
    const request = { ...createRequest(), serviceId: selected.id, quantity: 2, fitNotes: 'Panjang 90 cm.' };
    const inquiry = await customer.request('/api/v1/inquiries', { body: request, status: 201 });
    await customer.request('/api/v1/inquiries', { body: { ...request, quantity: 3 }, status: 409 });
    const tailorDetail = await details(tailor, inquiry.id);
    assert.equal(tailorDetail.inquiry.quantity, 2);
    assert.equal(tailorDetail.inquiry.fit_notes, request.fitNotes);
    const items = [{ name: 'Permak utama', quantity: 2, unitPrice: 22000 },
      { name: 'Bahan tambahan', quantity: 1, unitPrice: 5000 }];
    const price = '/api/v1/provider/inquiries/' + inquiry.id + '/quotes';
    const draft = { items, eta: '2099-12-04', terms: 'Termasuk pengambilan di toko.', validHours: 24, revision: 1 };
    await tailor.request(price, { body: { ...draft, amount: 48000 }, status: 422 });
    const first = await tailor.request(price, { body: draft, status: 201 });
    assert.equal(first.amount, 49000);
    const revised = [{ name: 'Permak utama', quantity: 2, unitPrice: 23000 }, items[1]];
    const latest = await tailor.request(price, { body: { ...draft, items: revised, revision: 2 }, status: 201 });
    await customer.request('/api/v1/quotes/' + first.id + '/decisions', {
      body: { version: first.version, decision: 'ACCEPTED' }, status: 409
    });
    await customer.request('/api/v1/quotes/' + latest.id + '/decisions', {
      body: { version: latest.version, decision: 'ACCEPTED' }
    });
    const accepted = await details(customer, inquiry.id);
    assert.equal(accepted.order.amount, 51000);
    assert.deepEqual(accepted.order.line_items, revised);
    assert.deepEqual(accepted.quotes[1].line_items, items);
    await details(foreignTailor, inquiry.id, 404);
    await details(foreignCustomer, inquiry.id, 404);
  });

  await t.test('reference photos are normalized and limited to the request participants', async () => {
    const { id } = await customer.request('/api/v1/inquiries', { body: createRequest(), status: 201 });
    const path = '/api/v1/inquiries/' + id + '/photos';
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#889965' } }).png().toBuffer();
    const upload = (actor, body, status = 201) => actor.request(path, {
      body, headers: { 'content-type': 'image/png' }, status
    });
    await upload(foreignCustomer, png, 404);
    await upload(tailor, png, 403);
    await upload(customer, Buffer.from('<html>not a photo</html>'), 422);
    await upload(customer, Buffer.alloc(3 * 1024 * 1024 + 1), 413);
    const photo = await upload(customer, png);
    const url = path + '/' + photo.id;
    const image = await tailor.request(url, { raw: 'bytes' });
    assert.equal((await sharp(image).metadata()).format, 'jpeg');
    await foreignTailor.request(url, { status: 404 });
    await foreignCustomer.request(url, { status: 404 });
    await client.request(url, { status: 401 });
    assert.deepEqual((await details(customer, id)).photos, [{ id: photo.id }]);
    await upload(customer, png);
    await upload(customer, png);
    await upload(customer, png, 409);
    await customer.request(url + '/remove', { body: {} });
    await tailor.request(url, { status: 404 });
    await newQuote(tailor, id, 22000, 1);
    await upload(customer, png, 409);
  });

  const getProof = async (email,purpose) => {
    let code;
    while (await processAccountMail(pool,async(job,value) => {
      if (job.email===email && job.purpose===purpose) code=value;
    })) {}
    assert.match(code,/^[0-9a-f]{64}$/);
    return code;
  };

  await t.test('a verified guest claims one request and its private photo; recovery revokes sessions',async() => {
    const guest=browserClient(base);
    const outsider=browserClient(base);
    const email='guest-pilot@marajut.test';
    await guest.request('/api/v1/session');
    await outsider.request('/api/v1/session');
    const draft={...createRequest(),email,quantity:2};
    const {draftId}=await guest.request('/akun/permintaan',{body:draft,status:202});
    assert.equal((await guest.request('/akun/permintaan',{body:draft,status:202})).draftId,draftId);
    const path='/akun/draf/'+draftId+'/photos';
    const image=await sharp({create:{width:12,height:12,channels:3,background:'#879b71'}}).png().toBuffer();
    await outsider.request(path,{body:image,headers:{'content-type':'image/png'},status:404});
    await guest.request(path,{body:image,headers:{'content-type':'image/png'},status:201});
    const code=await getProof(email,'guest');
    await outsider.request('/akun/periksa',{body:{code}});
    const claim=await guest.request('/akun/konfirmasi',{body:{code,name:'Pelanggan baru',password}});
    await outsider.request('/akun/konfirmasi',{body:{code,name:'Other',password},status:409});
    const request=await details(tailor,claim.inquiryId);
    assert.equal(request.inquiry.quantity,2);
    assert.equal(request.photos.length,1);
    await details(foreignTailor,claim.inquiryId,404);
    const recovery=await outsider.request('/akun/lupa',{body:{email},status:202});
    assert.deepEqual(await outsider.request('/akun/lupa',{body:{email:'absent@marajut.test'},status:202}),recovery);
    const reset=await getProof(email,'recovery');
    const replacement=password+'2';
    await outsider.request('/akun/konfirmasi',{body:{code:reset,password:replacement}});
    await details(guest,claim.inquiryId,401);
    await guest.request('/api/v1/session',{body:{email,password},status:401});
    await guest.request('/api/v1/session',{body:{email,password:replacement}});
    assert.equal((await details(guest,claim.inquiryId)).inquiry.quantity,2);
  });

  await t.test('manager invites, publishes and revokes one tailor with an audit trail',async() => {
    const newTailor=browserClient(base);
    const email='new-tailor@marajut.test';
    await customer.request('/api/v1/management',{status:403});
    const invite={name:'Jahit Uji',area:'Semarang Timur',description:'Permak pakaian untuk uji coba.',email,password};
    await operator.request('/api/v1/management/invites',{body:{...invite,password:'wrong'},status:403});
    const shop=await operator.request('/api/v1/management/invites',{body:invite,status:201});
    const code=await getProof(email,'invite');
    await newTailor.request('/api/v1/session');
    await newTailor.request('/akun/konfirmasi',{body:{code,name:'Penjahit uji',password}});
    await newTailor.request('/api/v1/provider/services',{body:{name:'Permak uji',description:'Layanan pengujian.',price:20000,active:true},status:201});
    const shopState=async() => (await operator.request('/api/v1/management')).shops.find(row=>row.id===shop.id);
    let b=await shopState();
    await client.request('/penjahit/'+b.slug,{raw:true,status:404});
    const moderation='/api/v1/management/shops/'+b.id;
    await operator.request(moderation,{body:{action:'publish',password,reason:'Katalog telah ditinjau.',revision:b.moderation_revision}});
    assert.match(await client.request('/penjahit/'+b.slug,{raw:true}),/Permak uji/);
    b=await shopState();
    await operator.request(moderation,{body:{action:'revoke',password,reason:'Selesai uji pencabutan.',revision:b.moderation_revision}});
    await newTailor.request('/api/v1/provider/services',{status:401});
    await newTailor.request('/api/v1/session',{body:{email,password},status:401});
    await client.request('/penjahit/'+b.slug,{raw:true,status:404});
    assert.ok((await operator.request('/api/v1/management')).events.some(item=>item.action==='ACCESS_REVOKED'));
  });

  await t.test('expiry, cash corrections and exceptional cancellation have separate state and audit',async() => {
    const {id}=await customer.request('/api/v1/inquiries',{body:createRequest(),status:201});
    const photo=await sharp({create:{width:10,height:10,channels:3,background:'#557950'}}).png().toBuffer();
    await customer.request('/api/v1/inquiries/'+id+'/photos',{body:photo,headers:{'content-type':'image/png'},status:201});
    const first=await newQuote(tailor,id,22000,1);
    await pool.query("UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);
    assert.equal(await expireQuotes(pool),1);
    const expired=await details(customer,id);
    assert.equal(expired.inquiry.status,'EXPIRED');
    assert.equal(expired.events.at(-1).actor,'Sistem Marajut');
    const active=await newQuote(tailor,id,25000,expired.inquiry.revision);
    const accepted=await customer.request('/api/v1/quotes/'+active.id+'/decisions',{body:{decision:'ACCEPTED',version:2}});
    const path='/api/v1/provider/orders/'+accepted.orderId;
    await tailor.request(path+'/transitions',{body:{action:'start',revision:1}});
    await tailor.request(path+'/transitions',{body:{action:'ready',revision:2}});
    await foreignTailor.request(path+'/cash',{body:{action:'record',confirmed:'yes',revision:0},status:404});
    await tailor.request(path+'/cash',{body:{action:'record',confirmed:'yes',revision:0}});
    await tailor.request(path+'/cash',{body:{action:'record',confirmed:'yes',revision:0},status:409});
    assert.equal((await details(customer,id)).order.cash_receipts[0].amount,25000);
    await tailor.request(path+'/review',{body:{revision:3,reason:'Alasan pembatalan uji.'},status:201});
    const [review]= (await operator.request('/api/v1/management')).reviews;
    const decision='/api/v1/management/reviews/'+review.id;
    const decisionBody={action:'approve',password,reason:'Pembatalan disepakati.'};
    await operator.request(decision,{body:decisionBody,status:409});
    await tailor.request(path+'/cash',{body:{action:'void',revision:1,reason:'Koreksi penerimaan tunai.'}});
    await operator.request(decision,{body:decisionBody});
    assert.equal((await details(customer,id)).order.status,'CANCELLED');
    assert.ok((await details(customer,id)).order.cash_receipts[0].voidAt);
    await pool.query("UPDATE domain_events SET created_at=now()-interval '91 days' WHERE inquiry_id=$1 AND kind='CANCEL_APPROVED'",[id]);
    assert.equal((await retentionSweep(pool)).closed_photos,1);
    assert.equal((await details(customer,id)).photos.length,1);
    assert.equal((await retentionSweep(pool,true)).closed_photos,1);
    const retained=await details(customer,id);
    assert.equal(retained.photos.length,0);
    assert.equal(retained.order.status,'CANCELLED');
    assert.ok(retained.events.some(item=>item.kind==='CANCEL_APPROVED'));
  });

  await t.test('unlink requires ownership while preserving the original customer history',async() => {
    const {sender,threads}=await customer.request('/api/v1/intake');
    assert.equal(sender.bound,true);
    const thread=threads.find(item=>item.inquiry_id===convertedRequest);
    const path='/api/v1/intake/binding/unlink';
    await foreignCustomer.request(path,{body:{senderId:sender.id},status:404});
    await customer.request(path,{body:{senderId:sender.id}});
    assert.equal((await customer.request('/api/v1/intake')).sender.bound,false);
    assert.equal((await customer.request('/api/v1/intake/threads/'+thread.id)).thread.inquiry_id,convertedRequest);
    await foreignCustomer.request('/api/v1/intake/threads/'+thread.id,{status:404});
    assert.equal((await customer.request('/api/v1/messages')).enabled,false);
  });
});

test('admin dispatch, reassignment, fitting and verified website payment', async t => {
  const {pool}=await isolatedDatabase(t);
  await migrate(pool);
  const password=randomBytes(14).toString('hex');
  await seed(pool,password);
  const payments={mode:'sandbox',key:'synthetic-server-key',feeBps:750};
  const charges=new Map();
  let loseResponse=true;
  let loseStatus=false;
  const gateway=midtrans(payments,async(url,options)=>{
    assert.equal(options.headers.Authorization,'Basic '+Buffer.from(payments.key+':').toString('base64'));
    if (options.method==='POST') {
      const body=JSON.parse(options.body);
      assert.equal(body.bank_transfer.bank,'bni');
      const {order_id,gross_amount}=body.transaction_details;
      if (charges.has(order_id)) return Response.json({status_code:'406'});
      const result={order_id,gross_amount: gross_amount+'.00',currency:'IDR',payment_type:'bank_transfer',
        va_numbers:[{bank:'bni',va_number:'8800000000001'}],transaction_status:'pending',status_code:'201'};
      charges.set(order_id,result);
      if (loseResponse) { loseResponse=false; throw Error('Simulated lost response'); }
      return Response.json(result);
    }
    assert.match(url,/api\.sandbox\.midtrans\.com\/v2\/[\da-f-]+\/status$/);
    if (loseStatus) { loseStatus=false; throw Error('Simulated status timeout'); }
    return Response.json(charges.get(url.split('/').at(-2)));
  });
  const base=await serve(t,pool,{payments,gateway});
  const guest=browserClient(base);
  await guest.request('/api/v1/session');
  const [customer,other,admin,tailor]=await Promise.all(
    [seedEmails.customer,seedEmails.otherCustomer,seedEmails.operator,seedEmails.provider].map(async email=>{
      const client=browserClient(base);
      await client.request('/api/v1/session');
      await client.request('/api/v1/session',{body:{email,password}});
      return client;
    }));
  const read=(client,id)=>client.request('/api/v1/inquiries/'+id);
  const post=(client,path,body,status=200)=>client.request(path,{body,status});
  const submit=(client,path,body,status)=>client.request(path,{
    body:Buffer.from(new URLSearchParams(body).toString()), headers:{'content-type':'application/x-www-form-urlencoded'},
    status, raw:true
  });
  const page=(client,path)=>client.request(path,{raw:true});
  const service=(await guest.request('/api/v1/services')).find(row=>row.slug==='jahit-rina');
  const profile={name:'Mitra tanpa akun',area:'Semarang',description:'Jahit dan fitting dengan janji temu.',
    specialty:'Jahit jas',whatsapp:'081234567890'};
  const prefix='/api/v1/management';
  await post(guest,'/mitra/daftar',profile,202);
  await post(guest,'/mitra/daftar',profile,202);
  const manual=await post(admin,prefix+'/partners',{...profile,name:'Mitra tambahan',whatsapp:'081234567892'},201);
  assert.match(await page(admin,'/pengelola/mitra/'+manual.id),/Mitra tambahan/);
  const pending=(await admin.request(prefix)).shops.filter(b=>b.whatsapp==='6281234567890');
  assert.equal(pending.length,1);
  const shop=pending[0];
  await post(admin,prefix+'/partners/'+shop.id,{...profile,revision:shop.moderation_revision});
  assert.match(await page(admin,'/pengelola/mitra/baru'),/Simpan mitra/);
  assert.match(await page(admin,'/pengelola/mitra/'+shop.id),/WhatsApp pribadi mitra/);
  const offer={name:'Setelan khusus',description:'Permak dan fitting jas.',active:true,price:35000};
  const replacementService=await post(admin,prefix+'/partners/'+shop.id+'/services',offer,201);
  await post(customer,prefix+'/partners/'+shop.id+'/services',offer,403);
  await post(admin,prefix+'/shops/'+shop.id,{action:'publish',password,revision:shop.moderation_revision+1,reason:'Profil sudah ditinjau.'});
  const publicPage=await page(guest,'/penjahit/'+shop.slug);
  assert.match(publicPage,/Jahit jas/);
  assert.doesNotMatch(publicPage,/6281234567890/);
  assert.equal((await pool.query('SELECT * FROM provider_memberships WHERE business_id=$1',[shop.id])).rowCount,0);
  await post(customer,'/akun/profil',{name:'Ayu QA',address:'Alamat sintetis',phone:'+62 812 3456 7891'});
  assert.match(await page(customer,'/akun/profil'),/Alamat sintetis/);
  const original=await post(customer,'/api/v1/inquiries',{key:randomUUID(),serviceId:service.id,quantity:2,
    description:'Pesanan jas sintetis.',requestedHandover:'delivery',fittingRequested:true},201);
  const cloth=await sharp({create:{width:10,height:10,channels:3,background:'#778899'}}).png().toBuffer();
  await customer.request('/api/v1/inquiries/'+original.id+'/photos',{
    body:cloth,headers:{'content-type':'image/png'},status:201
  });
  const detail=await read(customer,original.id);
  assert.equal(detail.inquiry.dispatch_state,'OPEN');
  assert.equal(detail.inquiry.requested_handover,'delivery');
  assert.equal(detail.inquiry.fitting_requested,true);
  assert.equal(Number(detail.inquiry.estimate),service.price_hint*2);
  const action=(id,kind)=>prefix+'/inquiries/'+id+'/'+kind;
  const quote={amount:81000,revision:1,eta:'2099-02-10',terms:'Antar setelah fitting.',validHours:48,handover:'delivery',
    fittingAt:'2099-02-08T11:00',fittingPlace:'Studio uji'};
  await post(admin,action(original.id,'quotes'),quote,409);
  await post(tailor,'/api/v1/provider/inquiries/'+original.id+'/quotes',quote,409);
  await post(admin,action(original.id,'dispatch'),{revision:1,state:'GROUP'});
  await post(admin,action(original.id,'dispatch'),{revision:2,state:'CONTACTED'});
  await post(admin,action(original.id,'dispatch'),{revision:3,state:'AVAILABLE'});
  const first=await post(admin,action(original.id,'quotes'),{...quote,revision:4},201);
  const decision=(q,value)=>post(customer,'/api/v1/quotes/'+q.id+'/decisions',{version:q.version,decision:value});
  await decision(first,'REJECTED');
  const switchPath='/api/v1/inquiries/'+original.id+'/reassign';
  const choice={revision:6,serviceId:replacementService.id};
  await post(other,switchPath,choice,404);
  const replacement=await post(customer,switchPath,choice,201);
  await post(customer,switchPath,choice,409);
  const id=replacement.id;
  const old=await read(customer,original.id);
  assert.equal(old.inquiry.replacement_id,id);
  assert.equal(old.quotes[0].status,'REJECTED');
  const replacementDetail=await read(customer,id);
  assert.equal(replacementDetail.inquiry.previous_inquiry_id,original.id);
  assert.equal(replacementDetail.photos.length,1);
  assert.equal(replacementDetail.inquiry.requested_handover,'delivery');
  assert.notEqual(replacementDetail.photos[0].id,detail.photos[0].id);
  await tailor.request('/api/v1/inquiries/'+id,{status:404});
  const adminPage=await page(admin,'/requests/'+id);
  assert.match(adminPage,/https:\/\/wa.me\/6281234567890\?text=/);
  assert.match(adminPage,/Alamat sintetis/);
  const groupDraft=decodeURIComponent(adminPage.match(/href="https:\/\/wa\.me\/\?text=([^"]+)"/)[1]);
  assert.match(groupDraft,/Setelan khusus/);
  assert.doesNotMatch(groupDraft,/Alamat sintetis|Pesanan jas sintetis|081234567891/);
  assert.doesNotMatch(await page(customer,'/requests/'+id),/wa.me\/6281234567890/);
  await post(admin,action(id,'dispatch'),{revision:1,state:'AVAILABLE'});
  await post(admin,action(id,'quotes'),{...quote,revision:2,fittingPlace:''},422);
  const finalQuote=await post(admin,action(id,'quotes'),{...quote,revision:2},201);
  const {orderId}=await decision(finalQuote,'ACCEPTED');
  const accepted=(await read(customer,id)).order;
  assert.equal(accepted.handover,'delivery');
  assert.equal(new Date(accepted.fitting_at).toISOString(),'2099-02-08T04:00:00.000Z');
  assert.match(await page(customer,'/requests/'+id),/Studio uji/);
  const checkout='/api/v1/orders/'+orderId+'/checkout';
  const fitting='/api/v1/orders/'+orderId+'/fitting';
  const change=(action,revision,status=200,detail)=>post(admin,prefix+'/orders/'+orderId+'/transitions',{action,revision,detail},status);
  await post(customer,checkout,{},409);
  assert.match(await submit(customer,checkout,{},409),
    /id="pembayaran"[\s\S]*Harga disepakati[\s\S]*Tagihan tersedia setelah admin menandai jahitan siap/);
  await post(other,fitting,{action:'request',revision:1,note:'Sabtu pagi.'},404);
  assert.equal((await post(customer,fitting,{action:'request',revision:1,note:'Sabtu pagi.'})).fittingState,'REQUESTED');
  await post(admin,fitting,{action:'propose',revision:1,fittingAt:'2099-02-09T09:00',fittingPlace:'Studio uji'},409);
  await post(admin,fitting,{action:'propose',revision:2,fittingAt:'2000-02-09T09:00',fittingPlace:'Studio uji'},422);
  await post(admin,fitting,{action:'propose',revision:2,fittingAt:'2099-02-09T09:00',fittingPlace:'Studio uji'});
  assert.ok((await admin.request(prefix+'?filter=quotes')).queue.some(row=>row.id===id));
  assert.match(await page(customer,'/requests/'+id),/Setujui jadwal fitting/);
  const updated=(await read(customer,id)).order;
  assert.equal(updated.amount,81000);
  assert.equal(new Date(updated.fitting_at).toISOString(),'2099-02-09T02:00:00.000Z');
  await post(customer,fitting,{action:'confirm',revision:3});
  await change('start',4);
  await change('ready',5,409);
  await post(admin,fitting,{action:'done',revision:5});
  await change('ready',6);
  await change('complete',7,409);
  await change('ship',7,409,'Kurir uji · nomor 81');
  await post(other,checkout,{},404);
  const checkoutError=await submit(customer,checkout,{amount:1},503);
  assert.match(checkoutError,/id="pembayaran"[\s\S]*81\.000[\s\S]*role="alert">Tagihan belum bisa dimuat/);
  assert.match(checkoutError,/Muat ulang tagihan/);
  const firstPayment=(await read(customer,id)).order.payment.id;
  await Promise.all([post(customer,checkout,{}),post(customer,checkout,{})]);
  assert.equal(charges.size,1);
  const attempt=(await read(customer,id)).order.payment;
  assert.equal(attempt.id,firstPayment);
  assert.equal(attempt.amount,81000);
  assert.equal(attempt.fee,6075);
  assert.equal(attempt.va_number,'8800000000001');
  const check='/api/v1/payments/'+attempt.id+'/check';
  await post(other,check,{},404);
  const pendingPage=await page(customer,'/requests/'+id);
  assert.match(pendingPage,/transfer uji di simulator Midtrans/);
  assert.match(pendingPage,/check#pembayaran/);
  assert.doesNotMatch(pendingPage,/Buat tagihan pembayaran|Buat tagihan baru/);
  loseStatus=true;
  const checkError=await submit(customer,check,{},503);
  assert.match(checkError,/id="pembayaran"[\s\S]*81\.000[\s\S]*role="alert">Status pembayaran belum bisa diperiksa/);
  assert.deepEqual((await read(customer,id)).order.payment,attempt);
  assert.ok((await admin.request(prefix+'?filter=payment')).queue.some(row=>row.id===id));
  const pendingCheck=await post(admin,check,{action:'confirm'});
  assert.equal(pendingCheck.state,'PENDING');
  charges.get(attempt.id).transaction_status='expire';
  charges.get(attempt.id).status_code='407';
  assert.equal((await post(admin,check,{})).state,'FAILED');
  assert.match(await page(customer,'/requests/'+id),/Tagihan sebelumnya sudah ditutup[\s\S]*Buat tagihan baru/);
  await post(customer,checkout,{});
  const invoice=(await read(customer,id)).order.payment;
  assert.notEqual(invoice.id,attempt.id);
  assert.equal(invoice.amount,attempt.amount);
  assert.equal(invoice.fee,attempt.fee);
  const settled=charges.get(invoice.id);
  settled.status_code='200';
  settled.transaction_status='settlement';
  const callback=async body=>fetch(base+'/webhooks/midtrans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await callback({...settled,signature_key:'0'.repeat(128)})).status,403);
  const signature=createHash('sha512').update(invoice.id+'200'+'81000.00'+payments.key).digest('hex');
  settled.gross_amount='1.00';
  await post(admin,'/api/v1/payments/'+invoice.id+'/check',{},503);
  settled.gross_amount='81000.00';
  for (let n=0;n<2;n++) assert.equal((await callback({...settled,signature_key:signature})).status,200);
  const search = await admin.request(prefix+'?q='+encodeURIComponent('#'+id.slice(0,8).toUpperCase()));
  assert.deepEqual(search.queue.map(row=>row.id),[id]);
  assert.equal(search.counts.handover,1);
  await change('complete',7,409);
  await change('ship',7,200,'Kurir uji · nomor 81');
  await change('ship',8,409,'Kurir uji · nomor 81');
  assert.match(await page(customer,'/requests/'+id),/Dalam pengiriman/);
  await change('complete',8);
  await post(customer,'/api/v1/orders/'+orderId+'/complaint',{note:'Periksa jahitan lengan.'});
  assert.ok((await admin.request(prefix+'?filter=complaints')).queue.some(row=>row.id===id));
  const followed=(await admin.request(prefix+'?filter=follow-up&q='+id.slice(0,8))).queue;
  assert.deepEqual(followed.map(row=>[row.id,row.queue_stage,row.follow_up_priority]),[[id,'history',1]]);
  await post(admin,'/api/v1/orders/'+orderId+'/complaint',{note:'Jadwal perbaikan disepakati.'});
  const completed=await read(customer,id);
  assert.equal(completed.events.filter(e=>e.kind==='PAYMENT_PAID').length,1);
  assert.equal(completed.order.payment.state,'PAID');
  assert.equal(completed.order.resolution,'Jadwal perbaikan disepakati.');
  const performance=(await admin.request(prefix)).performance.find(s=>s.service_id===replacementService.id);
  assert.equal(performance.completed,1);
  assert.ok((await admin.request(prefix+'?filter=history')).queue.some(row=>row.id===id));
  assert.equal(Number(performance.test_revenue),6075);
  assert.equal(Number(performance.revenue),0);
  assert.match(await page(guest,'/penjahit/'+shop.slug),/1 pesanan selesai/i); // shown as the "1 Pesanan Selesai" pill
  const another=await post(customer,'/api/v1/inquiries',{key:randomUUID(),serviceId:service.id,description:'Permintaan kedua sintetis.'},201);
  await post(admin,action(another.id,'dispatch'),{revision:1,state:'UNAVAILABLE'});
  await post(admin,action(another.id,'reassign'),{serviceId:replacementService.id,revision:2},201);
  assert.match(await page(customer,'/requests/'+another.id),/Buka permintaan baru/);
  const ownPerformance=(await tailor.request('/api/v1/provider/workspace')).performance;
  assert.ok(ownPerformance.some(row=>row.service_id===service.id));
  assert.ok(ownPerformance.every(row=>row.service_id!==replacementService.id));
});

test('admin follow-up prioritizes actionable orders across search and pages', async t => {
  const { pool } = await isolatedDatabase(t);
  await migrate(pool);
  const password = randomBytes(18).toString('hex');
  await seed(pool, randomBytes(18).toString('hex'));
  await seedWorkday(pool, seedEmails.customer);
  const readOrders = async () => (await pool.query(`SELECT o.id, o.inquiry_id, o.status, o.revision,
    o.eta::text, o.fitting_state, i.customer_id, i.service_id
    FROM orders o JOIN inquiries i ON i.id=o.inquiry_id ORDER BY o.id`)).rows;
  const original = await readOrders();
  await seed(pool, password);
  await seedWorkday(pool, seedEmails.customer);
  assert.deepEqual(await readOrders(), original);

  const base = await serve(t, pool);
  const [customer, admin, tailor] = await Promise.all(
    [seedEmails.customer, seedEmails.operator, seedEmails.provider].map(async email => {
      const client = browserClient(base);
      await client.request('/api/v1/session');
      await client.request('/api/v1/session', { body: { email, password } });
      return client;
    }));
  const manager = (await pool.query('SELECT id, role FROM users WHERE email=$1', [seedEmails.operator])).rows[0];
  manager.manager = true;
  const complainant = original.find(order => order.status === 'READY');
  const fitting = original.find(order => order.fitting_state === 'SCHEDULED');
  const [late, dueToday] = original.filter(order => order.status === 'IN_PROGRESS');
  const actor = { id: late.customer_id, role: 'customer' };
  const more = [];
  for (let index = 0; index < 24; index += 1) {
    const inquiry = await createInquiry(pool, actor, {
      key: randomUUID(), serviceId: late.service_id, description: 'Pesanan antrean uji ' + (index + 1)
    });
    await updateDispatch(pool, manager, inquiry.id, { state: 'AVAILABLE', revision: 1 });
    const quote = await issueQuote(pool, manager, inquiry.id, {
      amount: 35000, revision: 2, eta: '2099-01-15', terms: 'Ambil di studio.', validHours: 72, handover: 'pickup'
    }, 'disabled');
    const { orderId } = await decideQuote(pool, actor, quote.id, { decision: 'ACCEPTED', version: quote.version });
    more.push({ id: inquiry.id, orderId });
  }
  await pool.query("UPDATE orders SET eta=(now() AT TIME ZONE 'Asia/Jakarta')::date-1 WHERE id=ANY($1)",
    [[late.id, fitting.id, complainant.id, ...more.map(order => order.orderId)]]);
  await pool.query("UPDATE orders SET eta=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id=$1", [dueToday.id]);
  await pool.query("UPDATE inquiries SET created_at='2000-01-02T00:00:00Z' WHERE id=ANY($1)", [more.map(order => order.id)]);
  await pool.query("UPDATE inquiries SET created_at='2000-01-01T00:00:00Z' WHERE id=$1", [late.inquiry_id]);

  const path = '/api/v1/management?filter=follow-up';
  const complaint = '/api/v1/orders/'+complainant.id+'/complaint';
  const appointment = '/api/v1/orders/'+fitting.id+'/fitting';
  const byOrder = id => admin.request(path+'&q='+encodeURIComponent('#'+id.slice(0,8)));
  await customer.request(path, { status: 403 });
  await tailor.request(path, { status: 403 });
  assert.equal((await byOrder(complainant.inquiry_id)).counts['follow-up'], 0);
  assert.equal((await byOrder(dueToday.inquiry_id)).counts['follow-up'], 0);
  await customer.request(complaint, { body: { note: 'Mohon periksa kembali kelim pakaian.' } });
  await customer.request(appointment, { body: { action: 'request', revision: fitting.revision, note: 'Mohon jadwal sore.' } });
  const requested = (await byOrder(fitting.inquiry_id)).queue[0];
  assert.deepEqual([requested.follow_up_priority, requested.fitting_state], [2, 'REQUESTED']);
  await admin.request(appointment, {
    body: { action: 'propose', revision: fitting.revision+1, fittingAt: '2099-01-14T14:00', fittingPlace: 'Studio uji' }
  });
  assert.equal((await byOrder(fitting.inquiry_id)).queue[0].follow_up_priority, 3);
  await pool.query("UPDATE orders SET fitting_at=now()-interval '1 hour' WHERE id=$1", [fitting.id]);
  assert.equal((await byOrder(fitting.inquiry_id)).queue[0].follow_up_priority, 2);
  await admin.request(appointment, {
    body: { action: 'propose', revision: fitting.revision+2, fittingAt: '2099-01-15T14:00', fittingPlace: 'Studio uji' }
  });
  await customer.request(appointment, { body: { action: 'confirm', revision: fitting.revision+3 } });
  await pool.query("UPDATE orders SET fitting_at=now()-interval '1 hour' WHERE id=$1", [fitting.id]);

  const first = await admin.request(path);
  const second = await admin.request(path+'&page=2');
  assert.deepEqual([first.counts['follow-up'], second.counts['follow-up']], [27, 27]);
  assert.deepEqual([first.queue.length, second.queue.length, first.nextPage, second.nextPage], [25, 2, true, false]);
  assert.deepEqual([...first.queue, ...second.queue].map(row => row.id),
    [complainant.inquiry_id, fitting.inquiry_id, late.inquiry_id, ...more.map(order => order.id).sort()]);
  assert.ok(first.queue[0].complaint_at);
  assert.deepEqual(first.queue.slice(0,3).map(row => row.follow_up_priority), [1,2,3]);
  assert.equal((await byOrder(fitting.inquiry_id)).counts['follow-up'], 1);
  const html = await admin.request('/pengelola?filter=follow-up', { raw: true });
  assert.match(html,/Perlu tindak lanjut/);
  assert.match(html,/Keluhan terbuka[\s\S]*Diajukan .* WIB/);
  assert.match(html,/Waktu fitting sudah lewat[\s\S]*Jadwal fitting · .* WIB/);
  assert.match(html,/Lewat perkiraan selesai/);

  await admin.request(complaint, { body: { note: 'Perbaikan sudah dijadwalkan.' } });
  await admin.request(appointment, { body: { action: 'done', revision: fitting.revision+4 } });
  assert.equal((await byOrder(complainant.inquiry_id)).counts['follow-up'], 0);
  assert.equal((await byOrder(fitting.inquiry_id)).queue[0].follow_up_priority, 3);
});

test('RFC-0004 dispatch authorization, queue recovery and signed replies', async t => {
  const {pool} = await isolatedDatabase(t);
  await migrate(pool);
  const password = randomBytes(20).toString('hex');
  await seed(pool,password);
  const groupChat = '120363000000000001@g.us';
  const phone = '6281200000001';
  const directChat = phone+'@c.us';
  const secret = randomBytes(32).toString('hex');
  const settings = dispatchSettings({MARAJUT_ENV:'test',DISPATCH_WHATSAPP_MODE:'mock',
    OPENWA_GROUP_CHAT_ID:groupChat,OPENWA_WEBHOOK_SECRET:secret});
  const sender = mockDispatchGateway();
  const base = await serve(t,pool,{dispatch:settings});
  const [admin,customer,tailor] = [browserClient(base),browserClient(base),browserClient(base)];
  for (const [client,email] of [[admin,seedEmails.operator],[customer,seedEmails.customer],[tailor,seedEmails.provider]]) {
    await client.request('/api/v1/session');
    await client.request('/api/v1/session',{body:{email,password}});
  }
  const {rows:[service]} = await pool.query(`SELECT s.id,s.business_id FROM services s JOIN businesses b ON b.id=s.business_id
    WHERE b.slug='jahit-rina' ORDER BY s.name LIMIT 1`);
  await pool.query('UPDATE businesses SET whatsapp=$2 WHERE id=$1',[service.business_id,phone]);
  const newRequest = async () => (await customer.request('/api/v1/inquiries',{status:201,body:{
    key:randomUUID(),serviceId:service.id,quantity:2,description:'PRIVATE-ORDER-NOTE',fitNotes:'PRIVATE-MEASUREMENTS',desiredDate:'2099-12-10'
  }})).id;
  const requestId = await newRequest();
  const path = id => '/api/v1/management/inquiries/'+id+'/whatsapp-dispatches';
  const permission = '/api/v1/management/partners/'+service.business_id+'/whatsapp-permission';
  const approval = {action:'grant',version:0,evidence:'Synthetic consent fixture',confirmed:'yes'};
  const preview = async (id,channel) => (await admin.request(path(id))).previews.find(item=>item.channel===channel);
  const approve = (id,body,status=202) => admin.request(path(id),{body,status});
  assert.match((await preview(requestId,'partner')).reason,/Persetujuan/);
  await customer.request(path(requestId),{status:403});
  await tailor.request(path(requestId),{status:403});
  await customer.request('/pengelola/whatsapp',{raw:true,status:403});
  await tailor.request('/pengelola/whatsapp',{raw:true,status:403});
  await admin.request('/api/v1/management/whatsapp/group-permission',{body:approval});
  const alias = '73520000000000@lid';
  await admin.request(permission,{body:{...approval,groupMember:'yes',senderAlias:alias}});
  const group = await preview(requestId,'group');
  const partner = await preview(requestId,'partner');
  assert.equal(group.reason,null);
  assert.equal(partner.reason,null);
  assert.match(partner.masked,/0001$/);
  assert.match(partner.text,/2099-12-10/);
  assert.doesNotMatch(group.text+partner.text,/PRIVATE-|6281200000001/);
  const page = await admin.request('/requests/'+requestId,{raw:true});
  assert.match(page,/Konfirmasi kirim/);
  assert.match(page,/Simulasi WhatsApp/);
  await tailor.request(path(requestId),{body:partner,status:403});
  const replies = await Promise.all([approve(requestId,group),approve(requestId,group)]);
  assert.equal(replies[0].id,replies[1].id);
  assert.equal(replies.filter(result=>result.replayed).length,1);
  await approve(requestId,partner,409);
  const direct = await approve(requestId,await preview(requestId,'partner'));
  assert.equal(await processDispatch(pool,settings,sender),true);
  assert.equal(await processDispatch(pool,settings,sender),true);
  assert.equal(await processDispatch(pool,settings,sender),false);

  const callback = async (event,data,{key=randomUUID(),sessionId=settings.sessionId,signature,status=204,timestamp=new Date().toISOString()}={}) => {
    const body = Buffer.from(JSON.stringify({event,data,timestamp,idempotencyKey:key,sessionId}));
    await admin.request('/webhooks/openwa',{body,status,raw:true,headers:{'x-openwa-signature':signature ||
      'sha256='+createHmac('sha256',secret).update(body).digest('hex')}});
  };
  const outbound = {chatId:directChat,messageId:'mock-'+direct.id};
  await callback('message.ack',{...outbound,status:'read'},{signature:'wrong',status:401});
  await callback('message.ack',{...outbound,status:'read'},{sessionId:'other-session'});
  await callback('message.ack',{...outbound,status:'read'},{timestamp:'2000-01-01T00:00:00Z'});
  await callback('message.ack',{...outbound,status:'read'},{key:'read'});
  await callback('message.ack',{...outbound,status:'read'},{key:'read'});
  await callback('message.ack',{...outbound,chatId:alias,status:'delivered'});
  await callback('message.failed',outbound);
  const reply = {id:'reply-1',chatId:alias,from:alias,type:'text',fromMe:false,timestamp:Math.floor(Date.now()/1000),
    body:requestId.slice(0,8)+' <em>tersedia</em>'};
  await callback('message.received',reply);
  await callback('message.received',reply);
  await callback('message.received',{...reply,id:'reply-2',body:'Referensi belum diketahui'});
  await callback('message.received',{...reply,id:'reply-3',from:'6281200000999@c.us',body:'DROP-UNAPPROVED-SENDER'});
  await callback('message.received',{...reply,id:'reply-4',fromMe:true,body:'DROP-OWN-MESSAGE'});
  for (let count=0; await processDispatchInbox(pool); count++) assert.ok(count<10);
  const history = await admin.request(path(requestId));
  assert.equal(history.history.find(job=>job.id===direct.id).delivery_level,3);
  assert.equal(history.history.find(job=>job.id===direct.id).state,'SENT');
  assert.equal(history.replies.length,1);
  const repliedPage = await admin.request('/requests/'+requestId,{raw:true});
  assert.match(repliedPage,/Balasan WhatsApp diterima/);
  assert.match(repliedPage,/href="#balasan-whatsapp">Tinjau balasan/);
  assert.match(repliedPage,/id="balasan-whatsapp"[\s\S]*&lt;em&gt;tersedia&lt;\/em&gt;[\s\S]*value="AVAILABLE">Penjahit bersedia/);
  assert.doesNotMatch(repliedPage,/id="editor-penawaran"/);
  assert.doesNotMatch(await customer.request('/requests/'+requestId,{raw:true}),/Riwayat WhatsApp|tersedia&lt;|Balasan WhatsApp diterima/);
  await admin.request('/api/v1/management/inquiries/'+requestId+'/dispatch',{
    body:{revision:history.previews[0].revision,state:'AVAILABLE'}
  });
  const quotePage = await admin.request('/requests/'+requestId,{raw:true});
  assert.match(quotePage,/id="editor-penawaran"/);
  assert.match(quotePage,/href="#editor-penawaran">Susun penawaran/);
  assert.match(quotePage,/id="editor-penawaran"[\s\S]*Balasan WhatsApp dari Jahit Rina[\s\S]*&lt;em&gt;tersedia&lt;\/em&gt;/);
  assert.doesNotMatch(quotePage,/Balasan WhatsApp diterima/);
  const {rows:[manager]} = await pool.query('SELECT id,role,true AS manager FROM users WHERE email=$1',[seedEmails.operator]);
  const readPanel = () => dispatchPanel(pool,manager,requestId,settings);
  const followups = async () => (await readPanel()).followups;
  const draft = async purpose => (await followups()).find(message=>message.purpose===purpose);
  const sendFollowup = async purpose => {
    const message = await draft(purpose);
    assert.ok(message, purpose);
    assert.equal(message.reason,null);
    assert.equal(message.channel,'partner');
    assert.equal(message.recipient,directChat);
    assert.doesNotMatch(message.text,/PRIVATE-|Studio uji|50000|6281200000001/);
    const saved = await approve(requestId,message);
    assert.equal(await processDispatch(pool,settings,sender),true);
    assert.equal((await readPanel()).history.find(job=>job.id===saved.id).state,'SENT');
    return saved.id;
  };
  const quoteRequest = await draft('quote_request');
  assert.match(quoteRequest.text,/usulan harga, perkiraan selesai, dan jadwal fitting/);
  const reference = requestId.slice(0,8).toUpperCase();
  assert.ok(quoteRequest.text.includes(`KODE: ${reference}\nITEM:`));
  await approve(requestId,{...quoteRequest,channel:'group'},409);
  const requested = await sendFollowup('quote_request');
  assert.match((await draft('quote_request')).reason,/sudah tercatat/);
  const customerPath = '/requests/'+requestId;
  const form = `KODE: ${reference}
ITEM: Permak dua celana | 2 | 20000
ITEM: Penyesuaian pola | 1 | 10000
SELESAI: 2099-12-11
BERLAKU: 36
SERAH_TERIMA: KIRIM
FITTING: 2099-12-10 10:00
LOKASI_FITTING: Studio uji
CATATAN: Jahitan dikirim setelah pembayaran terverifikasi.`;
  const receive = async (id,body,chatId=alias) => {
    await callback('message.received',{...reply,id,body,chatId,author:alias,timestamp:Math.floor(Date.now()/1000)});
    assert.equal(await processDispatchInbox(pool),true);
  };
  await receive('quote-code-only',reference);
  assert.equal((await readPanel()).quoteReply,null);
  await receive('quote-group',form,groupChat);
  assert.equal((await readPanel()).quoteReply,null);
  await receive('quote-wrong-reference',form.replace(reference,reference==='00000000' ? 'FFFFFFFF' : '00000000'));
  assert.equal((await readPanel()).quoteReply,null);
  await receive('quote-invalid',form.replace('20000','20.000'));
  assert.match(await admin.request(customerPath,{raw:true}),/Balasan formulir WhatsApp belum bisa diisikan/);
  assert.equal((await readPanel()).quoteReply.draft,null);
  await receive('quote-no-fitting',form.replace('2099-12-10 10:00','TIDAK').replace('Studio uji','-'));
  const withoutFitting = (await readPanel()).quoteReply.draft;
  assert.equal(withoutFitting.fittingAt,'');
  assert.equal(withoutFitting.fittingPlace,'');
  const instructions = quoteRequest.text.split(`KODE: ${reference}`)[0];
  await receive('quote-complete',instructions+form);
  await receive('quote-regular-message',`Terima kasih ${reference}`);
  const imported = (await readPanel()).quoteReply;
  assert.equal(imported.reply.dispatch_id,requested);
  const fields = imported.draft;
  assert.deepEqual(fields.items,[{name:'Permak dua celana',quantity:2,unitPrice:20000},
    {name:'Penyesuaian pola',quantity:1,unitPrice:10000}]);
  const filledPage = await admin.request(customerPath,{raw:true});
  assert.match(filledPage,/Formulir terisi dari balasan WhatsApp mitra/);
  assert.match(filledPage,/name="itemPrice"[^>]*value="20000"/);
  assert.match(filledPage,/name="itemPrice"[^>]*value="10000"/);
  assert.match(filledPage,/name="eta" value="2099-12-11"/);
  assert.match(filledPage,/name="validHours" value="36"/);
  assert.match(filledPage,/<option value="delivery" selected>/);
  assert.match(filledPage,/name="fittingAt" value="2099-12-10T10:00"/);
  assert.match(filledPage,/name="fittingPlace"[^>]*value="Studio uji"/);
  assert.match(filledPage,/name="terms"[^>]*>Jahitan dikirim setelah pembayaran terverifikasi\./);
  assert.doesNotMatch(await customer.request(customerPath,{raw:true}),/Studio uji|Penyesuaian pola|Formulir terisi/);
  assert.equal((await customer.request('/api/v1/inquiries/'+requestId)).quotes.length,0);
  const post = new URLSearchParams({revision:fields.revision,eta:fields.eta,validHours:fields.validHours,
    handover:fields.handover,fittingAt:fields.fittingAt,fittingPlace:fields.fittingPlace,terms:fields.terms});
  for (const item of fields.items) {
    post.append('itemName',item.name);
    post.append('itemQuantity',item.quantity);
    post.append('itemPrice',item.unitPrice);
  }
  await admin.request('/api/v1/management/inquiries/'+requestId+'/quotes',{status:303,raw:true,
    body:Buffer.from(post.toString()),headers:{'content-type':'application/x-www-form-urlencoded'}});
  const {rows:[outgoingQuote]} = await pool.query('SELECT id,version,amount FROM quotes WHERE inquiry_id=$1',[requestId]);
  assert.equal(outgoingQuote.amount,50000);
  assert.equal(await draft('quote_request'),undefined);
  const sharedPage = await admin.request(customerPath,{raw:true});
  assert.ok(sharedPage.includes('id="quote-share-link">'+base+customerPath));
  assert.match(sharedPage,/Salin tautan penawaran/);
  assert.doesNotMatch(await customer.request(customerPath,{raw:true}),/quote-share-link|&lt;em&gt;tersedia&lt;/);
  const visitor = browserClient(base);
  const redirect = await visitor.request(customerPath,{raw:true,status:302});
  assert.ok(redirect.includes('/login?next='+encodeURIComponent(customerPath)));
  const login = await visitor.request('/login?next='+encodeURIComponent(customerPath),{raw:true});
  assert.ok(login.includes('name="next" value="'+customerPath+'"'));
  await visitor.request('/api/v1/session',{body:{email:seedEmails.otherCustomer,password}});
  await visitor.request(customerPath,{raw:true,status:404});
  const inbox = await admin.request('/pengelola/whatsapp',{raw:true});
  assert.match(inbox,/Referensi belum diketahui/);
  assert.doesNotMatch(inbox,/DROP-UNAPPROVED-SENDER|DROP-OWN-MESSAGE/);

  const accepted = await customer.request('/api/v1/quotes/'+outgoingQuote.id+'/decisions',{
    body:{version:outgoingQuote.version,decision:'ACCEPTED'}
  });
  const orderPath = '/api/v1/management/orders/'+accepted.orderId+'/transitions';
  const order = async () => (await customer.request('/api/v1/inquiries/'+requestId)).order;
  const transition = async (action,detail) => admin.request(orderPath,{body:{action,revision:(await order()).revision,detail}});
  assert.match((await draft('start_work')).text,/Pelanggan telah menyetujui/);
  assert.match((await draft('fitting')).text,/WIB/);
  await sendFollowup('fitting');
  const staleStart = await approve(requestId,await draft('start_work'));
  await transition('start');
  await processDispatch(pool,settings,{...sender,send:async()=>assert.fail('Outdated start message must not be sent')});
  assert.equal((await readPanel()).history.find(job=>job.id===staleStart.id).state,'CANCELLED');
  await sendFollowup('work_update');
  assert.equal(await draft('overdue'),undefined);
  await pool.query("UPDATE orders SET eta=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id=$1",[accepted.orderId]);
  assert.equal(await draft('overdue'),undefined);
  await pool.query("UPDATE orders SET eta=(now() AT TIME ZONE 'Asia/Jakarta')::date-1 WHERE id=$1",[accepted.orderId]);
  assert.match((await draft('overdue')).text,/sudah terlewati/);
  await sendFollowup('overdue');
  assert.equal(await draft('work_update'),undefined);
  await admin.request('/api/v1/orders/'+accepted.orderId+'/fitting',{body:{action:'done',revision:(await order()).revision}});
  await transition('ready');
  assert.equal(await draft('paid'),undefined);
  assert.equal(await draft('handover'),undefined);
  await sendFollowup('await_payment');
  await customer.request('/api/v1/orders/'+accepted.orderId+'/checkout',{body:{}});
  const payment = (await order()).payment;
  await admin.request('/api/v1/payments/'+payment.id+'/check',{body:{action:'confirm'}});
  assert.match((await draft('paid')).text,/simulasi telah ditandai lunas/);
  assert.equal(await draft('await_payment'),undefined);
  await sendFollowup('paid');
  await sendFollowup('handover');
  await transition('ship','Kurir uji dan catatan privat');
  assert.match((await draft('handover')).text,/Pengiriman sudah tercatat/);
  await sendFollowup('handover');
  await transition('complete');
  assert.match((await draft('handover')).text,/Serah terima sudah dicatat selesai/);
  const finishedNotice = await sendFollowup('handover');
  await callback('message.received',{...reply,id:'reply-complete',timestamp:Math.floor(Date.now()/1000),body:requestId.slice(0,8)+' terima kasih'});
  await processDispatchInbox(pool);
  const completedPanel = await readPanel();
  assert.equal(completedPanel.replies.find(item=>item.provider_message_id==='reply-complete').dispatch_id,finishedNotice);
  assert.equal(completedPanel.history.find(job=>job.id===requested).purpose,'quote_request');
  assert.match(await admin.request(customerPath,{raw:true}),/Tindak lanjut WhatsApp mitra/);
  assert.doesNotMatch(await customer.request(customerPath,{raw:true}),/Tindak lanjut WhatsApp mitra|terima kasih/);

  const retryRequest = await newRequest();
  const retry = await approve(retryRequest,await preview(retryRequest,'partner'));
  await processDispatch(pool,settings,{...sender,ready:async()=>({outcome:'retry',reason:'SESSION_OFFLINE'})});
  let job = (await admin.request(path(retryRequest))).history[0];
  assert.equal(job.state,'RETRY_WAIT');
  assert.equal(job.attempts,1);
  await pool.query('UPDATE whatsapp_dispatches SET next_attempt_at=now() WHERE id=$1',[retry.id]);
  await processDispatch(pool,settings,{...sender,send:async intent=>{
    assert.equal(intent.id,retry.id);
    assert.equal(intent.rendered_text,job.rendered_text);
    return {outcome:'review',reason:'GATEWAY_OUTCOME_UNKNOWN'};
  }});
  job = (await admin.request(path(retryRequest))).history[0];
  assert.equal(job.state,'NEEDS_REVIEW');
  await admin.request(path(retryRequest)+'/'+retry.id+'/review',{body:{revision:job.approved_revision+1,disposition:'unsent',reason:'Verified absence in the fixture chat'}});
  assert.equal((await admin.request(path(retryRequest))).history[0].state,'CANCELLED');

  const recoveryRequest = await newRequest();
  const recovery = await approve(recoveryRequest,await preview(recoveryRequest,'group'));
  const staleLease = randomUUID();
  await pool.query(`UPDATE whatsapp_dispatches SET state='SENDING',attempts=1,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1`,[recovery.id,staleLease]);
  const staleJob = (await admin.request(path(recoveryRequest))).history[0];
  await processDispatch(pool,settings,sender);
  assert.equal((await admin.request(path(recoveryRequest))).history[0].attempts,1);
  assert.equal(await finishDispatch(pool,staleJob,{outcome:'failed'}),undefined);
  const uncertainRequest = await newRequest();
  const uncertain = await approve(uncertainRequest,await preview(uncertainRequest,'group'));
  await pool.query(`UPDATE whatsapp_dispatches SET state='SENDING',attempt_started_at=now(),lease_until=now()-interval '1 second' WHERE id=$1`,[uncertain.id]);
  assert.equal(await processDispatch(pool,settings,sender),false);
  assert.equal((await admin.request(path(uncertainRequest))).history[0].state,'NEEDS_REVIEW');

  const revokedRequest = await newRequest();
  await approve(revokedRequest,await preview(revokedRequest,'partner'));
  await admin.request('/api/v1/management/whatsapp/pause',{body:{action:'pause',reason:'Pause synthetic approvals'}});
  assert.equal(await processDispatch(pool,settings,sender),false);
  assert.match((await preview(revokedRequest,'group')).reason,/dijeda/);
  await admin.request(permission,{body:{action:'revoke',version:1,evidence:'Synthetic withdrawal'}});
  await admin.request('/api/v1/management/whatsapp/pause',{body:{action:'resume',reason:'Resume synthetic approvals'}});
  await processDispatch(pool,settings,{...sender,send:async()=>assert.fail('Revoked destination cannot be sent')});
  assert.equal((await admin.request(path(revokedRequest))).history[0].state,'CANCELLED');
});

test('OpenWA adapter uses the scoped session, idempotency header, and conservative outcomes', async t => {
  const recorded = [];
  const sessionId = randomUUID();
  const intent = {id:randomUUID(),recipient:'6281200000001@c.us',rendered_text:'Synthetic dispatch'};
  let response = [201,{messageId:'A1B2'}];
  const server = createServer(async (req,res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    recorded.push({path:req.url,headers:req.headers,body});
    const [status,data] = req.method==='GET' ? [200,{status:'ready'}] : response;
    res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => new Promise(resolve=>server.close(resolve)));
  const gateway = openwaGateway({sessionId,baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'fixture'});
  assert.equal((await gateway.ready()).outcome,'ready');
  assert.deepEqual(await gateway.send(intent),{outcome:'sent',messageId:'A1B2'});
  assert.equal(recorded[1].path,'/api/sessions/'+sessionId+'/messages/send-text');
  assert.equal(recorded[1].headers['idempotency-key'],intent.id);
  assert.equal(recorded[1].headers['x-api-key'],'fixture');
  assert.deepEqual(JSON.parse(recorded[1].body),{chatId:intent.recipient,text:intent.rendered_text});
  response=[429,{code:'SEND_PACING_LIMITED',retryAfterSeconds:60}];
  assert.deepEqual(await gateway.send(intent),{outcome:'retry',reason:'SEND_PACING_LIMITED',retryAfter:60});
  response=[409,{code:'IDEMPOTENCY_KEY_IN_PROGRESS'}];
  assert.equal((await gateway.send(intent)).outcome,'review');
  response=[201,{}];
  assert.equal((await gateway.send(intent)).outcome,'review');
});
