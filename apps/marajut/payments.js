import { createHash, timingSafeEqual } from 'node:crypto';
import { one, transaction } from './db.js';
import { AppError, conflict, found } from './errors.js';
import { isFixtureEnvironment } from './environment.js';
import { event } from './inquiries.js';

const unavailable = () => new AppError(503,'PAYMENT_UNAVAILABLE','Pembayaran belum tersedia. Coba lagi atau hubungi admin.');

export function paymentSettings(env=process.env) {
  const local = isFixtureEnvironment(env);
  const mode=env.PAYMENT_MODE || (local?'demo':'disabled');
  const feeBps=Number(env.PLATFORM_FEE_BPS || 500);
  if (!Number.isInteger(feeBps) || feeBps<0 || feeBps>10000) throw new Error('Invalid PLATFORM_FEE_BPS.');
  if (!['disabled','demo','sandbox','live'].includes(mode) || (mode==='demo' && !local)) throw new Error('Invalid PAYMENT_MODE.');
  if (['sandbox','live'].includes(mode) && !env.MIDTRANS_SERVER_KEY) throw new Error('Set MIDTRANS_SERVER_KEY for checkout.');
  return {mode,feeBps,key:env.MIDTRANS_SERVER_KEY};
}

export function midtrans(settings,send=fetch) {
  const base=settings.mode==='live'?'https://api.midtrans.com/v2':'https://api.sandbox.midtrans.com/v2';
  const headers={Authorization:'Basic '+Buffer.from(settings.key+':').toString('base64'),'Content-Type':'application/json',Accept:'application/json'};
  async function request(path,body) {
    try {
      const res=await send(base+path,{headers, method:body?'POST':'GET',body:body && JSON.stringify(body),signal:AbortSignal.timeout(7000)});
      const data=await res.json();
      return {code:Number(data.status_code ?? res.status),data};
    } catch { throw unavailable(); }
  }
  const status=async id=>{
    const {code,data}=await request('/'+id+'/status');
    if (![200,201,202,407].includes(code)) throw unavailable();
    return data;
  };
  return {status, async charge(payment) {
    const {code,data}=await request('/charge',{payment_type:'bank_transfer',bank_transfer:{bank:'bni'},
      transaction_details:{order_id:payment.id,gross_amount:payment.amount}});
    if ([406,409].includes(code)) return status(payment.id);
    if (![200,201,202].includes(code)) throw unavailable();
    return data;
  }};
}

async function applyStatus(pool,actor,p,data) {
  if (data.order_id!==p.id || Number(data.gross_amount)!==p.amount || data.currency!=='IDR' ||
      data.payment_type!=='bank_transfer') throw unavailable();
  const state={pending:'PENDING',settlement:'PAID',expire:'FAILED',cancel:'FAILED',deny:'FAILED',failure:'FAILED'}[data.transaction_status];
  const number=data.va_numbers?.find(v=>v.bank==='bni')?.va_number;
  if (state==='PAID' && data.fraud_status && data.fraud_status!=='accept') throw unavailable();
  if (!state || (state==='PENDING' && !/^\d{6,30}$/.test(number ?? p.va_number ?? ''))) throw unavailable();
  return saveState(pool,actor,p,state,number);
}

function saveState(pool,actor,p,state,number=null) {
  return transaction(pool,async db => {
    const order=found(await one(db,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[p.order_id]));
    const current=await one(db,'SELECT state FROM order_payments WHERE id=$1 FOR UPDATE',[p.id]);
    if (current.state==='PENDING') {
      await db.query('UPDATE order_payments SET state=$2,va_number=COALESCE($3,va_number),checked_at=now() WHERE id=$1',[p.id,state,number]);
      if (state!=='PENDING') await event(db,order.inquiry_id,actor,'PAYMENT_'+state,order.status,order.status,null,order.id);
    }
    return {inquiryId:order.inquiry_id,state:current.state==='PENDING'?state:current.state};
  });
}

export async function startPayment(pool,actor,id,settings,gateway) {
  if (settings.mode==='disabled') throw unavailable();
  const payment=await transaction(pool,async db => {
    const order=found(await one(db,`SELECT o.* FROM orders o JOIN inquiries i ON i.id=o.inquiry_id
      WHERE o.id=$1 AND i.customer_id=$2 FOR UPDATE OF o`,[id,actor.id]));
    if (order.status!=='READY' || order.fee_bps===null) conflict('Selesaikan pengerjaan terlebih dahulu.');
    const existing=await one(db,"SELECT * FROM order_payments WHERE order_id=$1 AND state<>'FAILED'",[id]);
    if (existing) return {...existing,inquiry_id:order.inquiry_id};
    const fee=Math.round(order.amount*order.fee_bps/10000);
    const p=await one(db,'INSERT INTO order_payments(order_id,mode,amount,fee) VALUES($1,$2,$3,$4) RETURNING *',
      [id,settings.mode,order.amount,fee]);
    await event(db,order.inquiry_id,actor,'PAYMENT_STARTED',order.status,order.status,null,id);
    return {...p,inquiry_id:order.inquiry_id};
  });
  if (payment.mode!==settings.mode) throw unavailable();
  if (settings.mode==='demo' || payment.va_number || payment.state==='PAID') return {inquiryId:payment.inquiry_id,state:payment.state};
  return applyStatus(pool,actor,payment,await gateway.charge(payment));
}

export async function checkPayment(pool,actor,id,settings,gateway,action) {
  const p=found(await one(pool,`SELECT p.* FROM order_payments p JOIN orders o ON o.id=p.order_id
    JOIN inquiries i ON i.id=o.inquiry_id WHERE p.id=$1 AND ($2 OR i.customer_id=$3)`,[id,Boolean(actor.manager),actor.id]));
  if (p.mode!==settings.mode) throw unavailable();
  if (p.mode==='demo') {
    if (!actor.manager || !['confirm','reject'].includes(action)) conflict('Verifikasi simulasi oleh admin diperlukan.');
    return saveState(pool,actor,p,action==='confirm'?'PAID':'FAILED');
  }
  return applyStatus(pool,actor,p,await gateway.status(id));
}

export async function paymentNotification(pool,body,settings,gateway) {
  if (!['live','sandbox'].includes(settings.mode)) throw unavailable();
  const {order_id:id,status_code:code,gross_amount:amount,signature_key:signature}=body ?? {};
  if (!/^[\da-f-]{36}$/i.test(id) || !/^[a-f0-9]{128}$/i.test(signature ?? '')) throw new AppError(403,'INVALID_SIGNATURE','Invalid signature.');
  const expected=createHash('sha512').update(id+code+amount+settings.key).digest();
  if (!timingSafeEqual(expected,Buffer.from(signature,'hex'))) throw new AppError(403,'INVALID_SIGNATURE','Invalid signature.');
  const p=found(await one(pool,'SELECT * FROM order_payments WHERE id=$1 AND mode=$2',[id,settings.mode]));
  await applyStatus(pool,null,p,await gateway.status(id));
}
