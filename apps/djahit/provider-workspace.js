import { activeBusiness } from './catalog.js';
import { one, transaction } from './db.js';

export const workQueues = {
  inbox: { label: 'Permintaan masuk', hint: 'Tinjau permintaan dan siapkan penawaran.', action: 'Tinjau permintaan' },
  clarify: { label: 'Butuh klarifikasi', hint: 'Menunggu pelanggan melengkapi detail.', action: 'Lihat klarifikasi' },
  quotes: { label: 'Menunggu persetujuan', hint: 'Pelanggan sedang meninjau penawaran.', action: 'Lihat penawaran' },
  work: { label: 'Pekerjaan aktif', hint: 'Urut berdasarkan perkiraan selesai.', action: 'Buka pekerjaan' },
  ready: { label: 'Siap diambil', hint: 'Siapkan serah terima dengan pelanggan.', action: 'Lihat serah terima' },
  handoffs: { label: 'Percakapan WhatsApp', hint: 'Percakapan simulasi yang perlu ditangani.', action: 'Buka percakapan' },
  history: { label: 'Riwayat', hint: 'Permintaan dan pekerjaan yang sudah ditutup.', action: 'Lihat riwayat' }
};

export async function providerWorkspace(pool, actor, query = {}) {
  const view = typeof query.view === 'string' && Object.hasOwn(workQueues, query.view) ? query.view : 'overview';
  const page = typeof query.page === 'string' && /^\d{1,6}$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  const limit = view === 'overview' ? 8 : 20;
  return transaction(pool, async db => {
    const business = await activeBusiness(db, actor, true);
    const result = await one(db, `WITH work_items AS (
      SELECT i.id, 'request' AS kind, s.name AS service, customer.display_name AS customer_name,
        left(i.description, 160) AS brief, i.created_at AS activity_at,
        COALESCE(o.status, CASE WHEN q.expires_at <= now() THEN 'EXPIRED' ELSE i.status END) AS status,
        COALESCE(o.eta, i.desired_date) AS due_date,
        CASE WHEN t.id = i.request_key THEN 'whatsapp' ELSE 'web' END AS source,
        CASE
          WHEN o.status = 'READY' THEN 'ready'
          WHEN o.status IN ('CONFIRMED', 'IN_PROGRESS') THEN 'work'
          WHEN o.id IS NOT NULL OR i.status IN ('CANCELLED', 'DECLINED') THEN 'history'
          WHEN i.status = 'NEEDS_DETAILS' THEN 'clarify'
          WHEN i.status = 'QUOTED' AND q.expires_at > now() THEN 'quotes'
          ELSE 'inbox'
        END AS queue
      FROM inquiries i JOIN services s ON s.id = i.service_id
      JOIN users customer ON customer.id = i.customer_id
      LEFT JOIN orders o ON o.inquiry_id = i.id
      LEFT JOIN quotes q ON q.inquiry_id = i.id AND q.status = 'SENT'
      LEFT JOIN inbound_threads t ON t.inquiry_id = i.id AND t.business_id = i.business_id
      WHERE i.business_id = $1
      UNION ALL
      SELECT t.id, 'conversation', s.name, customer.display_name, NULL::text, t.updated_at, t.state, NULL::date, 'whatsapp', 'handoffs'
      FROM inbound_threads t JOIN inbound_senders sender ON sender.id = t.sender_id
      JOIN users customer ON customer.id = t.customer_id
      JOIN services s ON s.business_id = t.business_id AND s.id = t.service_id
      WHERE t.business_id = $1 AND $5 AND sender.customer_id IS NOT NULL AND t.state IN ('AWAITING_HUMAN', 'HUMAN')
    ), totals AS (
      SELECT queue, count(*)::int AS amount FROM work_items GROUP BY queue
    ), selected AS (
      SELECT *, due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date
        AND queue IN ('inbox', 'work', 'ready') AS overdue,
        CASE WHEN $2 = 'overview' THEN CASE queue
          WHEN 'handoffs' THEN 0 WHEN 'inbox' THEN 1 WHEN 'ready' THEN 2 WHEN 'work' THEN 3 ELSE 4 END ELSE 0 END AS priority
      FROM work_items
      WHERE ($2 = 'overview' AND queue IN ('inbox', 'handoffs', 'ready', 'work')) OR queue = $2
      ORDER BY priority, CASE WHEN queue <> 'history' THEN due_date END ASC NULLS LAST,
        CASE WHEN queue = 'inbox' THEN activity_at END ASC, activity_at DESC, id
      LIMIT $3 OFFSET $4
    )
    SELECT COALESCE((SELECT jsonb_object_agg(queue, amount) FROM totals), '{}'::jsonb) AS counts,
      COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY priority,
        CASE WHEN queue <> 'history' THEN due_date END ASC NULLS LAST,
        CASE WHEN queue = 'inbox' THEN activity_at END ASC, activity_at DESC, id)
        FROM selected), '[]'::jsonb) AS items`,
    [business.id, view, limit, view === 'overview' ? 0 : (page - 1) * limit, query.includeHandoffs === true]);
    return { business, view, page, limit, queues: workQueues, ...result };
  });
}
