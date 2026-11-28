import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './errors.js';
import { email,id,parse,businessProfile,phone,service } from './validation.js';
import { operationsBoard,partnerDirectory,inviteTailor,moderateShop,decideCancellation,requestCancellation,recordCash,reconcileNotification } from './operations.js';

import { deskOverview,partnerDetails,savePartner,updateDispatch,reassign,servicePerformance } from './dispatch.js';
import { saveService } from './catalog.js';
import { approveDispatch, reviewDispatch, dispatchPanel, dispatchOperations, dispatchInbox,
  permissionFor, saveDispatchPermission, pauseDispatch, resolveDispatchInbox } from './whatsapp-dispatch.js';
import { followupLabels } from './whatsapp-followup.js';
import { serviceCategories } from './service-categories.js';

const partner = businessProfile.extend({whatsapp:phone,specialty:z.string().trim().min(2).max(160)});
const password=z.string().min(1).max(128);
const reason=z.string().trim().min(5).max(500);
const revision=z.coerce.number().int().min(1).max(2147483647);
const invite=z.union([
  z.object({businessId:id,revision,email,password}),
  businessProfile.extend({email,password})
]);

const newPartnerPage = {title:'Tambah mitra',business:null,services:[],saved:false,onboarding:null,contactError:null,contactInput:''};

function partnerOnboardingMessage(number) {
  return [
    '🧵 *MERAJUT — DATA CALON MITRA PENJAHIT*',
    '',
    'Halo, saya admin Merajut. Jika berkenan bergabung, salin formulir ini, isi setelah titik dua, lalu balas di chat ini.',
    '',
    '*1. PROFIL USAHA*',
    'Nama usaha:',
    'Area layanan (kecamatan/kota):',
    'Spesialisasi:',
    'Tentang penjahit (singkat):',
    `Nomor WhatsApp untuk pesanan: +${number}`,
    'Periksa nomor di atas dan koreksi jika nomor untuk pesanan berbeda.',
    '',
    '*2. LAYANAN*',
    `Salin bagian ini untuk setiap layanan. Kategori tersedia ${Object.values(serviceCategories).join(', ')}.`,
    'Nama layanan:',
    'Kategori layanan:',
    'Deskripsi layanan:',
    'Harga awal (Rp atau sesuai penawaran):',
    'Perkiraan durasi (hari, opsional):',
    'Panduan untuk pelanggan (opsional):',
    '',
    '*3. PERSETUJUAN*',
    'Setuju profil dan layanan ditampilkan di Merajut: YA / TIDAK',
    'Setuju menerima pesan koordinasi pesanan di nomor WhatsApp ini: YA / TIDAK',
    '',
    '*Contoh pengisian layanan*',
    '```',
    'Nama layanan: Pendekkan celana',
    'Kategori layanan: Permak & ukuran',
    'Deskripsi layanan: Pendekkan panjang celana sesuai ukuran.',
    'Harga awal: Rp25.000',
    'Perkiraan durasi: 2 hari',
    'Panduan untuk pelanggan: Sebutkan panjang akhir yang diinginkan.',
    '```',
    'Admin akan memeriksa data dan persetujuan sebelum mengaktifkan profil.'
  ].join('\n');
}

export function operationsRouter(pool,{operator,provider,finish,dispatch}) {
  const router=Router();
  const access=(req,res,next) => {
    if (!req.actor.manager) throw new AppError(403,'FORBIDDEN','Akses pengelola diperlukan.');
    next();
  };
  router.use(['/pengelola','/api/v1/management'],operator,access);
  router.use('/api/v1/management',rateLimit({windowMs:15*60_000,limit:50,standardHeaders:'draft-8',legacyHeaders:false,
    handler:(req,res,next) => next(new AppError(429,'RATE_LIMITED','Coba lagi nanti.'))}));
  router.get('/pengelola',async(req,res) => res.render('operations',{title:'Pengelolaan platform',...await deskOverview(pool,req.query)}));
  router.get('/pengelola/mitra',async(req,res) => res.render('operations-partners',{
    title:'Mitra penjahit',shops:await partnerDirectory(pool)
  }));
  router.get('/pengelola/kinerja',async(req,res) => res.render('operations-performance',{
    title:'Kinerja layanan',performance:await servicePerformance(pool)
  }));
  router.get('/pengelola/operasional',async(req,res) => res.render('operations-support',{
    title:'Operasional',...await operationsBoard(pool),whatsapp:await dispatchOperations(pool,dispatch),saved:req.query.saved==='1'
  }));
  router.get('/api/v1/management',async(req,res) => {
    const [board,desk,performance]=await Promise.all([
      operationsBoard(pool),deskOverview(pool,req.query),servicePerformance(pool)
    ]);
    res.json({...board,...desk,performance});
  });
  router.get('/pengelola/mitra/baru',(req,res)=>res.render('partner',{...newPartnerPage}));
  router.post('/pengelola/mitra/baru/whatsapp',async(req,res) => {
    const number = phone.safeParse(req.body?.number);
    if (!number.success) {
      const contactInput = typeof req.body?.number==='string' ? req.body.number.slice(0,32) : '';
      return res.status(422).render('partner',{...newPartnerPage,contactInput,
        contactError:'Masukkan nomor WhatsApp yang valid, misalnya 0812 3456 7890.'});
    }
    const {rows:existing} = await pool.query('SELECT id,name FROM businesses WHERE whatsapp=$1 ORDER BY name,id',[number.data]);
    res.render('partner',{...newPartnerPage,contactInput:'+'+number.data,
      onboarding:{number:number.data,text:partnerOnboardingMessage(number.data),existing}});
  });
  router.get('/pengelola/mitra/:id',async(req,res)=>res.render('partner',{title:'Kelola mitra',...await partnerDetails(pool,parse(id,req.params.id)),
    whatsappPermission:await permissionFor(pool,dispatch,parse(id,req.params.id)),dispatchMode:dispatch.mode,saved:req.query.saved==='1'}));
  router.get('/pengelola/whatsapp',async(req,res)=>res.render('whatsapp-inbox',{
    title:'Balasan WhatsApp',items:await dispatchInbox(pool),saved:req.query.saved==='1'
  }));
  router.get('/api/v1/management/inquiries/:id/whatsapp-dispatches',async(req,res)=>{
    res.json(await dispatchPanel(pool,req.actor,parse(id,req.params.id),dispatch));
  });
  router.post('/api/v1/management/inquiries/:id/whatsapp-dispatches',async(req,res)=>{
    const result = await approveDispatch(pool,req.actor,parse(id,req.params.id),parse(z.object({
      channel:z.enum(['group','partner']),purpose:z.enum(['contact',...Object.keys(followupLabels)]).default('contact'),
      revision,requestKey:id,previewDigest:z.string().regex(/^[a-f\d]{64}$/)
    }),req.body),dispatch);
    finish(req,res,result,'/requests/'+result.inquiryId+'?updated=saved#koordinasi',202);
  });
  router.post('/api/v1/management/inquiries/:id/whatsapp-dispatches/:dispatchId/review',async(req,res)=>{
    const result = await reviewDispatch(pool,req.actor,parse(id,req.params.id),parse(id,req.params.dispatchId),
      parse(z.object({revision,disposition:z.enum(['sent','unsent']),reason}),req.body));
    finish(req,res,result,'/requests/'+result.inquiryId+'?updated=saved#koordinasi');
  });
  router.post(['/api/v1/management/partners/:id/whatsapp-permission','/api/v1/management/whatsapp/group-permission'],async(req,res)=>{
    const businessId = req.params.id ? parse(id,req.params.id) : null;
    const data = parse(z.object({action:z.enum(['grant','revoke']),version:z.coerce.number().int().nonnegative(),
      evidence:reason,confirmed:z.literal('yes').optional(),groupMember:z.literal('yes').optional(),senderAlias:z.string().max(100).optional()}),req.body);
    const result = await saveDispatchPermission(pool,req.actor,dispatch,businessId,data);
    finish(req,res,{id:result.id},businessId ? '/pengelola/mitra/'+businessId+'?saved=1#whatsapp-permission' : '/pengelola/operasional?saved=1#whatsapp');
  });
  router.post('/api/v1/management/whatsapp/pause',async(req,res)=>{
    const data=parse(z.object({action:z.enum(['pause','resume']),reason}),req.body);
    await pauseDispatch(pool,req.actor,dispatch,data.action==='pause',data.reason);
    finish(req,res,{updated:true},'/pengelola/operasional?saved=1#whatsapp');
  });
  router.post('/api/v1/management/whatsapp/inbox/:id/review',async(req,res)=>{
    await resolveDispatchInbox(pool,req.actor,parse(id,req.params.id),parse(z.object({reason}),req.body).reason);
    finish(req,res,{updated:true},'/pengelola/whatsapp?saved=1');
  });
  router.post('/api/v1/management/partners',async(req,res)=>{
    const result=await savePartner(pool,req.actor,null,parse(partner,req.body));
    finish(req,res,result,'/pengelola/mitra/'+result.id+'?saved=1#layanan-mitra',201);
  });
  router.post('/api/v1/management/partners/:id',async(req,res)=>{
    const result=await savePartner(pool,req.actor,parse(id,req.params.id),parse(partner.extend({revision}),req.body));
    finish(req,res,result,'/pengelola/mitra/'+result.id+'?saved=1');
  });
  router.post(['/api/v1/management/partners/:id/services','/api/v1/management/partners/:id/services/:serviceId'],async(req,res)=>{
    const shop=parse(id,req.params.id);
    const result=await saveService(pool,req.actor,req.params.serviceId ? parse(id,req.params.serviceId) : null,parse(service,req.body),shop);
    finish(req,res,result,'/pengelola/mitra/'+shop+'?saved=1#layanan-mitra',req.params.serviceId ? 200 : 201);
  });
  router.post('/api/v1/management/inquiries/:id/dispatch',async(req,res)=>{
    const result=await updateDispatch(pool,req.actor,parse(id,req.params.id),
      parse(z.object({revision,state:z.enum(['GROUP','CONTACTED','AVAILABLE','UNAVAILABLE'])}),req.body),dispatch);
    finish(req,res,result,'/requests/'+result.id+'?updated=saved');
  });
  router.post('/api/v1/management/inquiries/:id/reassign',async(req,res)=>{
    const result=await reassign(pool,req.actor,parse(id,req.params.id),parse(z.object({revision,serviceId:id}),req.body));
    finish(req,res,result,'/requests/'+result.id+'?updated=transferred',201);
  });
  const done='/pengelola/operasional?saved=1';
  router.post('/api/v1/management/invites',async(req,res) => {
    const result=await inviteTailor(pool,req.actor,parse(invite,req.body));
    finish(req,res,result,'/pengelola/mitra/'+result.id+'?saved=1',201);
  });
  router.post('/api/v1/management/shops/:id',async(req,res) => {
    const shop=parse(id,req.params.id);
    await moderateShop(pool,req.actor,shop,parse(z.object({action:z.enum(['publish','hide','revoke']),password,reason,revision}),req.body));
    finish(req,res,{updated:true},'/pengelola/mitra/'+shop+'?saved=1#publikasi');
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
