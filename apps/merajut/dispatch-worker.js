import { setTimeout as delay } from 'node:timers/promises';
import { createPool } from './db.js';
import { dispatchSettings } from './whatsapp-config.js';
import { mockDispatchGateway, openwaGateway } from './whatsapp-gateway.js';
import { processDispatch } from './whatsapp-worker.js';
import { processDispatchInbox } from './whatsapp-inbox.js';
import { messagingMode } from './outbox.js';

const settings = dispatchSettings(process.env,{worker:true});
const mode = messagingMode();
const gateway = settings.mode === 'openwa' ? openwaGateway(settings) : mockDispatchGateway();
const pool = createPool();
pool.on('error',() => console.error('Dispatch database connection failed.'));
let stopping = false;
let nextHealth = 0;
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => { stopping = true; });
console.log('Merajut dispatch worker started.',{mode:settings.mode});
while (!stopping) {
  try {
    if (Date.now() >= nextHealth) {
      const health = settings.mode === 'disabled' ? {outcome:'disabled'} : await gateway.ready();
      await pool.query(`INSERT INTO whatsapp_dispatch_heartbeats(mode,session_id,gateway_state) VALUES($1,$2,$3)
        ON CONFLICT(mode,session_id) DO UPDATE SET gateway_state=EXCLUDED.gateway_state,seen_at=now()`,
        [settings.mode,settings.sessionId,health.outcome]);
      nextHealth = Date.now()+10_000;
    }
    const inboxHandled = await processDispatchInbox(pool,{settings,mode});
    const sent = await processDispatch(pool,settings,gateway);
    if (!inboxHandled && !sent) await delay(1000);
  } catch (error) {
    console.error('Dispatch processing failed.',{code:error.code || 'DISPATCH_ERROR'});
    await delay(2000);
  }
}
await pool.end();
