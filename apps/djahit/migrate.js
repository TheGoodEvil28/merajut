import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPool, one, transaction } from './db.js';

const migrations = new URL('../../db/migrations/', import.meta.url);
export const schemaVersion = '005_pilot_workflows.sql';

export async function migrate(pool) {
  const files = (await readdir(migrations)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  if (files.at(-1) !== schemaVersion) throw new Error('Update the expected schema version.');
  await transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(129042006)');
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of files) {
      const sql = await readFile(new URL(name, migrations), 'utf8');
      const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
      const existing = await one(db, 'SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (existing?.checksum !== undefined && existing.checksum !== checksum) {
        throw new Error(`Migration checksum changed for ${name}`);
      }
      if (existing) continue;
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      console.log(`Applied ${name}`);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
