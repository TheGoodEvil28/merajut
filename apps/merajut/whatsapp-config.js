import { isFixtureEnvironment } from './environment.js';
import { id } from './validation.js';

export function dispatchSettings(env = process.env, { worker = false } = {}) {
  const mode = env.DISPATCH_WHATSAPP_MODE || 'disabled';
  if (!['disabled','mock','openwa'].includes(mode)) throw new Error('Invalid DISPATCH_WHATSAPP_MODE.');
  if (mode === 'mock' && !isFixtureEnvironment(env)) throw new Error('Mock dispatch requires a fixture environment.');
  const sessionId = env.OPENWA_SESSION_ID || (mode === 'mock' ? 'merajut-mock' : '');
  const groupChatId = env.OPENWA_GROUP_CHAT_ID || '';
  const webhookSecret = env.OPENWA_WEBHOOK_SECRET || '';
  const baseUrl = (env.OPENWA_BASE_URL || '').replace(/\/$/, '');
  if (groupChatId && !/^\d+(?:-\d+)?@g\.us$/.test(groupChatId)) throw new Error('Invalid OPENWA_GROUP_CHAT_ID.');
  if (mode === 'openwa' && (!id.safeParse(sessionId).success || webhookSecret.length < 32)) {
    throw new Error('OpenWA dispatch requires a session UUID and a webhook secret of at least 32 characters.');
  }
  if (webhookSecret && webhookSecret.length < 32) throw new Error('OPENWA_WEBHOOK_SECRET is too short.');
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('OPENWA_BASE_URL must be a gateway origin.');
    }
  }
  if (worker && mode === 'openwa' && (!baseUrl || !env.OPENWA_API_KEY)) {
    throw new Error('The dispatch worker requires OPENWA_BASE_URL and a scoped OPENWA_API_KEY.');
  }
  return { mode, sessionId, groupChatId, groupLabel:env.OPENWA_GROUP_LABEL || '', webhookSecret, baseUrl, apiKey: env.OPENWA_API_KEY || '',
    callbackMode: mode === 'mock' ? 'mock' : 'openwa' };
}

export function canonicalChat(value) {
  if (typeof value !== 'string') return null;
  const chat = value.replace(/@s\.whatsapp\.net$/, '@c.us');
  return /^\d{6,20}@c\.us$|^\d+(?:-\d+)?@g\.us$|^\d+@lid$/.test(chat) ? chat : null;
}

export function providerMessageId(value, chat) {
  if (typeof value !== 'string' || value.length > 256) return null;
  if (/^[a-z\d-]+$/i.test(value)) return value;
  const serialized = /^(?:true|false)_([^_]+)_([a-z\d-]+)$/i.exec(value);
  return serialized && canonicalChat(serialized[1]) === chat ? serialized[2] : null;
}
