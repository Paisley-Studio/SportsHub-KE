# SportsHub-KE

**One platform. Every sport. Every player.**

A sports participation, matchmaking, team, coaching, facility, marketplace, advertising and competition platform. Kenya-first, configurable for anywhere.

Built with HTML, CSS and modern vanilla JavaScript on Firebase, with no framework and no build step.

## Project structure

Every page is its own HTML file in its own folder. A page holds its own markup and its own logic. Only the design system and the core engine are shared.

```
index.html                          Homepage
auth/login/                         Sign in
auth/register/                      Choose an account type
auth/register/form/                 Registration forms
discover/  sports/  games/  teams/  coaches/  facilities/  tournaments/  athletes/  community/  search/  membership/  advertise/  legal/
games/view/  games/new/  teams/view/  coaches/view/  facilities/view/  sports/view/  tournaments/view/  athletes/profile/
marketplace/                        Marketplace, with product/, store/, cart/ and checkout/
dashboard/                          Sends each person to their own dashboard
dashboard/player/                   membership, games, bookings, teams, stats, requests, transfers, payments, orders
dashboard/team/                     squad, fixtures, challenges, training, transfers, new
dashboard/coach/                    roster, training, academy
dashboard/vendor/                   products, orders, promotions, reviews, payouts, profile
dashboard/facility/                 bookings, pitches, availability, staff, settlements, reviews, profile
dashboard/organisation/             competitions, registrations, reports, announcements
dashboard/scout/                    requests
dashboard/calendar/ messages/ notifications/ profile/ settings/ advertising/
admin/                              Command centre, plus one folder per module (30 modules)
setup/                              First-run platform setup

shared/css/sportshub.css            Design system and animation system
shared/js/config.js                 Firebase project credentials (sportshub-9c219)
shared/js/core.js                   Reference data, utilities, matchmaking
shared/js/firebase.js               Data layer
shared/js/ui.js                     Page lifecycle, navigation, forms, modals, motion
shared/js/features.js               Components and actions used by more than one page
assets/                             Photos (web copies of Img/), logos, icons

worker/src/index.js                 Cloudflare Worker: account creation, trusted operations, R2 upload signing, daily sweep, payment webhook
worker/src/trusted-ops.js           All sensitive business rules
worker/src/firestore.js             Firestore REST client and transactions for the Worker
worker/wrangler.toml                Worker settings, R2 binding and daily schedule
firestore.rules  firestore.indexes.json  firebase.json
```

## Run it

SportsHub-KE runs on Firebase. There is no demo mode, no sample data and no demo accounts. A new project starts empty, and every number on screen comes from your database.

The pages use root paths, so serve the project from a web server rather than opening a file directly.

### On your computer

```
firebase emulators:start --only auth,firestore,hosting --project sportshub-9c219
cd worker && npm install && npx wrangler dev
```

`worker/.dev.vars` (never deployed) points the local Worker at the emulators:

```
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
ALLOWED_ORIGINS=http://localhost:5000,http://127.0.0.1:5000
ALLOW_SIMULATED_PAYMENTS=true
```

Open http://localhost:5000. This is the full system (real authentication, security rules, the Worker) running locally with an empty database, and nothing leaves your machine. Because `shared/js/config.js` now holds the live project's credentials, open **http://localhost:5000/?emulators=1** to use the emulators; the choice is remembered for the browser tab. Without `?emulators=1`, localhost talks to the live project.

To make yourself Super Administrator: create an account, open http://localhost:5000/setup/ and click **Run setup**. Locally, the first account to do this becomes the administrator.

### Live

The project is **sportshub-9c219**. Its web credentials are already in `shared/js/config.js` and `.firebaserc` points at it.

1. In the [Firebase console](https://console.firebase.google.com/project/sportshub-9c219), enable **Firestore**. The free Spark plan is enough: Cloud Functions are not used. Do not enable Storage; files go to Cloudflare R2.
2. Under **Authentication > Sign-in method**, enable **Email/Password** and **Google**. Under **Authentication > Settings > Authorised domains**, add every domain the site is served from (the `web.app` and `firebaseapp.com` domains and `localhost` are there by default).
3. Set up and deploy the Worker (see "Server: Cloudflare Worker" below) and put its address in `WORKER_URL` in `shared/js/config.js`.
4. Deploy the site and the security rules:
   ```
   firebase deploy
   ```
5. Create an account using that email address, open `/setup/` and click **Run setup**. This loads the sports catalogue and default settings and makes you Super Administrator.

## Server: Cloudflare Worker

Firebase Hosting serves static files only, and Cloud Functions are not used (they need the Blaze plan). Everything that must be trusted runs in one Cloudflare Worker, `worker/`:

| Endpoint | What it does |
| --- | --- |
| `POST /create-account` | Registers the signed-in user (player, coach, facility...). |
| `POST /op` | Any other trusted operation, `{ op, payload }`: payments, bookings, games, teams, approvals, admin actions. |
| `POST /get-upload-url` | A presigned R2 `PUT` address, valid for five minutes. |
| `GET /files/<key>` | Serves a stored file when the bucket has no public domain. |
| `POST /mpesa-callback?token=...` | M-Pesa Daraja callback, once a provider is installed. |
| Cron, 00:05 Nairobi time | Closes expired membership months and sends renewal reminders. |

Every request carries the user's Firebase ID token (`Authorization: Bearer ...`), which the Worker checks against Google's public keys. The Worker then reads and writes Firestore through its REST API as a service account, inside a Firestore transaction, using the business rules in `worker/src/trusted-ops.js`. `firestore.rules` still blocks those writes from browsers. The pages call the Worker only through `callOp()` and `backend.upload()` in `shared/js/firebase.js`.

### Files: Cloudflare R2

Firebase Storage is not used anywhere. Profile photos, logos, facility photos and chat attachments go to the R2 bucket `sports-hub-buckets`. The Worker checks the file type and size. Chat files are allowed only for members of the conversation. The Worker builds every object key itself (`uploads/<uid>/...` or `chat/<conversationId>/...`) and returns a signed `PUT` address plus the public URL that gets stored in Firestore.

### Setup

1. **Firebase service account.** In the Firebase console, open **Project settings > Service accounts > Generate new private key**. Keep the JSON file private.
2. **R2 access key.** Under **R2 > Manage API tokens**, create one with *Object Read & Write* on `sports-hub-buckets`.
3. Store the secrets and deploy (PowerShell):
   ```
   cd worker
   npm install
   npx wrangler login
   Get-Content C:\keys\service-account.json -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   npx wrangler secret put SUPERADMIN_EMAIL
   npx wrangler secret put R2_ACCOUNT_ID
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler r2 bucket cors set sports-hub-buckets --file r2-cors.json
   npx wrangler deploy
   ```
4. Put the deployed `https://sportshub-uploads.<subdomain>.workers.dev` address in `WORKER_URL` in `shared/js/config.js`.

Settings in `worker/wrangler.toml`: `PUBLIC_BASE` (a public bucket domain, if you add one), `ALLOWED_ORIGINS`, `PAYMENT_PROVIDER`, `ALLOW_SIMULATED_PAYMENTS` (testing only) and `RATE_LIMIT_PER_MINUTE`.

The bucket's CORS policy is in `worker/r2-cors.json` (Wrangler format). `cors.json` holds the same policy in the format the Cloudflare dashboard editor accepts.

Chat attachments are stored under long random names. Anyone holding a file's link can open it, so treat attachment links as unlisted rather than private.

## Sign in with Google

The sign-in and registration pages offer **Continue with Google** alongside email and password. A Google account that already has a SportsHub profile goes straight to its dashboard. A new Google account is taken to registration, where its name and email are prefilled and only the remaining details (phone, location, sport, and so on) are asked for. If the browser blocks the pop-up, sign-in falls back to a full-page redirect.

## Registration

Registration currently offers three account types: **individual player**, **coach** and **sports facility**. Team, vendor, organisation and scout registration remain in the code (`ACCOUNT_TYPES` in `shared/js/features.js`) and return when `ACTIVE_ACCOUNT_TYPES` includes them. Registered players can already create a team from their dashboard.

Every registration asks for county and town, and offers **Use my current location**:

- Players and coaches: the position is rounded to about 1 km, used only for matching, and never shown.
- Facilities: the owner pins the venue precisely, so it appears correctly on the map. The nearest county is filled in automatically if none is chosen.

## Payments

M-Pesa is not installed yet, so **nobody can pay until you choose one of these**:

- **To test payments before M-Pesa:** set `ALLOW_SIMULATED_PAYMENTS = "true"` in `worker/wrangler.toml` and redeploy the Worker. Checkout then offers success, failure and cancellation, and every receipt is marked Simulated. This activates memberships without money, so never use it with real users.
- **Otherwise:** the platform tells members that online payments are not enabled yet.

To add M-Pesa:

1. Add a provider in `PROVIDERS` in `worker/src/index.js`. Its `start` function calls Daraja STK Push and returns `{ providerCheckoutId }`.
2. In `worker/wrangler.toml`, set `PAYMENT_PROVIDER = "mpesa"` and `ALLOW_SIMULATED_PAYMENTS = "false"`. Store `MPESA_CALLBACK_TOKEN` and your Daraja keys with `npx wrangler secret put`.
3. Register `https://<your-worker>/mpesa-callback?token=VALUE` with Safaricom.

The callback endpoint and idempotent processing already exist, and checkout automatically waits for the webhook. **The Daraja call itself is not written, and the callback has not been run against Safaricom.**

## How security works

Payments, credits, bookings, approvals, roles, orders and audit logs change only inside `worker/src/trusted-ops.js`, on the server (the Worker), inside a Firestore transaction. `firestore.rules` denies those writes from every browser, so hiding a button is never what protects anything.

A browser may only write its own cart and presence, mark its own notifications read, and post messages in conversations the user belongs to.

## Membership rules

| | |
| --- | --- |
| Registration | KES 500, paid once, never charged at renewal |
| Membership | KES 1,500 per month, for 8 sessions across any eligible sport |

- **Booking reserves** a session. **Only verified attendance spends** it. Viewing never costs anything.
- Covered sessions never carry a ground-access fee. External, private and organised bookings are recorded separately and charged at the venue.
- Every balance change is an append-only ledger entry. Balances cannot go negative.
- Renewals paid early are scheduled for the next month. Unused sessions expire at month end, and the expiry is recorded.
- Duplicate payment callbacks are ignored.
- **Transfers:** credits go into escrow immediately, the recipient accepts, an administrator approves, and both ledgers update together.

### Decisions to review

| Decision | Choice made | Why |
| --- | --- | --- |
| No-shows | The session returns and a strike is recorded. Three strikes pause new bookings for seven days. | The brief says credits are only consumed on attendance. |
| Unrecorded attendance | The reservation is released after 24 hours, with no strike. | Staff forgetting should not penalise members. |
| Free cancellation | Up to 6 hours before the start. | Placeholder. Configurable. |
| Unused sessions | Expire at month end, with no rollover. | Simplest fair rule. |
| Transfers | Up to 4 sessions, within the current month. | Limits resale. Configurable. |
| Refunds | Pro rata for unused sessions, blocked while sessions are reserved. | Protects the ledger. |
| Facility settlement | **KES 120 per attended session.** | **A placeholder that needs your commercial decision.** Each session brings in KES 187.50, so this sets your margin. |
| Marketplace commission | 10% | Placeholder. Configurable. |

## Before real users

- Replace the placeholder logo at `assets/branding/sportshub-symbol.svg`.
- Have counsel review `/legal/?page=privacy`, `terms` and `minors`, and register with the Office of the Data Protection Commissioner as applicable.
- Confirm the commercial placeholders in **Admin > System configuration**.

## Design

Warm, clear and bright. White and warm paper (#FFFAF2) carry the layout. The four brand colours (#1FB6F5, #3DB54A, #EC1C72, #FFB522) give each sport and role its identity, and buttons are bright pills in those colours. Black is used only for the footer, where the dark logo sits. Quicksand throughout, with measured heading sizes (h1 about 42px, h2 about 32px, homepage headline about 50px on desktop). No gradients and no decorative shapes. Photography does the storytelling.

- **Homepage**: a light hero with a three-photo mosaic and a strip of the next real open games; sports as a mosaic of photo tiles with live game and team counts (a swipeable row on phones); a filterable fixture board; teams beside a photograph; coach profiles; facilities; the marketplace; competitions on light blue; the eight membership sessions; and a closing call to action with the brand artwork.
- **Dashboards** are purpose-built: the player sees sessions left, the week, next games and recommendations filtered by their sports; the coach sees players waiting, the week's training and who turned up; the facility owner sees today's day board for every space, seven-day utilisation and a match-up desk of nearby teams and fixtures without a venue; the administrator sees what needs a decision first, then platform and revenue figures.

Motion lives in `shared/css/sportshub.css` and `shared/js/ui.js`. Scroll reveals slide in when an element enters the screen and back out when it leaves (`.reveal`, `.reveal-left`, `.reveal-right`, `.reveal-scale`, `.reveal-fade`, `.reveal-rotate`, plus `.rv`; add `.keep` to stop one sliding back out). Photos behind a curtain (`.img-rv`) are watched through their container, because a fully clipped element never reports as on screen. Also: rotating hero headlines with dots, a pulsing call-to-action button (`.btn-pulse`), line-by-line headings (`.lnr`), count-up figures, and a page loader that hides the footer until content is in. Photos are still images; there are no image sliders. `prefers-reduced-motion` turns movement off.

Administrators can set each sport's identity colour under **Admin > Sports and disciplines**.

## Assets

- **Logos** (in `assets/branding/`, made from the originals in `Img/`):
  - `logo-light.webp`: from `Sports-logo1.png`, trimmed. Used on white: header, dashboard sidebar, menu, mobile sign-in.
  - `logo-dark.webp`: from `SportsHub-01.png`, with its black background made transparent. Used on black: the footer.
  - `brand-poster.webp`: from `SportsHub-log-1.png` (transparent background). Used on the sign-in and registration pages.
  - The homepage call to action shows `logo-light.webp` on a white card.
  - The logo is always the image; the name is never typed out as text.
- **Photographs:** all from `Img/`, resized to web copies in `assets/photos/`. The original file for each:

  football-sunset sPORTSHUB-8 · football-boot-night 10 · football-boot-tall 9 · kenya-athlete-flag 18 · kenya-runners 17 · rugby-kenya 36 · basketball-net 13 · basketball-dunk 14 · swim-butterfly 12 · swim-lane 11 · golf-tee 4 · golf-swing 5 · tennis-balls 6 · tennis-serve 7 · volleyball-beach 16 · volleyball-block 15 · cricket-batter 21 · cricket-stadium 22 · gym-lift 19 · gym-dumbbells 20 · boxing-gloves 23 · boxing-fighter 24 · martial-arts 25 · karate-kick 26 · motorsport-pack 27 · motorsport-lean 28 · table-tennis 29 · table-tennis-top 30 · cycling-trail 31 · cycling-rider 32 · badminton-racket 33 · badminton-shuttle 34 · badminton-serve 35 · equipment-grass 1 · equipment-row 2 · equipment-dark 3 · brand-banner Sportshub.png · coach Coach.png · marketplace marketplace.png · facility facility.jpg · facility-1 facility-1.jpg

  Homepage sections: teams use equipment-dark (Sportshub-3), coaches use coach, the marketplace uses marketplace, and facilities fall back to facility and facility-1 until a facility uploads its own photos.

  Each sport's photo is set in `SPORTS_CATALOGUE` (`shared/js/core.js`). A photo an administrator uploads for a sport takes priority. To add a photo, put a `.webp` in `assets/photos/` and use its name with `img('name')`.
- **Icons:** [Lucide](https://lucide.dev) (ISC licence), in `assets/icons.svg`. To add one, append its `<symbol>`.
- **Map:** [Leaflet](https://leafletjs.com) and OpenStreetMap, loaded only when someone opens the map view. OpenStreetMap's tile policy limits heavy use, so choose a tile provider before large-scale traffic.

## Known limits

- Search matches the start of words in one term, using indexed tokens. It does not handle typos or full-text ranking. For that, connect Algolia or Typesense.
- Phone-number sign-in is not enabled. Email and password, and Google, are.
- Distance uses a county centre unless the user shares their location, so it is approximate.
- Pages render their data in the browser. Each has its own title and description, and the homepage hero is in the HTML, but there is no server-side rendering.
- Facility staff can check members in through the backend, but the bookings dashboard is scoped to the facility owner.
- Automatic renewal is a stored preference until a live payment provider exists.
- Reminders are in-app. Email, SMS or push needs a provider.
