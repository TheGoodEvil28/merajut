import { pathToFileURL } from 'node:url';
import { createPool, one, transaction } from './db.js';
import { isFixtureEnvironment } from './environment.js';
import { hashPassword } from './identity.js';
import { seedWorkday } from './demo-workday.js';

export const seedEmails = {
  customer: 'customer@merajut.test',
  otherCustomer: 'customer2@merajut.test',
  provider: 'tailor@merajut.test',
  otherProvider: 'tailor2@merajut.test',
  operator: 'operator@merajut.test'
};

export async function seed(pool, password) {
  if (!isFixtureEnvironment()) {
    throw new Error('Fixture seed requires MERAJUT_ENV=local or test.');
  }
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error('Set DEMO_PASSWORD to a local secret of 12 to 128 characters.');
  }
  const passwordDigest = await hashPassword(password);
  await transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(129042007)');
    const accounts = {};
    for (const [key, email] of Object.entries(seedEmails)) {
      const role = key === 'operator' ? 'operator' : key.toLowerCase().includes('customer') ? 'customer' : 'provider';
      const names = { customer: 'Ayu', otherCustomer: 'Bima', provider: 'Rina', otherProvider: 'Dewi', operator: 'Admin Merajut' };
      accounts[key] = (await one(db, `INSERT INTO users (email, display_name, password_digest, role, verified_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (email) DO UPDATE SET password_digest = EXCLUDED.password_digest RETURNING id`,
      [email, names[key], passwordDigest, role])).id;
    }
    await grantDemoManager(db);
    const businesses = [
      ['jahit-rina', 'Jahit Rina', 'Semarang Tengah', 'Permak dan perbaikan pakaian sehari-hari.',
        accounts.provider, [['Permak panjang pakaian', 'Pendekkan celana, rok, atau lengan.', 25000, 'alteration',
          'Sebutkan bagian yang ingin dipendekkan dan panjang yang diinginkan.'],
          ['Ganti ritsleting', 'Ganti ritsleting pakaian yang rusak.', 35000, 'repair',
            'Sebutkan jenis pakaian, letak, dan kondisi ritsleting.']]],
      ['ruang-jahit-dewi', 'Ruang Jahit Dewi', 'Banyumanik', 'Perbaikan kecil agar baju favorit tetap terpakai.',
        accounts.otherProvider, [['Perbaikan jahitan lepas', 'Perbaiki jahitan yang terbuka dan perkuat sambungan.', 20000, 'repair',
          'Sebutkan letak jahitan yang terbuka dan panjang bagian yang perlu diperbaiki.']]]
    ];
    for (const [slug, name, area, description, operator, services] of businesses) {
      const inserted = await one(db, `INSERT INTO businesses (slug, name, area, description, published)
        VALUES ($1, $2, $3, $4, true) ON CONFLICT (slug) DO NOTHING
        RETURNING id`, [slug, name, area, description]);
      const business = inserted ?? await one(db, 'SELECT id FROM businesses WHERE slug = $1', [slug]);
      await db.query(`INSERT INTO provider_memberships (business_id, user_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING`, [business.id, operator]);
      if (!inserted) continue;
      for (const [serviceName, summary, price, category, hint] of services) {
        await db.query(`INSERT INTO services (business_id, name, description, price_hint, category, intake_hint)
          VALUES ($1, $2, $3, $4, $5, $6)`,
        [business.id, serviceName, summary, price, category, hint]);
      }
    }
  });
}

async function grantDemoManager(db) {
  await db.query(`INSERT INTO platform_managers(user_id) SELECT id FROM users
    WHERE email=$1 AND role='operator' ON CONFLICT DO NOTHING`,[seedEmails.operator]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  try {
    if (process.argv.includes('--operator-access')) {
      if ((process.env.MERAJUT_ENV ?? process.env.MARAJUT_ENV) !== 'local') throw new Error('Demo operator access requires the local environment.');
      await grantDemoManager(pool);
    } else await seed(pool, process.env.DEMO_PASSWORD);
    if (process.argv.includes('--workday')) await seedWorkday(pool, seedEmails.customer);
    console.log('Synthetic fixture accounts and services are ready.');
  } finally {
    await pool.end();
  }
}
