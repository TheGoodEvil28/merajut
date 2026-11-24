import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import sharp from 'sharp';
import { createApp } from '../apps/djahit/app.js';
import { migrate } from '../apps/djahit/migrate.js';
import { seed, seedEmails } from '../apps/djahit/seed.js';
import { enqueue, messagingMode, processNext, simulator } from '../apps/djahit/outbox.js';
import { normalizeSimulation } from '../apps/djahit/inbound-adapter.js';
import { processInbound } from '../apps/djahit/inbound.js';
import { processAccountMail } from '../apps/djahit/mail.js';
import { expireQuotes } from '../apps/djahit/quotes.js';
import { retentionSweep } from '../apps/djahit/maintenance.js';

function browserClient(base) {
  const cookies = new Map();
  return {
    async request(path, { body, status = 200, headers = {}, raw = false } = {}) {
      if (!raw) headers.accept = 'application/json';
      headers.cookie = [...cookies].map(([name, value]) => name + '=' + value).join('; ');
      if (body) {
        headers['content-type'] ??= 'application/json';
        headers.origin ??= base;
        headers['x-csrf-token'] ??= cookies.get('djahit_csrf') ?? '';
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

test('Express and PostgreSQL workflow', async t => {
  assert.equal(process.env.DJAHIT_ENV, 'test', 'Run in the isolated test environment documented in README.');
  const schema = 'test_' + randomBytes(12).toString('hex');
  const administration = new pg.Pool();
  await administration.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ options: '-c search_path=' + schema });
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
    await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
    await administration.end();
  });

  // Reserve an ephemeral port, then install the app with the same canonical Origin.
  const { createServer } = await import('node:http');
  server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const fixtureSecret = randomBytes(24).toString('hex');
  process.env.SIMULATION_WEBHOOK_SECRET = fixtureSecret;
  server.on('request', createApp(pool, { origin: base, mode: 'simulated' }));
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
    assert.match(home, /Coba chat WhatsApp \(simulasi\)/);
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
    assert.doesNotMatch(publicPage, /@djahit\.test/);
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
    const email='guest-pilot@djahit.test';
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
    assert.deepEqual(await outsider.request('/akun/lupa',{body:{email:'absent@djahit.test'},status:202}),recovery);
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
    const email='new-tailor@djahit.test';
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
