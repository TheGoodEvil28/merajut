import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPool, one, transaction } from './db.js';

const migrations = new URL('../../db/migrations/', import.meta.url);
export const schemaVersion = '013_merajut_brand.sql';

// Both versions rename the same demo accounts. Keep successful earlier migration records valid.
const demoAccountMigration = {
  name: '008_marajut_demo_accounts.sql',
  originalChecksum: 'c4209a1b87873f4638cb7079aca006ff40d83eaa443735c8e044937de596250c',
  currentChecksum: '8056540eae143355d23ea07c1622dfaf5ebdb1e26a0f1b803933d09d0b33d50e',
};

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
      if (existing) {
        const isOriginalDemoMigration = name === demoAccountMigration.name
          && existing.checksum === demoAccountMigration.originalChecksum
          && checksum === demoAccountMigration.currentChecksum;
        if (existing.checksum !== checksum && !isOriginalDemoMigration) {
          throw new Error(`Migration checksum changed for ${name}`);
        }
        continue;
      }
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
