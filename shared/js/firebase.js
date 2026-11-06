/* ==========================================================================
   SPORTSHUB-KE DATA LAYER
   Every page talks to Firebase only through db, auth, callOp and backend.upload.
   Sensitive changes go through callOp to the SportsHub Cloudflare Worker (worker/),
   which checks the user's Firebase sign-in token and writes to Firestore itself.
   Firebase Storage is never used. backend.upload sends files to Cloudflare R2
   with a short-lived signed URL issued by the same Worker.
   ========================================================================== */
import { ACTIVE_CONFIG, IS_CONFIGURED, USE_EMULATORS, FIREBASE_SDK_VERSION, API_URL } from './config.js';

let fs, fbAuth, authApi, F;
export const genId = pre => `${pre}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const toQuery = (c, q = {}) => {
  const parts = [F.collection(fs, c)];
  (q.where || []).forEach(([f, op, v]) => parts.push(F.where(f, op, v)));
  if (q.orderBy) parts.push(F.orderBy(q.orderBy[0], q.orderBy[1] || 'asc'));
  if (q.limit) parts.push(F.limit(q.limit));
  return F.query(...parts);
};
const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
const friendly = e => (e && e.code === 'permission-denied' ? new Error('You do not have access to that.') : e);

/* ----- Instant pages: a stale-while-revalidate read cache -----
   While a page first loads, reads are answered from what this device saw last time, so the page draws at once.
   Every answer used is then fetched live in the background; if anything changed, the page redraws (ui.js).
   Entries are per signed-in user, are cleared by any write or sign-out, and never hold more than about 250 KB each. */
const CK = 'shke.c2.';
const who = () => (fbAuth && fbAuth.currentUser ? fbAuth.currentUser.uid : 'anon');
let instant = false;
const usedFromCache = [];
const cRead = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; } };
const cWrite = (k, v) => {
  try { const str = JSON.stringify(v); if (str.length < 250000) localStorage.setItem(k, str); }
  catch (e) { cacheClear(true); /* Storage full: start again. */ }
};
export const cacheClear = (everyone = false) => {
  try { const mine = `${CK}${who()}|`; Object.keys(localStorage).filter(k => k.startsWith(CK) && (everyone || k.startsWith(mine) || k.startsWith(`${CK}anon|`))).forEach(k => localStorage.removeItem(k)); } catch (e) { /* no storage */ }
};
export const instantPages = {
  start() { instant = true; usedFromCache.length = 0; },
  /* Ends the instant window and returns the cached answers that were used. */
  stop() { instant = false; return usedFromCache.splice(0); },
  /* Fetches those answers live, stores them, and resolves true if any differ from what was shown. */
  async changed(list) {
    let diff = false;
    await Promise.all(list.map(async ({ k, live, old }) => {
      try { const fresh = await live(); cWrite(k, fresh); if (JSON.stringify(fresh) !== JSON.stringify(old)) diff = true; } catch (e) { /* keep what is shown */ }
    }));
    return diff;
  }
};
/* Queries such as "games starting from now" carry the current time; for the cache key, any time within
   a few hours of now counts as "now", so the page still opens instantly (the live check corrects it). */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const keyOf = args => JSON.stringify(args === undefined ? null : args, (k, v) => (typeof v === 'string' && ISO.test(v) && Math.abs(Date.parse(v) - Date.now()) < 6 * 3600e3 ? '@now' : v));
const cached = async (kind, c, args, live) => {
  const k = `${CK}${who()}|${kind}|${c}|${keyOf(args)}`;
  if (instant) { const hit = cRead(k); if (hit !== undefined) { usedFromCache.push({ k, live, old: hit }); return hit; } }
  const v = await live(); cWrite(k, v); return v;
};
const liveGet = async (c, i) => { const d = await F.getDoc(F.doc(fs, c, i)); return d.exists() ? { id: d.id, ...d.data() } : null; };
const writeDone = () => cacheClear();

export const db = {
  /* fresh: skip the instant cache (used for access checks such as administrator roles). */
  async get(c, i, fresh = false) {
    try { if (fresh) { const v = await liveGet(c, i); cWrite(`${CK}${who()}|get|${c}|${keyOf(i)}`, v); return v; } return await cached('get', c, i, () => liveGet(c, i)); }
    catch (e) { if (e.code === 'permission-denied') return null; throw e; }
  },
  /* A query the user may not read, or one whose index is missing or still building (failed-precondition),
     returns no rows instead of failing the whole page. The console keeps the index link for the administrator. */
  async list(c, q) {
    try { return await cached('list', c, q, async () => rows(await F.getDocs(toQuery(c, q)))); }
    catch (e) {
      if (e.code === 'failed-precondition') { console.error(`Query on ${c} needs a Firestore index (it may still be building):`, e.message); return []; }
      console.warn(`Query on ${c} failed:`, e.message); if (e.code === 'permission-denied') return []; throw friendly(e);
    }
  },
  async count(c, q) {
    try { return await cached('count', c, q && q.where, async () => (await F.getCountFromServer(toQuery(c, { where: q && q.where }))).data().count); }
    catch (e) { console.warn(`Count on ${c} failed:`, e.message); return 0; }
  },
  async add(c, d) { try { const id = (await F.addDoc(F.collection(fs, c), d)).id; writeDone(); return id; } catch (e) { throw friendly(e); } },
  async set(c, i, d) { try { await F.setDoc(F.doc(fs, c, i), d); writeDone(); } catch (e) { throw friendly(e); } },
  async update(c, i, p) { try { await F.setDoc(F.doc(fs, c, i), p, { merge: true }); writeDone(); } catch (e) { throw friendly(e); } },
  async remove(c, i) { try { await F.deleteDoc(F.doc(fs, c, i)); writeDone(); } catch (e) { throw friendly(e); } },
  watch(c, q, cb) { return F.onSnapshot(toQuery(c, q), s => cb(rows(s)), e => { console.warn(`Listener on ${c} failed:`, e.message); cb([]); }); },
  watchDoc(c, i, cb) { return F.onSnapshot(F.doc(fs, c, i), d => cb(d.exists() ? { id: d.id, ...d.data() } : null), e => { console.warn(`Listener on ${c}/${i} failed:`, e.message); cb(null); }); }
};
export const auth = {
  uid: () => (fbAuth.currentUser ? fbAuth.currentUser.uid : null),
  /* Name, email and photo from the sign-in provider, used to prefill registration. */
  current: () => { const u = fbAuth && fbAuth.currentUser; return u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '', provider: (u.providerData[0] || {}).providerId || 'password' } : null; },
  onChange(cb) { authApi.onAuthStateChanged(fbAuth, u => cb(u ? u.uid : null)); },
  async signIn(email, password) { await authApi.signInWithEmailAndPassword(fbAuth, email, password); },
  async signUp(email, password) { const c = await authApi.createUserWithEmailAndPassword(fbAuth, email, password); return c.user.uid; },
  /* Google sign-in. Falls back to a full-page redirect when the browser blocks popups. */
  async google() {
    const provider = new authApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try { const c = await authApi.signInWithPopup(fbAuth, provider); return c.user.uid; }
    catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') { try { sessionStorage.setItem('shke.gredirect', '1'); } catch (x) { /* no session storage */ } await authApi.signInWithRedirect(fbAuth, provider); return null; }
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') { const err = new Error('Google sign-in was closed before it finished.'); err.name = 'Handled'; throw err; }
      if (e.code === 'auth/unauthorized-domain') throw new Error('This web address is not yet authorised for Google sign-in. Add it under Firebase console > Authentication > Settings > Authorised domains.');
      if (e.code === 'auth/operation-not-allowed') throw new Error('Google sign-in is not enabled yet. Turn it on under Firebase console > Authentication > Sign-in method.');
      throw e;
    }
  },
  async signOut() { cacheClear(); await authApi.signOut(fbAuth); },
  /* Password reset. The SportsHub server sends a branded email from the SportsHub domain (not filed as spam),
     linking to /auth/action/. If its email is not set up yet, Firebase sends its standard email, whose page
     then offers a Continue button back to sign-in. */
  async reset(email) {
    const r = await api('/password-reset', { email }).catch(e => { if (e.code === 'invalid-argument' || e.code === 'resource-exhausted') throw e; return { fallback: true }; });
    if (!r || !r.fallback) return;
    const back = { url: `${location.origin}/auth/login/?reset=1` };
    try { await authApi.sendPasswordResetEmail(fbAuth, email, back); }
    catch (e) {
      if (e.code === 'auth/user-not-found') return; /* Same answer either way, so addresses cannot be probed. */
      if (/continue-uri|unauthorized/i.test(e.code || '')) { await authApi.sendPasswordResetEmail(fbAuth, email).catch(() => {}); return; }
      if (e.code === 'auth/too-many-requests') throw new Error('Too many reset requests. Please wait a few minutes and try again.');
      throw e;
    }
  },
  /* The reset page: check the link, then save the new password. */
  verifyReset: code => authApi.verifyPasswordResetCode(fbAuth, code),
  confirmReset: (code, password) => authApi.confirmPasswordReset(fbAuth, code, password)
};
const emulatorsUp = async () => {
  try { const c = new AbortController(), t = setTimeout(() => c.abort(), 2500); await fetch(`http://${location.hostname}:8080/`, { signal: c.signal, mode: 'no-cors' }); clearTimeout(t); return true; }
  catch (e) { return false; }
};
export const backend = {
  /* Resolves to { ok } so pages can show the setup screen instead of hanging. */
  async init() {
    if (!IS_CONFIGURED && !USE_EMULATORS) return { ok: false };
    if (USE_EMULATORS && !(await emulatorsUp())) return { ok: false, reason: 'The Firebase emulators are not running.' };
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    const [app, a, f] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`)]);
    const fa = app.initializeApp(ACTIVE_CONFIG);
    F = f; authApi = a;
    fs = f.getFirestore(fa); fbAuth = a.getAuth(fa);
    if (USE_EMULATORS) {
      f.connectFirestoreEmulator(fs, location.hostname, 8080);
      a.connectAuthEmulator(fbAuth, `http://${location.hostname}:9099`, { disableWarnings: true });
    }
    /* Completes a Google sign-in that had to fall back to a redirect. Only checked when one was started,
       so ordinary page loads never wait on the sign-in helper. */
    let redirecting = false; try { redirecting = !!sessionStorage.getItem('shke.gredirect'); sessionStorage.removeItem('shke.gredirect'); } catch (e) { /* no session storage */ }
    if (redirecting) await a.getRedirectResult(fbAuth).catch(e => console.warn('Google redirect sign-in failed:', e.message));
    return { ok: true };
  },
  /* Cloudflare R2 upload. The Worker checks who you are, what the file is and where it may go,
     then returns a signed PUT address that works for a few minutes. Resolves to the public file URL. */
  async upload(blob, path) {
    const [, chatId] = String(path).match(/^chat\/([^/]+)\//) || [];
    const r = await api('/get-upload-url', { fileName: String(path).split('/').pop(), fileType: blob.type, size: blob.size, chatId }, 'The upload could not be prepared.');
    const put = await fetch(r.uploadUrl, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob }).catch(() => null);
    if (!put || !put.ok) throw new Error('The file could not be uploaded. Please try again.');
    return r.publicUrl;
  }
};
/* POST to the SportsHub Worker with the user's Firebase ID token. Errors keep the server's code (e.g. 'slot-conflict'). */
async function api(path, body, fallback = 'Something went wrong.') {
  if (!API_URL) throw new Error('The SportsHub server address is not set (WORKER_URL in shared/js/config.js).');
  const headers = { 'Content-Type': 'application/json' }, u = fbAuth && fbAuth.currentUser;
  if (u) headers.Authorization = `Bearer ${await u.getIdToken()}`;
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) }).catch(() => null);
  if (!res) throw new Error('Could not reach the SportsHub server. Check your connection and try again.');
  const out = await res.json().catch(() => null);
  if (!res.ok) { const err = new Error((out && out.error && out.error.message) || fallback); err.code = out && out.error && out.error.code; throw err; }
  if (path !== '/get-upload-url') cacheClear(); /* Something changed on the server: the next page reads live data. */
  return out;
}
/* Trusted operations run on the Worker. Account creation has its own endpoint; everything else goes through /op. */
export const callOp = (op, payload) => op === 'registerAccount'
  ? api('/create-account', payload || {})
  : api('/op', { op, payload: payload || {} });
/* Payment service. New providers plug in on the server; pages never change.
   Completion is only ever decided on the backend, by the provider's webhook. */
export const PaymentService = {
  start: (type, extra = {}) => callOp('paymentInitiate', { type, ...extra }),
  simulate: (txId, outcome, eventId) => callOp('paymentSimulateOutcome', { txId, outcome, eventId: eventId || genId('evt') })
};
