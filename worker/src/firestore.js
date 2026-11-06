/* Firestore through its REST API, as a trusted server (a Google service account), for the Worker.
   Gives the business rules the same small transaction interface they had under the Admin SDK:
   get, query, set, update, del. Reads see earlier writes in the same operation; writes are buffered
   and sent in one atomic commit. Firestore retries are handled here. */

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const te = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(te.encode(s));

/* Local testing against the Firebase emulators (set in worker/.dev.vars only). */
export const emulated = env => !!env.FIRESTORE_EMULATOR_HOST;
const base = env => emulated(env) ? `http://${env.FIRESTORE_EMULATOR_HOST}/v1` : 'https://firestore.googleapis.com/v1';
const root = env => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/* ----- Service account access token (cached for most of its hour) ----- */
let token = null, tokenUntil = 0;
async function accessToken(env) {
  if (emulated(env)) return 'owner';
  if (token && Date.now() < tokenUntil) return token;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is not set.');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT), now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }))}.${b64uStr(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64u(sig)}`
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Google token exchange failed: ${j.error_description || j.error || r.status}`);
  token = j.access_token; tokenUntil = Date.now() + (Number(j.expires_in || 3600) - 300) * 1000;
  return token;
}

class FirestoreError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function call(env, method, path, body) {
  const r = await fetch(`${base(env)}/${path}`, {
    method, headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new FirestoreError(r.status, (j.error && j.error.message) || `Firestore ${r.status}`);
  return j;
}

/* ----- Values: plain JSON in the business rules, typed values on the wire ----- */
const enc = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter(x => x !== undefined).map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
  return { stringValue: String(v) };
};
const encFields = o => Object.fromEntries(Object.entries(o || {}).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)]));
const dec = v => {
  if (!v || 'nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).toISOString();
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields);
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  return null;
};
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, x]) => [k, dec(x)]));
const fromDoc = d => ({ id: d.name.split('/').pop(), ...decFields(d.fields) });

/* Field paths: a plain key is one segment; anything unusual is quoted. Queries treat dots as nesting. */
const seg = s => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '`' + s.replace(/[`\\]/g, '\\$&') + '`';
const pathOf = f => String(f).split('.').map(seg).join('.');
const OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS', 'array-contains-any': 'ARRAY_CONTAINS_ANY', in: 'IN', 'not-in': 'NOT_IN' };
const filter = ([f, op, v]) => {
  if (v === null && (op === '==' || op === '!=')) return { unaryFilter: { field: { fieldPath: pathOf(f) }, op: op === '==' ? 'IS_NULL' : 'IS_NOT_NULL' } };
  if (!OPS[op]) throw new Error(`Unsupported query operator ${op}`);
  return { fieldFilter: { field: { fieldPath: pathOf(f) }, op: OPS[op], value: enc(v) } };
};
const structured = (c, q = {}) => {
  const s = { from: [{ collectionId: c }] }, w = q.where || [];
  if (w.length === 1) s.where = filter(w[0]);
  else if (w.length > 1) s.where = { compositeFilter: { op: 'AND', filters: w.map(filter) } };
  if (q.orderBy) s.orderBy = [{ field: { fieldPath: pathOf(q.orderBy[0]) }, direction: (q.orderBy[1] || 'asc') === 'desc' ? 'DESCENDING' : 'ASCENDING' }];
  if (q.limit) s.limit = q.limit;
  return s;
};

const AUTO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const autoId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), b => AUTO[b % 62]).join('');

/* The transaction adapter handed to the business rules. */
function makeTx(env, transaction) {
  const sets = new Map(), patches = new Map(), merges = new Map(), dels = new Set(), key = (c, i) => `${c}/${i}`;
  const name = k => `${root(env)}/${k}`;
  return {
    async get(c, i) {
      const k = key(c, i);
      if (dels.has(k)) return null;
      if (sets.has(k)) return JSON.parse(JSON.stringify({ id: String(i), ...sets.get(k) }));
      /* batchGet rather than a single-document GET: same result, and it also works inside emulator transactions. */
      const [row] = await call(env, 'POST', `${root(env)}:batchGet`, { documents: [name(k)], ...(transaction ? { transaction } : {}) });
      const d = row && row.found;
      if (!d) return null;
      return JSON.parse(JSON.stringify({ ...fromDoc(d), ...(patches.get(k) || {}) }));
    },
    async query(c, q = {}) {
      const rows = await call(env, 'POST', `${root(env)}:runQuery`, { structuredQuery: structured(c, q), ...(transaction ? { transaction } : {}) });
      return (rows || []).filter(r => r.document).map(r => fromDoc(r.document));
    },
    set(c, i, d) { const k = key(c, i); dels.delete(k); patches.delete(k); sets.set(k, { ...d }); },
    update(c, i, p) {
      const k = key(c, i);
      if (sets.has(k)) sets.set(k, { ...sets.get(k), ...p });
      else patches.set(k, { ...(patches.get(k) || {}), ...p });
    },
    del(c, i) { const k = key(c, i); sets.delete(k); patches.delete(k); merges.delete(k); dels.add(k); },
    /* Like set(..., { merge: true }): writes these fields, keeps the rest, creates the document if needed. Write-only. */
    merge(c, i, d) { const k = key(c, i); merges.set(k, { ...(merges.get(k) || {}), ...d }); },
    writes() {
      const w = [];
      sets.forEach((d, k) => w.push({ update: { name: name(k), fields: encFields(d) } }));
      patches.forEach((p, k) => {
        const keys = Object.keys(p).filter(x => p[x] !== undefined);
        if (keys.length) w.push({ update: { name: name(k), fields: encFields(p) }, updateMask: { fieldPaths: keys.map(seg) }, currentDocument: { exists: true } });
      });
      merges.forEach((d, k) => { const keys = Object.keys(d).filter(x => d[x] !== undefined); if (keys.length) w.push({ update: { name: name(k), fields: encFields(d) }, updateMask: { fieldPaths: keys.map(seg) } }); });
      dels.forEach(k => w.push({ delete: name(k) }));
      return w;
    }
  };
}

/* Runs fn(tx) in a read-write transaction and commits its writes atomically. Retries when Firestore reports contention. */
export async function runTransaction(env, fn) {
  let retry;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { transaction } = await call(env, 'POST', `${root(env)}:beginTransaction`, { options: { readWrite: retry ? { retryTransaction: retry } : {} } });
    const tx = makeTx(env, transaction);
    let result;
    try { result = await fn(tx); }
    catch (e) { await call(env, 'POST', `${root(env)}:rollback`, { transaction }).catch(() => {}); throw e; }
    try { await call(env, 'POST', `${root(env)}:commit`, { transaction, writes: tx.writes() }); return result; }
    catch (e) {
      if (!(e instanceof FirestoreError) || !(e.status === 409 || /ABORTED|contention/i.test(e.message))) throw e;
      retry = transaction;
      await new Promise(r => setTimeout(r, 60 * 2 ** attempt + Math.random() * 50));
    }
  }
  throw new FirestoreError(409, 'Too much activity right now. Please try again.');
}

/* Reads and writes outside a transaction (scheduled jobs and checks). */
export const db = env => {
  const tx = makeTx(env, null);
  return {
    get: tx.get, query: tx.query,
    async commit(build) { const t = makeTx(env, null); build(t); const writes = t.writes(); if (writes.length) await call(env, 'POST', `${root(env)}:commit`, { writes }); }
  };
};
