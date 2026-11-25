import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { one, transaction } from './db.js';
import { schemaVersion } from './migrate.js';
import { AppError } from './errors.js';
import { authenticate, endSession, sessionUser, startSession, token } from './identity.js';
import { activeBusiness, publicCatalog, publicProvider, saveService, updateProfile, workspaceServices } from './catalog.js';
import { providerWorkspace } from './provider-workspace.js';
import { statusLabel, eventLabel, formatTime, formatDate } from './ui-copy.js';
import { actOnInquiry, createInquiry, inquiryDetail, listInquiries } from './inquiries.js';
import { issueQuote, decideQuote } from './quotes.js';
import { transitionOrder, updateFitting } from './orders.js';
import { messagingMode, setSimulationPreference, simulationInbox } from './outbox.js';
import { simulatedInbound, verifySimulation } from './inbound-adapter.js';
import { enqueueInbound } from './inbound.js';
import { createIntakeRouter } from './intake-routes.js';
import { accountRouter } from './account-routes.js';
import { operationsRouter } from './operations-routes.js';
import { catalogFilters, serviceCategories } from './service-categories.js';
import { addPhoto, photoLimit, readPhoto, removePhoto } from './photos.js';
import { paymentSettings, midtrans, paymentNotification, startPayment, checkPayment } from './payments.js';
import { orderJourney, orderReference, milestones, fittingLabels, handoverLabels } from './order-flow.js';
import { dispatchContacts, orderComplaint, reassign } from './dispatch.js';
import { z } from 'zod';
import * as input from './validation.js';

function cookie(req, name) {
  const entry = req.headers.cookie?.split(';').map(pair => pair.trim()).find(pair => pair.startsWith(name + '='));
  return entry?.slice(name.length + 1);
}

function wantsJson(req) {
  return req.is('application/json') || req.get('accept')?.includes('application/json');
}

function finish(req, res, data, redirect, status = 200) {
  if (wantsJson(req)) return res.status(status).json(data);
  res.redirect(303, redirect);
}

function requireUser(...roles) {
  return (req, res, next) => {
    if (!req.actor) {
      if (req.method === 'GET' && !req.originalUrl.startsWith('/api/')) {
        const nextPath = requestDestination(req.originalUrl, req.app.locals.intakeEnabled);
        return res.redirect(nextPath ? '/login?next=' + encodeURIComponent(nextPath) : '/login');
      }
      throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
    }
    if (roles.length && !roles.includes(req.actor.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Your account cannot perform this action.');
    }
    next();
  };
}

const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const sessionCookie = 'marajut_session';
const csrfCookie = 'marajut_csrf';

function requestDestination(value, intakeEnabled) {
  if (intakeEnabled && value === '/workspace/intake') return value;
  if (typeof value !== 'string') return null;
  const candidate = /^\/requests\/new\?service=([0-9a-f-]+)$/i.exec(value);
  return candidate && input.id.safeParse(candidate[1]).success ? value : null;
}

export function createApp(pool, { origin = 'http://localhost:3100', mode = messagingMode(), payments = paymentSettings(), gateway = midtrans(payments) } = {}) {
  const app = express();
  messagingMode(mode);
  const expectedOrigin = new URL(origin).origin;
  const requestOrigins = new Set([expectedOrigin]);
  const localUrl = new URL(expectedOrigin);
  if (localUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(localUrl.hostname)) {
    localUrl.hostname = localUrl.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    requestOrigins.add(localUrl.origin);
  }
  const secure = expectedOrigin.startsWith('https://');
  const commonCookie = { path: '/', httpOnly: true, secure, sameSite: 'lax' };
  const setSession = (res, value) => {
    res.cookie(sessionCookie, value, { ...commonCookie, maxAge: 8 * 60 * 60 * 1000 });
    res.cookie(csrfCookie, token(), commonCookie);
  };
  const customer = requireUser('customer');
  const provider = requireUser('provider');
  const authenticated = requireUser();
  const manager = (req,res,next) => {
    if (!req.actor?.manager) throw new AppError(req.actor ? 403 : 401,'FORBIDDEN','Akses admin diperlukan.');
    next();
  };
  const workReader = (req,res,next) => req.actor?.manager ? next() : participant(req,res,next);
  const workWriter = (req,res,next) => req.path.startsWith('/api/v1/management/') ? manager(req,res,next) : provider(req,res,next);
  const participant = requireUser('customer', 'provider');

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': secure ? [] : null } },
    strictTransportSecurity: secure,
    referrerPolicy: { policy: 'same-origin' }
  }));
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('./views/', import.meta.url)));
  app.locals.money = amount => money.format(amount);
  app.locals.dateTime = formatTime;
  app.locals.localDate = formatDate;
  app.locals.statusLabel = statusLabel;
  app.locals.orderJourney = orderJourney;
  app.locals.orderReference = orderReference;
  app.locals.milestones = milestones;
  app.locals.fittingLabels = fittingLabels;
  app.locals.handoverLabels = handoverLabels;
  app.locals.eventLabel = eventLabel;
  app.locals.serviceCategories = serviceCategories;
  app.locals.mode = mode;
  app.locals.paymentMode = payments.mode;
  app.locals.partnerContact = input.phone.safeParse(process.env.ADMIN_WHATSAPP).data;
  app.locals.intakeEnabled = mode === 'simulated' && simulatedInbound();
  app.use('/assets/vendor/lenis', express.static(fileURLToPath(new URL('../../node_modules/lenis/dist/', import.meta.url)), {
    index: false, dotfiles: 'ignore', lerp: 0.06
  }));
  app.use('/assets', express.static(fileURLToPath(new URL('./public/', import.meta.url)), {
    index: false, dotfiles: 'ignore'
  }));

  app.get('/health/live', (req, res) => res.json({ status: 'live' }));
  app.get('/health/ready', async (req, res) => {
    try {
      const schema = await one(pool, 'SELECT name FROM schema_migrations WHERE name = $1', [schemaVersion]);
      if (schema) return res.json({ status: 'ready' });
    } catch {
      // This endpoint exposes only readiness, independent of worker and vendor health.
    }
    res.status(503).json({ status: 'unavailable' });
  });

  if (app.locals.intakeEnabled && process.env.SIMULATION_WEBHOOK_SECRET?.length >= 32) {
    const fixtureLimit = rateLimit({ windowMs: 60_000, limit: 120 });
    app.post('/simulated/webhooks/whatsapp', fixtureLimit, express.raw({ type: 'application/json', limit: '8kb' }),
      async (req, res) => {
        const event = verifySimulation(req.body, req.get('x-simulation-signature'), process.env.SIMULATION_WEBHOOK_SECRET);
        const receipt = await transaction(pool, db => enqueueInbound(db, event));
        res.status(202).json(receipt);
      });
  }

  app.use(express.json({ limit: '16kb' }));
  app.post('/webhooks/midtrans', async (req,res) => {
    await paymentNotification(pool,req.body,payments,gateway);
    res.json({received:true});
  });
  app.use(express.urlencoded({ limit: '16kb', extended: false, parameterLimit: 35 }));
  app.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.locals.currentPath = req.path;
    const existingCsrf = cookie(req, csrfCookie);
    const valid = typeof existingCsrf === 'string' && /^[a-f0-9]{64}$/.test(existingCsrf);
    const csrf = valid ? existingCsrf : token();
    if (!valid) res.cookie(csrfCookie, csrf, commonCookie);
    res.locals.csrf = csrf;
    res.locals.user = null;
    if (req.method === 'POST') {
      const supplied = req.get('x-csrf-token') ?? req.body?._csrf;
      const requestOrigin = req.get('origin');
      if (!valid || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
        || !timingSafeEqual(Buffer.from(csrf), Buffer.from(supplied))
        || (requestOrigin && !requestOrigins.has(requestOrigin))
        || req.get('sec-fetch-site') === 'cross-site') {
        throw new AppError(403, 'INVALID_CSRF', 'Refresh the page and submit the form again.');
      }
    }
    req.actor = await sessionUser(pool, cookie(req, sessionCookie));
    res.locals.user = req.actor;
    next();
  });
  app.get('/api/v1/session', (req, res) => res.json({ user: req.actor, csrf: res.locals.csrf }));

  app.get('/', async (req, res) => {
    const filters = catalogFilters(req.query);
    res.render('catalog', { title: 'Cari Penjahit', filters, services: await publicCatalog(pool, filters) });
  });
  app.get('/penjahit/:slug', async (req, res) => {
    const detail = await publicProvider(pool, req.params.slug);
    res.render('public-provider', { title: detail.profile.name, ...detail });
  });
  app.get('/api/v1/services', async (req, res) => res.json(await publicCatalog(pool, catalogFilters(req.query))));
  app.get('/mitra/daftar',(req,res)=>res.render('partner-interest',{title:'Bergabung sebagai mitra',sent:req.query.sent==='1'}));
  app.post('/mitra/daftar',rateLimit({windowMs:60*60_000,limit:10}),async(req,res)=>{
    const data=input.parse(z.object({name:z.string().trim().min(3).max(80),area:z.string().trim().min(3).max(100),
      specialty:z.string().trim().min(2).max(160),whatsapp:input.phone}),req.body);
    await transaction(pool,async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,63))',[data.whatsapp]);
      if (!await one(db,'SELECT id FROM businesses WHERE whatsapp=$1',[data.whatsapp])) {
        await db.query(`INSERT INTO businesses(name,slug,area,description,specialty,whatsapp)
          VALUES($1,$2,$3,$4,$4,$5)`,[data.name,'mitra-'+randomUUID(),data.area,data.specialty,data.whatsapp]);
      }
    });
    finish(req,res,{received:true},'/mitra/daftar?sent=1',202);
  });
  app.get('/login', (req, res) => {
    const nextPath = requestDestination(req.query.next, app.locals.intakeEnabled);
    if (req.actor) return res.redirect((req.actor.role === 'customer' && nextPath) || '/workspace');
    const shopLogin = req.query.ruang === 'usaha';
    res.render('login', { title: shopLogin ? 'Masuk ke ruang usaha' : 'Masuk', shopLogin, message: null, nextPath, reset:req.query.reset === '1' });
  });

  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.'))
  });
  app.post('/api/v1/session', loginLimit, async (req, res) => {
    const { email, password } = input.parse(input.login, req.body);
    const value = await transaction(pool, async db => {
      const userId = await authenticate(db, email, password);
      await endSession(db, cookie(req, sessionCookie));
      return startSession(db, userId);
    });
    setSession(res,value);
    const nextPath = requestDestination(req.body?.next, app.locals.intakeEnabled);
    if (nextPath && !wantsJson(req)) {
      const actor = await sessionUser(pool, value);
      return res.redirect(303, actor?.role === 'customer' ? nextPath : '/workspace');
    }
    finish(req, res, { signedIn: true }, '/workspace');
  });
  app.post('/api/v1/session/logout', authenticated, async (req, res) => {
    await endSession(pool, cookie(req, sessionCookie));
    res.clearCookie(sessionCookie, commonCookie);
    res.cookie(csrfCookie, token(), commonCookie);
    finish(req, res, { signedOut: true }, '/');
  });

  app.get('/workspace', authenticated, async (req, res) => {
    if (req.actor.role === 'operator') return res.redirect(req.actor.manager ? '/pengelola' : app.locals.intakeEnabled ? '/workspace/intake' : '/');
    if (req.actor.role === 'provider') {
      const workspace = await providerWorkspace(pool, req.actor, {
        ...req.query, includeHandoffs: app.locals.intakeEnabled
      });
      return res.render('provider-workspace', { title: 'Ringkasan Usaha', ...workspace });
    }
    const items = await listInquiries(pool, req.actor);
    res.render('workspace', { title: 'Pesanan Saya', items });
  });
  app.get('/api/v1/provider/workspace', provider, async (req, res) =>
    res.json(await providerWorkspace(pool, req.actor, { ...req.query, includeHandoffs: app.locals.intakeEnabled })));
  app.get('/akun/profil', customer, async (req,res) => {
    const profile = await one(pool,'SELECT display_name,email,phone,address FROM users WHERE id=$1',[req.actor.id]);
    res.render('customer-profile',{title:'Profil saya',profile,formError:null,saved:req.query.saved==='1'});
  });
  app.post('/akun/profil', customer, async (req,res) => {
    const fields = z.object({name:z.string().trim().min(2).max(80),
      phone:z.union([input.phone,z.literal('')]),address:z.string().trim().max(400)});
    const result = fields.safeParse(req.body);
    if (!result.success && !wantsJson(req)) {
      const { email } = await one(pool,'SELECT email FROM users WHERE id=$1',[req.actor.id]);
      const field = result.error.issues[0]?.path[0];
      const formError = {
        name:'Masukkan nama dengan 2 sampai 80 karakter.',
        phone:'Periksa nomor WhatsApp. Gunakan nomor dengan kode negara atau awalan 0.',
        address:'Alamat pengiriman maksimal 400 karakter.'
      }[field] ?? 'Periksa kembali informasi profil Anda.';
      return res.status(422).render('customer-profile',{
        title:'Profil saya',saved:false,formError,
        profile:{display_name:req.body?.name,email,phone:req.body?.phone,address:req.body?.address}
      });
    }
    const data = result.success ? result.data : input.parse(fields,req.body);
    await pool.query('UPDATE users SET display_name=$2,phone=$3,address=$4 WHERE id=$1',
      [req.actor.id,data.name,data.phone || null,data.address || null]);
    finish(req,res,{saved:true},'/akun/profil?saved=1');
  });
  app.get('/workspace/profile', provider, async (req, res) => {
    const business = await activeBusiness(pool, req.actor);
    res.render('provider-profile', { title: 'Profil Usaha', business, saved: req.query.saved === '1' });
  });
  app.post('/api/v1/provider/profile', provider, async (req, res) => {
    const business = await updateProfile(pool, req.actor, input.parse(input.businessProfile, req.body));
    finish(req, res, business, '/workspace/profile?saved=1');
  });
  app.get('/api/v1/inquiries', participant, async (req, res) => res.json(await listInquiries(pool, req.actor)));
  const renderInquiryForm = async (res, fields = {}, formError = null) => {
    const preferred = input.id.safeParse(fields.serviceId);
    const services = await publicCatalog(pool, { preferred: preferred.success ? preferred.data : null });
    const requestKey = input.id.safeParse(fields.key);
    res.render('new-request', { title: 'Minta penawaran', services, fields, formError,
      key: requestKey.success ? requestKey.data : randomUUID() });
  };
  app.use(accountRouter(pool,{sessionValue:req => cookie(req,sessionCookie),setSession,wantsJson,renderInquiryForm}));
  app.get('/requests/new', (req, res) => {
    if (req.actor && req.actor.role !== 'customer') throw new AppError(403,'FORBIDDEN','Gunakan akun pelanggan.');
    return renderInquiryForm(res, { serviceId: req.query.service });
  });
  app.post('/api/v1/inquiries', customer, async (req, res) => {
    try {
      const created = await createInquiry(pool, req.actor, input.parse(input.inquiry, req.body));
      finish(req, res, created, '/requests/' + created.id + '?updated=received', created.created ? 201 : 200);
    } catch (error) {
      if (!wantsJson(req) && [404, 422].includes(error.status)) {
        res.status(error.status);
        return renderInquiryForm(res, req.body, error.status === 404
          ? 'Layanan tidak tersedia. Pilih layanan lain.' : displayError(error));
      }
      throw error;
    }
  });
  const photoUpload = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
  app.post('/api/v1/inquiries/:id/photos', customer, photoUpload,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: photoLimit }), async (req, res) => {
      const id = input.parse(input.id, req.params.id);
      const photo = await addPhoto(pool, req.actor, id, req.body);
      res.status(201).json(photo);
    });
  app.get('/api/v1/inquiries/:id/photos/:photoId', workReader, async (req, res) => {
    const photo = await readPhoto(pool, req.actor, input.parse(input.id, req.params.id),
      input.parse(input.id, req.params.photoId));
    res.type('jpeg').send(photo.content);
  });
  app.post('/api/v1/inquiries/:id/photos/:photoId/remove', customer, async (req, res) => {
    const id = input.parse(input.id, req.params.id);
    const photo = await removePhoto(pool, req.actor, id, input.parse(input.id, req.params.photoId));
    finish(req, res, photo, '/requests/' + id + '#request-photos');
  });
  async function requestPage(actor,id) {
    const detail=await inquiryDetail(pool,actor,id);
    const { inquiry, quotes, order } = detail;
    if (!inquiry.dispatch_state || (!actor.manager && actor.role !== 'customer')) return detail;
    const journey = orderJourney({
      ...inquiry, quote_status:quotes[0]?.status, order_status:order?.status, handover:order?.handover,
      fitting_state:order?.fitting_state, fitting_at:order?.fitting_at, shipped_at:order?.shipped_at,
      payment_state:order?.payment?.state, payment_mode:order?.payment?.mode
    }, actor.manager ? 'admin' : 'customer', payments.mode);
    const open = !order && !['DECLINED','CANCELLED'].includes(inquiry.status);
    const canChoose = open && (actor.manager || ['UNAVAILABLE','REJECTED'].includes(journey.key));
    const [contacts, alternatives] = await Promise.all([
      actor.manager ? dispatchContacts(pool,id) : null,
      canChoose ? pool.query(`SELECT s.id,s.name,s.price_hint,b.name AS business,b.area,
        s.category=$2 AS same_category FROM services s JOIN businesses b ON b.id=s.business_id
        WHERE s.active AND b.published AND b.id<>$1 ORDER BY same_category DESC,b.name,s.name,s.id`,
      [inquiry.business_id,inquiry.category]).then(result => result.rows) : []
    ]);
    return { ...detail, journey, contacts, alternatives, canChoose, open };
  }

  async function renderRequest(req,res,id,options={}) {
    const detail = await requestPage(req.actor,id);
    const template = detail.journey ? 'managed-request' : 'request-detail';
    const notices = {
      received:'Permintaan diterima. Pantau kabar selanjutnya dari halaman ini.',
      accepted:'Penawaran disetujui. Rincian pesanan sudah tersimpan.',
      sent:'Penawaran sudah dikirim kepada pelanggan.',
      saved:'Perubahan sudah tersimpan.',
      transferred:'Permintaan diteruskan ke penjahit pilihan.'
    };
    const notice = Object.hasOwn(notices,req.query.updated) ? notices[req.query.updated] : null;
    return res.render(template, {
      title: detail.inquiry.service, ...detail, quoteDraft:null, quoteError:null, formError:null, fittingDraft:null,
      notice, ...options
    });
  }
  app.get('/requests/:id', workReader, async (req, res) => {
    return renderRequest(req,res,input.parse(input.id,req.params.id));
  });
  app.get('/api/v1/inquiries/:id', workReader, async (req, res) =>
    res.json(await inquiryDetail(pool, req.actor, input.parse(input.id, req.params.id))));
  app.post('/api/v1/inquiries/:id/actions', workReader, async (req, res) => {
    const updated = await actOnInquiry(pool, req.actor, input.parse(input.id, req.params.id),
      input.parse(input.inquiryAction, req.body));
    finish(req, res, updated, '/requests/' + updated.id + '?updated=saved');
  });
  app.post(['/api/v1/provider/inquiries/:id/quotes','/api/v1/management/inquiries/:id/quotes'], workWriter, async (req, res) => {
    const id = input.parse(input.id, req.params.id);
    let quoteDraft;
    try {
      quoteDraft = wantsJson(req) ? req.body : input.quoteForm(req.body);
      const quote = await issueQuote(pool, req.actor, id, input.parse(input.quote, quoteDraft), mode);
      finish(req, res, quote, '/requests/' + quote.inquiryId + '?updated=sent#penawaran', 201);
    } catch (error) {
      if (!wantsJson(req) && [409,422].includes(error.status)) {
        return renderRequest(req,res.status(422),id,{quoteDraft,quoteError:displayError(error)});
      }
      throw error;
    }
  });
  app.post('/api/v1/quotes/:id/decisions', customer, async (req, res) => {
    const result = await decideQuote(pool, req.actor, input.parse(input.id, req.params.id),
      input.parse(input.decision, req.body), payments.feeBps);
    const accepted = result.orderId ? '?updated=accepted' : '?updated=saved';
    finish(req, res, result, '/requests/' + result.inquiryId + accepted);
  });
  app.post(['/api/v1/provider/orders/:id/transitions','/api/v1/management/orders/:id/transitions'], workWriter, async (req, res) => {
    const id=input.parse(input.id,req.params.id);
    try {
      const result=await transitionOrder(pool,req.actor,id,input.parse(input.transition,req.body),mode);
      finish(req,res,result,'/requests/'+result.inquiryId+'?updated=saved');
    } catch (error) {
      if (!req.actor.manager) throw error;
      return orderFormError(req,res,id,error);
    }
  });
  async function orderFormError(req,res,id,error,{payment=false,fittingDraft=null}={}) {
    if (wantsJson(req) || ![409,422,503].includes(error.status)) throw error;
    const order=await one(pool,`SELECT o.inquiry_id FROM orders o JOIN inquiries i ON i.id=o.inquiry_id
      WHERE ($2 OR i.customer_id=$3) AND ${payment
        ? 'EXISTS (SELECT 1 FROM order_payments p WHERE p.id=$1 AND p.order_id=o.id)' : 'o.id=$1'}`,
      [id,Boolean(req.actor.manager),req.actor.id]);
    if (!order) throw error;
    return renderRequest(req,res.status(error.status),order.inquiry_id,{formError:displayError(error),fittingDraft});
  }

  app.post('/api/v1/orders/:id/fitting',workReader,async(req,res) => {
    if (!req.actor.manager && req.actor.role!=='customer') throw new AppError(403,'FORBIDDEN','Akses ditolak.');
    const id=input.parse(input.id,req.params.id);
    try {
      const data=input.parse(input.fitting,req.body);
      const result=await updateFitting(pool,req.actor,id,data);
      finish(req,res,result,'/requests/'+result.inquiryId+'?updated=saved#fitting');
    } catch (error) {
      return orderFormError(req,res,id,error,{fittingDraft:req.body});
    }
  });

  app.post('/api/v1/inquiries/:id/reassign',customer,async(req,res) => {
    const result=await reassign(pool,req.actor,input.parse(input.id,req.params.id),
      input.parse(z.object({serviceId:input.id,revision:z.coerce.number().int().positive()}),req.body));
    finish(req,res,result,'/requests/'+result.id+'?updated=transferred',201);
  });
  app.post('/api/v1/orders/:id/checkout',customer, async(req,res) => {
    const id=input.parse(input.id,req.params.id);
    try {
      const result=await startPayment(pool,req.actor,id,payments,gateway);
      finish(req,res,result,'/requests/'+result.inquiryId+'#pembayaran');
    } catch (error) {
      return orderFormError(req,res,id,error);
    }
  });
  app.post('/api/v1/payments/:id/check',workReader,async(req,res) => {
    if (!req.actor.manager && req.actor.role!=='customer') throw new AppError(403,'FORBIDDEN','Akses ditolak.');
    const id=input.parse(input.id,req.params.id);
    try {
      const result=await checkPayment(pool,req.actor,id,payments,gateway,req.body?.action);
      finish(req,res,result,'/requests/'+result.inquiryId+'#pembayaran');
    } catch (error) {
      return orderFormError(req,res,id,error,{payment:true});
    }
  });
  app.post('/api/v1/orders/:id/complaint',workReader,async(req,res) => {
    if (!req.actor.manager && req.actor.role!=='customer') throw new AppError(403,'FORBIDDEN','Akses ditolak.');
    const {note}=input.parse(z.object({note:z.string().trim().min(5).max(500)}),req.body);
    const result=await orderComplaint(pool,req.actor,input.parse(input.id,req.params.id),note);
    finish(req,res,result,'/requests/'+result.id+'#keluhan');
  });
  app.get('/workspace/services', provider, async (req, res) => {
    res.render('services', { title: 'Layanan Saya', ...await workspaceServices(pool, req.actor) });
  });
  app.get('/api/v1/provider/services', provider, async (req, res) => res.json(await workspaceServices(pool, req.actor)));
  app.post('/api/v1/provider/services', provider, async (req, res) => {
    const result = await saveService(pool, req.actor, null, input.parse(input.service, req.body));
    finish(req, res, result, '/workspace/services', 201);
  });
  app.post('/api/v1/provider/services/:id', provider, async (req, res) => {
    const result = await saveService(pool, req.actor, input.parse(input.id, req.params.id),
      input.parse(input.service, req.body));
    finish(req, res, result, '/workspace/services');
  });

  app.get('/workspace/messages', customer, async (req, res) =>
    res.render('messages', { title: 'Notifikasi simulasi', ...await simulationInbox(pool, req.actor) }));
  app.get('/api/v1/messages', customer, async (req, res) => res.json(await simulationInbox(pool, req.actor)));
  app.post('/api/v1/messages/preference', customer, async (req, res) => {
    const { enabled } = input.parse(input.preference, req.body);
    await setSimulationPreference(pool, req.actor, enabled);
    finish(req, res, { enabled }, '/workspace/messages');
  });
  if (app.locals.intakeEnabled) {
    app.use(createIntakeRouter(pool, {
      authenticated, customer, finish, sessionValue: req => cookie(req, sessionCookie)
    }));
  }
  app.use(operationsRouter(pool,{operator:requireUser('operator'),provider,finish}));

  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'This page is unavailable.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let problem = error;
    if (!(problem instanceof AppError)) {
      if (error.status === 400 || error.status === 413) {
        problem = new AppError(error.status, 'INVALID_REQUEST', 'The submitted request could not be read.');
      } else {
        console.error('Application request failed.', { code: error.code ?? 'UNKNOWN' });
        problem = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Try again later.');
      }
    }
    if (wantsJson(req) || req.path==='/webhooks/midtrans' || req.path.startsWith('/simulated/webhooks/') || req.path.endsWith('/photos')
      || (req.method === 'GET' && req.path.startsWith('/api/'))) {
      return res.status(problem.status).json({ error: { code: problem.code, message: problem.message } });
    }
    if (req.path === '/api/v1/session' && res.locals.csrf) {
      const message = problem.status === 401 ? 'Periksa kembali email dan kata sandi.' : displayError(problem);
      return res.status(problem.status).render('login', {
        title: 'Masuk', shopLogin: req.body?.ruang === 'usaha', message,
        nextPath: requestDestination(req.body?.next, app.locals.intakeEnabled)
      });
    }
    res.status(problem.status).render('error', { title: 'Halaman tidak tersedia', message: displayError(problem) });
  });
  return app;
}

function displayError(problem) {
  if (['INVALID_PROOF','ACCOUNT_MISMATCH','NAME_REQUIRED','SIGNED_IN','REAUTH_REQUIRED','WORK_UNAVAILABLE','PAYMENT_UNAVAILABLE'].includes(problem.code)) return problem.message;
  if (problem.code === 'INVALID_QUOTE_TOTAL') return 'Masukkan total penawaran antara Rp1 dan Rp100.000.000.';
  if (problem.code === 'INVALID_ETA') return 'Pilih perkiraan selesai mulai hari ini.';
  const messages = {
    401: 'Masuk untuk melanjutkan.',
    403: 'Akun ini tidak memiliki akses atau formulir sudah kedaluwarsa. Muat ulang halaman dan coba lagi.',
    404: 'Halaman ini tidak ditemukan atau tidak tersedia untuk akun Anda.',
    409: 'Halaman ini telah berubah. Buka kembali permintaan dan periksa status atau versi penawaran terbaru.',
    413: 'Isian melebihi batas ukuran.',
    422: 'Periksa isian dan ketentuan pada formulir, lalu coba lagi.',
    429: 'Terlalu banyak percobaan. Tunggu beberapa saat dan coba lagi.'
  };
  return messages[problem.status] ?? 'Permintaan belum dapat diproses. Coba lagi sebentar lagi.';
}
