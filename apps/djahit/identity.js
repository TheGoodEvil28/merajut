import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one } from './db.js';
import { AppError } from './errors.js';

const derive = promisify(scrypt);
const saltBytes = 16;
const digestBytes = 64;
const sessionHours = 8;
const tokenPattern = /^[a-f0-9]{64}$/;

export function token() {
  return randomBytes(32).toString('hex');
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashPassword(password) {
  const salt = randomBytes(saltBytes);
  const hash = await derive(password, salt, digestBytes);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(stored, password) {
  const [salt, expected] = stored
    ? stored.split(':').map(value => Buffer.from(value, 'hex'))
    : [Buffer.alloc(saltBytes), Buffer.alloc(digestBytes)];
  const actual = await derive(password, salt, digestBytes);
  return timingSafeEqual(expected, actual) && Boolean(stored);
}

export async function authenticate(db, email, password) {
  const user = await one(db, `SELECT u.id,u.password_digest FROM users u
    WHERE u.email=$1 AND u.verified_at<=now() AND (u.role<>'provider' OR EXISTS (
      SELECT 1 FROM provider_memberships m WHERE m.user_id=u.id AND m.active)) FOR SHARE OF u`,[email]);
  if (!await verifyPassword(user?.password_digest, password)) {
    throw new AppError(401, 'LOGIN_FAILED', 'Check your email and password.');
  }
  return user.id;
}

export async function startSession(pool, userId) {
  const raw = token();
  await pool.query(`INSERT INTO sessions (token_digest, user_id, expires_at)
    VALUES ($1, $2, now() + $3 * interval '1 hour')`, [digest(raw), userId, sessionHours]);
  return raw;
}

export async function sessionUser(pool, raw) {
  if (!tokenPattern.test(raw ?? '')) return null;
  const key = digest(raw);
  const user = await one(pool, `SELECT u.id, u.display_name, u.role,
      (u.role='operator' AND EXISTS(SELECT 1 FROM platform_managers p WHERE p.user_id=u.id)) AS manager
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_digest = $1 AND s.expires_at > now()
      AND s.last_seen_at > now() - interval '60 minutes' AND u.verified_at <= now()
      AND (u.role<>'provider' OR EXISTS (SELECT 1 FROM provider_memberships m WHERE m.user_id=u.id AND m.active))`, [key]);
  if (user) {
    await pool.query(`UPDATE sessions SET last_seen_at = now()
      WHERE token_digest = $1 AND last_seen_at < now() - interval '5 minutes'`, [key]);
  }
  return user ?? null;
}

export async function endSession(pool, raw) {
  if (tokenPattern.test(raw ?? '')) {
    await pool.query('DELETE FROM sessions WHERE token_digest = $1', [digest(raw)]);
  }
}
