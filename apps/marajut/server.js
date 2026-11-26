import { createApp } from './app.js';
import { createPool } from './db.js';

const port = Number(process.env.PORT ?? 3100);
const host = process.env.BIND_HOST ?? '127.0.0.1';
const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const pool = createPool();
pool.on('error', () => console.error('Idle database connection failed.'));
const app = createApp(pool, { origin });
if (process.env.TRUST_PROXY_HOPS === '1') app.set('trust proxy', 1);
const server = app.listen(port, host, () => console.log(`Marajut listening at ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => pool.end()));
}
