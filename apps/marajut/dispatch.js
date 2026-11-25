import { randomUUID } from 'node:crypto';
import { one, transaction } from './db.js';
import { AppError, conflict, found } from './errors.js';
import { event, lockInquiry, orderIndex, persistInquiry } from './inquiries.js';

const openStates = ['NEW','UNDER_REVIEW','NEEDS_DETAILS','QUOTED','EXPIRED'];

const deskFilters = {
  all:'Semua', 'follow-up':'Perlu tindak lanjut', dispatch:'Koordinasi', quotes:'Menunggu pelanggan', work:'Pengerjaan',
  payment:'Pembayaran', handover:'Serah terima', complaints:'Keluhan', history:'Riwayat'
};

export async function deskOverview(pool, query) {
  const filter=typeof query.filter==='string' && Object.hasOwn(deskFilters,query.filter) ? query.filter : 'all';
  const search=typeof query.q==='string' ? query.q.trim().slice(0,80) : '';
  const page=typeof query.page==='string' && /^\d{1,6}$/.test(query.page) ? Math.max(1,Number(query.page)) : 1;
  const ordering = filter === 'follow-up' ? 'follow_up_priority, created_at, id'
    : "complaint_open DESC, queue_stage='history', created_at DESC, id";
  const result=await one(pool,`WITH records AS (${orderIndex}), filtered AS (
    SELECT records.*, u.display_name AS customer,
      CASE
        WHEN COALESCE(order_status,status) IN ('COMPLETED','CANCELLED','DECLINED') THEN 'history'
        WHEN order_status='READY' AND dispatch_state IS NOT NULL AND payment_state IS DISTINCT FROM 'PAID' THEN 'payment'
        WHEN order_status='READY' THEN 'handover'
        WHEN fitting_state='PROPOSED' AND fitting_at>now() THEN 'quotes'
        WHEN order_status IN ('CONFIRMED','IN_PROGRESS') THEN 'work'
        WHEN status='NEEDS_DETAILS' OR (status='QUOTED' AND quote_status='SENT') THEN 'quotes'
        ELSE 'dispatch'
      END AS queue_stage,
      CASE
        WHEN complaint_open THEN 1
        WHEN order_status IN ('CONFIRMED','IN_PROGRESS') AND (
          fitting_state='REQUESTED' OR (fitting_state IN ('SCHEDULED','PROPOSED') AND fitting_at<=now())
        ) THEN 2
        WHEN order_status IN ('CONFIRMED','IN_PROGRESS') AND due_date::date < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 3
      END AS follow_up_priority
    FROM records JOIN users u ON u.id=records.customer_id
    WHERE strpos(lower(concat_ws(' ',records.id::text,u.display_name,business,service)),lower($1))>0 OR $1=''
  ), selected AS (
    SELECT filtered.*, CASE WHEN complaint_open THEN (
      SELECT created_at FROM domain_events WHERE inquiry_id=filtered.id AND kind='COMPLAINT_OPEN'
      ORDER BY sequence DESC LIMIT 1
    ) END AS complaint_at
    FROM filtered
    WHERE $2='all' OR queue_stage=$2 OR ($2='complaints' AND complaint_open)
      OR ($2='follow-up' AND follow_up_priority IS NOT NULL)
    ORDER BY ${ordering} LIMIT 26 OFFSET $3
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY ${ordering})
         FROM selected),'[]'::jsonb) AS queue,
    COALESCE((SELECT jsonb_object_agg(queue_stage,amount) FROM
         (SELECT queue_stage,count(*)::int AS amount FROM filtered GROUP BY queue_stage) counts),'{}'::jsonb)
       || jsonb_build_object('all',count(*)::int,'complaints',count(*) FILTER (WHERE complaint_open)::int,
         'follow-up',count(follow_up_priority)::int) AS counts
  FROM filtered`,[search.replace(/^#/,'').trim(),filter,(page-1)*25]);
  return { filter,search,deskFilters,counts:result.counts,queue:result.queue.slice(0,25),nextPage:result.queue.length>25,page };
}

export async function servicePerformance(pool,businessId=null) {
  const result=await pool.query(`SELECT b.id,b.name,s.id AS service_id,s.name AS service, count(i.id)::int AS requests,count(o.id)::int AS accepted,
      count(o.id) FILTER (WHERE o.status='COMPLETED')::int AS completed,
      COALESCE(sum(p.fee) FILTER (WHERE p.mode='live'),0) AS revenue,
      COALESCE(sum(p.amount-p.fee) FILTER (WHERE p.mode='live'),0) AS partner_net,
      COALESCE(sum(p.fee) FILTER (WHERE p.mode<>'live'),0) AS test_revenue
      FROM businesses b JOIN services s ON s.business_id=b.id LEFT JOIN inquiries i ON i.service_id=s.id LEFT JOIN orders o ON o.inquiry_id=i.id
      LEFT JOIN order_payments p ON p.order_id=o.id AND p.state='PAID'
      WHERE ($1::uuid IS NULL OR b.id=$1)
      GROUP BY b.id,s.id ORDER BY b.name,s.name,s.id`,[businessId]);
  return result.rows;
}

export async function partnerDetails(pool,id) {
  const business=found(await one(pool,`SELECT b.*,u.display_name AS operator FROM businesses b
    LEFT JOIN provider_memberships m ON m.business_id=b.id AND m.active LEFT JOIN users u ON u.id=m.user_id
    WHERE b.id=$1`,[id]));
  const services=(await pool.query('SELECT * FROM services WHERE business_id=$1 ORDER BY active DESC,name,id',[id])).rows;
  return {business,services};
}

export function savePartner(pool,actor,id,input) {
  return transaction(pool,async db => {
    const args=[input.name,input.area,input.description,input.specialty,input.whatsapp];
    let business;
    if (id) {
      business=await one(db,`UPDATE businesses SET name=$1,area=$2,description=$3,specialty=$4,whatsapp=$5,
        moderation_revision=moderation_revision+1 WHERE id=$6 AND moderation_revision=$7 RETURNING id`,[...args,id,input.revision]);
      if (!business) conflict('Profil telah berubah.');
    } else {
      const slug=(input.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'mitra')+'-'+randomUUID().slice(0,8);
      business=await one(db,`INSERT INTO businesses(name,area,description,specialty,whatsapp,slug)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[...args,slug]);
    }
    await db.query('INSERT INTO operator_events(actor_id,action,target_id) VALUES($1,$2,$3)',[actor.id,'PARTNER_SAVED',business.id]);
    return business;
  });
}

export function updateDispatch(pool,actor,id,{state,revision}) {
  return transaction(pool,async db => {
    const i=await lockInquiry(db,actor,id);
    if (!i.dispatch_state || !openStates.includes(i.status) || i.revision!==revision) conflict('Permintaan telah berubah.');
    if (state==='GROUP') {
      await db.query('UPDATE inquiries SET revision=revision+1 WHERE id=$1',[id]);
      await event(db,id,actor,'GROUP_POSTED',i.status,i.status);
      return {id};
    }
    if (state===i.dispatch_state) conflict('Jawaban ini sudah dicatat.');
    if (i.status==='QUOTED' && state!=='UNAVAILABLE') {
      throw new AppError(409,'WORK_UNAVAILABLE','Pelanggan sedang meninjau penawaran ini.');
    }
    if (state==='UNAVAILABLE') {
      await db.query("UPDATE quotes SET status='WITHDRAWN' WHERE inquiry_id=$1 AND status='SENT'",[id]);
    }
    const status=i.status==='NEEDS_DETAILS' && state!=='UNAVAILABLE' ? i.status : 'UNDER_REVIEW';
    await db.query('UPDATE inquiries SET dispatch_state=$2,status=$3,revision=revision+1 WHERE id=$1',[id,state,status]);
    await event(db,id,actor,'DISPATCH_'+state,i.status,status);
    return {id};
  });
}

export function reassign(pool,actor,id,input) {
  return transaction(pool,async db => {
    const i=await lockInquiry(db,actor,id);
    if (!i.dispatch_state || !openStates.includes(i.status) || i.revision!==input.revision) conflict('Permintaan telah berubah.');
    if (!actor.manager && i.dispatch_state!=='UNAVAILABLE') {
      const latest=await one(db,'SELECT status FROM quotes WHERE inquiry_id=$1 ORDER BY version DESC LIMIT 1',[id]);
      if (latest?.status!=='REJECTED') conflict('Tolak penawaran sebelum memilih mitra lain.');
    }
    const target=found(await one(db,`SELECT s.business_id,b.name FROM services s JOIN businesses b ON b.id=s.business_id
      WHERE s.id=$1 AND s.active AND b.published FOR SHARE OF s,b`,[input.serviceId]));
    if (target.business_id===i.business_id) conflict('Pilih mitra lain.');
    const {id:next}=await persistInquiry(db,actor,{key:randomUUID(),serviceId:input.serviceId,description:i.description,
      quantity:i.quantity, fitNotes:i.fit_notes, desiredDate:i.desired_date,
      requestedHandover:i.requested_handover, fittingRequested:i.fitting_requested},i.customer_id);
    await db.query('UPDATE inquiries SET previous_inquiry_id=$1 WHERE id=$2',[id,next]);
    await db.query('INSERT INTO inquiry_photos(inquiry_id,content) SELECT $2,content FROM inquiry_photos WHERE inquiry_id=$1',[id,next]);
    await db.query("UPDATE quotes SET status='WITHDRAWN' WHERE inquiry_id=$1 AND status='SENT'",[id]);
    await db.query("UPDATE inquiries SET status='DECLINED',revision=revision+1 WHERE id=$1",[id]);
    await event(db,id,actor,'REASSIGNED',i.status,'DECLINED',target.name);
    return {id:next};
  });
}

export async function dispatchContacts(pool,id) {
  return found(await one(pool,`SELECT b.whatsapp,u.display_name,u.phone,u.address FROM inquiries i
    JOIN businesses b ON b.id=i.business_id JOIN users u ON u.id=i.customer_id WHERE i.id=$1`,[id]));
}

export function orderComplaint(pool,actor,id,note) {
  return transaction(pool,async db => {
    const order=found(await one(db,`SELECT o.* FROM orders o JOIN inquiries i ON i.id=o.inquiry_id
      WHERE o.id=$1 AND ($2 OR i.customer_id=$3) FOR UPDATE OF o`,[id,Boolean(actor.manager),actor.id]));
    if (order.fee_bps===null || !['READY','COMPLETED'].includes(order.status) ||
        (actor.manager ? !order.complaint || order.resolution : order.complaint)) conflict('Keluhan tidak dapat diubah.');
    const column=actor.manager?'resolution':'complaint';
    await db.query('UPDATE orders SET '+column+'=$2 WHERE id=$1',[id,note]);
    await event(db,order.inquiry_id,actor,actor.manager?'COMPLAINT_RESOLVED':'COMPLAINT_OPEN',order.status,order.status,note,id);
    return {id:order.inquiry_id};
  });
}
