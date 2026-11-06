# SportsHub-KE

Vanilla multi-page JavaScript site (ES modules, no framework, no build step) on Firebase Hosting, with Firestore as the database, a Cloudflare Worker as the only server, and Cloudflare R2 for files.

## Storage rules (strict)

- NEVER use Firebase Storage. Never import `firebase/storage` or `firebase-storage.js`, never call `getStorage()`, and never use the `storageBucket` value in the Firebase config.
- All file uploads and downloads go to Cloudflare R2.
- The browser uploads only through `backend.upload(blob, path)` in `shared/js/firebase.js`. Do not add other upload paths.

## No Cloud Functions

- The project stays on the free Spark plan. Never add Firebase Cloud Functions, `firebase-functions`, `httpsCallable` or `firebase-functions.js`.
- `functions/` is legacy and no longer deployed (removed from `firebase.json`). Do not edit it. The live business rules are `worker/src/trusted-ops.js`.

## R2 configuration

- Bucket: `sports-hub-buckets`, bound to the Worker as `MEDIA` in `worker/wrangler.toml`.
- Bucket CORS: `worker/r2-cors.json` (Wrangler format). `cors.json` is the same policy for the dashboard editor. Keep both in step with the authorized domains below.
- Object keys are built by the Worker, never by the browser: `uploads/<uid>/<random>-<name>.<ext>` and `chat/<conversationId>/<random>-<name>.<ext>`.

## Architecture

- Firebase Hosting is static, so the backend is the Cloudflare Worker `sportshub-uploads` in `worker/`:
  - `worker/src/index.js`: router, Firebase ID token check, rate limit, setup, uploads, cron and M-Pesa callback.
  - `worker/src/firestore.js`: Firestore REST client (service account) with transactions.
  - `worker/src/trusted-ops.js`: the business rules.
- Endpoints:
  - `POST /create-account`: runs `registerAccount`.
  - `POST /op` `{ op, payload }`: every other trusted operation.
  - `POST /get-upload-url`: presigned R2 PUT.
  - `GET /files/<key>`: serves a stored file.
  - `POST /mpesa-callback`: M-Pesa callback.
  - Cron `5 21 * * *` (00:05 Nairobi): daily membership sweep.
- Every request carries `Authorization: Bearer <Firebase ID token>`. The Worker verifies it against Google's public keys and never trusts a uid from the request body.
- The Worker writes Firestore through the REST API as a service account (secret `FIREBASE_SERVICE_ACCOUNT`), inside a transaction. `firestore.rules` keeps blocking those writes from browsers.
- Business rules use only the transaction interface `get`, `query`, `set`, `update`, `del`, `merge`. Reads use `:batchGet`, because single-document GETs hang inside emulator transactions.
- Uploads: the frontend gets a presigned URL from the Worker, then `PUT`s the file straight to R2.
  - Presigning uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` with `requestChecksumCalculation: 'WHEN_REQUIRED'`. Without it, browser PUTs fail.
- Frontend: `callOp(op, payload)` and `backend.upload()` in `shared/js/firebase.js` call the Worker at `API_URL` (from `WORKER_URL` in `shared/js/config.js`; `http://127.0.0.1:8787` when using the emulators).
- Secrets go in through `npx wrangler secret put`, never committed: `FIREBASE_SERVICE_ACCOUNT`, `SUPERADMIN_EMAIL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `MPESA_CALLBACK_TOKEN`.
- Cloudflare free plan: 50 subrequests per request. Every Firestore read, query or commit is one subrequest, so keep operations from reading documents one by one in long loops.

## Authorized domains

Used for Worker CORS (`ALLOWED_ORIGINS` in `worker/wrangler.toml`), R2 bucket CORS and Firebase Auth authorized domains:

- http://127.0.0.1:5500
- http://localhost:5500
- https://sportshub.co.ke
- https://www.sportshub.co.ke
- https://sportshub-9c219.web.app
- https://sportshub-9c219.firebaseapp.com

## Database

- Firestore is the ONLY Firebase database service allowed (project `sportshub-9c219`). Firebase Auth (Google and email sign-in) handles identity. Nothing else from Firebase except Hosting.
- Security rules: `firestore.rules`. Indexes: `firestore.indexes.json`.
- Pages talk to the backend only through `db`, `auth`, `callOp` and `backend` in `shared/js/firebase.js`.

## Front-end conventions

- No React or other frameworks. Do not add new CSS or JS files to the site. Shared code lives in `shared/css/sportshub.css` and `shared/js/{core,ui,features,firebase,config}.js`.
- Admin pages (`/admin/...`) show their own email-and-password sign-in (`gates.admin` in `features.js`) until an administrator signs in. No Google sign-in and no registration there: admin accounts are created on the server.
- Buttons that do work show a spinner through the `is-busy` class (set in `ui.js` for `data-act` and `data-form`). Password fields from `fld()` get the show/hide eye automatically.
- Show only real data from Firestore, plus the placeholder photos in `assets/photos/` until real uploads exist.
- Design: Quicksand font. Palette: blue #1FB6F5, green #3DB54A, magenta #EC1C72, yellow #FFB522, black #0B0B0D and white. No gradients, bubbles, purple or brown.

## Local testing

```
firebase emulators:start --only auth,firestore,hosting --project sportshub-9c219
cd worker && npx wrangler dev        # uses worker/.dev.vars: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

Open http://localhost:5000/?emulators=1. The Worker accepts the Auth emulator's unsigned tokens only when it runs on localhost with `FIRESTORE_EMULATOR_HOST` set.
