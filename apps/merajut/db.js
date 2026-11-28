import pg from 'pg';

export function createPool() {
  return new pg.Pool({ connectionTimeoutMillis: 3000, statement_timeout: 10000 });
}

export async function one(db, sql, args) {
  return (await db.query(sql, args)).rows[0];
}

export async function transaction(pool, execute) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await execute(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
