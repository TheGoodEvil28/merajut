import { updateDispatch } from './dispatch.js';
import { one } from './db.js';
import { actOnInquiry, createInquiry } from './inquiries.js';
import { decideQuote, issueQuote } from './quotes.js';
import { transitionOrder } from './orders.js';

const examples = [
  ['jahit-rina', 'inbox', 'alteration', 'Pendekkan dua celana kerja dengan panjang akhir 92 cm.'],
  ['jahit-rina', 'clarify', 'repair', 'Ganti ritsleting jaket jika masih bisa diperbaiki.'],
  ['jahit-rina', 'quotes', 'alteration', 'Permak kelim rok tanpa mengganti kain.'],
  ['jahit-rina', 'work', 'alteration', 'Pendekkan lengan kemeja dan pertahankan kancing.'],
  ['jahit-rina', 'ready', 'repair', 'Ganti ritsleting di sisi celana. Ambil sendiri.'],
  ['ruang-jahit-dewi', 'work', 'repair', 'Perbaiki jahitan yang terbuka pada jaket katun.'],
  ['ruang-jahit-dewi', 'fitting', 'repair', 'Rapikan bagian bahu jaket dan cek ukuran saat fitting.']
];

export async function seedWorkday(pool, email) {
  const customer = await one(pool, "SELECT id, role FROM users WHERE email = $1 AND role = 'customer'", [email]);
  const admin = await one(pool, `SELECT u.id, u.role, true AS manager FROM users u JOIN platform_managers m ON m.user_id=u.id ORDER BY u.id LIMIT 1`);
  for (const [index, [slug, checkpoint, category, description]] of examples.entries()) {
    const key = '70000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    if (await one(pool, 'SELECT id FROM inquiries WHERE customer_id = $1 AND request_key = $2', [customer.id, key])) continue;
    const info = await one(pool, `SELECT s.id AS service_id FROM businesses b
      JOIN services s ON s.business_id = b.id AND s.active
      WHERE b.slug = $1 AND b.published AND s.category = $2 ORDER BY s.name, s.id LIMIT 1`, [slug, category]);
    if (!info) continue;
    const { eta, fittingDay } = await one(pool, `SELECT (day + $1::int)::text AS eta, (day+2)::text AS "fittingDay"
      FROM (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date AS day) calendar`, [index + 1]);
    const fitting = checkpoint==='fitting';
    const request = await createInquiry(pool, customer, {
      key, serviceId: info.service_id, description: 'Contoh demo: ' + description, desiredDate: eta,
      ...(fitting ? {fittingRequested:true,requestedHandover:'delivery'} : {})
    });
    if (!request.created || checkpoint === 'inbox') continue;
    if (checkpoint === 'clarify') {
      await actOnInquiry(pool, admin, request.id, { action: 'clarify', revision: 1,
        detail: 'Mohon konfirmasi ukuran atau bagian pakaian yang perlu diperbaiki.' });
      continue;
    }
    await updateDispatch(pool, admin, request.id, {state:'AVAILABLE', revision:1});
    const quote = await issueQuote(pool, admin, request.id, {
      amount: 30000 + index * 2500, eta,
      terms: fitting ? 'Contoh demo. Pakaian dikirim setelah pembayaran.' : 'Contoh demo. Ambil pakaian setelah pengerjaan selesai.',
      validHours: 72, revision: 2, handover:fitting?'delivery':'pickup',
      ...(fitting ? {fittingAt:fittingDay+'T10:00',fittingPlace:'Studio contoh · Banyumanik'} : {})
    }, 'disabled');
    if (checkpoint === 'quotes') continue;
    const { orderId } = await decideQuote(pool, customer, quote.id, { decision: 'ACCEPTED', version: quote.version });
    if (fitting) continue;
    await transitionOrder(pool, admin, orderId, { action: 'start', revision: 1 }, 'disabled');
    if (checkpoint === 'ready') await transitionOrder(pool, admin, orderId, { action: 'ready', revision: 2 }, 'disabled');
  }
}
