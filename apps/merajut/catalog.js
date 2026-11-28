import { one, transaction } from './db.js';
import { found } from './errors.js';

export async function publicCatalog(pool, { search = '', category = '', preferred = null } = {}) {
  return (await pool.query(`SELECT b.name AS business, b.slug, b.area, b.description AS about,
    s.id, s.name, s.description, s.price_hint, s.category, s.lead_days, s.intake_hint
    FROM businesses b JOIN services s ON s.business_id = b.id
    WHERE b.published AND s.active AND ($1 = '' OR strpos(lower(
      concat_ws(' ', s.name, s.description, b.name, b.area, b.specialty)), lower($1)) > 0)
      AND ($2 = '' OR s.category = $2)
    ORDER BY (s.id = $3) DESC NULLS LAST, b.slug, s.name, s.id LIMIT 100`, [search, category, preferred])).rows;
}

export async function activeBusiness(db, actor, lock = false) {
  const sql = `SELECT b.id, b.slug, b.name, b.area, b.description, b.published,
    EXISTS (SELECT 1 FROM business_photos WHERE business_id=b.id) AS has_photo FROM provider_memberships m
    JOIN businesses b ON b.id = m.business_id WHERE m.user_id = $1 AND m.active`;
  if (lock) {
    const active = found(await one(db,sql,[actor.id]));
    await db.query('SELECT id FROM businesses WHERE id=$1 FOR NO KEY UPDATE',[active.id]);
    return found(await one(db,sql+' AND b.id=$2 FOR SHARE OF m',[actor.id,active.id]));
  }
  return found(await one(db,sql,[actor.id]));
}

export async function publicProvider(pool, slug) {
  const profile = found(await one(pool, `SELECT slug, name, area, description, specialty,
    EXISTS (SELECT 1 FROM business_photos WHERE business_id=b.id) AS has_photo,
    (SELECT count(*)::int FROM orders o WHERE o.business_id=b.id AND o.status='COMPLETED') AS completed_orders,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name,
      'description', s.description, 'price_hint', s.price_hint, 'category', s.category,
      'lead_days', s.lead_days, 'intake_hint', s.intake_hint) ORDER BY s.name, s.id)
      FROM services s WHERE s.business_id = b.id AND s.active), '[]'::jsonb) AS services
    FROM businesses b WHERE b.slug = $1 AND b.published`, [slug]));
  const { services, ...publicFields } = profile;
  return { profile: publicFields, services };
}

export async function updateProfile(pool, actor, input) {
  return transaction(pool, async db => {
    const business = await activeBusiness(db, actor, true);
    return one(db, `UPDATE businesses SET name = $2, area = $3, description = $4
      WHERE id = $1 RETURNING slug, name, area, description, published`,
    [business.id, input.name, input.area, input.description]);
  });
}

export async function workspaceServices(pool, actor) {
  const business = await activeBusiness(pool, actor);
  const services = (await pool.query(`SELECT id, name, description, price_hint, active, category, lead_days, intake_hint FROM services
    WHERE business_id = $1 ORDER BY active DESC, name, id`, [business.id])).rows;
  return { business, services };
}

export async function saveService(pool, actor, serviceId, input, managedBusinessId = null) {
  return transaction(pool, async db => {
    const business = actor.manager && managedBusinessId
      ? found(await one(db,'SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[managedBusinessId]))
      : await activeBusiness(db, actor, true);
    const fields = [business.id, input.name, input.description, input.price, input.active];
    if (!serviceId) {
      return one(db, `INSERT INTO services (business_id, name, description, price_hint, active, category, lead_days, intake_hint)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [...fields, input.category ?? 'other', input.leadDays ?? null, input.intakeHint ?? null]);
    }
    const current = found(await one(db, `SELECT category, lead_days, intake_hint FROM services
      WHERE business_id = $1 AND id = $2 FOR UPDATE`, [business.id, serviceId]));
    return one(db, `UPDATE services SET name = $2, description = $3, price_hint = $4, active = $5,
      category = $6, lead_days = $7, intake_hint = $8 WHERE business_id = $1 AND id = $9 RETURNING id`,
    [...fields, input.category ?? current.category,
      input.leadDays === undefined ? current.lead_days : input.leadDays,
      input.intakeHint === undefined ? current.intake_hint : input.intakeHint, serviceId]);
  });
}
