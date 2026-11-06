/* SportsHub-KE shared components and actions, used by more than one page. */
import { img, BRAND, COUNTY_NAMES, townsOf, PRODUCT_CATEGORIES, CATEGORY_ICON, AVAILABILITY, GAME_TYPES, SKILLS, ROLE_LABEL, html, raw, ic, $, $$, money, pct, titleCase, fmt, fmtDate, fmtDay, fmtTime, fmtDT, dayKey, zonedISO, countyLatLng, haversine, csvDownload, scoreGame, Rules } from './core.js';
import { db, auth, callOp, PaymentService } from './firebase.js';
import { gates, page, ADMIN_MODULES, S, SPORT, sportC, hasRole, canAdmin, A, F, toast, showErr, badge, avatar, emptyState, metrics, sportPill, table, opt, fld, countyTown, sportOptions, formValues, closeModal, openModal, confirmBox, promptForm, run, go, setQuery, renderMain, notFound, route, refreshSession, startLiveCounts, updateChrome, logo, creditMeter, ROLE_HOME } from './ui.js';

/* ----- Discovery pages ----- */
export const nowISO = () => new Date().toISOString();
export const qUpcoming = (extra = [], limit = 40) => ({ where: [['status', '==', 'open'], ['start', '>=', nowISO()], ...extra], orderBy: ['start', 'asc'], limit });
export const pubProfilesQ = (extra = [], limit = 24) => ({ where: [['visibility', '==', 'public'], ...extra], limit });
export const spacesLeft = g => Math.max(0, g.capacity - g.joined);
/* Fixture row: the common way a game appears anywhere on the platform. */
export const gameRow = (g, { fit = true } = {}) => {
  const m = fit && S.profile ? scoreGame(g, S.profile, S.origin) : null, left = spacesLeft(g), s = SPORT(g.sportId);
  return html`<a class="fx ${sportC(g.sportId)}" href="#/games/${g.id}">
    <div class="when"><b>${fmtTime(g.start)}</b><span>${fmtDay(g.start)}</span></div>
    <div style="min-width:0"><div class="ttl">${g.title}</div>
      <div class="meta"><span>${ic(s.icon)}${s.name}</span><span>${ic('map-pin')}${g.venueName || g.town}</span>${g.covered ? html`<span>${ic('badge-check')}Covered session</span>` : ''}${g.fee ? html`<span>${money(g.fee)} fee</span>` : ''}</div>
      ${m && m.reasons.length ? html`<div class="why">${m.reasons.slice(0, 3).join(' · ')}</div>` : ''}</div>
    <div class="cap"><div class="xs muted" style="margin-bottom:4px">${left ? `${left} of ${g.capacity} places left` : 'Full, waitlist open'}</div><div class="bar"><i style="width:${pct(g.joined, g.capacity)}%"></i></div></div>
    <div class="tar acts">${m ? html`<span class="fit">${m.score}% match</span>` : html`<span class="small semi">${g.skill}</span>`}</div>
  </a>`;
};
export const teamLine = (t, reasons) => html`<a class="line-row" href="#/teams/${t.id}">
  ${avatar(t.name, t.logo, 'sq')}<span class="grow"><span class="t semi" style="display:block">${t.name}</span><span class="small muted">${t.sportName} · ${t.town}, ${t.county} · ${t.skill}</span>${reasons && reasons.length ? html`<span class="why" style="display:block">${reasons.join(' · ')}</span>` : ''}</span>
  ${t.recruiting ? html`<span class="badge ok">Recruiting</span>` : ''}</a>`;
export const coachLine = co => html`<a class="line-row c-yellow" href="#/coaches/${co.id}">${avatar(co.name, co.photo)}<span class="grow"><span class="t semi" style="display:block">${co.name}</span><span class="small muted">${(co.sports || []).map(x => SPORT(x).name).join(', ')} · ${co.area || co.county}</span></span>${co.accepting ? html`<span class="badge ok">Accepting</span>` : html`<span class="badge">Full</span>`}</a>`;
export const facilityPlace = f => html`<a class="place" href="#/facilities/${f.id}">
  <span class="pic">${f.photos && f.photos[0] ? html`<img src="${f.photos[0]}" alt="" loading="lazy">` : ''}</span>
  <span style="min-width:0"><span class="semi" style="display:block">${f.name}</span><span class="small muted">${f.town}, ${f.county} · from ${money(f.priceFrom)}/hr</span></span>
  <span class="row sm">${f.participating ? html`<span class="badge ok">Membership venue</span>` : html`<span class="badge">Pay per booking</span>`}</span></a>`;
export const productCard = p => html`<a class="prod" href="#/marketplace/product/${p.id}">
  <div class="pic">${p.photo ? html`<img src="${p.photo}" alt="" loading="lazy">` : html`<span class="noimg">${ic(CATEGORY_ICON[p.category] || 'package')}</span>`}</div>
  <h4>${p.title}</h4><div class="small muted">${p.storeName}</div>
  <div class="row sm" style="margin-top:2px"><span class="price">${money(p.salePrice || p.price)}</span>${p.salePrice ? html`<span class="was">${money(p.price)}</span>` : ''}</div></a>`;
export const compRow = t => html`<a class="comp-row ${sportC(t.sportId)}" href="#/tournaments/${t.id}">
  <span class="cdate"><b>${fmt(t.start, { day: 'numeric' })}</b><span>${fmt(t.start, { month: 'short' })}</span></span>
  <span style="min-width:0"><span class="nm">${t.name}</span><span class="sub">${t.sportName} · ${titleCase(t.format)}${t.venue ? ` · ${t.venue}` : ''}</span></span>
  <span class="cap">${t.registered || 0} of ${t.capacity} entered<span class="bar" style="display:block"><i style="width:${pct(t.registered || 0, t.capacity)}%"></i></span></span>${badge(t.status)}</a>`;
export const filterSelect = (name, label, value, options, blank) => html`<div class="field"><label for="ff-${name}">${label}</label><select id="ff-${name}" name="${name}" data-filter>${opt('', blank, value || '')}${options.map(x => Array.isArray(x) ? opt(x[0], x[1], value) : opt(x, x, value))}</select></div>`;
export const filterText = (name, label, value) => html`<div class="field"><label for="ff-${name}">${label}</label><input id="ff-${name}" name="${name}" value="${value || ''}" placeholder="Any" data-filter></div>`;
A.clearFilters = () => { S.query = {}; setQuery({}); };
A.cancelGame = async d => { if (await confirmBox('Cancel this game?', 'All players are notified and their sessions are returned.', 'Cancel game', 'btn-bad')) await run('cancelGame', { gameId: d.game }, 'Game cancelled.').catch(() => {}); };
A.reportThing = async d => {
  if (!S.uid) { go('/signin'); return; }
  const v = await promptForm({ title: 'Report this', intro: 'Our moderators review every report. The person you report is not told who sent it.', fields: fld({ name: 'reason', label: 'What is wrong?', type: 'select', required: true, options: ['Spam or misleading', 'Harassment or abuse', 'Not sports related', 'Unsafe for young athletes', 'Fraud or scam', 'Something else'], full: true }), submit: 'Send report' });
  if (v) await run('reportContent', { targetType: d.type, targetId: d.id, reason: v.reason, excerpt: d.text || '' }, 'Thanks. Our team will review this.').catch(() => {});
};
export const TrustedOpsIsOfficial = t => t.captainId === S.uid || t.viceId === S.uid || (t.adminIds || []).includes(S.uid);
export const fixtureLine = f => html`<div class="row between"><div style="min-width:0"><div class="semi">${f.homeName} ${f.status === 'completed' ? html`<span class="nums">${f.homeScore} : ${f.awayScore}</span>` : 'v'} ${f.awayName}</div><div class="small muted">${fmtDT(f.start)}${f.venue ? ` · ${f.venue}` : ''}${f.roundLabel ? ` · ${f.roundLabel}` : ''}</div></div>${badge(f.status)}</div>`;
A.respondInvite = d => run('teamRespondInvite', { teamId: d.id, accept: !!d.v }, d.v ? 'Welcome to the team.' : 'Invitation declined.').catch(() => {});
A.writeReview = async d => {
  const v = await promptForm({ title: 'Write a review', intro: 'Reviews are limited to people who attended or bought here.', fields: html`${fld({ name: 'rating', label: 'Rating', type: 'select', required: true, value: '5', options: [['5', '5, excellent'], ['4', '4, good'], ['3', '3, average'], ['2', '2, poor'], ['1', '1, very poor']], full: true })}${fld({ name: 'text', label: 'Your review', type: 'textarea', full: true })}`, submit: 'Publish review' });
  if (v) await run('submitReview', { targetType: d.type, targetId: d.id, rating: v.rating, text: v.text }, 'Review published.').catch(() => {});
};
export const saveCart = async () => { if (S.uid) await db.set('carts', S.uid, { items: S.cart }); else { try { localStorage.setItem('shke.cart', JSON.stringify(S.cart)); } catch (e) { /* session only */ } } updateChrome(); };
A.contactSeller = async d => { const r = await callOp('startConversation', { type: 'store', members: [d.v], title: d.title }); go(`/app/messages/${r.id}`); };
A.recordScore = async d => {
  const v = await promptForm({ title: 'Enter result', fields: html`${fld({ name: 'home', label: d.h, type: 'number', min: 0, required: true })}${fld({ name: 'away', label: d.a, type: 'number', min: 0, required: true })}`, submit: 'Save result' });
  if (v) await run('recordResult', { fixtureId: d.id, home: v.home, away: v.away }, 'Result recorded.').catch(() => {});
};
A.addIndividualResult = async d => {
  const t = await db.get('tournaments', d.id), entries = (await db.list('tournamentRegistrations', { where: [['tournamentId', '==', d.id], ['status', '==', 'confirmed']], limit: 200 }));
  if (!entries.length) { toast('Confirm at least one entry first.', 'yellow'); return; }
  const v = await promptForm({ title: 'Record a result', fields: html`${fld({ name: 'entrantId', label: 'Competitor', type: 'select', required: true, options: entries.map(e => [e.entrantId, e.entrantName]), full: true })}${fld({ name: 'value', label: t.metricLabel || 'Result', type: 'number', step: 'any', required: true, min: 0, full: true })}`, submit: 'Save result' });
  if (v) await run('recordIndividualResult', { id: d.id, entrantId: v.entrantId, value: v.value }, 'Leaderboard updated.').catch(() => {});
};
A.verifyStat = d => run('verifyStat', { id: d.id }, 'Record verified.').catch(() => {});
A.contactPlayer = async d => {
  const v = await promptForm({ title: 'Send a contact request', intro: 'Phone numbers are never shared. If they accept, you can message them here. Requests about players under 18 go through their guardian.', fields: fld({ name: 'message', label: 'Introduce yourself', type: 'textarea', required: true, full: true }), submit: 'Send request' });
  if (v) await run('contactRequest', { toUid: d.uid, message: v.message }, 'Contact request sent.').catch(() => {});
};
/* ----- Payment experience: initiation, confirmation, outcome, receipt -----
   Lipa na M-Pesa (provider mpesa_manual): the member sends money to the platform number, enters the 10-character
   M-Pesa code, and an administrator confirms it. The window follows the transaction live, so it updates on approval. */
export const paymentFlow = ({ txId, amount, description }) => new Promise(resolve => {
  S.ui.pay = { txId, amount, description, resolve, step: 'loading' };
  let stop = () => {};
  openModal({ title: 'Checkout', body: html`<div id="pay-body"></div>` }).then(() => { stop(); const r = S.ui.pay && S.ui.pay.resolve; if (S.ui.pay && !S.ui.pay.done) { S.ui.pay.done = true; if (r) r(S.ui.pay.outcome || 'dismissed'); } });
  drawPay();
  /* Only the server changes a payment's status, so the window listens to it. */
  stop = db.watchDoc('paymentTransactions', txId, t => {
    const p = S.ui.pay; if (!t || !p || p.txId !== txId) return;
    p.simulated = !!t.simulated; p.manual = t.provider === 'mpesa_manual';
    if (t.status === 'pending') { if (p.step === 'loading') { p.step = 'confirm'; drawPay(); } return; }
    if (t.status === 'awaiting_verification') { if (p.step !== 'submitted') { p.step = 'submitted'; p.outcome = 'submitted'; drawPay(t); } return; }
    if (p.step !== 'done') { p.step = 'done'; p.outcome = t.status; drawPay(t); refreshSession().catch(() => {}); }
  });
});
const mpesaNo = () => String(S.settings.mpesaNumber || '0720274530');
const prettyNo = n => n.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
export const drawPay = (t) => {
  const p = S.ui.pay, box = $('#pay-body'); if (!box) return;
  if (p.step === 'loading') { box.innerHTML = html`<div class="row" style="padding:24px 0"><span class="spin"></span><span>Preparing your payment...</span></div>`.s; return; }
  const sim = html`<div class="notice c-yellow small"><b>Simulation.</b> This is not an M-Pesa transaction and no money moves. Choose the outcome to see how the platform responds.</div>`;
  if (p.step === 'confirm' && p.manual) {
    const no = mpesaNo();
    box.innerHTML = html`<div class="mpesa stack">
      <div class="mp-head"><span class="mp-brand">Lipa na <b>M-PESA</b></span><span class="mp-amt"><span>Amount</span><b>${money(p.amount)}</b></span></div>
      <p class="small muted">${p.description}</p>
      <ol class="mp-steps">
        <li>Open <b>M-PESA</b> on your phone and choose <b>Send Money</b>.</li>
        <li>Enter the number <span class="mp-no"><b>${prettyNo(no)}</b><button type="button" class="icon-btn" data-act="copyText" data-v="${no}" aria-label="Copy the number">${ic('copy')}</button></span>${S.settings.mpesaName ? html` <span class="xs muted">(${S.settings.mpesaName})</span>` : ''}</li>
        <li>Send exactly <b>${money(p.amount)}</b> and enter your M-PESA PIN.</li>
        <li>Type the <b>10-character code</b> from the M-PESA confirmation SMS below, then press <b>Confirm payment</b>.</li>
      </ol>
      <form class="form" data-form="payCode" novalidate>
        <div class="field"><label for="mp-code">M-PESA transaction code <span class="req">*</span></label><input id="mp-code" class="mp-code" name="code" required maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. SGH7K2L9QX"><span class="hint">It starts the SMS, for example <b>SGH7K2L9QX Confirmed.</b></span></div>
        <div class="field"><label for="mp-phone">Phone number you paid from</label><input id="mp-phone" name="phone" type="tel" autocomplete="tel" placeholder="07XX XXX XXX"></div>
        <p class="form-err err hide"></p>
        <button class="btn btn-green btn-block" type="submit">${ic('check')} Confirm payment</button>
      </form>
      <p class="xs faint">We check every code against our M-PESA statement before access is granted. You get a notification and an email as soon as it is confirmed.</p></div>`.s;
    const inp = $('#mp-code', box); if (inp) { inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); }); setTimeout(() => inp.focus(), 50); }
  } else if (p.step === 'confirm') box.innerHTML = html`<div class="stack">${p.simulated ? sim : ''}<dl class="kv"><dt>Item</dt><dd>${p.description}</dd><dt>Amount</dt><dd>${money(p.amount)}</dd></dl>
    ${p.simulated ? html`<div class="stack sm"><button class="btn btn-green btn-block" data-act="payOutcome" data-v="success">Simulate successful payment</button><button class="btn btn-ghost btn-block" data-act="payOutcome" data-v="failed">Simulate failed payment</button><button class="btn btn-ghost btn-block" data-act="payOutcome" data-v="cancelled">Simulate cancelled payment</button></div>` : html`<p class="muted small">A payment prompt has been sent by your configured provider. This window updates when the provider confirms the result.</p><div class="spin"></div>`}</div>`.s;
  else if (p.step === 'working') box.innerHTML = html`<div class="row" style="padding:24px 0"><span class="spin"></span><span>Waiting for confirmation from the payment service...</span></div>`.s;
  else if (p.step === 'submitted') {
    box.innerHTML = html`<div class="stack pay-state c-blue"><span class="ps-ic">${ic('hourglass')}</span><h3>Payment submitted</h3>
      <p class="muted small">Thank you. We are confirming M-PESA code <b>${t.mpesaCode}</b> for ${money(t.amount)}. Access opens as soon as it is confirmed, and we will notify you and send an email. You can close this window.</p>
      <dl class="kv"><dt>For</dt><dd>${t.description}</dd><dt>Reference</dt><dd>${t.ref}</dd><dt>Status</dt><dd>${badge('awaiting_verification')}</dd></dl>
      <div class="row"><a class="btn btn-ghost" href="#/app/payments">Payment records</a><button class="btn" data-act="payDone">Done</button></div></div>`.s;
  } else {
    const ok = t.status === 'success', label = ok ? 'Payment confirmed' : t.status === 'rejected' ? 'Payment not confirmed' : t.status === 'failed' ? 'Payment failed' : 'Payment cancelled';
    box.innerHTML = html`<div class="stack pay-state ${ok ? 'c-green' : 'c-magenta'}"><span class="ps-ic">${ic(ok ? 'circle-check' : 'circle-x')}</span><h3>${label}</h3>${t.simulated ? html`<span class="tag sim">Simulated</span>` : ''}
      ${ok ? receiptHtml(t) : html`<p class="muted small">${t.status === 'rejected' ? `${t.rejectReason || 'We could not match the M-PESA code.'} If you paid, start again and enter the exact code from your SMS.` : 'You were not charged. You can try again whenever you are ready.'}</p>`}
      <div class="row">${ok ? html`<button class="btn btn-ghost" data-act="printReceipt">${ic('printer')} Print receipt</button>` : ''}<button class="btn" data-act="payDone">Done</button></div></div>`.s;
  }
};
F.payCode = async v => {
  const code = String(v.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{10}$/.test(code) || !/[A-Z]/.test(code) || !/\d/.test(code)) throw new Error('Enter the 10-character M-PESA code from your SMS, for example SGH7K2L9QX.');
  const p = S.ui.pay;
  await callOp('paymentSubmitCode', { txId: p.txId, code, phone: v.phone });
  const t = await db.get('paymentTransactions', p.txId);
  if (t && p.step !== 'submitted' && p.step !== 'done') { p.step = 'submitted'; p.outcome = 'submitted'; drawPay(t); }
};
A.copyText = async d => { try { await navigator.clipboard.writeText(d.v); toast('Number copied.', 'green'); } catch (e) { toast(d.v); } };
export const receiptHtml = t => html`<dl class="kv"><dt>Receipt</dt><dd>${t.receiptNo}</dd><dt>Reference</dt><dd>${t.ref}</dd><dt>For</dt><dd>${t.description}</dd><dt>Amount</dt><dd>${money(t.amount)}</dd><dt>Date</dt><dd>${fmtDT(t.completedAt || t.initiatedAt)}</dd><dt>Member</dt><dd>${t.memberId || ''}</dd>${t.mpesaCode ? html`<dt>M-PESA code</dt><dd>${t.mpesaCode}</dd>` : ''}</dl>`;
A.payOutcome = async d => {
  const p = S.ui.pay; p.step = 'working'; drawPay();
  await new Promise(r => setTimeout(r, 650));
  try {
    await PaymentService.simulate(p.txId, d.v);
    const t = await db.get('paymentTransactions', p.txId);
    if (p.step !== 'done') { p.step = 'done'; p.outcome = t.status; drawPay(t); }
    await refreshSession();
  } catch (e) { showErr(e); p.step = 'confirm'; drawPay(); }
};
A.payDone = () => { const p = S.ui.pay; p.done = true; const r = p.resolve; closeModal(); r(p.outcome); };
A.printReceipt = () => window.print();
/* ----- Sign in ----- */
/* Sign-in and registration show the brand artwork on its own black panel, and the form on white. */
export const authShell = (cut, alt, content, tagline = 'Every sport. Every player. One home.', c = 'blue', sub = '') => html`<div class="auth c-${c}"><div class="auth-pic"><a class="ph" href="#/" aria-label="SportsHub-KE home"><img src="${BRAND.poster}" alt="SportsHub-KE. Every sport. Every player. One home."></a><div class="au-c"><span class="au-l"></span><div class="au-t">${tagline}</div>${sub ? html`<p class="au-s">${sub}</p>` : ''}</div></div><div class="auth-main">${logo()}${content}</div></div>`;
/* Google sign-in. Existing members go to their dashboard; new people continue registration with their Google name and email. */
const GOOGLE_G = '<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
export const googleBtn = (label = 'Continue with Google', stay = '') => html`<button type="button" class="btn btn-google btn-block" data-act="googleSignIn" data-stay="${stay}">${raw(GOOGLE_G)}${label}</button>`;
A.googleSignIn = async d => {
  S.registering = true;
  let uid;
  try { uid = await auth.google(); } catch (e) { S.registering = false; throw e; }
  if (!uid) return; /* The browser is redirecting to Google. */
  S.registering = false;
  await refreshSession(); startLiveCounts();
  if (S.user) { const to = S.afterLogin || (S.activeRole === 'admin' ? '/admin' : ROLE_HOME[S.activeRole] || '/app'); S.afterLogin = null; toast(`Welcome back, ${S.user.name.split(' ')[0]}.`, 'green'); go(to); return; }
  if (d.stay) { await renderMain(); toast('Signed in with Google. Add your details to finish.', 'green'); return; }
  go('/join');
};
/* ----- Administrator sign in -----
   Any admin address shows this until an administrator signs in. Email and password only: administrator
   accounts are created on the server (setup and Roles), never registered here and never through Google. */
gates.admin = async () => {
  const other = S.uid && S.user ? S.user.email || S.user.name : '';
  S.pageTitle = 'Administrator sign in';
  return authShell('admin', 'SportsHub-KE administration', html`<div class="auth-card">
    <div class="stack"><span class="eyebrow rv f">Administration</span><h1><span class="lnr"><span>Administrator sign in.</span></span></h1><p class="muted rv u" style="--d:.15s">For SportsHub-KE staff. Sign in with the email and password your administrator account was given.</p></div>
    ${other ? html`<p class="notice small rv u" style="--d:.2s">You are signed in as ${other}, which does not have administrator access. Sign in below with an administrator account.</p>` : ''}
    <div class="stack rv u" style="--d:.25s"><form class="form" data-form="adminSignIn">${fld({ name: 'email', label: 'Email', type: 'email', required: true, auto: 'username' })}${fld({ name: 'password', label: 'Password', type: 'password', required: true, auto: 'current-password' })}<p class="form-err err hide"></p><button class="btn btn-block" type="submit">${ic('lock')} Sign in</button></form>
      <div class="row between small"><button type="button" class="semi muted" data-act="adminReset">Forgot password?</button><a class="semi muted" href="#/">Back to SportsHub-KE</a></div></div></div>`,
  'Command centre', 'blue', 'Verification, payments, moderation and settings for the whole platform.');
};
F.adminSignIn = async v => {
  S.registering = true;
  try {
    try { await auth.signIn(v.email, v.password); }
    catch (e) { throw new Error(/invalid|wrong|not-found|credential/i.test(e.code || e.message) ? 'That email and password do not match.' : /too-many/i.test(e.code || '') ? 'Too many attempts. Please wait a few minutes and try again.' : e.message); }
    await refreshSession(); /* Reads adminRoles/<uid> live. Its role must be one of Rules.ADMIN_ROLES (super, finance, ...). */
    if (!Rules.ADMIN_ROLES[S.adminRole]) {
      const uid = S.uid, role = S.adminRole;
      console.warn(role ? `adminRoles/${uid} has role "${role}", which is not a known administrator role. Use one of: ${Object.keys(Rules.ADMIN_ROLES).join(', ')}.`
        : `No administrator role for this account. Create the Firestore document adminRoles/${uid} with role "super" (or run /setup as SUPERADMIN_EMAIL).`);
      await auth.signOut(); await refreshSession();
      throw new Error(role ? `This account's administrator role "${role}" is not recognised. Ask a super administrator to fix it.` : 'This account does not have administrator access.');
    }
  } finally { S.registering = false; }
  location.replace(location.pathname + location.search); /* Reopen the address with the administrator signed in. */
  await new Promise(() => {}); /* Keep the button spinning while the page reloads. */
};
A.adminReset = async () => {
  const v = await promptForm({ title: 'Reset your password', fields: fld({ name: 'email', label: 'Administrator email', type: 'email', required: true, full: true }), submit: 'Send reset link' });
  if (!v) return;
  await auth.reset(v.email).catch(() => {});
  toast('If that email has an account, a reset link is on its way. Check your inbox.', 'green');
};
/* Location. Members choose whether to share it. Player and coach positions are rounded to about 1 km. */
export const geoField = (precise = false) => html`<div class="full geo" data-geo><input type="hidden" name="lat" value=""><input type="hidden" name="lng" value="">
  <button type="button" class="btn btn-ghost btn-sm" data-act="useLocation" data-precise="${precise ? '1' : ''}">${ic('locate')} ${precise ? 'Pin the facility at my current location' : 'Use my current location'}</button>
  <span class="gstat">${precise ? 'Stand at the venue and tap this, so players see it on the map and can get directions.' : 'Optional. Finds games, teams and venues near you. Rounded to about 1 km and never shown publicly.'}</span></div>`;
A.useLocation = async (d, el) => {
  const box = el.closest('[data-geo]'), stat = $('.gstat', box), form = el.closest('form');
  if (!('geolocation' in navigator)) { stat.textContent = 'This browser cannot share a location. Choose your county and town instead.'; return; }
  stat.textContent = 'Finding your location...';
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: !!d.precise, timeout: 15000, maximumAge: 60000 }));
    const k = d.precise ? 1e5 : 1e2, lat = Math.round(pos.coords.latitude * k) / k, lng = Math.round(pos.coords.longitude * k) / k;
    $('input[name=lat]', box).value = lat; $('input[name=lng]', box).value = lng;
    /* Suggest the nearest county when none is chosen yet. */
    const sel = form && $('select[name=county]', form);
    let near = '';
    if (sel) {
      near = COUNTY_NAMES.map(c => { const p = countyLatLng(c); return [c, haversine(lat, lng, p.lat, p.lng)]; }).sort((x, y) => x[1] - y[1])[0][0];
      if (!sel.value) { sel.value = near; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    box.classList.add('ok');
    stat.textContent = d.precise ? `Pinned at ${lat}, ${lng} (accurate to about ${Math.round(pos.coords.accuracy)} m).` : `Location saved${near ? `, near ${near}` : ''}. Rounded to about 1 km.`;
    el.innerHTML = `${ic('check').s} Location saved`;
  } catch (e) {
    stat.textContent = e && e.code === 1 ? 'Location permission was declined. You can still choose your county and town.' : 'We could not read your location. Choose your county and town instead.';
  }
};
export const adSlotData = async placement => {
  const rows = await db.list('advertisingCampaigns', { where: [['status', '==', 'active'], ['approvedPlacements', 'array-contains', placement]], limit: 4 });
  return rows[0] || null;
};
/* Photo card used for games on the home page and in game discovery. */
export const gameCard = (g, i = 0) => {
  const s = SPORT(g.sportId), left = spacesLeft(g), m = S.profile ? scoreGame(g, S.profile, S.origin) : null;
  return html`<a class="game-card ${sportC(g.sportId)} rv u" style="--d:${Math.min(i, 5) * .07}s" href="#/games/${g.id}">
    <div class="gc-img">${s.photo ? html`<img src="${s.photo}" alt="" loading="lazy">` : ''}<span class="gc-sport">${sportPill(g.sportId)}</span><span class="gc-date">${fmt(g.start, { weekday: 'short' })}<b>${fmt(g.start, { day: 'numeric' })}</b>${fmt(g.start, { month: 'short' })}</span></div>
    <div class="gc-b"><h3>${g.title}</h3><div class="gc-meta"><span>${ic('clock')}${fmtTime(g.start)} to ${fmtTime(g.end)}</span><span>${ic('map-pin')}<span class="clip">${g.venueName || g.town}</span></span><span>${ic('gauge')}${g.skill}${g.covered ? ' · Covered session' : ''}</span></div>
      <div class="small semi" style="margin-top:4px">${left ? `${left} of ${g.capacity} places left` : 'Full, waitlist open'}</div><div class="bar"><i style="width:${pct(g.joined, g.capacity)}%"></i></div>
      <div class="gc-foot">${m && m.score ? html`<span class="fit">${m.score}% match</span>` : html`<span class="small faint">${g.fee ? money(g.fee) : 'No fee'}</span>`}<span class="btn btn-sm" style="background:var(--c);color:var(--con)">${left ? 'Join' : 'Waitlist'} ${ic('arrow-right')}</span></div></div></a>`;
};
export const appRoute = (p, view, title, role) => route(p, view, { shell: 'app', auth: true, title, role });
export const pageHead = (title, sub, action) => html`<div class="page-head"><div class="stack sm"><span class="eyebrow">${ROLE_LABEL[S.activeRole] || 'SportsHub'}</span><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>${action || ''}</div>`;
/* ----- Registration ----- */
export const ACCOUNT_TYPES = [
  ['player', 'user', 'Individual player', 'Find games, teams and coaches. Use eight sessions a month across any sport.', 'blue'],
  ['team', 'users', 'Team or captain', 'Register your team, build a squad, schedule fixtures and challenge rivals.', 'green'],
  ['coach', 'clipboard-list', 'Coach', 'Apply with at least three players. Approved coaches get a full roster and training dashboard.', 'yellow'],
  ['vendor', 'store', 'Sports vendor or shop', 'Open a verified storefront and sell to people who play.', 'magenta'],
  ['facility', 'map-pin', 'Sports facility', 'List your pitches and courts, get matched with teams nearby and fill empty hours.', 'green'],
  ['organisation', 'trophy', 'Organisation or organiser', 'Run competitions with fixtures, results and standings.', 'yellow'],
  ['scout', 'search', 'Scout or sports professional', 'Discover talent using verified performance records.', 'blue']
];
/* Account types open for registration now. The others stay in the code and return when their journeys are ready. */
export const ACTIVE_ACCOUNT_TYPES = ['player', 'coach', 'facility'];
export const rowsEditor = (name, cols, count, addLabel) => html`<div class="full stack sm" data-rows="${name}"><div class="stack sm" data-row-list>${Array.from({ length: count }, () => rowHtml(cols))}</div><button type="button" class="btn btn-ghost btn-sm" style="align-self:flex-start" data-act="addRow" data-name="${name}">${ic('plus')} ${addLabel}</button><template>${rowHtml(cols)}</template></div>`;
export const rowHtml = cols => html`<div class="grid" data-row style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr)) 40px;gap:8px;align-items:end">${cols}<button type="button" class="icon-btn" data-act="delRow" aria-label="Remove row">${ic('x')}</button></div>`;
A.addRow = (d, el) => { const box = el.closest('[data-rows]'); $('[data-row-list]', box).insertAdjacentHTML('beforeend', $('template', box).innerHTML); };
A.delRow = (d, el) => el.closest('[data-row]').remove();
export const collectRows = (form, name) => $$(`[data-rows="${name}"] [data-row-list] [data-row]`, form).map(r => formValues(r));
export const wizard = (id, steps, submitLabel, formName, c = '') => html`<form class="form" id="${id}" data-form="${formName}" data-wizard novalidate>
  <ol class="steps-mini">${steps.map((s, i) => html`<li class="${i ? '' : 'on'}" data-step-label="${i}">${i + 1}. ${s.t}</li>`)}</ol>
  ${steps.map((s, i) => html`<div class="${i ? 'hide' : ''} form-grid" data-step="${i}">${s.body}</div>`)}
  <p class="form-err err hide"></p>
  <div class="wiz-acts"><button type="button" class="btn btn-ghost hide" data-act="wizBack">${ic('arrow-left')} Back</button><button type="button" class="btn ${c}" data-act="wizNext">Continue ${ic('arrow-right')}</button><button type="submit" class="btn ${c} hide" data-wiz-submit>${submitLabel}</button></div></form>`;
export const wizMove = (form, dir) => {
  const steps = $$('[data-step]', form), cur = steps.findIndex(s => !s.classList.contains('hide'));
  if (dir > 0) {
    const bad = $$('input,select,textarea', steps[cur]).find(x => !x.checkValidity() && x.offsetParent !== null);
    if (bad) { bad.reportValidity(); return; }
    const boxes = $$('[data-need-one]', steps[cur]).find(g => !$$('input:checked', g).length);
    if (boxes) { toast(boxes.dataset.needOne, 'yellow'); return; }
  }
  const next = cur + dir;
  steps.forEach((s, i) => s.classList.toggle('hide', i !== next));
  $$('[data-step-label]', form).forEach((l, i) => { l.classList.toggle('on', i === next); l.classList.toggle('done', i < next); });
  $('[data-act=wizBack]', form).classList.toggle('hide', next === 0);
  $('[data-act=wizNext]', form).classList.toggle('hide', next === steps.length - 1);
  $('[data-wiz-submit]', form).classList.toggle('hide', next !== steps.length - 1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
A.wizNext = (d, el) => wizMove(el.closest('form'), 1);
A.wizBack = (d, el) => wizMove(el.closest('form'), -1);
export const needOne = (msg, content) => html`<div class="full" data-need-one="${msg}">${content}</div>`;
export const accountStep = () => {
  if (S.uid && S.user) return { t: 'Account', body: html`<p class="full muted">You are signed in as <b>${S.user.name}</b>. This role will be added to your existing account.</p>` };
  const g = S.uid ? auth.current() : null;
  const agree = fld({ name: 'agree', label: html`I agree to the <a href="#/legal/terms" target="_blank" style="text-decoration:underline">terms</a> and <a href="#/legal/privacy" target="_blank" style="text-decoration:underline">privacy policy</a>`, type: 'tick', required: true, full: true });
  const phone = fld({ name: 'phone', label: 'Phone number', type: 'tel', required: true, placeholder: '+254 7..', auto: 'tel', hint: 'Never shown publicly.' });
  if (g) return { t: 'Account', body: html`<div class="notice c-green full small">Signed in with Google as <b>${g.email}</b>. Add the details below to finish.</div>
    ${fld({ name: 'name', label: 'Full name', required: true, auto: 'name', value: g.name })}<div class="field"><label for="g-email">Email address</label><input id="g-email" name="email" type="email" value="${g.email}" readonly></div>${phone}${agree}` };
  return { t: 'Account', body: html`<div class="full stack">${googleBtn('Sign up with Google', '1')}<div class="or">or with email</div></div>
    ${fld({ name: 'name', label: 'Full name', required: true, auto: 'name', full: true })}${fld({ name: 'email', label: 'Email address', type: 'email', required: true, auto: 'email' })}${phone}${fld({ name: 'password', label: 'Password', type: 'password', required: true, auto: 'new-password', min: 8, hint: 'At least 8 characters.' })}${agree}` };
};
/* Create the sign-in, the user record and the shared member profile, if the visitor does not have them yet. */
export const ensureAccount = async (v, type, extra = {}) => {
  if (!S.uid || !S.user) {
    if (!S.uid) { if (String(v.password || '').length < 8) throw new Error('Password must be at least 8 characters.'); S.registering = true; S.uid = await auth.signUp(v.email, v.password); }
    const ll = Number(v.lat) || Number(v.lng) ? { lat: Number(v.lat), lng: Number(v.lng) } : countyLatLng(v.county);
    await callOp('registerAccount', { accountType: type, name: v.name, email: v.email, phone: v.phone, county: v.county, town: v.town, lat: ll.lat, lng: ll.lng, ...extra });
    
  }
  S.registering = false;
  await refreshSession(); startLiveCounts();
};
export const joinForms = {
  player: () => wizard('reg', [accountStep(), { t: 'About you', body: html`
      ${fld({ name: 'dob', label: 'Date of birth', type: 'date', required: true, max: dayKey(new Date()), hint: 'Used for age-appropriate games and protection. Never public.' })}${fld({ name: 'gender', label: 'Gender', type: 'select', blank: 'Prefer not to say', options: ['Female', 'Male'], hint: 'Only used for competition eligibility.' })}
      ${countyTown()}${fld({ name: 'area', label: 'General playing area', placeholder: 'For example, Kibra or Thika Road', hint: 'A general area only. Do not enter your home address.' })}${fld({ name: 'photo', label: 'Profile photograph', type: 'image' })}
      ${geoField()}
      <div class="full stack hide" data-minor-block><div class="notice c-yellow small">Players under 18 need a parent or guardian. Their profile stays protected and is never listed publicly.</div><div class="form-grid">${fld({ name: 'guardianName', label: 'Parent or guardian name' })}${fld({ name: 'guardianPhone', label: 'Parent or guardian phone', type: 'tel' })}${fld({ name: 'guardianConsent', label: 'I am the parent or guardian, and I consent to this account', type: 'tick', full: true })}</div></div>` },
    { t: 'Your sport', body: html`
      ${needOne('Choose at least one sport.', fld({ name: 'sports', label: 'Preferred sports', type: 'checks', options: sportOptions(), required: true }))}
      ${fld({ name: 'position', label: 'Playing position, if any', placeholder: 'Midfielder, setter, sprint...' })}${fld({ name: 'skill', label: 'Skill level', type: 'select', value: 'Recreational', options: SKILLS, required: true })}
      ${fld({ name: 'availability', label: 'Availability', type: 'checks', options: AVAILABILITY, full: true })}${fld({ name: 'gameTypes', label: 'Preferred game types', type: 'checks', options: GAME_TYPES, full: true, value: ['Open games'] })}` }
  ], 'Create my account', 'regPlayer', 'btn-blue'),
  team: () => wizard('reg', [accountStep(), { t: 'Your team', body: html`
      ${fld({ name: 'teamName', label: 'Team name', required: true })}${fld({ name: 'sportId', label: 'Main sport', type: 'select', options: sportOptions(), value: 'football', required: true })}
      ${S.uid ? html`${fld({ name: 'county', label: 'County', type: 'select', value: S.user && S.user.county, options: COUNTY_NAMES, required: true, county: true })}${fld({ name: 'town', label: 'Town', value: S.user && S.user.town, list: 'towns-list', required: true })}<datalist id="towns-list">${townsOf(S.user && S.user.county).map(t => html`<option value="${t}"></option>`)}</datalist>` : countyTown()}
      ${fld({ name: 'area', label: 'Playing area' })}${fld({ name: 'format', label: 'Team format', placeholder: '7-a-side, 5x5...' })}${fld({ name: 'skill', label: 'Skill level', type: 'select', value: 'Recreational', options: SKILLS })}${fld({ name: 'logo', label: 'Team logo', type: 'image' })}${fld({ name: 'description', label: 'Team description', type: 'textarea', full: true })}${fld({ name: 'extraSports', label: 'Additional sports', type: 'checks', options: sportOptions(), full: true })}` },
    { t: 'Team members', body: html`<p class="full muted">You become captain and team administrator. Add players now or later. Existing members get an invitation. Others are recorded until they join.</p>${rowsEditor('members', html`${fld({ name: 'name', label: 'Player name' })}${fld({ name: 'memberId', label: 'SportsHub ID, if known' })}${fld({ name: 'contact', label: 'Email to invite' })}`, 2, 'Add another player')}` }
  ], 'Register my team', 'regTeam', 'btn-green'),
  coach: () => wizard('reg', [accountStep(), { t: 'Credentials', body: html`
      ${S.uid && S.user ? html`${fld({ name: 'phone', label: 'Phone', type: 'tel', required: true })}${fld({ name: 'email', label: 'Email', type: 'email' })}` : ''}
      ${S.uid && S.user ? fld({ name: 'county', label: 'County', type: 'select', value: S.user && S.user.county, options: COUNTY_NAMES, required: true, county: true }) : countyTown()}${fld({ name: 'operatingArea', label: 'Operating area', placeholder: 'Where you train players' })}${geoField()}
      ${needOne('Choose at least one sport.', fld({ name: 'sports', label: 'Sports specialisation', type: 'checks', options: sportOptions(), required: true }))}
      ${fld({ name: 'experienceYears', label: 'Years of coaching experience', type: 'number', min: 0, required: true })}${fld({ name: 'academy', label: 'Academy or club affiliation' })}
      ${fld({ name: 'experience', label: 'Coaching experience', type: 'textarea', full: true, required: true })}${fld({ name: 'qualifications', label: 'Qualifications', type: 'textarea', full: true, required: true })}${fld({ name: 'certificates', label: 'Coaching certificates, comma separated', full: true })}${fld({ name: 'doc1', label: 'Supporting document image', type: 'image' })}` },
    { t: 'Your players', body: html`<div class="notice c-yellow full small">A coach application needs at least <b>three players</b> under your coaching responsibility.</div>${rowsEditor('players', html`${fld({ name: 'name', label: 'Player name', required: true })}${fld({ name: 'sportId', label: 'Sport', type: 'select', options: sportOptions() })}${fld({ name: 'position', label: 'Position or event' })}${fld({ name: 'age', label: 'Age', type: 'number', min: 5, max: 90 })}${fld({ name: 'memberId', label: 'SportsHub ID, if any' })}`, 3, 'Add another player')}` }
  ], 'Submit application', 'regCoach', 'btn-yellow'),
  vendor: () => wizard('reg', [accountStep(), { t: 'Your business', body: html`
      ${fld({ name: 'businessName', label: 'Store or business name', required: true, full: true })}${S.uid ? html`${fld({ name: 'county', label: 'County', type: 'select', value: S.user && S.user.county, options: COUNTY_NAMES, required: true, county: true })}${fld({ name: 'town', label: 'Town', value: S.user && S.user.town, list: 'towns-list', required: true })}<datalist id="towns-list"></datalist>` : countyTown()}
      ${fld({ name: 'contactPhone', label: 'Business phone', type: 'tel', required: true })}${fld({ name: 'kraPin', label: 'KRA PIN', hint: 'For verification.' })}${fld({ name: 'description', label: 'What do you sell?', type: 'textarea', required: true, full: true })}${fld({ name: 'logo', label: 'Store logo', type: 'image' })}<div class="notice c-magenta full small">Your store goes live after administrative approval. Products are moderated before they appear.</div>` }
  ], 'Submit for approval', 'regVendor', 'btn-magenta'),
  facility: () => wizard('reg', [accountStep(), { t: 'Your facility', body: html`
      ${fld({ name: 'facilityName', label: 'Facility name', required: true, full: true })}${S.uid && S.user ? html`${fld({ name: 'county', label: 'County', type: 'select', value: S.user && S.user.county, options: COUNTY_NAMES, required: true, county: true })}${fld({ name: 'town', label: 'Town', value: S.user && S.user.town, list: 'towns-list', required: true })}<datalist id="towns-list"></datalist>` : countyTown()}
      ${fld({ name: 'location', label: 'Location or landmark' })}${fld({ name: 'contactPhone', label: 'Contact phone', type: 'tel', required: true })}${geoField(true)}${fld({ name: 'hours', label: 'Opening hours', value: 'Mon to Sun, 06:00 to 22:00' })}${fld({ name: 'capacity', label: 'Total capacity', type: 'number', min: 0 })}
      ${needOne('Choose at least one sport.', fld({ name: 'sportIds', label: 'Supported sports', type: 'checks', options: sportOptions(), required: true }))}
      ${fld({ name: 'amenities', label: 'Amenities, comma separated', full: true, placeholder: 'Changing rooms, floodlights, parking' })}${fld({ name: 'description', label: 'Description', type: 'textarea', full: true })}${fld({ name: 'rules', label: 'Facility rules', type: 'textarea', full: true })}${fld({ name: 'photo', label: 'Photograph', type: 'image' })}` },
    { t: 'Pitches and courts', body: html`<p class="full muted">Each pitch, court or space has its own availability and price.</p>${rowsEditor('resources', html`${fld({ name: 'name', label: 'Name', required: true, placeholder: 'Football Pitch A' })}${fld({ name: 'hourlyRate', label: 'KES per hour', type: 'number', min: 0, required: true })}${fld({ name: 'open', label: 'Opens', type: 'number', min: 0, max: 23, value: '6' })}${fld({ name: 'close', label: 'Closes', type: 'number', min: 1, max: 24, value: '22' })}`, 1, 'Add another space')}
      ${fld({ name: 'settlementAgreed', label: 'Join the SportsHub membership programme and accept commercial settlement terms', type: 'tick', full: true, hint: `Members use sessions here with no ground-access fee. You receive ${money(S.settings.settlementRatePerSession)} per attended session, settled monthly.` })}` }
  ], 'Submit for approval', 'regFacility', 'btn-green'),
  organisation: () => wizard('reg', [accountStep(), { t: 'Your organisation', body: html`${fld({ name: 'orgName', label: 'Organisation name', required: true, full: true })}${S.uid ? fld({ name: 'county', label: 'County', type: 'select', value: S.user && S.user.county, options: COUNTY_NAMES, required: true, county: true }) : countyTown()}${fld({ name: 'contactPhone', label: 'Contact phone', type: 'tel', required: true })}${fld({ name: 'description', label: 'About your organisation', type: 'textarea', full: true, required: true })}${fld({ name: 'credentials', label: 'Registration or accreditation details', type: 'textarea', full: true })}` }], 'Submit for approval', 'regOrg', 'btn-yellow'),
  scout: () => wizard('reg', [accountStep(), { t: 'Professional details', body: html`${fld({ name: 'orgName', label: 'Agency, club or organisation', required: true, full: true })}${S.uid ? fld({ name: 'county', label: 'County', type: 'select', value: S.user && S.user.county, options: COUNTY_NAMES, required: true, county: true }) : countyTown()}${fld({ name: 'contactPhone', label: 'Contact phone', type: 'tel', required: true })}${fld({ name: 'description', label: 'What talent are you looking for?', type: 'textarea', full: true, required: true })}${fld({ name: 'credentials', label: 'Scouting credentials', type: 'textarea', full: true, required: true })}<div class="notice c-blue full small">Scouting tools unlock after verification. Contact with players under 18 always requires verified guardian consent.</div>` }], 'Submit for verification', 'regScout', 'btn-blue')
};
F.regPlayer = async (v, form) => {
  if (!v.sports || !v.sports.length) throw new Error('Choose at least one sport.');
  const positions = {}; if (v.position) positions[v.sports[0]] = v.position;
  await ensureAccount(v, 'player', { dob: v.dob, gender: v.gender, area: v.area, photo: v.photo, sports: v.sports, positions, skill: v.skill, availability: v.availability, gameTypes: v.gameTypes, guardianName: v.guardianName, guardianPhone: v.guardianPhone, guardianConsent: !!v.guardianConsent });
  toast(`Welcome, ${S.user.name.split(' ')[0]}. Your member ID is ${S.user.memberId}.`, 'green');
  go('/app/membership');
};
F.regTeam = async (v, form) => {
  await ensureAccount(v, 'team');
  const r = await callOp('createTeam', { name: v.teamName, sportId: v.sportId, county: v.county, town: v.town, area: v.area, format: v.format, skill: v.skill, logo: v.logo, description: v.description, extraSports: v.extraSports, members: collectRows(form, 'members') });
  await refreshSession();
  toast(`${v.teamName} is registered. You are captain.`, 'green'); go('/app/team');
  return r;
};
F.regCoach = async (v, form) => {
  const players = collectRows(form, 'players').filter(p => p.name.trim());
  if (players.length < 3) throw new Error('Please add at least three players before submitting.');
  await ensureAccount(v, 'coach');
  await callOp('submitCoachApplication', { name: S.user.name, phone: v.phone || '', email: v.email || '', county: v.county, area: v.operatingArea, sports: v.sports, experienceYears: v.experienceYears, experience: v.experience, qualifications: v.qualifications, certificates: String(v.certificates || '').split(','), academy: v.academy, documents: v.doc1 ? [v.doc1] : [], players });
  await refreshSession();
  toast('Application submitted. It is now pending approval.', 'green'); go('/app/coach');
};
F.regVendor = async v => {
  await ensureAccount(v, 'vendor');
  await callOp('submitVendor', { businessName: v.businessName, county: v.county, town: v.town, contactPhone: v.contactPhone, kraPin: v.kraPin, description: v.description, logo: v.logo });
  await refreshSession();
  toast('Submitted for approval.', 'green'); go('/app/store');
};
F.regFacility = async (v, form) => {
  await ensureAccount(v, 'facility');
  const resources = collectRows(form, 'resources').map(r => ({ ...r, memberEligible: true }));
  const ll = countyLatLng(v.county);
  await callOp('submitFacility', { name: v.facilityName, county: v.county, town: v.town, location: v.location, contactPhone: v.contactPhone, lat: Number(v.lat) || ll.lat, lng: Number(v.lng) || ll.lng, hours: v.hours, capacity: v.capacity || 0, sportIds: v.sportIds, amenities: String(v.amenities || '').split(','), description: v.description, rules: v.rules, photos: v.photo ? [v.photo] : [], resources, settlementAgreed: !!v.settlementAgreed });
  await refreshSession();
  toast('Submitted for approval.', 'green'); go('/app/facility');
};
export const regVerify = kind => async v => {
  await ensureAccount(v, kind);
  await callOp('submitVerification', { kind, orgName: v.orgName, county: v.county, contactPhone: v.contactPhone, description: v.description, credentials: v.credentials });
  await refreshSession();
  toast('Submitted for verification. We will notify you.', 'green'); go('/app/settings');
};
F.regOrg = regVerify('organisation');
 F.regScout = regVerify('scout');
export const membershipCard = (pop) => {
  const m = S.membership, p = S.period, s = S.settings;
  if (!m) return emptyState('badge-check', 'No membership record', 'Complete your player profile to activate membership.');
  if (m.registrationStatus !== 'paid') return html`<div class="sess-cta c-green"><div><span class="eyebrow">Step 1 of 2</span><h3>Complete your registration</h3><p class="small muted">A one-time ${money(s.registrationFee)} registration unlocks games, bookings and membership.</p></div><button class="btn btn-green" data-act="payFee" data-type="registration">Pay ${money(s.registrationFee)}</button></div>`;
  if (!p) return html`<div class="sess-cta c-green"><div><span class="eyebrow">${m.status === 'expired' ? 'Membership expired' : 'Step 2 of 2'}</span><h3>${s.sessionsPerPeriod} sessions a month, any sport</h3><p class="small muted">${money(s.membershipFee)} a month, used at participating facilities. A session is only spent when you attend.</p></div><button class="btn btn-green" data-act="payFee" data-type="membership">${m.status === 'expired' ? 'Renew' : 'Activate'} membership</button></div>`;
  const rem = Rules.remaining(p), av = Rules.available(p), low = rem <= 2;
  return html`<section class="sess ${low ? 'low' : ''}" aria-label="Membership sessions"><div><div class="n"><b data-countup>${rem}</b><span>${rem === 1 ? 'session' : 'sessions'} left this month</span></div><p class="renew">${low && rem ? `Only ${rem} left. ` : ''}Renews ${fmtDate(p.end)} · ${av} ready to book</p></div>
    <div>${creditMeter(p, pop)}<div class="row"><a class="btn btn-green btn-sm" href="#/games?covered=1">Use a session ${ic('arrow-right')}</a><a class="btn btn-ghost btn-sm" href="#/app/membership">Details</a></div></div></section>`;
};
/* ----- Membership ----- */
A.payFee = async d => {
  const r = await PaymentService.start(d.type);
  const outcome = await paymentFlow({ txId: r.txId, amount: r.amount, description: r.description });
  if (outcome === 'submitted') toast('Payment submitted. We will confirm it and let you know.', 'blue');
  await refreshSession(); renderMain();
};
A.cancelBooking = async d => { if (await confirmBox('Cancel this booking?', 'The slot is released. Covered sessions return your reserved credit.', 'Cancel booking', 'btn-bad')) await run('cancelBooking', { id: d.id }, 'Booking cancelled.').catch(() => {}); };
A.openTeamChat = async d => { const r = await callOp('startConversation', { type: 'team', teamId: d.id }); go(`/app/messages/${r.id}`); };
A.orderTo = d => run('updateOrderStatus', { id: d.id, status: d.v }, `Order ${d.v}.`).catch(() => {});
/* ----- Team captain dashboard ----- */
export const captainTeam = async () => {
  const mine = await db.list('teams', { where: [['captainId', '==', S.uid]], limit: 10 });
  const pick = (S.user.activeTeamId && mine.find(t => t.id === S.user.activeTeamId)) || mine[0];
  if (pick) return { team: pick, mine };
  const member = await db.list('teamMembers', { where: [['uid', '==', S.uid], ['status', '==', 'active']], limit: 20 });
  for (const m of member) { const t = await db.get('teams', m.teamId); if (t && TrustedOpsIsOfficial(t)) return { team: t, mine: [t] }; }
  return { team: null, mine };
};
export const noTeam = () => page(emptyState('users', 'You do not manage a team yet', 'Register a team to become its captain.', html`<a class="btn" href="#/app/teams/new">Register a team</a>`));
export const teamTabs = (t, mine) => mine.length > 1 ? html`<div class="field mb" style="max-width:320px"><label for="tsw">Team</label><select id="tsw" data-change="switchTeam">${mine.map(x => opt(x.id, x.name, t.id))}</select></div>` : '';
A.switchTeam = (d, el) => { S.user.activeTeamId = el.value; renderMain(); };
A.teamReview = d => run('teamReviewRequest', { teamId: d.t, uid: d.uid, approve: !!d.v }, d.v ? 'Player approved.' : 'Request declined.').catch(() => {});
export const trainingView = async (ownerType, ownerId, members, headline) => {
  const rows = await db.list('trainingSessions', { where: [['ownerId', '==', ownerId]], limit: 60 });
  rows.sort((a, b) => a.start < b.start ? 1 : -1);
  return page(pageHead('Training', headline, html`<button class="btn btn-green" data-act="newTraining" data-type="${ownerType}" data-id="${ownerId}">${ic('plus')} Schedule training</button>`),
    rows.length ? html`<div class="stack lg">${rows.map(t => { const present = Object.values(t.attendance || {}).filter(Boolean).length; return html`<article class="panel"><div class="panel-head"><div><h3>${t.title}</h3><span class="small muted">${fmtDT(t.start)} · ${t.venue}</span></div><span class="small semi">${present} of ${(t.members || []).length} present</span></div>
      <div class="row sm">${(t.members || []).map(uid => { const m = members.find(x => x.uid === uid), on = (t.attendance || {})[uid]; return html`<button class="btn btn-sm ${on ? 'btn-green' : 'btn-ghost'}" data-act="toggleAttendance" data-id="${t.id}" data-uid="${uid}" data-v="${on ? '' : '1'}" aria-pressed="${on ? 'true' : 'false'}">${m ? m.name : 'Player'}</button>`; })}</div></article>`; })}</div>` : emptyState('dumbbell', 'No training scheduled', 'Schedule a session and players are told automatically.'));
};
A.newTraining = async d => {
  const v = await promptForm({ title: 'Schedule training', wide: true, fields: html`${fld({ name: 'title', label: 'Session title', required: true, full: true })}${fld({ name: 'date', label: 'Date', type: 'date', required: true, min: dayKey(new Date()) })}${fld({ name: 'venue', label: 'Venue' })}${fld({ name: 'from', label: 'Start', type: 'time', value: '17:00', required: true })}${fld({ name: 'to', label: 'End', type: 'time', value: '19:00', required: true })}`, submit: 'Schedule', tone: 'btn-green' });
  if (v) await run('createTraining', { ownerType: d.type, ownerId: d.id, title: v.title, venue: v.venue, start: zonedISO(v.date, v.from), end: zonedISO(v.date, v.to) }, 'Training scheduled.').catch(() => {});
};
A.toggleAttendance = d => run('markTrainingAttendance', { id: d.id, uid: d.uid, present: !!d.v }).catch(() => {});
/* ----- Coach dashboard ----- */
export const coachGate = async () => {
  const app = await db.get('coachApplications', S.uid), co = await db.get('coaches', S.uid);
  if (co && co.verified) return { co, app };
  return { gate: page(pageHead('Coach application', ''), app ? html`<div class="panel stack" style="max-width:720px"><div class="row between"><h3>Application status</h3>${badge(app.status)}</div>
    <p class="muted">${{ pending: 'Your application is with our verification team. You will be notified as soon as it has been reviewed. Verified coach privileges unlock on approval.', rejected: 'This application was not approved. You may apply again with more information.', suspended: 'Your coach privileges are suspended. Please contact support.', info_required: 'We need more information before we can approve your application.', approved: 'Approved.' }[app.status]}</p>
    ${app.reviewNote ? html`<div class="notice c-yellow small"><b>Note from our team.</b> ${app.reviewNote}</div>` : ''}
    <dl class="kv small"><dt>Submitted</dt><dd>${fmtDate(app.submittedAt)}</dd><dt>Sports</dt><dd>${app.sports.map(s => SPORT(s).name).join(', ')}</dd><dt>Players registered</dt><dd>${app.players.length}</dd></dl>
    ${['rejected', 'info_required'].includes(app.status) ? html`<a class="btn" href="#/join/coach" style="align-self:flex-start">Update and resubmit</a>` : ''}</div>` : emptyState('clipboard-list', 'You have not applied yet', 'Apply with at least three players.', html`<a class="btn" href="#/join/coach">Apply as a coach</a>`)) };
};
A.reviewCoachReq = d => run('reviewCoachRequest', { id: d.id, approve: !!d.v }, d.v ? 'Added to your roster.' : 'Request declined.').catch(() => {});
/* ----- Vendor dashboard ----- */
export const vendorGate = async () => {
  const v = await db.get('vendors', S.uid), st = await db.get('stores', S.uid);
  if (st && st.active) return { st, v };
  return { gate: page(pageHead('Your store', ''), v ? html`<div class="panel stack" style="max-width:720px"><div class="row between"><h3>${v.businessName}</h3>${badge(v.status)}</div><p class="muted">${{ pending: 'Our marketplace team is reviewing your business. Your storefront opens on approval.', rejected: 'This application was not approved.', suspended: 'This store is suspended. Please contact support.', info_required: 'We need more information about your business.' }[v.status]}</p>${v.reviewNote ? html`<div class="notice c-yellow small">${v.reviewNote}</div>` : ''}${['rejected', 'info_required'].includes(v.status) ? html`<a class="btn" href="#/join/vendor" style="align-self:flex-start">Update and resubmit</a>` : ''}</div>` : emptyState('store', 'No store yet', 'Apply to open a verified storefront.', html`<a class="btn" href="#/join/vendor">Open a store</a>`)) };
};
export const monthLabel = k => { const [y, m] = k.split('-'); return new Date(Date.UTC(+y, +m - 1, 15)).toLocaleString('en-KE', { month: 'short', timeZone: 'UTC' }); };
export const lastMonths = n => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - (n - 1 - i)); return d.toISOString().slice(0, 7); });
A.editProduct = async d => {
  const p = d.id ? await db.get('products', d.id) : { sizes: [], colours: [] };
  const v = await promptForm({ title: d.id ? 'Edit product' : 'Add a product', wide: true, fields: html`${fld({ name: 'title', label: 'Product name', value: p.title || '', required: true, full: true })}${fld({ name: 'category', label: 'Category', type: 'select', value: p.category || '', options: PRODUCT_CATEGORIES, required: true })}${fld({ name: 'sportId', label: 'Sport', type: 'select', value: p.sportId || '', blank: 'General', options: sportOptions() })}${fld({ name: 'price', label: 'Price, KES', type: 'number', min: 1, value: p.price || '', required: true })}${fld({ name: 'salePrice', label: 'Sale price, KES', type: 'number', min: 0, value: p.salePrice || '' })}${fld({ name: 'stock', label: 'Stock', type: 'number', min: 0, value: p.stock ?? '', required: true })}${fld({ name: 'photo', label: 'Photograph', type: 'image', value: p.photo || '' })}${fld({ name: 'sizes', label: 'Sizes, comma separated', value: (p.sizes || []).join(', ') })}${fld({ name: 'colours', label: 'Colours, comma separated', value: (p.colours || []).join(', ') })}${fld({ name: 'description', label: 'Description', type: 'textarea', value: p.description || '', full: true })}`, submit: 'Save product', tone: 'btn-magenta' });
  if (!v) return;
  const csv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  await run('upsertProduct', { ...v, id: d.id || undefined, sizes: csv(v.sizes), colours: csv(v.colours) }, d.id ? 'Product saved.' : 'Submitted for moderation.').catch(() => {});
};
/* ----- Facility dashboard ----- */
export const facilityGate = async () => {
  const mine = await db.list('facilities', { where: [['ownerId', '==', S.uid]], limit: 10 });
  if (!mine.length) return { gate: page(emptyState('map-pin', 'No facility listed', 'List your venue to start filling empty hours.', html`<a class="btn" href="#/join/facility">List a facility</a>`)) };
  const id = S.ui.facId && mine.find(f => f.id === S.ui.facId) ? S.ui.facId : (mine.find(f => f.status === 'approved') || mine[0]).id;
  return { f: mine.find(x => x.id === id), mine };
};
export const facSwitch = (f, mine) => mine.length > 1 ? html`<div class="field mb" style="max-width:360px"><label for="fsw">Facility</label><select id="fsw" data-change="switchFac">${mine.map(x => opt(x.id, `${x.name} (${titleCase(x.status)})`, f.id))}</select></div>` : '';
A.switchFac = (d, el) => { S.ui.facId = el.value; renderMain(); };
export const facStatus = f => f.status === 'approved' ? '' : html`<div class="notice c-yellow mb"><b>${titleCase(f.status)}.</b> ${f.reviewNote || 'Your facility will be public and verified after administrative approval.'}</div>`;
/* ----- Organiser dashboard ----- */
export const orgGate = async () => {
  if (hasRole('organiser')) return {};
  const v = await db.get('verificationRequests', `organisation_${S.uid}`);
  return { gate: page(emptyState('trophy', v ? `Application ${titleCase(v.status).toLowerCase()}` : 'Become a verified organiser', v ? 'You will be able to create competitions after verification.' : 'Apply to run competitions on SportsHub.', v ? '' : html`<a class="btn" href="#/join/organisation">Apply</a>`)) };
};
A.reviewEntry = d => run('reviewTournamentRegistration', { id: d.id, approve: !!d.v }, d.v ? 'Entry confirmed.' : 'Entry declined.').catch(() => {});
A.newTournament = async () => {
  const v = await promptForm({ title: 'Create a competition', wide: true, fields: html`${fld({ name: 'name', label: 'Competition name', required: true, full: true })}${fld({ name: 'sportId', label: 'Sport', type: 'select', options: sportOptions(), required: true })}${fld({ name: 'format', label: 'Format', type: 'select', required: true, options: [['knockout', 'Knockout'], ['round_robin', 'Round robin'], ['league', 'League (home and away)'], ['groups', 'Group stages'], ['individual', 'Individual competition']] })}${fld({ name: 'startDate', label: 'Start date', type: 'date', required: true })}${fld({ name: 'endDate', label: 'End date', type: 'date', required: true })}${fld({ name: 'venue', label: 'Venue', required: true })}${fld({ name: 'county', label: 'County', type: 'select', value: S.user.county, options: COUNTY_NAMES, required: true })}${fld({ name: 'ageCategory', label: 'Age category', value: 'Open' })}${fld({ name: 'capacity', label: 'Maximum entries', type: 'number', min: 2, max: 512, value: '16', required: true })}${fld({ name: 'entryFee', label: 'Entry fee, KES', type: 'number', min: 0, value: '0' })}${fld({ name: 'metricLabel', label: 'Individual result unit', placeholder: 'Seconds', hint: 'For individual competitions.' })}${fld({ name: 'lowerIsBetter', label: 'A lower result is better', type: 'tick' })}${fld({ name: 'requirements', label: 'Registration requirements', type: 'textarea', full: true })}${fld({ name: 'description', label: 'Description', type: 'textarea', full: true })}`, submit: 'Open registration', tone: 'btn-yellow' });
  if (!v) return;
  await run('createTournament', { ...v, start: zonedISO(v.startDate, '09:00'), end: zonedISO(v.endDate, '18:00') }, 'Competition created.', { then: r => { S.ui.lastT = r.id; } }).catch(() => {});
};
export const adminView = {};
export const adminPage = mod => async () => {
  const def = ADMIN_MODULES.flatMap(g => g[1]).find(m => m[0] === mod);
  if (!def) return notFound();
  S.pageTitle = def[2];
  if (!canAdmin(def[3])) return page(emptyState('lock', 'Not available for your role', `${Rules.ADMIN_ROLES[S.adminRole].label} does not include this module.`));
  return page(await adminView[mod]());
};
export const decisionPrompt = async (title, intro, options) => promptForm({ title, intro, fields: html`${fld({ name: 'decision', label: 'Decision', type: 'select', required: true, options, full: true })}${fld({ name: 'note', label: 'Note to the applicant', type: 'textarea', full: true })}`, submit: 'Record decision' });
export const REVIEW_OPTS = [['approved', 'Approve'], ['info_required', 'Request more information'], ['rejected', 'Reject'], ['suspended', 'Suspend']];
export const adminSearch = (key, ph) => html`<div class="search-box" style="max-width:340px;margin-bottom:14px">${ic('search')}<input type="search" value="${S.query[key] || ''}" name="${key}" placeholder="${ph}" data-filter aria-label="${ph}"></div>`;
export const filt = (rows, key, fn) => { const q = (S.query[key] || '').toLowerCase(); return q ? rows.filter(r => fn(r).toLowerCase().includes(q)) : rows; };
A.exportCol = async d => {
  const rows = await db.list(d.col, { limit: 2000 });
  if (!rows.length) { toast('Nothing to export.', 'yellow'); return; }
  const flat = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'searchTokens').map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v])));
  csvDownload(`${d.col}-${dayKey(new Date())}.csv`, flat);
  await callOp('logExport', { name: d.col, rows: rows.length }).catch(() => {});
};
/* ----- Venues ----- */
export const facilityTable = rows => table([{ h: 'Facility', v: f => html`<a class="semi" href="#/facilities/${f.id}">${f.name}</a><br><span class="xs faint">${f.town}, ${f.county} · ${f.ownerName}</span>` }, { h: 'Sports', v: f => (f.sportIds || []).map(s => SPORT(s).name).join(', ') }, { h: 'Settlement terms', v: f => f.settlementAgreed ? 'Accepted' : 'Not accepted' }, { h: 'Programme', v: f => f.participating ? html`<span class="badge ok">Participating</span>` : html`<span class="badge">Outside</span>` }, { h: 'Status', v: f => badge(f.status) }, { h: '', act: true, v: f => html`<button class="btn btn-sm" data-act="reviewFac" data-id="${f.id}">Review</button>` }], rows);
A.reviewFac = async d => {
  const f = await db.get('facilities', d.id);
  const v = await promptForm({ title: `Review ${f.name}`, wide: true, intro: html`<dl class="kv small"><dt>Location</dt><dd>${f.location}</dd><dt>Contact</dt><dd>${f.contactPhone}</dd><dt>Settlement terms</dt><dd>${f.settlementAgreed ? 'Accepted' : 'Not accepted'}</dd><dt>Description</dt><dd>${f.description}</dd></dl>`, fields: html`${fld({ name: 'decision', label: 'Decision', type: 'select', required: true, options: REVIEW_OPTS, full: true })}${fld({ name: 'participating', label: 'Include in the membership programme', type: 'tick', value: f.settlementAgreed, full: true, hint: 'Only if settlement terms were accepted.' })}${fld({ name: 'note', label: 'Note to the owner', type: 'textarea', full: true })}`, submit: 'Record decision' });
  if (v) await run('reviewFacility', { id: d.id, ...v }, 'Decision recorded.').catch(() => {});
};
export const productTable = rows => table([{ h: 'Product', v: p => html`<a class="semi" href="#/marketplace/product/${p.id}">${p.title}</a><br><span class="xs faint">${p.storeName} · ${p.category}</span>` }, { h: 'Price', right: true, v: p => money(p.price) }, { h: 'Stock', right: true, v: p => p.stock }, { h: 'Status', v: p => badge(p.status) }, { h: '', act: true, v: p => html`${p.status !== 'active' ? html`<button class="btn btn-sm btn-green" data-act="modProduct" data-id="${p.id}" data-v="active">Approve</button>` : ''}${p.status === 'pending' ? html`<button class="btn btn-sm btn-ghost" data-act="modProduct" data-id="${p.id}" data-v="rejected">Reject</button>` : ''}${p.status === 'active' ? html`<button class="btn btn-sm btn-ghost" data-act="modProduct" data-id="${p.id}" data-v="hidden">Hide</button>` : ''}` }], rows);
A.modProduct = d => run('moderateProduct', { id: d.id, decision: d.v }, 'Product updated.').catch(() => {});
export const payTable = rows => table([{ h: 'Date', v: t => fmtDate(t.initiatedAt) }, { h: 'Member', v: t => html`<span class="semi">${t.userName}</span><br><span class="xs faint">${t.memberId}</span>` }, { h: 'Reference', v: t => html`${t.ref}${t.simulated ? html` <span class="tag sim">Simulated</span>` : ''}` }, { h: 'Amount', right: true, v: t => money(t.amount) }, { h: 'Status', v: t => badge(t.status) }, { h: '', act: true, v: t => t.status === 'success' ? html`<button class="btn btn-sm btn-ghost" data-act="refundTx" data-id="${t.id}">Refund</button>` : '' }], rows);
export const payView = (type, title, sub) => async () => {
  const rows = await db.list('paymentTransactions', { where: [['type', '==', type]], orderBy: ['initiatedAt', 'desc'], limit: 200 }), ok = rows.filter(t => t.status === 'success');
  return html`${pageHead(title, sub, html`<button class="btn btn-ghost" data-act="exportCol" data-col="paymentTransactions">${ic('download')} Export</button>`)}${metrics([[money(ok.reduce((a, t) => a + t.amount, 0)), 'Collected'], [ok.length, 'Successful'], [rows.filter(t => t.status === 'failed').length, 'Failed'], [rows.filter(t => t.status === 'refunded').length, 'Refunded']])}<div class="mt-lg"></div>${payTable(rows)}`;
};
A.refundTx = async d => {
  const v = await promptForm({ title: 'Process a refund', intro: 'Membership refunds are pro rata for unused sessions, and are blocked while sessions are reserved. This is written to the audit log.', fields: fld({ name: 'reason', label: 'Reason', required: true, full: true, type: 'textarea' }), submit: 'Refund', tone: 'btn-magenta' });
  if (v) await run('refundPayment', { txId: d.id, reason: v.reason }, 'Refund recorded.').catch(() => {});
};
/* ----- Trust ----- */
export const reportTable = rows => table([{ h: 'Type', v: r => titleCase(r.targetType) }, { h: 'Content', v: r => r.excerpt }, { h: 'Reason', v: r => r.reason }, { h: 'Reported by', v: r => r.reporterName }, { h: 'Status', v: r => badge(r.status) }, { h: '', act: true, v: r => r.status === 'open' ? html`<button class="btn btn-sm btn-bad" data-act="resolveReport" data-id="${r.id}" data-v="remove">Remove</button><button class="btn btn-sm btn-ghost" data-act="resolveReport" data-id="${r.id}" data-v="dismiss">Dismiss</button>` : '' }], rows, emptyState('shield-check', 'No reports here', 'Reported content appears here for review.'));
A.resolveReport = d => run('resolveReport', { id: d.id, action: d.v }, d.v === 'remove' ? 'Content removed.' : 'Report dismissed.').catch(() => {});