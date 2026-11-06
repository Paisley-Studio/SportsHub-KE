/* ==========================================================================
   SPORTSHUB-KE FIREBASE CONFIGURATION
   >>> INSERT YOUR FIREBASE PROJECT CREDENTIALS HERE <<<
   Firebase console > Project settings > General > Your apps > SDK setup.
   These values identify your project and are safe in a web page. Access is
   protected by firestore.rules and the SportsHub Worker (worker/).
   Files are NOT stored in Firebase Storage. Uploads go to Cloudflare R2 through
   the Worker in worker/ (see README, "Server: Cloudflare Worker").
   ========================================================================== */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDZBN9SVi9ozB643SYP9n8CTflr9DIZwVU',
  authDomain: 'sportshub-9c219.firebaseapp.com',
  projectId: 'sportshub-9c219',
  storageBucket: 'sportshub-9c219.firebasestorage.app',
  messagingSenderId: '938264530730',
  appId: '1:938264530730:web:73435e19dcc0d41692d853',
  measurementId: 'G-LJTTMDL1VT'
};
export const FIREBASE_SDK_VERSION = '10.14.1';
/* The SportsHub Worker (worker/): account creation, every trusted operation and R2 upload signing.
   Cloud Functions are not used. */
/* The public address of the site. Canonical links, sitemaps and email links use it. */
export const SITE_URL = 'https://sportshub.co.ke';
export const WORKER_URL = 'https://sportshub-uploads.manchamdevelopers.workers.dev';
export const TZ = 'Africa/Nairobi', LOCALE = 'en-KE', CURRENCY = 'KES';

export const IS_CONFIGURED = !Object.values(FIREBASE_CONFIG).some(v => String(v).includes('YOUR_'));
const isLocalHost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
/* On this computer the app talks to the Firebase emulators until real credentials are set.
   Add ?emulators=1 to keep using them after credentials are in place. */
export const USE_EMULATORS = isLocalHost && (!IS_CONFIGURED || (() => {
  const asked = new URLSearchParams(location.search).has('emulators');
  try { if (asked) sessionStorage.setItem('shke.emulators', '1'); return !!sessionStorage.getItem('shke.emulators'); } catch (e) { return asked; }
})());
/* With the emulators, the Worker runs on this computer too (cd worker && npx wrangler dev). */
export const API_URL = (USE_EMULATORS ? 'http://127.0.0.1:8787' : WORKER_URL).replace(/\/+$/, '');
export const ACTIVE_CONFIG = IS_CONFIGURED ? FIREBASE_CONFIG : { apiKey: 'local', authDomain: 'demo-sportshub.firebaseapp.com', projectId: 'demo-sportshub', storageBucket: 'demo-sportshub.appspot.com', messagingSenderId: '1', appId: '1:1:web:1' };
