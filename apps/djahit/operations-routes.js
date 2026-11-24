import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './errors.js';
import { email,id,parse,businessProfile } from './validation.js';
import { operationsBoard,inviteTailor,moderateShop,decideCancellation,requestCancellation,recordCash,reconcileNotification } from './operations.js';

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
  router.get('/pengelola',async(req,res) => res.render('operations',{title:'Pengelolaan platform',...await operationsBoard(pool),saved:req.query.saved==='1'}));
  router.get('/api/v1/management',async(req,res) => res.json(await operationsBoard(pool)));
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
