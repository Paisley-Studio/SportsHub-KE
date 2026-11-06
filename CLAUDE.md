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
  - `GET /sitemap.xml`: live sitemap of every public record (declared in `robots.txt`).
  - Cron `5 21 * * *` (00:05 Nairobi): daily membership sweep.
- Every request carries `Authorization: Bearer <Firebase ID token>`. The Worker verifies it against Google's public keys and never trusts a uid from the request body.
- The Worker writes Firestore through the REST API as a service account (secret `FIREBASE_SERVICE_ACCOUNT`), inside a transaction. `firestore.rules` keeps blocking those writes from browsers.
- Business rules use only the transaction interface `get`, `query`, `set`, `update`, `del`, `merge`. Reads use `:batchGet`, because single-document GETs hang inside emulator transactions.
- Uploads: the frontend gets a presigned URL from the Worker, then `PUT`s the file straight to R2.
  - Presigning uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` with `requestChecksumCalculation: 'WHEN_REQUIRED'`. Without it, browser PUTs fail.
- Frontend: `callOp(op, payload)` and `backend.upload()` in `shared/js/firebase.js` call the Worker at `API_URL` (from `WORKER_URL` in `shared/js/config.js`; `http://127.0.0.1:8787` when using the emulators).
- Secrets go in through `npx wrangler secret put`, never committed: `FIREBASE_SERVICE_ACCOUNT`, `SUPERADMIN_EMAIL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `MPESA_CALLBACK_TOKEN`, `RESEND_API_KEY`.
- Cloudflare free plan: 50 subrequests per request. Every Firestore read, query or commit is one subrequest, so keep operations from reading documents one by one in long loops.

## Payments (Lipa na M-Pesa, manual confirmation)

- `PAYMENT_PROVIDER = "mpesa_manual"`. Members send money to the number in `systemSettings/platform.mpesaNumber` (default 0720274530, editable in System configuration), then enter the 10-character M-Pesa code in the payment window (`paymentFlow` in `features.js`).
- `paymentSubmitCode` moves the payment to `awaiting_verification`, reserves the code in `mpesaCodes/<code>` (a code can be used once) and notifies every admin with the `payments` permission.
- An admin confirms or rejects it on `/admin/payments` (`paymentReview`). Confirming runs the same `applyPaymentEvent` as a provider webhook, so access, receipts and revenue follow automatically. Revenue counts only `success` (and the kept part of `refunded`).
- Admin pages: `/admin/payments` (M-Pesa confirmations) and `/admin/revenue`. Members see their records on `/app/payments` (every role's menu).

## Emails

- Every notification a trusted operation writes (`notify()` in `trusted-ops.js`) is also emailed after the transaction commits (`worker/src/email.js`, sent with Resend in `ctx.waitUntil`). One layout for every email, in the SportsHub theme. To email something new, write a notification; do not send email elsewhere.
- Needs the `RESEND_API_KEY` secret and `EMAIL_FROM` on a domain verified in Resend. Without the key, emails are skipped silently.
- The recipient address is `usersPrivate/<uid>.email`. Payment, account, welcome and verification emails always send; other types follow the member's notification preferences.

## Speed and SEO

- Instant pages: while a page first loads, `db.get`, `db.list` and `db.count` answer from a per-user localStorage cache, then `ui.js` re-checks them live and redraws only if something changed. Any write (`callOp`, `db.add/set/update/remove`) or sign-out clears the cache. Keep page reads going through `db`.
- Every page head has unique SEO title and description, robots (dashboards, admin, auth forms, cart, search: noindex), canonical, Open Graph and Twitter tags, modulepreload for every shared module, preconnects, and speculation rules that prerender a page while its link is hovered. Copy that head pattern for any new page.
- Detail views set `S.pageTitle`, `S.pageDesc`, `S.pageImage` and `S.pageLd` (schema.org); `setMeta` in `ui.js` writes them with a canonical that keeps only `id`/`page`.
- `sitemap.xml` (fixed pages and sports) and `robots.txt` are at the site root; the Worker serves the rest of the sitemap.

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
