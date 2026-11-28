import { orderReference } from './order-flow.js';
import { quote } from './validation.js';

const labels = {
  REF:'Referensi',
  TERIMA:'Bersedia menerima pesanan',
  HARGA:'Harga tetap (Rp)',
  CATATAN_BIAYA:'Catatan biaya tambahan',
  SELESAI:'Perkiraan selesai (tanggal)',
  DURASI_HARI:'Estimasi durasi (hari)',
  FITTING:'Perlu fitting',
  JADWAL_FITTING:'Jadwal fitting (WIB)',
  LOKASI_FITTING:'Lokasi fitting',
  CATATAN_FITTING:'Catatan fitting',
  SERAH_TERIMA:'Cara serah terima',
  CATATAN:'Catatan tambahan',
  STATUS:'Status penawaran'
};
const aliases = new Map(Object.entries(labels).flatMap(([key,label]) => [[key,key],[label.toUpperCase(),key]]));
for (const [label,key] of [['KODE','REF'],['ITEM','ITEM'],['BERLAKU','BERLAKU']]) aliases.set(label,key);
const exampleHeading = 'Contoh pengisian';

export function partnerQuoteForm(inquiry, fields, followup = false) {
  const reference = orderReference(inquiry.id);
  return [
    '🧵 *MARAJUT — KONFIRMASI PERMINTAAN JAHIT*',
    '',
    `📋 *${labels.REF}:* ${reference}`,
    `🪡 *Layanan:* ${fields.service}`,
    `👕 *Jumlah:* ${inquiry.quantity ?? 1} pakaian`,
    ...(fields.desired_date ? [`Target pelanggan: ${fields.desired_date}`] : []),
    '',
    'Isi bagian 1–5 setelah titik dua, lalu balas di chat ini dengan referensi di atas. Jika tidak bersedia, cukup isi TIDAK pada bagian 1.',
    '',
    '*1. KESEDIAAN PENGERJAAN*',
    `${labels.TERIMA}: ${followup ? 'YA' : 'YA / TIDAK'}`,
    '',
    '*2. PENAWARAN HARGA*',
    `${labels.HARGA}:`,
    `${labels.CATATAN_BIAYA}:`,
    '',
    '*3. ESTIMASI PENGERJAAN*',
    `${labels.SELESAI}:`,
    `${labels.DURASI_HARI}:`,
    '',
    '*4. KEBUTUHAN FITTING*',
    `${labels.FITTING}: YA / TIDAK`,
    `${labels.JADWAL_FITTING}:`,
    `${labels.LOKASI_FITTING}:`,
    `${labels.CATATAN_FITTING}:`,
    '',
    '*5. SERAH TERIMA DAN CATATAN*',
    `${labels.SERAH_TERIMA}: AMBIL / KIRIM`,
    `${labels.CATATAN}:`,
    '',
    `*${exampleHeading}*`,
    'Gunakan contoh ini sebagai acuan. Ganti harga total, jadwal, dan catatan sesuai pesanan.',
    `> ${labels.TERIMA}: YA`,
    `> ${labels.HARGA}: Rp50.000`,
    `> ${labels.CATATAN_BIAYA}: Tidak ada`,
    `> ${labels.SELESAI}: 15/01/2027`,
    `> ${labels.DURASI_HARI}: 4`,
    `> ${labels.FITTING}: YA`,
    `> ${labels.JADWAL_FITTING}: 12/01/2027 14:00`,
    `> ${labels.LOKASI_FITTING}: Studio jahit`,
    `> ${labels.CATATAN_FITTING}: Datang untuk pengukuran`,
    `> ${labels.SERAH_TERIMA}: AMBIL`,
    `> ${labels.CATATAN}: Ambil setelah pembayaran lunas`
  ].join('\n');
}

function formEntries(body) {
  const entries = [];
  for (const line of (body ?? '').split(/\r?\n/)) {
    if (line.replace(/\*/g,'').trim().toLowerCase() === exampleHeading.toLowerCase()) break;
    const match = line.match(/^[^\p{L}]*([\p{L}][^:]*):\*?[ \t]*(.*)$/u);
    if (!match) continue;
    const field = aliases.get(match[1].replace(/\*/g,'').trim().toUpperCase());
    if (field) entries.push([field,match[2].trim()]);
  }
  return entries;
}

function formReference(entries) {
  const refs = entries.filter(([field]) => field === 'REF');
  return refs.length === 1 && /^[A-F0-9]{8}$/i.test(refs[0][1]) ? refs[0][1].toUpperCase() : null;
}

export function quoteFormReference(body) {
  return formReference(formEntries(body));
}

function isoDate(value = '') {
  const parts = value.match(/^(\d{2})([/-])(\d{2})\2(\d{4})$/);
  return parts ? `${parts[4]}-${parts[3]}-${parts[1]}` : value;
}

function parseQuoteReply(entries, inquiry, service, today) {
  const values = new Map();
  const items = [];
  for (const [field,value] of entries) {
    if (field === 'ITEM') {
      const parts = value.split('|').map(part => part.trim());
      if (parts.length !== 3 || parts[0] === '[rincian]') return null;
      const [name,quantity,unitPrice] = parts;
      items.push({name,quantity,unitPrice});
    } else {
      if (values.has(field)) return null;
      values.set(field,value);
    }
  }
  const choice = field => values.get(field)?.toUpperCase();
  if (choice('TERIMA') === 'TIDAK' || choice('STATUS') === 'TOLAK') return {declined:true};
  const legacy = items.length > 0 && !values.has('HARGA') && !values.has('TERIMA') && !values.has('STATUS');
  const handoverChoice = choice('SERAH_TERIMA');
  const handover = { AMBIL:'pickup', KIRIM:'delivery' }[handoverChoice];
  if (handoverChoice && !handover) return null;

  let terms = values.get('CATATAN');
  const fitting = choice('FITTING');
  let fittingAt = '';
  let fittingPlace = values.get('LOKASI_FITTING') || '';
  if (fittingPlace === '-') fittingPlace = '';
  if (legacy) {
    if (!handover || !fitting || !values.get('LOKASI_FITTING') ||
        terms === '[rincian pengerjaan dan serah terima]') return null;
    fittingAt = fitting === 'TIDAK' ? '' : fitting.replace(' ','T');
    if (Boolean(fittingAt) !== Boolean(fittingPlace)) return null;
  } else {
    const status = choice('STATUS');
    if (choice('TERIMA') !== 'YA' || (status && status !== 'AJUKAN') || !['YA','TIDAK'].includes(fitting) || items.length) return null;
    const price = values.get('HARGA')?.match(/^(?:Rp\.?\s*)?(\d+|\d{1,3}(?:\.\d{3})+)$/i);
    if (!price) return null;
    items.push({name:service,quantity:1,unitPrice:price[1].replaceAll('.','')});
    const duration = values.get('DURASI_HARI');
    if (duration && !/^\d{1,3}$/.test(duration)) return null;
    terms = [
      terms,
      values.get('CATATAN_BIAYA') && 'Catatan biaya tambahan: '+values.get('CATATAN_BIAYA'),
      duration && 'Estimasi durasi: '+Number(duration)+' hari.',
      values.get('CATATAN_FITTING') && 'Catatan fitting: '+values.get('CATATAN_FITTING')
    ].filter(Boolean).join('\n') || 'Pengerjaan sesuai permintaan.';
    const time = values.get('JADWAL_FITTING');
    if (fitting === 'YA' && time) {
      const parts = time.match(/^(\S+)[ T](\d{2}:\d{2})(?: WIB)?$/i);
      if (!parts) return null;
      fittingAt = `${isoDate(parts[1])}T${parts[2]}`;
    }
    if (fitting === 'TIDAK') fittingPlace = '';
  }

  const parsed = quote.safeParse({items,handover:handover || inquiry.requested_handover || undefined,
    fittingAt,fittingPlace,revision:inquiry.revision,eta:isoDate(values.get('SELESAI')),
    validHours:legacy ? values.get('BERLAKU') : 48,terms});
  if (!parsed.success) return null;
  const draft = parsed.data;
  const total = draft.items.reduce((sum,item) => sum + item.quantity * item.unitPrice,0);
  if (total < 1 || total > 100000000 || draft.eta < today) return null;
  if (fittingAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fittingAt) ||
      fittingAt.slice(0,10) > draft.eta || !(new Date(fittingAt+'+07:00') > new Date()))) return null;
  if (fittingPlace && fittingPlace.length < 3) return null;
  return {draft:{...draft,fittingPlace},fittingPending:fitting === 'YA' && (!fittingAt || !fittingPlace)};
}

export function quoteReplyDraft(inquiry, preview, history, replies, settings, workflow, service) {
  if (settings.mode === 'disabled' || !preview?.recipient || !preview.permission || preview.permission.revoked_at ||
      preview.permission.chat_id !== preview.recipient) return null;
  const sourceIds = new Set(history.filter(job => job.channel==='partner' && job.business_id===inquiry.business_id &&
    job.recipient===preview.recipient && job.permission_id===preview.permission.id && job.mode===settings.mode &&
    job.session_id===settings.sessionId && (
      (job.purpose==='quote_request' && job.context_key===preview.contextKey) ||
      (job.purpose==='contact' && !workflow.quote_id)
    )).map(job => job.id));
  const reference = orderReference(inquiry.id);
  for (const reply of replies.toReversed()) {
    if (reply.state !== 'LINKED' || reply.business_id !== inquiry.business_id || reply.chat_id !== preview.recipient ||
        reply.sender_chat !== preview.recipient || !sourceIds.has(reply.dispatch_id)) continue;
    const entries = formEntries(reply.body);
    if (formReference(entries) !== reference || !entries.some(([field]) => ['ITEM','TERIMA','HARGA','STATUS'].includes(field))) continue;
    const result = parseQuoteReply(entries,inquiry,service,workflow.today);
    return {reply,draft:null,...result};
  }
  return null;
}
