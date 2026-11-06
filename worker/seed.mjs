/* One-time production seed for SportsHub-KE. Safe to run again at any time.

   - sports/<id>: the full catalogue the app uses (the same data /setup loads), written with merge,
     so a re-run refreshes the catalogue but keeps any extra fields an administrator added.
   - systemSettings/platform: default fees, session counts and the M-Pesa number. Only fields that are
     MISSING are filled in, so anything already changed in System configuration is never overwritten.

   Run from the worker folder:   node seed.mjs
   Uses worker/key.json (the Firebase service account, never committed).
   Against the local emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node seed.mjs        */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './src/firestore.js';

globalThis.location = new URL('https://sportshub.co.ke/'); /* core.js reads location when it loads. */
const { SPORTS_CATALOGUE, img, Rules } = await import('../shared/js/core.js');

const keyPath = fileURLToPath(new URL('./key.json', import.meta.url));
const env = { FIREBASE_PROJECT_ID: 'sportshub-9c219', FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '' };
if (!env.FIRESTORE_EMULATOR_HOST) {
  const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
  if (sa.project_id !== env.FIREBASE_PROJECT_ID) throw new Error(`key.json is for project "${sa.project_id}", expected ${env.FIREBASE_PROJECT_ID}.`);
  env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(sa);
}
const store = db(env);
console.log(`Seeding ${env.FIRESTORE_EMULATOR_HOST ? 'the local emulator' : 'PRODUCTION project ' + env.FIREBASE_PROJECT_ID}...`);

/* Sports: exactly the records /setup writes (photo becomes the site path of its picture). */
const sports = SPORTS_CATALOGUE.map(s => ({ ...s, photo: s.photo ? img(s.photo) : '' }));
await store.commit(t => sports.forEach(s => t.merge('sports', String(s.id), s)));
console.log(`sports: ${sports.length} written (${sports.map(s => s.id).join(', ')})`);

/* Platform settings: fill only what is missing. */
const current = (await store.get('systemSettings', 'platform')) || {};
const missing = Object.fromEntries(Object.entries(Rules.DEFAULT_SETTINGS).filter(([k, v]) => current[k] === undefined || current[k] === null || (current[k] === '' && v !== '')));
if (Object.keys(missing).length) await store.commit(t => t.merge('systemSettings', 'platform', missing));
console.log(`systemSettings/platform: ${Object.keys(missing).length ? 'added ' + Object.keys(missing).join(', ') : 'already complete, nothing changed'}`);
const after = await store.get('systemSettings', 'platform');
console.log(`  M-Pesa number ${after.mpesaNumber} · registration KES ${after.registrationFee} · membership KES ${after.membershipFee} / ${after.sessionsPerPeriod} sessions`);
console.log('Done.');
