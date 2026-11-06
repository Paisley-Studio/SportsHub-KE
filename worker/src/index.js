/* SportsHub-KE server: a Cloudflare Worker. It replaces the Firebase Cloud Functions entirely.
   POST /create-account   Registers the signed-in user (player, coach, facility...): the registerAccount rule.
   POST /op               Any other trusted operation: { op, payload }. Same rules, same transaction guarantees.
   POST /get-upload-url   A presigned R2 PUT address (5 minutes) for a signed-in user.
   GET  /files/<key>      Serves a stored file through the R2 binding (when no public bucket domain is set).
   POST /mpesa-callback   M-Pesa Daraja STK callback, once a provider is installed.
   Cron (daily 00:05 EAT) Closes expired membership months and sends renewal reminders.
   Every request that changes data carries the user's Firebase ID token, verified against Google's public keys.
   Firestore is reached through its REST API with a service account (firestore.js). Firebase Storage is never used. */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import TrustedOps from './trusted-ops.js';
import { runTransaction, db, autoId, emulated } from './firestore.js';

/* ----- Responses and errors ----- */
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const STATUS = { 'invalid-argument': 400, unauthenticated: 401, 'permission-denied': 403, 'not-found': 404, 'already-exists': 409, 'failed-precondition': 412, 'resource-exhausted': 429 };
const origins = env => (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsHeaders = (req, env) => {
  const o = req.headers.get('Origin');
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (o && origins(env).includes(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
};
/* Success bodies are the result itself; failures are { error: { code, message } }. */
const json = (req, env, body, status = 200) => new Response(JSON.stringify(body === undefined ? null : body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(req, env) } });
const toApiError = e => {
  if (e instanceof ApiError) return e;
  if (e instanceof TrustedOps.OpError || e.name === 'OpError') return new ApiError(STATUS[e.code] || 400, e.code, e.message);
  console.error(e);
  /* Firestore refuses a query whose composite index is missing or still building. */
  if (e.status === 400 && /index/i.test(e.message)) return new ApiError(503, 'index-building', 'The database is still getting ready. Please try again in a few minutes.');
  return new ApiError(500, 'internal', 'Something went wrong. Please try again.');
};

/* ----- Firebase ID token check (RS256, Google's published keys) ----- */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwks = null, jwksUntil = 0;
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const getKeys = async () => {
  if (jwks && Date.now() < jwksUntil) return jwks;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('Could not load sign-in keys');
  const age = Number((r.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwks = (await r.json()).keys; jwksUntil = Date.now() + age * 1000;
  return jwks;
};
/* Local only: the Auth emulator issues unsigned tokens. Accepted only when the Worker runs on this computer
   (wrangler dev) and points at the emulators, so a deployed Worker can never take this path. */
const localEmulator = (req, env) => emulated(env) && /^(127\.0\.0\.1|localhost)$/.test(new URL(req.url).hostname);
async function verifyIdToken(token, env, req) {
  const parts = String(token || '').split('.'), projectId = env.FIREBASE_PROJECT_ID;
  if (parts.length !== 3) return null;
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(b64url(parts[0]))); claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  const claimsOk = claims.aud === projectId && claims.iss === `https://securetoken.google.com/${projectId}` && claims.sub && claims.exp > now && claims.iat <= now + 300;
  if (head.alg === 'none') return localEmulator(req, env) && claimsOk ? { uid: claims.sub, email: claims.email || '' } : null;
  if (head.alg !== 'RS256') return null;
  const jwk = (await getKeys()).find(k => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  return ok && claimsOk ? { uid: claims.sub, email: claims.email || '' } : null;
}
const bearer = req => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
/* Resolves to the user, or null when no token was sent. A token that was sent but fails is always rejected. */
async function caller(req, env) {
  const t = bearer(req);
  if (!t) return null;
  const user = await verifyIdToken(t, env, req).catch(() => null);
  if (!user) throw new ApiError(401, 'unauthenticated', 'Your sign-in has expired. Please sign in again.');
  return user;
}
const readBody = async req => { try { return (await req.json()) || {}; } catch { throw new ApiError(400, 'invalid-argument', 'The request body must be JSON.'); } };

/* ----- Trusted operations ----- */
const newId = pre => `${pre}_${autoId()}`;
const opEnv = env => ({
  allowSimulation: env.ALLOW_SIMULATED_PAYMENTS === 'true',
  paymentProvider: env.PAYMENT_PROVIDER || 'simulation',
  trustedCaller: false,
  relaxAttendance: emulated(env) && env.RELAX_ATTENDANCE === 'true'
});
async function runOp(env, op, uid, payload, extra = {}) {
  const fn = TrustedOps.ops[op];
  if (!fn) throw new ApiError(404, 'not-found', 'Unknown operation.');
  return runTransaction(env, async tx => fn({ uid, now: new Date().toISOString(), tx, nid: newId, env: { ...opEnv(env), ...extra } }, payload || {}));
}
/* Fixed-window rate limit per user or address. */
async function rateLimit(env, id) {
  const limit = Number(env.RATE_LIMIT_PER_MINUTE || 90), minute = Math.floor(Date.now() / 60000);
  const docId = id.replace(/[^\w.:-]/g, '_').slice(0, 120);
  const over = await runTransaction(env, async tx => {
    const d = (await tx.get('rateLimits', docId)) || {};
    const count = d.minute === minute ? (d.count || 0) + 1 : 1;
    tx.set('rateLimits', docId, { minute, count });
    return count > limit;
  });
  if (over) throw new ApiError(429, 'resource-exhausted', 'Too many requests. Please wait a moment.');
}

/* Payment providers. A provider starts a payment and later confirms it through a webhook;
   only that webhook, never the browser, can mark a transaction successful. */
const PROVIDERS = {
  simulation: { start: async () => ({}) }
  /* mpesa: { start: async (env, tx) => { call Daraja STK Push, then return { providerCheckoutId } } } */
};

async function trustedOp(req, env, op, payload) {
  const user = await caller(req, env), uid = user ? user.uid : null;
  if (op === 'bootstrapPlatform') { if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in first.'); return bootstrap(env, user, payload); }
  if (!uid && !TrustedOps.PUBLIC_OPS.includes(op)) throw new ApiError(401, 'unauthenticated', 'Please sign in first.');
  if (op === 'providerPaymentEvent') throw new ApiError(403, 'permission-denied', 'Not available.');
  await rateLimit(env, uid || `ip:${req.headers.get('CF-Connecting-IP') || 'unknown'}`);
  const result = await runOp(env, op, uid, payload);
  /* Hand off to the configured provider once the pending transaction is safely stored. */
  const providerName = env.PAYMENT_PROVIDER || 'simulation';
  if (result && result.txId && providerName !== 'simulation' && ['paymentInitiate', 'placeOrder'].includes(op)) {
    const provider = PROVIDERS[providerName];
    if (!provider) throw new ApiError(412, 'failed-precondition', `Payment provider "${providerName}" is not installed.`);
    const started = await provider.start(env, { ...result, uid, phone: payload && payload.phone });
    if (started && started.providerCheckoutId) await runTransaction(env, async tx => { tx.update('paymentTransactions', result.txId, { providerCheckoutId: started.providerCheckoutId }); });
  }
  return result === undefined ? null : result;
}

/* First-run setup. Only the signed-in user whose email equals SUPERADMIN_EMAIL can run it. */
async function bootstrap(env, user, payload) {
  const superEmail = (env.SUPERADMIN_EMAIL || '').toLowerCase(), email = (user.email || '').toLowerCase();
  /* On local emulators with no SUPERADMIN_EMAIL set, the first account to run setup becomes super administrator. */
  const localFirstRun = emulated(env) && !superEmail && !(await db(env).query('adminRoles', { limit: 1 })).length;
  if (!localFirstRun && (!superEmail || email !== superEmail)) throw new ApiError(403, 'permission-denied', 'Only the configured super administrator can run setup.');
  const sports = ((payload && payload.sports) || []).slice(0, 100), now = new Date().toISOString();
  return runTransaction(env, async tx => {
    const u = await tx.get('users', user.uid);
    if (!u) throw new ApiError(412, 'failed-precondition', 'Complete your own registration first.');
    tx.set('adminRoles', user.uid, { uid: user.uid, name: u.name, role: 'super', assignedBy: 'bootstrap', at: now });
    tx.update('users', user.uid, { roles: [...new Set([...(u.roles || []), 'admin'])] });
    tx.merge('systemSettings', 'platform', TrustedOps.DEFAULT_SETTINGS);
    sports.forEach(s => tx.merge('sports', String(s.id), s));
    tx.set('auditLogs', autoId(), { actorId: user.uid, action: 'platform.bootstrap', target: '', meta: { sports: sports.length }, at: now });
    return { ok: true, sports: sports.length };
  });
}

/* Daily: close expired membership months, release stale reservations and send renewal reminders. */
async function dailySweep(env) {
  for (let pass = 0; pass < 6; pass++) {
    const r = await runOp(env, 'sweepMemberships', null, {}, { trustedCaller: true });
    if (r.closed + r.released === 0) break;
  }
  const now = new Date().toISOString(), soon = new Date(Date.now() + 3 * 864e5).toISOString();
  const due = await db(env).query('membershipPeriods', { where: [['status', '==', 'active'], ['end', '<=', soon], ['end', '>', now]], limit: 400 });
  await db(env).commit(t => due.forEach(d => t.set('notifications', autoId(), { uid: d.uid, type: 'membership', title: 'Membership renews soon', body: 'Your month ends in the next three days.', link: '/app/membership', read: false, at: now, channels: ['in_app'] })));
}

/* M-Pesa Daraja STK callback. Set the MPESA_CALLBACK_TOKEN secret and register .../mpesa-callback?token=VALUE with Safaricom.
   Duplicate deliveries are ignored by providerPaymentEvent, keyed on Daraja's CheckoutRequestID. */
async function mpesaCallback(req, env) {
  const token = env.MPESA_CALLBACK_TOKEN;
  if (!token || new URL(req.url).searchParams.get('token') !== token) return new Response(null, { status: 404 });
  const body = await req.json().catch(() => null), cb = body && body.Body && body.Body.stkCallback;
  if (!cb) return new Response(null, { status: 400 });
  const found = await db(env).query('paymentTransactions', { where: [['providerCheckoutId', '==', cb.CheckoutRequestID]], limit: 1 });
  if (!found.length) { console.warn('Unknown CheckoutRequestID', cb.CheckoutRequestID); return Response.json({ ResultCode: 0, ResultDesc: 'Accepted' }); }
  const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
  const receipt = (items.find(i => i.Name === 'MpesaReceiptNumber') || {}).Value || '';
  const outcome = cb.ResultCode === 0 ? 'success' : cb.ResultCode === 1032 ? 'cancelled' : 'failed';
  await runOp(env, 'providerPaymentEvent', null, { txId: found[0].id, eventId: cb.CheckoutRequestID, outcome, providerRef: receipt }, { trustedCaller: true });
  return Response.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

/* ----- File uploads: Cloudflare R2 ----- */
/* What may be uploaded, and where. Keys are always built here, never taken from the browser. */
const RULES = {
  uploads: { types: ['image/jpeg', 'image/png', 'image/webp'], maxMb: 8 },
  chat: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxMb: 10 }
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const URL_TTL = 300;
let s3 = null;
const r2 = env => s3 || (s3 = new S3Client({
  region: 'auto', forcePathStyle: true,
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  /* Newer SDKs add checksum parameters to presigned URLs, which make browser PUTs to R2 fail. */
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
}));

async function uploadUrl(req, env) {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new ApiError(503, 'failed-precondition', 'File uploads are not configured yet.');
  const user = await caller(req, env);
  if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in first.');
  const { fileName, fileType, size, chatId } = await readBody(req);
  const area = chatId ? 'chat' : 'uploads', rule = RULES[area];
  if (!rule.types.includes(fileType)) throw new ApiError(400, 'invalid-argument', 'That file type is not allowed.');
  if (!(Number(size) > 0 && Number(size) <= rule.maxMb * 1024 * 1024)) throw new ApiError(400, 'invalid-argument', `Files must be ${rule.maxMb} MB or smaller.`);
  if (chatId) {
    const c = /^[A-Za-z0-9_-]{3,128}$/.test(chatId) ? await db(env).get('conversations', chatId) : null;
    if (!c || !(c.members || []).includes(user.uid)) throw new ApiError(403, 'permission-denied', 'You cannot upload to that conversation.');
  }
  await rateLimit(env, `upload:${user.uid}`);
  /* A safe, unique key: folder, then a random prefix so nobody can overwrite someone else's file. */
  const base = String(fileName || 'file').split(/[\\/]/).pop().replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'file';
  const key = `${area}/${chatId || user.uid}/${crypto.randomUUID().slice(0, 8)}-${base}.${EXT[fileType]}`;
  const url = await getSignedUrl(r2(env), new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: fileType, ContentLength: Number(size) }), { expiresIn: URL_TTL });
  const publicBase = (env.PUBLIC_BASE || `${new URL(req.url).origin}/files`).replace(/\/+$/, '');
  return { uploadUrl: url, key, publicUrl: `${publicBase}/${key}`, expiresIn: URL_TTL };
}

async function serveFile(req, env, key) {
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders(req, env) });
  const h = new Headers(corsHeaders(req, env));
  obj.writeHttpMetadata(h);
  h.set('ETag', obj.httpEtag);
  h.set('Cache-Control', 'public, max-age=31536000, immutable');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers: h });
}

/* ----- Router ----- */
export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try {
      if (req.method === 'POST') {
        if (pathname === '/create-account') return json(req, env, await trustedOp(req, env, 'registerAccount', await readBody(req)));
        if (pathname === '/op') { const { op, payload } = await readBody(req); return json(req, env, await trustedOp(req, env, String(op || ''), payload)); }
        if (pathname === '/get-upload-url') return json(req, env, await uploadUrl(req, env));
        if (pathname === '/mpesa-callback') return await mpesaCallback(req, env);
      }
      if (req.method === 'GET' && pathname.startsWith('/files/')) {
        const key = decodeURIComponent(pathname.slice(7));
        if (!/^(uploads|chat)\/[A-Za-z0-9_-]{3,128}\/[A-Za-z0-9_.-]{4,100}$/.test(key)) return new Response('Not found', { status: 404 });
        return await serveFile(req, env, key);
      }
      throw new ApiError(404, 'not-found', 'Not found.');
    } catch (e) {
      const err = toApiError(e);
      return json(req, env, { error: { code: err.code, message: err.message } }, err.status);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dailySweep(env));
  }
};
