/* SportsHub-KE server: a Cloudflare Worker. It replaces the Firebase Cloud Functions entirely.
   POST /create-account   Registers the signed-in user (player, coach, facility...): the registerAccount rule.
   POST /op               Any other trusted operation: { op, payload }. Same rules, same transaction guarantees.
   POST /get-upload-url   A presigned R2 PUT address (5 minutes) for a signed-in user.
   GET  /files/<key>      Serves a stored file through the R2 binding (when no public bucket domain is set).
   POST /mpesa-callback   M-Pesa Daraja STK callback, once a provider is installed.
   Emails: every notification an operation writes is also emailed in the SportsHub theme (email.js, Resend).
   Cron (daily 00:05 EAT) Closes expired membership months and sends renewal reminders.
   Every request that changes data carries the user's Firebase ID token, verified against Google's public keys.
   Firestore is reached through its REST API with a service account (firestore.js). Firebase Storage is never used. */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import TrustedOps from './trusted-ops.js';
import { runTransaction, db, autoId, emulated, accessToken } from './firestore.js';
import { emailNotifications, renderEmail, sendEmails } from './email.js';

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
  paymentProvider: env.PAYMENT_PROVIDER || 'mpesa_manual',
  trustedCaller: false,
  relaxAttendance: emulated(env) && env.RELAX_ATTENDANCE === 'true'
});
async function runOp(env, op, uid, payload, extra = {}, ctx = null) {
  const fn = TrustedOps.ops[op];
  if (!fn) throw new ApiError(404, 'not-found', 'Unknown operation.');
  let last;
  const result = await runTransaction(env, async tx => { last = tx; return fn({ uid, now: new Date().toISOString(), tx, nid: newId, env: { ...opEnv(env), ...extra } }, payload || {}); });
  /* Once committed, every notification the operation wrote is also emailed, after the response is sent. */
  const notes = last ? last.created('notifications') : [];
  if (notes.length) { const job = emailNotifications(env, notes).catch(e => console.error('Emails failed:', e)); if (ctx) ctx.waitUntil(job); else await job; }
  return result;
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
  simulation: { start: async () => ({}) },
  /* Lipa na M-Pesa Send Money: the member pays the platform number and submits the code (paymentSubmitCode);
     an administrator confirms it (paymentReview). Nothing to start here. */
  mpesa_manual: { start: async () => ({}) }
  /* mpesa: { start: async (env, tx) => { call Daraja STK Push, then return { providerCheckoutId } } } */
};

async function trustedOp(req, env, op, payload, ctx) {
  const user = await caller(req, env), uid = user ? user.uid : null;
  if (op === 'bootstrapPlatform') { if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in first.'); return bootstrap(env, user, payload); }
  if (!uid && !TrustedOps.PUBLIC_OPS.includes(op)) throw new ApiError(401, 'unauthenticated', 'Please sign in first.');
  if (op === 'providerPaymentEvent') throw new ApiError(403, 'permission-denied', 'Not available.');
  await rateLimit(env, uid || `ip:${req.headers.get('CF-Connecting-IP') || 'unknown'}`);
  /* Emails go to the address on the account; when the form left it blank, use the verified sign-in email. */
  if (op === 'registerAccount' && user.email && !(payload && payload.email)) payload = { ...(payload || {}), email: user.email };
  const result = await runOp(env, op, uid, payload, {}, ctx);
  /* Hand off to the configured provider once the pending transaction is safely stored. */
  const providerName = env.PAYMENT_PROVIDER || 'mpesa_manual';
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
  const notes = due.map(d => ({ uid: d.uid, type: 'membership', title: 'Membership renews soon', body: 'Your month ends in the next three days. Renew to keep your sessions coming.', link: '/app/membership', read: false, at: now, channels: ['in_app', 'email'] }));
  await db(env).commit(t => notes.forEach(n => t.set('notifications', autoId(), n)));
  await emailNotifications(env, notes).catch(e => console.error('Emails failed:', e));
}

/* M-Pesa Daraja STK callback. Set the MPESA_CALLBACK_TOKEN secret and register .../mpesa-callback?token=VALUE with Safaricom.
   Duplicate deliveries are ignored by providerPaymentEvent, keyed on Daraja's CheckoutRequestID. */
async function mpesaCallback(req, env, ctx) {
  const token = env.MPESA_CALLBACK_TOKEN;
  if (!token || new URL(req.url).searchParams.get('token') !== token) return new Response(null, { status: 404 });
  const body = await req.json().catch(() => null), cb = body && body.Body && body.Body.stkCallback;
  if (!cb) return new Response(null, { status: 400 });
  const found = await db(env).query('paymentTransactions', { where: [['providerCheckoutId', '==', cb.CheckoutRequestID]], limit: 1 });
  if (!found.length) { console.warn('Unknown CheckoutRequestID', cb.CheckoutRequestID); return Response.json({ ResultCode: 0, ResultDesc: 'Accepted' }); }
  const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
  const receipt = (items.find(i => i.Name === 'MpesaReceiptNumber') || {}).Value || '';
  const outcome = cb.ResultCode === 0 ? 'success' : cb.ResultCode === 1032 ? 'cancelled' : 'failed';
  await runOp(env, 'providerPaymentEvent', null, { txId: found[0].id, eventId: cb.CheckoutRequestID, outcome, providerRef: receipt }, { trustedCaller: true }, ctx);
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

/* ----- Password reset, sent as a SportsHub email -----
   Firebase's own reset email comes from a shared firebaseapp.com address that inboxes often file as spam.
   Here Firebase Auth makes the one-time code, and the email goes from the SportsHub domain (signed for it in Resend)
   with a link to the site's own reset page, which signs the member in and sends them on to their dashboard.
   The answer is the same whether or not the address has an account, so nobody can probe for members. */
async function passwordReset(req, env) {
  const { email } = await readBody(req), addr = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) || addr.length > 200) throw new ApiError(400, 'invalid-argument', 'Enter a valid email address.');
  await rateLimit(env, `reset:${req.headers.get('CF-Connecting-IP') || 'unknown'}`);
  /* Until SportsHub email is set up, the browser asks Firebase to send its standard email instead. */
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { fallback: true };
  const idt = env.FIREBASE_AUTH_EMULATOR_HOST ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const r = await fetch(`${idt}/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:sendOobCode`, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: addr, returnOobLink: true })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.oobLink) {
    if (/EMAIL_NOT_FOUND|USER_NOT_FOUND/.test((j.error && j.error.message) || '')) return { ok: true };
    console.error('Reset link failed:', r.status, j.error && j.error.message);
    return { fallback: true };
  }
  const code = new URL(j.oobLink).searchParams.get('oobCode');
  const site = (env.SITE_URL || 'https://sportshub.co.ke').replace(/\/+$/, '');
  const url = `${site}/auth/action/?mode=resetPassword&oobCode=${encodeURIComponent(code)}`;
  const { html, text } = renderEmail({ site, name: '', type: 'account', title: 'Reset your SportsHub-KE password',
    body: `We received a request to reset the password for ${addr}. Choose a new password with the button below. The link works for one hour and only once.`,
    url, cta: 'Choose a new password', note: 'If you did not ask for this, you can ignore this email. Your password stays the same.' });
  const sent = await sendEmails(env, [{ from: env.EMAIL_FROM, to: [addr], subject: 'Reset your SportsHub-KE password', html, text, ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}) }]);
  return sent ? { ok: true } : { fallback: true };
}

/* ----- Live sitemap: every public record, so Google finds each game, venue, coach, team and product -----
   Declared in the site's robots.txt. Only public records are listed (the Worker reads past the security rules). */
async function sitemap(env, ctx, req) {
  const cache = caches.default, key = new Request(new URL('/sitemap.xml', req.url).href);
  const hit = await cache.match(key); if (hit) return hit;
  const site = (env.SITE_URL || 'https://sportshub.co.ke').replace(/\/+$/, ''), now = new Date().toISOString(), d = db(env);
  const q = (c, where, limit = 500) => d.query(c, { where, limit }).catch(() => []);
  const [games, facilities, coaches, teams, tournaments, products, stores, athletes] = await Promise.all([
    q('games', [['status', '==', 'open'], ['start', '>=', now]]), q('facilities', [['status', '==', 'approved']]), q('coaches', [['verified', '==', true]]),
    q('teams', []), q('tournaments', []), q('products', [['status', '==', 'active']]), q('vendors', [['status', '==', 'approved']]), q('playerProfiles', [['visibility', '==', 'public']])
  ]);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const day = r => String(r.updatedAt || r.createdAt || r.submittedAt || now).slice(0, 10);
  const rows = [
    ...games.map(r => [`/games/view/?id=${r.id}`, day(r), 'daily', '0.6']), ...facilities.map(r => [`/facilities/view/?id=${r.id}`, day(r), 'weekly', '0.8']),
    ...coaches.map(r => [`/coaches/view/?id=${r.id}`, day(r), 'weekly', '0.7']), ...teams.map(r => [`/teams/view/?id=${r.id}`, day(r), 'weekly', '0.6']),
    ...tournaments.filter(r => r.status !== 'draft').map(r => [`/tournaments/view/?id=${r.id}`, day(r), 'daily', '0.7']), ...products.map(r => [`/marketplace/product/?id=${r.id}`, day(r), 'weekly', '0.5']),
    ...stores.map(r => [`/marketplace/store/?id=${r.id}`, day(r), 'weekly', '0.5']), ...athletes.filter(r => !r.isMinor).map(r => [`/athletes/profile/?id=${r.id}`, day(r), 'weekly', '0.5'])
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map(([p, m, f, pr]) => `  <url><loc>${esc(site + p)}</loc><lastmod>${m}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`;
  const res = new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ----- Router ----- */
export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try {
      if (req.method === 'POST') {
        if (pathname === '/create-account') return json(req, env, await trustedOp(req, env, 'registerAccount', await readBody(req), ctx));
        if (pathname === '/op') { const { op, payload } = await readBody(req); return json(req, env, await trustedOp(req, env, String(op || ''), payload, ctx)); }
        if (pathname === '/password-reset') return json(req, env, await passwordReset(req, env));
        if (pathname === '/get-upload-url') return json(req, env, await uploadUrl(req, env));
        if (pathname === '/mpesa-callback') return await mpesaCallback(req, env, ctx);
      }
      if (req.method === 'GET' && pathname === '/sitemap.xml') return await sitemap(env, ctx, req);
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
