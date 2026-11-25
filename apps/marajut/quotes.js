import { one, transaction } from './db.js';
import { AppError, conflict, found } from './errors.js';
import { event, lockInquiry } from './inquiries.js';
import { enqueue } from './outbox.js';

export async function issueQuote(pool, actor, id, input, mode) {
  const amount = input.items
    ? input.items.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0)
    : input.amount;
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000000 ||
    (input.amount !== undefined && input.amount !== amount)) {
    throw new AppError(422, 'INVALID_QUOTE_TOTAL', 'The itemized total must match the quote and stay within the price limit.');
  }
  return transaction(pool, async db => {
    const inquiry = await lockInquiry(db, actor, id);
    if (inquiry.dispatch_state && (inquiry.dispatch_state !== 'AVAILABLE' || !input.handover)) {
      throw new AppError(409, 'WORK_UNAVAILABLE', 'Konfirmasi kesediaan mitra dan pilih cara serah terima.');
    }
    if (Boolean(input.fittingAt) !== Boolean(input.fittingPlace) ||
        (input.fittingAt && (input.fittingAt.slice(0,10) > input.eta || !(new Date(input.fittingAt + '+07:00') > new Date())))) {
      throw new AppError(422, 'WORK_UNAVAILABLE', 'Pilih waktu fitting mendatang paling lambat pada tanggal selesai dan isi tempatnya.');
    }
    if (!['NEW', 'UNDER_REVIEW', 'QUOTED','EXPIRED'].includes(inquiry.status) || inquiry.revision !== input.revision) {
      conflict('Refresh the request before issuing a quote.');
    }
    const { today } = await one(db, `SELECT (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date::text AS today`);
    if (input.eta < today) throw new AppError(422, 'INVALID_ETA', 'Choose an estimated completion date from today onward.');
    await db.query(`UPDATE quotes SET status = CASE WHEN expires_at <= clock_timestamp() THEN 'EXPIRED'
      ELSE 'SUPERSEDED' END WHERE inquiry_id = $1 AND status = 'SENT'`, [id]);
    const quote = await one(db, `INSERT INTO quotes (business_id, inquiry_id, version, amount, eta, terms, expires_at, issued_by, line_items, handover, fitting_at, fitting_place)
      SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4, $5,
        LEAST(clock_timestamp() + $6 * interval '1 hour', $10::timestamptz), $7, $8, $9, $10, $11
      FROM quotes WHERE inquiry_id = $2 RETURNING id, version, amount`,
    [inquiry.business_id, id, amount, input.eta, input.terms, input.validHours, actor.id,
      input.items ? JSON.stringify(input.items) : null, input.handover ?? null, input.fittingAt ? input.fittingAt + '+07:00' : null, input.fittingPlace || null]);
    await db.query("UPDATE inquiries SET status = 'QUOTED', revision = revision + 1 WHERE id = $1", [id]);
    const issued = await event(db, id, actor, 'QUOTE_ISSUED', inquiry.status, 'QUOTED', `Penawaran versi ${quote.version}`);
    await enqueue(db, issued.id, inquiry.customer_id, 'QUOTE_READY', mode);
    return { ...quote, inquiryId: id };
  });
}

export async function decideQuote(pool, actor, quoteId, input, feeBps = 500) {
  return transaction(pool, async db => {
    const candidate = found(await one(db, `SELECT q.inquiry_id FROM quotes q JOIN inquiries i ON i.id = q.inquiry_id
      WHERE q.id = $1 AND i.customer_id = $2`, [quoteId, actor.id]));
    const inquiry = await lockInquiry(db, actor, candidate.inquiry_id);
    const quote = await one(db, `SELECT *, eta::text AS eta, expires_at > clock_timestamp() AS live FROM quotes WHERE id = $1`, [quoteId]);
    if (quote.version !== input.version) conflict('The quote version does not match.');
    const prior = await one(db, 'SELECT decision FROM quote_decisions WHERE quote_id = $1', [quoteId]);
    if (prior?.decision === input.decision) {
      const order = await one(db, 'SELECT id FROM orders WHERE quote_id = $1', [quoteId]);
      return { inquiryId: inquiry.id, orderId: order?.id ?? null, replay: true };
    }
    if (prior || inquiry.status !== 'QUOTED' || quote.status !== 'SENT' || !quote.live) {
      conflict('This quote is no longer available. Review the current version.');
    }
    await db.query('INSERT INTO quote_decisions (quote_id, customer_id, decision) VALUES ($1, $2, $3)',
      [quoteId, actor.id, input.decision]);
    await db.query('UPDATE quotes SET status = $2 WHERE id = $1', [quoteId, input.decision]);
    const accepted = input.decision === 'ACCEPTED';
    const status = accepted ? 'ACCEPTED' : 'UNDER_REVIEW';
    await db.query('UPDATE inquiries SET status = $2, revision = revision + 1 WHERE id = $1', [inquiry.id, status]);
    await event(db, inquiry.id, actor, `QUOTE_${input.decision}`, 'QUOTED', status, `Penawaran versi ${quote.version}`);
    if (!accepted) return { inquiryId: inquiry.id, orderId: null, replay: false };
    const managed = Boolean(inquiry.dispatch_state);
    const order = await one(db, `INSERT INTO orders
      (inquiry_id, business_id, quote_id, amount, currency, eta, terms, fee_bps, fitting_at, fitting_place, fitting_state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [inquiry.id, inquiry.business_id, quoteId, quote.amount, quote.currency, quote.eta, quote.terms,
      managed ? feeBps : null, managed ? quote.fitting_at : null, managed ? quote.fitting_place : null,
      managed && quote.fitting_at ? 'SCHEDULED' : null]);
    await event(db, inquiry.id, actor, 'ORDER_CONFIRMED', null, 'CONFIRMED', null, order.id);
    return { inquiryId: inquiry.id, orderId: order.id, replay: false };
  });
}

export function expireQuotes(pool) {
  return transaction(pool, async db => {
    const due = await db.query(`SELECT i.id FROM inquiries i JOIN quotes q ON q.inquiry_id=i.id
      WHERE i.status='QUOTED' AND q.status='SENT' AND q.expires_at<=clock_timestamp()
      ORDER BY q.expires_at LIMIT 50 FOR UPDATE OF i SKIP LOCKED`);
    for (const inquiry of due.rows) {
      const quote = await one(db,`UPDATE quotes SET status='EXPIRED' WHERE inquiry_id=$1 AND status='SENT'
        AND expires_at<=clock_timestamp() RETURNING version`,[inquiry.id]);
      if (!quote) continue;
      await db.query("UPDATE inquiries SET status='EXPIRED',revision=revision+1 WHERE id=$1",[inquiry.id]);
      await event(db,inquiry.id,null,'QUOTE_EXPIRED','QUOTED','EXPIRED','Penawaran v'+quote.version);
    }
    return due.rowCount;
  });
}
