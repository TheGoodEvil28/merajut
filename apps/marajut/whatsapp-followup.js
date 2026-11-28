import { one } from './db.js';
import { orderReference } from './order-flow.js';
import { formatDate, formatTime } from './ui-copy.js';
import { partnerQuoteForm } from './whatsapp-quote.js';

export const followupLabels = {
  group_taken:'Kabari grup pesanan sudah diambil',
  quote_request:'Minta penawaran dari mitra',
  start_work:'Konfirmasi mulai pengerjaan',
  fitting:'Koordinasikan fitting',
  work_update:'Minta kabar pengerjaan',
  overdue:'Minta pembaruan lewat tenggat',
  await_payment:'Kabari pembayaran masih ditunggu',
  paid:'Kabari pembayaran lunas',
  handover:'Koordinasikan serah terima'
};

export async function readDispatchWorkflow(db, inquiryId, lock) {
  // Read after obtaining the order lock so fitting and payment data reflect the committed transition.
  if (lock) await db.query('SELECT id FROM orders WHERE inquiry_id=$1 FOR SHARE',[inquiryId]);
  return one(db, `SELECT
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date::text AS today,
      latest.id AS quote_id,COALESCE(latest.active,false) AS quote_active,
      o.id AS order_id,o.status AS order_status,o.eta::text AS eta,o.fitting_at,o.fitting_state,
      o.shipped_at,accepted.handover,p.id AS payment_id,p.state AS payment_state,p.mode AS payment_mode,
      (SELECT e.sequence FROM domain_events e WHERE e.order_id=o.id AND e.kind IN
        ('FITTING_CHANGE_REQUESTED','FITTING_PROPOSED','FITTING_CONFIRMED','FITTING_DONE')
        ORDER BY e.sequence DESC LIMIT 1) AS fitting_event
    FROM inquiries i LEFT JOIN orders o ON o.inquiry_id=i.id LEFT JOIN quotes accepted ON accepted.id=o.quote_id
    LEFT JOIN LATERAL (SELECT id,status='SENT' AND expires_at>now() AS active
      FROM quotes WHERE inquiry_id=i.id ORDER BY version DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL (SELECT id,state,mode FROM order_payments WHERE order_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1) p ON true
    WHERE i.id=$1`,[inquiryId]);
}

export function followupDrafts(inquiry, fields, workflow) {
  const drafts = {};
  const reference = orderReference(inquiry.id);
  const service = `🪡 ${fields.service} · ${inquiry.quantity ?? 1} pakaian`;
  const add = (purpose, contextKey, message, {title = followupLabels[purpose], details = [], replies = []} = {}) => {
    const text = [
      `🧵 *MARAJUT — ${title.toUpperCase()}*`,
      [service,...details].join('\n'),
      message,
      ...replies.map(([label,...lines]) => [`*${label}*`,'```',reference,...lines,'```'].join('\n'))
    ].join('\n\n');
    drafts[purpose] = {contextKey,text};
  };
  if (!workflow.order_id) {
    if (inquiry.dispatch_state==='AVAILABLE' && !workflow.quote_active &&
        ['NEW','UNDER_REVIEW','QUOTED','EXPIRED'].includes(inquiry.status)) {
      drafts.quote_request = {contextKey:`quote-form-v1:${workflow.quote_id || 'initial'}`,text:partnerQuoteForm(inquiry,fields,true)};
    }
    return drafts;
  }
  const {order_id:id,order_status:status,eta,fitting_state:fittingState,fitting_at:fittingAt} = workflow;
  if (['CONFIRMED','IN_PROGRESS'].includes(status)) {
    const due = `📅 *Perkiraan selesai:* ${formatDate(eta)}`;
    if (eta < workflow.today) {
      add('overdue',`${id}:${eta}`,'Perkiraan selesai sudah terlewati. Mohon kabari progres, kendala, dan perkiraan selesai terbaru.',{
        title:'Pembaruan lewat tenggat',details:[due],
        replies:[['Contoh balasan','Progres: [tahap saat ini]','Kendala: [jika ada]','Perkiraan selesai terbaru: DD/MM/YYYY']]
      });
    } else if (status==='CONFIRMED') {
      add('start_work',id,'Pelanggan telah menyetujui penawaran. Balas di chat ini dengan salah satu format di bawah dan isi tanggal mulai.',{
        details:[due],replies:[
          ['Jika siap mulai','Siap mulai: DD/MM/YYYY'],
          ['Jika perlu menyesuaikan jadwal','Usulan mulai: DD/MM/YYYY','Catatan: [kendala atau perubahan jadwal]']
        ]
      });
    } else {
      add('work_update',id,'Mohon kabari progres pengerjaan atau beri tahu admin jika jahitan sudah siap.',{
        title:'Kabar pengerjaan',details:[due],replies:[
          ['Jika masih dikerjakan','Progres: [tahap saat ini]','Perkiraan selesai: DD/MM/YYYY'],
          ['Jika jahitan sudah siap','Jahitan sudah siap.']
        ]
      });
    }
    if (['REQUESTED','PROPOSED','SCHEDULED'].includes(fittingState)) {
      const contextKey = `${id}:${fittingState}:${workflow.fitting_event || 'initial'}`;
      const propose = ['Usulan jadwal lain','Usulan fitting: DD/MM/YYYY HH:mm WIB'];
      if (fittingState==='REQUESTED') {
        add('fitting',contextKey,'Pelanggan meminta jadwal fitting lain. Mohon usulkan tanggal dan jam yang tersedia.',{
          title:'Jadwal fitting',replies:[propose]
        });
      } else {
        const proposed = fittingState==='PROPOSED';
        const message = proposed ? 'Jadwal ini menunggu konfirmasi pelanggan. Mohon kabari admin jika waktu tersebut berubah.'
          : 'Mohon konfirmasi kesiapan. Setelah fitting dilakukan, kabari admin dengan kode pesanan dan pesan “Fitting selesai”.';
        add('fitting',contextKey,message,{
          title:'Jadwal fitting',details:[`📅 *${proposed ? 'Usulan fitting' : 'Jadwal fitting'}:* ${formatTime(fittingAt)}`],
          replies:[['Jika waktu tersedia','Saya siap untuk jadwal fitting tersebut.'],propose]
        });
      }
    }
  }
  if (status==='READY' && workflow.payment_state!=='PAID') {
    add('await_payment',id,'Jahitan sudah siap. Pembayaran pelanggan masih menunggu verifikasi. Mohon tunggu konfirmasi admin sebelum serah terima.',{
      title:'Menunggu pembayaran',replies:[['Contoh balasan','Baik, saya tunggu konfirmasi admin.']]
    });
  }
  if (['READY','COMPLETED'].includes(status) && workflow.payment_state==='PAID') {
    const livePayment = workflow.payment_mode==='live';
    const payment = livePayment ? 'Pembayaran pelanggan telah diverifikasi lunas.'
      : 'Pembayaran simulasi telah ditandai lunas untuk latihan.';
    if (status==='READY' && !workflow.shipped_at) {
      add('paid',workflow.payment_id,payment,{
        title:livePayment ? 'Pembayaran lunas' : 'Pembayaran simulasi lunas',
        replies:[['Contoh balasan','Baik, saya siap berkoordinasi untuk serah terima.']]
      });
    }
    const phase = status==='COMPLETED' ? 'completed' : workflow.shipped_at ? 'shipped' : 'ready';
    const method = workflow.handover==='delivery' ? 'pengiriman' : 'pengambilan';
    const next = {
      ready:[`Mohon koordinasikan ${method} dengan admin sesuai kesepakatan.`,`Jadwal ${method}: DD/MM/YYYY HH:mm WIB`],
      shipped:['Pengiriman sudah tercatat di Marajut. Mohon kabari admin jika ada kendala.','Kendala pengiriman: [jika ada]'],
      completed:['Serah terima sudah dicatat selesai di Marajut. Terima kasih.','Serah terima selesai. Terima kasih.']
    };
    add('handover',`${id}:${phase}`,`${payment}\n${next[phase][0]}`,{
      title:'Serah terima',replies:[['Contoh balasan',next[phase][1]]]
    });
  }
  return drafts;
}
