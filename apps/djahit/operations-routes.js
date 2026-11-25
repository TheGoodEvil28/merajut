import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './errors.js';
import { email,id,parse,businessProfile,phone,service } from './validation.js';
import { operationsBoard,inviteTailor,moderateShop,decideCancellation,requestCancellation,recordCash,reconcileNotification } from './operations.js';

import { deskOverview,partnerDetails,savePartner,updateDispatch,reassign } from './dispatch.js';
import { saveService } from './catalog.js';

const partner = businessProfile.extend({whatsapp:phone,specialty:z.string().trim().min(2).max(160)});
const password=z.string().min(1).max(128);
const reason=z.string().trim().min(5).max(500);
const revision=z.coerce.number().int().min(1).max(2147483647);
const invite=z.union([
  z.object({businessId:id,revision,email,password}),
  businessProfile.extend({email,password})
]);
export function operationsRouter(pool,{operator,provider,finish}) {
  const router=Router();
  const access=(req,res,next) => {
    if (!req.actor.manager) throw new AppError(403,'FORBIDDEN','Akses pengelola diperlukan.');
    next();
  };
  router.use(['/pengelola','/api/v1/management'],operator,access);
  router.use('/api/v1/management',rateLimit({windowMs:15*60_000,limit:50,standardHeaders:'draft-8',legacyHeaders:false,
    handler:(req,res,next) => next(new AppError(429,'RATE_LIMITED','Coba lagi nanti.'))}));
  router.get('/pengelola',async(req,res) => res.render('operations',{title:'Pengelolaan platform',...await operationsBoard(pool),...await deskOverview(pool,req.query),saved:req.query.saved==='1'}));
  router.get('/api/v1/management',async(req,res) => res.json({...await operationsBoard(pool),...await deskOverview(pool,req.query)}));
  router.get('/pengelola/mitra/baru',(req,res)=>res.render('partner',{title:'Tambah mitra',business:null,services:[]}));
  router.get('/pengelola/mitra/:id',async(req,res)=>res.render('partner',{title:'Kelola mitra',...await partnerDetails(pool,parse(id,req.params.id))}));
  router.post('/api/v1/management/partners',async(req,res)=>{
    const result=await savePartner(pool,req.actor,null,parse(partner,req.body));
    finish(req,res,result,'/pengelola/mitra/'+result.id,201);
  });
  router.post('/api/v1/management/partners/:id',async(req,res)=>{
    const result=await savePartner(pool,req.actor,parse(id,req.params.id),parse(partner.extend({revision}),req.body));
    finish(req,res,result,'/pengelola/mitra/'+result.id);
  });
  router.post(['/api/v1/management/partners/:id/services','/api/v1/management/partners/:id/services/:serviceId'],async(req,res)=>{
    const shop=parse(id,req.params.id);
    const result=await saveService(pool,req.actor,req.params.serviceId ? parse(id,req.params.serviceId) : null,parse(service,req.body),shop);
    finish(req,res,result,'/pengelola/mitra/'+shop,req.params.serviceId ? 200 : 201);
  });
  router.post('/api/v1/management/inquiries/:id/dispatch',async(req,res)=>{
    const result=await updateDispatch(pool,req.actor,parse(id,req.params.id),
      parse(z.object({revision,state:z.enum(['GROUP','CONTACTED','AVAILABLE','UNAVAILABLE'])}),req.body));
    finish(req,res,result,'/requests/'+result.id);
  });
  router.post('/api/v1/management/inquiries/:id/reassign',async(req,res)=>{
    const result=await reassign(pool,req.actor,parse(id,req.params.id),parse(z.object({revision,serviceId:id}),req.body));
    finish(req,res,result,'/requests/'+result.id,201);
  });
  const done='/pengelola?saved=1';
  router.post('/api/v1/management/invites',async(req,res) => {
    const result=await inviteTailor(pool,req.actor,parse(invite,req.body));
    finish(req,res,result,done,201);
  });
  router.post('/api/v1/management/shops/:id',async(req,res) => {
    await moderateShop(pool,req.actor,parse(id,req.params.id),parse(z.object({action:z.enum(['publish','hide','revoke']),password,reason,revision}),req.body));
    finish(req,res,{updated:true},done);
  });
  router.post('/api/v1/management/reviews/:id',async(req,res) => {
    await decideCancellation(pool,req.actor,parse(id,req.params.id),parse(z.object({action:z.enum(['approve','decline']),password,reason}),req.body));
    finish(req,res,{reviewed:true},done);
  });
  router.post('/api/v1/management/notices/:id',async(req,res) => {
    await reconcileNotification(pool,req.actor,parse(id,req.params.id),parse(z.object({action:z.enum(['retry','close']),password,reason}),req.body));
    finish(req,res,{reviewed:true},done);
  });
  router.post('/api/v1/provider/orders/:id/review',provider,async(req,res) => {
    const result=await requestCancellation(pool,req.actor,parse(id,req.params.id),parse(z.object({reason,revision}),req.body));
    finish(req,res,result,'/requests/'+result.inquiryId,201);
  });
  router.post('/api/v1/provider/orders/:id/cash',provider,async(req,res) => {
    const cashRevision=z.coerce.number().int().nonnegative();
    const cash=z.discriminatedUnion('action',[
      z.object({action:z.literal('record'),confirmed:z.enum(['yes']),revision:cashRevision}),
      z.object({action:z.literal('void'),reason,revision:cashRevision})
    ]);
    const result=await recordCash(pool,req.actor,parse(id,req.params.id),parse(cash,req.body));
    finish(req,res,result,'/requests/'+result.inquiryId+'#tunai');
  });
  return router;
}
