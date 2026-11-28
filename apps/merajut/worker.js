import { setTimeout as delay } from 'node:timers/promises';
import { isFixtureEnvironment } from './environment.js';
import { createPool } from './db.js';
import { messagingMode, processNext, simulator } from './outbox.js';
import { simulatedInbound } from './inbound-adapter.js';
import { processInbound } from './inbound.js';
import { accountMailer, processAccountMail } from './mail.js';
import { expireQuotes } from './quotes.js';
import { pruneExpiredCredentials } from './maintenance.js';

const mode = messagingMode();
const fault = process.env.SIMULATION_FAULT ?? 'none';
if (!['none', 'first', 'transient', 'permanent'].includes(fault)) throw new Error('Invalid SIMULATION_FAULT.');
if (fault !== 'none' && !isFixtureEnvironment()) {
  throw new Error('Fault injection requires a local or test environment.');
}

{
  const pool = createPool();
  pool.on('error',() => console.error('Idle worker database connection failed.'));
  const adapter = mode === 'simulated' ? simulator(pool, fault) : null;
  const inboundEnabled = Boolean(adapter) && simulatedInbound();
  const sendMail = accountMailer();
  let nextCheck = 0;
  let nextPrune = 0;
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; });

  console.log('Merajut worker started.', { mode });
  while (!stopping) {
    try {
      if (Date.now() >= nextCheck) {
        await expireQuotes(pool);
        await pool.query(`INSERT INTO worker_heartbeats (mode, seen_at) VALUES ($1, now())
          ON CONFLICT (mode) DO UPDATE SET seen_at = EXCLUDED.seen_at`, [mode]);
        nextCheck=Date.now()+3000;
      }
      if (Date.now() >= nextPrune) {
        await pruneExpiredCredentials(pool);
        nextPrune=Date.now()+60_000;
      }
      const inboundHandled = inboundEnabled && await processInbound(pool);
      const outboundHandled = adapter && await processNext(pool, adapter);
      const mailHandled = await processAccountMail(pool, sendMail);
      if (!inboundHandled && !outboundHandled && !mailHandled) await delay(1000);
    } catch {
      console.error('Worker could not process the queue. Retrying.');
      await delay(2000);
    }
  }
  await pool.end();
}
