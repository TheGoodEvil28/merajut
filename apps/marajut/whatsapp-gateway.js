import { providerMessageId } from './whatsapp-config.js';

async function gatewayRequest(settings, path, options = {}) {
  const response = await fetch(settings.baseUrl+'/api/sessions/'+encodeURIComponent(settings.sessionId)+path, {
    ...options, redirect:'error', signal:AbortSignal.timeout(15_000),
    headers:{'X-API-Key':settings.apiKey,...options.headers}
  });
  const raw = await response.text();
  if (raw.length > 65_536) throw new Error('GATEWAY_RESPONSE_TOO_LARGE');
  let body;
  try { body = JSON.parse(raw); } catch { body = null; }
  return {status:response.status,body,retryAfter:Number(response.headers.get('retry-after')) || 0};
}

export function openwaGateway(settings) {
  return {
    mode:'openwa',
    async ready() {
      try {
        const result = await gatewayRequest(settings,'');
        if (result.status === 200 && result.body?.status === 'ready') return {outcome:'ready'};
        if ([401,403,404].includes(result.status)) return {outcome:'failed',reason:'GATEWAY_ACCESS_REFUSED'};
        return {outcome:'retry',reason:'SESSION_OFFLINE'};
      } catch { return {outcome:'retry',reason:'GATEWAY_UNREACHABLE'}; }
    },
    async send(job) {
      try {
        const result = await gatewayRequest(settings,'/messages/send-text',{
          method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':job.id},
          body:JSON.stringify({chatId:job.recipient,text:job.rendered_text})
        });
        const code = result.body?.code;
        if (['IDEMPOTENCY_OUTCOME_UNKNOWN','IDEMPOTENCY_KEY_IN_PROGRESS'].includes(code)) {
          return {outcome:'review',reason:code};
        }
        const messageId = providerMessageId(result.body?.messageId,job.recipient);
        if (result.status === 201 && messageId) return {outcome:'sent',messageId};
        if (result.status === 429 && code === 'SEND_PACING_LIMITED') {
          return {outcome:'retry',reason:code,retryAfter:Math.max(result.retryAfter,Number(result.body.retryAfterSeconds) || 0)};
        }
        if ([401,403,404].includes(result.status)) return {outcome:'failed',reason:'GATEWAY_ACCESS_REFUSED'};
        // DTO validation is a known pre-send rejection. Other 400/409/5xx bodies can follow egress.
        if (result.status === 400 && Array.isArray(result.body?.message) && result.body?.error === 'Bad Request') {
          return {outcome:'failed',reason:'INVALID_GATEWAY_REQUEST'};
        }
        return {outcome:'review',reason:'UNCLASSIFIED_GATEWAY_RESPONSE'};
      } catch { return {outcome:'review',reason:'GATEWAY_OUTCOME_UNKNOWN'}; }
    }
  };
}

export function mockDispatchGateway() {
  return {
    mode:'mock',
    async ready() { return {outcome:'ready'}; },
    async send(job) { return {outcome:'sent',messageId:'mock-'+job.id}; }
  };
}
