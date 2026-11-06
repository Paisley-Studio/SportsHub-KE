// SportsHub-KE trusted backend.
// Every sensitive change goes through `trustedOp`, inside a Firestore transaction.
// Business rules live in trusted-ops.js.
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const TrustedOps = require('./trusted-ops.js');

admin.initializeApp();
const fs = admin.firestore();
fs.settings({ ignoreUndefinedProperties: true });
setGlobalOptions({ region: 'europe-west1', maxInstances: 20 });

/* ----- Environment. Set these in functions/.env (see README). ----- */
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'simulation';
/* Off unless explicitly enabled. In a live project, leaving this off makes simulated success impossible. */
const ALLOW_SIMULATED = process.env.ALLOW_SIMULATED_PAYMENTS === 'true' || !!process.env.FUNCTIONS_EMULATOR;
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || "").toLowerCase();
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 90);

const newId = pre => `${pre}_${fs.collection('_').doc().id}`;

/* Transaction adapter: gives the business rules a small, testable interface over Firestore.
   Reads see earlier writes in the same operation. Writes are buffered and applied last,
   which also satisfies Firestore's requirement that all reads come before writes. */
function makeTx(t) {
  const sets = new Map(), patches = new Map(), dels = new Set(), key = (c, i) => `${c}/${i}`;
  const ref = (c, i) => fs.collection(c).doc(String(i));
  return {
    async get(c, i) {
      const k = key(c, i);
      if (dels.has(k)) return null;
      if (sets.has(k)) return JSON.parse(JSON.stringify({ id: i, ...sets.get(k) }));
      const snap = await t.get(ref(c, i));
      if (!snap.exists) return null;
      return JSON.parse(JSON.stringify({ id: snap.id, ...snap.data(), ...(patches.get(k) || {}) }));
    },
    async query(c, q = {}) {
      let query = fs.collection(c);
      (q.where || []).forEach(([f, op, v]) => { query = query.where(f, op, v); });
      if (q.orderBy) query = query.orderBy(q.orderBy[0], q.orderBy[1] || 'asc');
      if (q.limit) query = query.limit(q.limit);
      const snap = await t.get(query);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    set(c, i, d) { const k = key(c, i); dels.delete(k); patches.delete(k); sets.set(k, { ...d }); },
    update(c, i, p) {
      const k = key(c, i);
      if (sets.has(k)) sets.set(k, { ...sets.get(k), ...p });
      else patches.set(k, { ...(patches.get(k) || {}), ...p });
    },
    del(c, i) { const k = key(c, i); sets.delete(k); patches.delete(k); dels.add(k); },
    commit() {
      sets.forEach((d, k) => t.set(fs.doc(k), d));
      patches.forEach((p, k) => t.update(fs.doc(k), p));
      dels.forEach(k => t.delete(fs.doc(k)));
    }
  };
}
const GRPC = new Set(['invalid-argument', 'failed-precondition', 'not-found', 'already-exists', 'permission-denied', 'unauthenticated', 'resource-exhausted']);
const toHttps = e => {
  if (e instanceof TrustedOps.OpError || e.name === 'OpError') return new HttpsError(GRPC.has(e.code) ? e.code : 'failed-precondition', e.message, { code: e.code });
  logger.error(e);
  return new HttpsError('internal', 'Something went wrong. Please try again.');
};
async function runOp(op, uid, payload, env = {}) {
  const fn = TrustedOps.ops[op];
  if (!fn) throw new HttpsError('not-found', 'Unknown operation.');
  return fs.runTransaction(async t => {
    const tx = makeTx(t);
    const r = await fn({ uid, now: new Date().toISOString(), tx, nid: newId, env: { allowSimulation: ALLOW_SIMULATED, paymentProvider: PAYMENT_PROVIDER, trustedCaller: false, relaxAttendance: !!process.env.FUNCTIONS_EMULATOR && process.env.RELAX_ATTENDANCE === 'true', ...env } }, payload);
    tx.commit();
    return r;
  });
}
/* Fixed-window rate limit per user or address. */
async function rateLimit(id) {
  const ref = fs.collection('rateLimits').doc(id.replace(/[^\w.:-]/g, '_').slice(0, 120)), minute = Math.floor(Date.now() / 60000);
  const over = await fs.runTransaction(async t => {
    const s = await t.get(ref), d = s.exists ? s.data() : {};
    const count = d.minute === minute ? (d.count || 0) + 1 : 1;
    t.set(ref, { minute, count });
    return count > RATE_LIMIT_PER_MINUTE;
  });
  if (over) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment.');
}

/* Payment providers. A provider starts a payment and later confirms it through a webhook;
   only that webhook, never the browser, can mark a transaction successful. */
const PROVIDERS = {
  simulation: { start: async () => ({}) }
  /* mpesa: { start: async tx => { call Daraja STK Push, then return { providerCheckoutId } } } */
};

exports.trustedOp = onCall({ cors: true }, async req => {
  const { op, payload } = req.data || {};
  const uid = req.auth ? req.auth.uid : null;
  try {
    if (op === 'bootstrapPlatform') return await bootstrap(req);
    if (!uid && !TrustedOps.PUBLIC_OPS.includes(op)) throw new HttpsError('unauthenticated', 'Please sign in first.');
    if (op === 'providerPaymentEvent') throw new HttpsError('permission-denied', 'Not available.');
    await rateLimit(uid || `ip:${req.rawRequest.ip}`);
    const result = await runOp(op, uid, payload || {});
    /* Hand off to the configured provider once the pending transaction is safely stored. */
    if (result && result.txId && PAYMENT_PROVIDER !== 'simulation' && ['paymentInitiate', 'placeOrder'].includes(op)) {
      const provider = PROVIDERS[PAYMENT_PROVIDER];
      if (!provider) throw new HttpsError('failed-precondition', `Payment provider "${PAYMENT_PROVIDER}" is not installed.`);
      const started = await provider.start({ ...result, uid, phone: payload && payload.phone });
      if (started && started.providerCheckoutId) await fs.collection('paymentTransactions').doc(result.txId).update({ providerCheckoutId: started.providerCheckoutId });
    }
    return result === undefined ? null : result;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw toHttps(e);
  }
});

/* ----- File storage: Cloudflare R2 (Firebase Storage is not used) -----
   The browser asks for a signed PUT address, uploads straight to R2, and stores the public URL.
   Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE in functions/.env. */
const R2 = {
  account: process.env.R2_ACCOUNT_ID || '', key: process.env.R2_ACCESS_KEY_ID || '', secret: process.env.R2_SECRET_ACCESS_KEY || '',
  bucket: process.env.R2_BUCKET || '', publicBase: (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '')
};
const UPLOAD_RULES = [
  /* Profile photos, logos, facility photos and documents: only into the uploader's own folder. */
  { re: /^uploads\/([A-Za-z0-9_-]{6,128})\/[A-Za-z0-9_.-]{4,80}$/, types: ['image/jpeg', 'image/png', 'image/webp'], maxMb: 8, allow: async (uid, m) => m[1] === uid },
  /* Chat attachments: only members of the conversation. */
  { re: /^chat\/([A-Za-z0-9_-]{3,128})\/[A-Za-z0-9_.-]{4,80}$/, types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxMb: 10, allow: async (uid, m) => { const c = await fs.collection('conversations').doc(m[1]).get(); return c.exists && (c.data().members || []).includes(uid); } }
];
let s3 = null;
const r2Client = () => {
  if (s3) return s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({ region: 'auto', endpoint: `https://${R2.account}.r2.cloudflarestorage.com`, forcePathStyle: true, credentials: { accessKeyId: R2.key, secretAccessKey: R2.secret }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  return s3;
};
exports.mediaUploadUrl = onCall({ cors: true }, async req => {
  const uid = req.auth ? req.auth.uid : null;
  if (!uid) throw new HttpsError('unauthenticated', 'Please sign in first.');
  if (!R2.account || !R2.key || !R2.secret || !R2.bucket || !R2.publicBase) throw new HttpsError('failed-precondition', 'File uploads are not configured yet. The administrator needs to add the Cloudflare R2 settings.');
  const { path, contentType, size } = req.data || {};
  const rule = UPLOAD_RULES.find(r => r.re.test(String(path || '')));
  if (!rule) throw new HttpsError('invalid-argument', 'That upload location is not allowed.');
  if (!rule.types.includes(contentType)) throw new HttpsError('invalid-argument', 'That file type is not allowed.');
  if (!(Number(size) > 0 && Number(size) <= rule.maxMb * 1024 * 1024)) throw new HttpsError('invalid-argument', `Files must be ${rule.maxMb} MB or smaller.`);
  if (!(await rule.allow(uid, String(path).match(rule.re)))) throw new HttpsError('permission-denied', 'You cannot upload there.');
  await rateLimit(`upload:${uid}`);
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const uploadUrl = await getSignedUrl(r2Client(), new PutObjectCommand({ Bucket: R2.bucket, Key: path, ContentType: contentType, ContentLength: Number(size) }), { expiresIn: 300 });
  return { uploadUrl, publicUrl: `${R2.publicBase}/${path}` };
});

/* First-run setup. Only the signed-in user whose email equals SUPERADMIN_EMAIL can run it. */
async function bootstrap(req) {
  const email = (req.auth && req.auth.token.email || '').toLowerCase();
  /* On local emulators with no SUPERADMIN_EMAIL set, the first account to run setup becomes super administrator. */
  const localFirstRun = !!process.env.FUNCTIONS_EMULATOR && !SUPERADMIN_EMAIL && (await fs.collection('adminRoles').limit(1).get()).empty;
  if (!localFirstRun && (!SUPERADMIN_EMAIL || email !== SUPERADMIN_EMAIL)) throw new HttpsError('permission-denied', 'Only the configured super administrator can run setup.');
  const uid = req.auth.uid, batch = fs.batch(), sports = (req.data.payload && req.data.payload.sports) || [];
  const user = await fs.collection('users').doc(uid).get();
  if (!user.exists) throw new HttpsError('failed-precondition', 'Complete your own registration first.');
  batch.set(fs.collection('adminRoles').doc(uid), { uid, name: user.data().name, role: 'super', assignedBy: 'bootstrap', at: new Date().toISOString() });
  batch.update(user.ref, { roles: [...new Set([...(user.data().roles || []), 'admin'])] });
  batch.set(fs.collection('systemSettings').doc('platform'), TrustedOps.DEFAULT_SETTINGS, { merge: true });
  sports.slice(0, 100).forEach(s => batch.set(fs.collection('sports').doc(String(s.id)), s, { merge: true }));
  batch.set(fs.collection('auditLogs').doc(), { actorId: uid, action: 'platform.bootstrap', target: '', meta: { sports: sports.length }, at: new Date().toISOString() });
  await batch.commit();
  return { ok: true, sports: sports.length };
}

/* Daily: close expired membership months, release stale reservations and send renewal reminders. */
exports.dailyMembershipSweep = onSchedule({ schedule: 'every day 00:05', timeZone: 'Africa/Nairobi' }, async () => {
  for (let pass = 0; pass < 20; pass++) {
    const r = await runOp('sweepMemberships', null, {}, { trustedCaller: true });
    if (r.closed + r.released === 0) break;
  }
  const soon = new Date(Date.now() + 3 * 864e5).toISOString(), now = new Date().toISOString();
  const due = await fs.collection('membershipPeriods').where('status', '==', 'active').where('end', '<=', soon).where('end', '>', now).limit(400).get();
  const batch = fs.batch();
  due.docs.forEach(d => batch.set(fs.collection('notifications').doc(), { uid: d.data().uid, type: 'membership', title: 'Membership renews soon', body: `Your month ends in the next three days.`, link: '/app/membership', read: false, at: now, channels: ['in_app'] }));
  await batch.commit();
});

/* M-Pesa Daraja STK callback, ready for when the provider is installed.
   Set MPESA_CALLBACK_TOKEN and register .../mpesaCallback?token=VALUE with Safaricom.
   Duplicate deliveries are ignored by applyPaymentEvent, keyed on Daraja's CheckoutRequestID. */
exports.mpesaCallback = onRequest(async (req, res) => {
  const token = process.env.MPESA_CALLBACK_TOKEN;
  if (!token || req.query.token !== token || req.method !== 'POST') { res.status(404).end(); return; }
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!cb) { res.status(400).end(); return; }
    const found = await fs.collection('paymentTransactions').where('providerCheckoutId', '==', cb.CheckoutRequestID).limit(1).get();
    if (found.empty) { logger.warn('Unknown CheckoutRequestID', cb.CheckoutRequestID); res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); return; }
    const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
    const receipt = (items.find(i => i.Name === 'MpesaReceiptNumber') || {}).Value || '';
    const outcome = cb.ResultCode === 0 ? 'success' : cb.ResultCode === 1032 ? 'cancelled' : 'failed';
    await runOp('providerPaymentEvent', null, { txId: found.docs[0].id, eventId: cb.CheckoutRequestID, outcome, providerRef: receipt }, { trustedCaller: true });
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (e) { logger.error(e); res.status(500).end(); }
});
