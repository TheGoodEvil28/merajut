import { orderReference } from './order-flow.js';
import { quote } from './validation.js';

export function quoteFormLines(reference) {
  return [
    'Salin dan isi format di bawah. Pertahankan nama kolom dan kode pesanan.',
    'Ulangi baris ITEM untuk setiap rincian (maks. 8). Tulis harga satuan sebagai angka rupiah tanpa titik atau koma.',
    'Pilih AMBIL atau KIRIM. Untuk fitting, isi YYYY-MM-DD HH:mm (WIB) dan lokasi. Jika tanpa fitting, biarkan TIDAK dan -.',
    '',
    `KODE: ${reference}`,
    'ITEM: [rincian] | [jumlah] | [harga satuan]',
    'SELESAI: YYYY-MM-DD',
    'BERLAKU: 48',
    'SERAH_TERIMA: [AMBIL/KIRIM]',
    'FITTING: TIDAK',
    'LOKASI_FITTING: -',
    'CATATAN: [rincian pengerjaan dan serah terima]'
  ].join('\n');
}

function quoteFormHeader(body) {
  return body?.match(/^[ \t]*KODE:[ \t]*([a-f0-9]{8})[ \t]*\r?$/im) ?? null;
}

export function quoteFormReference(body) {
  return quoteFormHeader(body)?.[1].toUpperCase() ?? null;
}

function parseQuoteReply(body, revision, today) {
  const header = quoteFormHeader(body);
  if (!header) return null;
  const lines = body.slice(header.index + header[0].length).split(/\r?\n/);
  const values = new Map();
  const items = [];
  const allowed = ['SELESAI','BERLAKU','SERAH_TERIMA','FITTING','LOKASI_FITTING','CATATAN'];
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.trim().match(/^([A-Z_]+):\s*(.*)$/i);
    if (!match) return null;
    const label = match[1].toUpperCase();
    const value = match[2].trim();
    if (label === 'ITEM') {
      const parts = value.split('|').map(part => part.trim());
      if (parts.length !== 3 || parts[0]==='[rincian]') return null;
      const [name, quantity, unitPrice] = parts;
      items.push({name,quantity,unitPrice});
    } else {
      if (!allowed.includes(label) || values.has(label)) return null;
      values.set(label,value);
    }
  }
  const handover = { AMBIL:'pickup', KIRIM:'delivery' }[values.get('SERAH_TERIMA')?.toUpperCase()];
  const fitting = values.get('FITTING')?.toUpperCase();
  const place = values.get('LOKASI_FITTING');
  const terms = values.get('CATATAN');
  const fittingAt = fitting === 'TIDAK' ? '' : fitting?.replace(' ','T');
  const fittingPlace = place === '-' ? '' : place;
  if (!handover || !fitting || !place || terms==='[rincian pengerjaan dan serah terima]' ||
      Boolean(fittingAt) !== Boolean(fittingPlace)) return null;
  const parsed = quote.safeParse({items,handover,fittingAt,fittingPlace,revision,
    eta:values.get('SELESAI'),validHours:values.get('BERLAKU'),terms});
  if (!parsed.success) return null;
  const draft = parsed.data;
  const total = draft.items.reduce((sum,item) => sum + item.quantity * item.unitPrice,0);
  if (total < 1 || total > 100000000 || draft.eta < today) return null;
  if (fittingAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fittingAt) || fittingPlace.length < 3 ||
      fittingAt.slice(0,10) > draft.eta || !(new Date(fittingAt+'+07:00') > new Date()))) return null;
  return {...draft,fittingPlace};
}

export function quoteReplyDraft(inquiry, preview, history, replies, settings, today) {
  if (settings.mode === 'disabled' || !preview?.recipient || !preview.permission || preview.permission.revoked_at ||
      preview.permission.chat_id !== preview.recipient) return null;
  const sourceIds = new Set(history.filter(job => job.purpose==='quote_request' && job.channel==='partner' &&
    job.business_id===inquiry.business_id && job.context_key===preview.contextKey && job.recipient===preview.recipient &&
    job.permission_id===preview.permission.id && job.mode===settings.mode && job.session_id===settings.sessionId).map(job => job.id));
  const reference = orderReference(inquiry.id);
  const reply = replies.findLast(item => item.state==='LINKED' && item.business_id===inquiry.business_id &&
    item.chat_id===preview.recipient && item.sender_chat===preview.recipient && sourceIds.has(item.dispatch_id) &&
    quoteFormReference(item.body)===reference);
  return reply ? {reply,draft:parseQuoteReply(reply.body,inquiry.revision,today)} : null;
}
