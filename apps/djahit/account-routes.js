import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { addGuestPhoto, inspectProof, redeemProof, requestProof } from './accounts.js';
import { AppError } from './errors.js';
import { digest } from './identity.js';
import { photoLimit } from './photos.js';
import * as input from './validation.js';

export function accountRouter(pool, { sessionValue, setSession, wantsJson, renderInquiryForm }) {
  const router = Router();
  const limit = rateLimit({windowMs:15*60_000, limit:35, standardHeaders:'draft-8',legacyHeaders:false,
    handler:(req,res,next) => next(new AppError(429,'RATE_LIMITED','Tunggu sebelum mencoba kembali.'))});
  const code = z.string().regex(/^[0-9a-f]{64}$/);
  const credentials = z.object({code, name:z.string().trim().max(80).optional(),password:z.string().min(12).max(128)});
  function signedOut(req) {
    if (req.actor) throw new AppError(409,'SIGNED_IN','Keluar dari akun sebelum melanjutkan.');
  }
  function reply(req,res,data) {
    if (wantsJson(req)) return res.status(202).json({accepted:true,...data});
    res.status(202).render('account-sent',{title:'Periksa email Anda', draftId:data.draftId});
  }
  for (const [purpose,path,title] of [['signup','/akun/daftar','Daftar sebagai pelanggan'],['recovery','/akun/lupa','Lupa kata sandi']]) {
    router.get(path,(req,res) => res.render('account-email',{title,purpose,path}));
    router.post(path,limit,async(req,res) => {
      signedOut(req);
      const email = input.parse(input.email,req.body.email);
      await requestProof(pool,purpose,email);
      reply(req,res,{});
    });
  }
  router.post('/akun/permintaan',limit,async(req,res) => {
    signedOut(req);
    try {
      const draft = input.parse(input.inquiry,req.body);
      const email = input.parse(input.email,req.body.email);
      const result = await requestProof(pool,'guest',email,draft,digest(res.locals.csrf));
      reply(req,res,result);
    } catch (error) {
      if (!wantsJson(req) && [404,422].includes(error.status)) {
        res.status(error.status);
        return renderInquiryForm(res,req.body,'Periksa email, layanan dan detail permintaan Anda.');
      }
      throw error;
    }
  });
  router.post('/akun/draf/:id/photos',limit,raw({type:['image/jpeg','image/png','image/webp'],limit:photoLimit}),async(req,res) => {
    signedOut(req);
    await addGuestPhoto(pool,input.parse(input.id,req.params.id),digest(res.locals.csrf),req.body);
    res.status(201).json({attached:true});
  });
  router.get('/akun/tautan',(req,res) => res.render('account-proof',{title:'Verifikasi email',proof:null,code:null}));
  router.post('/akun/periksa',limit,async(req,res) => {
    const secret = input.parse(code,req.body.code);
    const proof = await inspectProof(pool,secret);
    if (wantsJson(req)) return res.json(proof);
    res.render('account-proof',{title:'Konfirmasi akun',proof,code:secret});
  });
  router.post('/akun/konfirmasi',limit,async(req,res) => {
    signedOut(req);
    const values = input.parse(credentials,req.body);
    const result = await redeemProof(pool,values.code,values,sessionValue(req));
    if (result.session) setSession(res,result.session);
    if (wantsJson(req)) return res.json({reset:!!result.reset,inquiryId:result.inquiryId});
    res.redirect(303,result.reset ? '/login?reset=1' : result.inquiryId ? '/requests/'+result.inquiryId : '/workspace');
  });
  return router;
}
