import { img, sportPhoto, BRAND, COUNTY_NAMES, townsOf, SKILLS, ROLE_LABEL, ROLE_COLOR, STATUS_TONE, esc, fmtHtml, html, raw, ic, $, $$, debounce, money, compact, initials, titleCase, fmtDT, countyLatLng, readImage, Rules, SPORT_COLORS, SPORTS_CATALOGUE } from './core.js';
import { genId, db, auth, backend, callOp, instantPages } from './firebase.js';
import { SITE_URL } from './config.js';

/* ==========================================================================
   SPORTSHUB-KE INTERFACE KIT
   Page mounting, navigation between page folders, shells, forms, modals, motion.
   Every HTML page imports this, then mounts its own view with route().
   ========================================================================== */
export const S = { uid: null, user: null, profile: null, membership: null, period: null, adminRole: null, activeRole: null, settings: { ...Rules.DEFAULT_SETTINGS }, sports: [], unreadN: 0, unreadM: 0, cart: [], origin: null, ui: {}, query: {}, params: {} };
Object.defineProperty(S, 'afterLogin', {
  get() { try { return sessionStorage.getItem('shke.next'); } catch (e) { return null; } },
  set(v) { try { if (v) sessionStorage.setItem('shke.next', v); else sessionStorage.removeItem('shke.next'); } catch (e) { /* session only */ } }
});
export const SPORT = id => S.sports.find(s => s.id === id) || { id, name: titleCase(id || 'Sport'), icon: 'trophy', color: 'blue', statFields: [], positions: [], formats: [], skillLevels: SKILLS };
export const sportC = id => `c-${SPORT(id).color || SPORT_COLORS[id] || 'blue'}`;
export const hasRole = r => !!(S.user && (S.user.roles || []).includes(r));
export const canAdmin = p => Rules.can(S.adminRole, p);
export const A = {}, F = {};
 /* click actions and form handlers, registered by name */
export const onMountQ = [], onLeaveQ = [];
export const onMount = fn => onMountQ.push(fn), onLeave = fn => onLeaveQ.push(fn);
export const toast = (msg, c = 'blue') => {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = `toast c-${c}`; el.textContent = msg; box.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, 3800);
};
export const showErr = e => { console.warn(e); toast(e && e.message ? e.message : 'Something went wrong. Please try again.', 'magenta'); };
/* ----- Small components ----- */
export const badge = s => html`<span class="badge ${STATUS_TONE[s] || ''}">${titleCase(s)}</span>`;
export const avatar = (name, photo, cls = '') => photo ? html`<img class="avatar ${cls}" src="${photo}" alt="" loading="lazy">` : html`<span class="avatar ${cls}" aria-hidden="true">${initials(name)}</span>`;
export const verifiedMark = () => html`<span class="verified">${ic('badge-check')}Verified</span>`;
export const stars = n => html`<span class="stars" role="img" aria-label="${n} out of 5">${[1, 2, 3, 4, 5].map(i => ic('star', i <= Math.round(n) ? 'on' : ''))}</span>`;
export const emptyState = (icon, title, body, action) => html`<div class="empty">${ic(icon)}<h4>${title}</h4><p class="small">${body}</p>${action ? html`<div class="mt">${action}</div>` : ''}</div>`;
export const metrics = list => html`<div class="metrics">${list.map(([v, l], i) => html`<div class="metric seq" style="--i:${i}"><span class="v" data-countup>${v}</span><span class="l">${l}</span></div>`)}</div>`;
export const sportPill = id => { const s = SPORT(id); return html`<span class="sport-pill ${sportC(id)}">${ic(s.icon)}${s.name}</span>`; };
export const sectionHead = (c, eye, title, link) => html`<div class="sec-head c-${c}"><div class="stack"><span class="eyebrow rv f">${eye}</span><h2><span class="lnr" style="--d:.08s"><span>${title}</span></span></h2></div>${link ? html`<a class="link rv f" style="--d:.2s" href="${link[0]}">${link[1]} ${ic('arrow-right')}</a>` : ''}</div>`;
export const table = (cols, rows, empty) => {
  if (!rows.length) return empty || emptyState('inbox', 'Nothing here yet', 'Records will appear here as activity happens.');
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c => html`<th scope="col" class="${c.right ? 'tar' : ''}">${c.h}</th>`)}</tr></thead><tbody>${rows.map((r, i) => html`<tr class="seq" style="--i:${Math.min(i, 14)}">${cols.map(c => html`<td data-l="${c.h}" class="${c.act ? 'act' : ''}${c.right ? ' tar nums' : ''}">${c.v(r)}</td>`)}</tr>`)}</tbody></table></div>`;
};
export const opt = (v, l, sel) => html`<option value="${v}" ${String(sel) === String(v) ? raw('selected') : ''}>${l}</option>`;
/* Field builder used by every form so spacing, labels and validation stay identical. */
export const fld = o => {
  const { name, label, type = 'text', value = '', options = [], required, hint, full, placeholder, min, max, step, rows, list, auto } = o;
  const req = required ? html`<span class="req" title="Required"> *</span>` : '';
  const id = `f-${name}-${Math.random().toString(36).slice(2, 6)}`;
  const reqA = required ? raw('required') : '';
  let ctl;
  if (type === 'textarea') ctl = html`<textarea id="${id}" name="${name}" rows="${rows || 3}" placeholder="${placeholder || ''}" ${reqA}>${value}</textarea>`;
  else if (type === 'select') ctl = html`<select id="${id}" name="${name}" ${reqA} ${o.county ? raw('data-county-select') : ''} ${o.onchange ? raw(`data-change="${o.onchange}"`) : ''}>${o.blank !== undefined ? opt('', o.blank, value) : ''}${options.map(x => Array.isArray(x) ? opt(x[0], x[1], value) : opt(x, x, value))}</select>`;
  else if (type === 'checks') {
    const sel = new Set(Array.isArray(value) ? value : []);
    ctl = html`<div class="checks" role="group" aria-label="${label}">${options.map(x => { const v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return html`<label class="check"><input type="checkbox" name="${name}" value="${v}" ${sel.has(v) ? raw('checked') : ''}><span>${l}</span></label>`; })}</div>`;
    return html`<div class="field ${full ? 'full' : ''}"><span class="lab">${label}${req}</span>${ctl}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
  } else if (type === 'tick') {
    return html`<label class="tick ${full ? 'full' : ''}"><input type="checkbox" name="${name}" data-bool value="1" ${value ? raw('checked') : ''} ${reqA}><span>${label}${req}${hint ? html`<br><span class="hint">${hint}</span>` : ''}</span></label>`;
  } else if (type === 'image') {
    return html`<div class="field ${full ? 'full' : ''}"><span class="lab">${label}${req}</span><div class="filepick"><img src="${value || '/assets/branding/sportshub-symbol.svg'}" alt="" class="${value ? '' : 'hide'}"><input type="hidden" name="${name}" value="${value}"><label class="btn btn-ghost btn-sm">${ic('upload')} Choose image<input class="sr" type="file" accept="image/jpeg,image/png,image/webp" data-image-for="${name}"></label></div>${hint ? html`<span class="hint">${hint}</span>` : html`<span class="hint">JPG, PNG or WebP, up to 8 MB.</span>`}</div>`;
  } else ctl = html`<input id="${id}" name="${name}" type="${type}" value="${value}" placeholder="${placeholder || ''}" ${min !== undefined ? raw(`${type === 'password' ? 'minlength' : 'min'}="${esc(min)}"`) : ''} ${max !== undefined ? raw(`max="${esc(max)}"`) : ''} ${step ? raw(`step="${esc(step)}"`) : ''} ${list ? raw(`list="${esc(list)}"`) : ''} ${auto ? raw(`autocomplete="${esc(auto)}"`) : ''} ${reqA}>`;
  /* Password fields get an eye button that shows and hides what was typed. */
  if (type === 'password') ctl = html`<div class="pw">${ctl}<button type="button" class="pw-eye" data-pw-eye aria-label="Show password" aria-pressed="false" aria-controls="${id}">${ic('eye')}</button></div>`;
  return html`<div class="field ${full ? 'full' : ''}"><label for="${id}">${label}${req}</label>${ctl}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
};
export const countyTown = (v = {}, req = true) => html`
  ${fld({ name: 'county', label: 'County', type: 'select', value: v.county || '', options: COUNTY_NAMES, blank: 'Choose county', required: req, county: true })}
  ${fld({ name: 'town', label: 'Sub-county or town', value: v.town || '', list: 'towns-list', required: req })}
  <datalist id="towns-list">${townsOf(v.county).map(t => html`<option value="${t}"></option>`)}</datalist>`;
export const sportOptions = () => S.sports.filter(s => s.active !== false).map(s => [s.id, s.name]);
export const formValues = form => {
  const out = {}, seenMulti = new Set();
  $$('input,select,textarea', form).forEach(el => {
    if (!el.name || el.type === 'file') return;
    if (el.type === 'checkbox') {
      if (el.dataset.bool !== undefined) { out[el.name] = el.checked; return; }
      if (!seenMulti.has(el.name)) { out[el.name] = []; seenMulti.add(el.name); }
      if (el.checked) out[el.name].push(el.value);
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  return out;
};
/* ----- Modal and prompts ----- */
export let modalResolve = null, lastFocus = null;
export const closeModal = (result = null) => {
  const root = $('#modal-root'); if (root) root.innerHTML = '';
  document.documentElement.classList.remove('dlock');
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  const r = modalResolve; modalResolve = null; if (r) r(result);
};
export const openModal = ({ title, body, foot, wide }) => {
  lastFocus = document.activeElement;
  $('#modal-root').innerHTML = html`<div class="modal-bg" data-modal-bg><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="m-t"><div class="modal-head"><h2 id="m-t">${title}</h2><button class="icon-btn" data-act="closeModal" aria-label="Close">${ic('x')}</button></div><div class="modal-body">${body}</div>${foot ? html`<div class="modal-foot">${foot}</div>` : ''}</div></div>`.s;
  document.documentElement.classList.add('dlock');
  const first = $('#modal-root input:not([type=hidden]),#modal-root select,#modal-root textarea,#modal-root .modal-foot .btn'); if (first) first.focus();
  return new Promise(r => { modalResolve = r; });
};
A.closeModal = () => closeModal();
export const confirmBox = (title, message, confirmLabel = 'Confirm', tone = '') => openModal({ title, body: html`<p class="muted">${message}</p>`, foot: html`<button class="btn btn-ghost" data-act="closeModal">Keep as is</button><button class="btn ${tone}" data-act="modalYes">${confirmLabel}</button>` });
A.modalYes = () => closeModal(true);
/* Generic one-off form, returned as a promise. Used across dashboards and administration. */
export const promptForm = ({ title, intro, fields, submit = 'Save', tone = '', wide }) => openModal({
  title, wide,
  body: html`${intro ? html`<div class="muted mb">${intro}</div>` : ''}<form class="form" id="prompt-form" data-form="promptSubmit"><div class="form-grid">${fields}</div></form>`,
  foot: html`<button class="btn btn-ghost" data-act="closeModal">Cancel</button><button class="btn ${tone}" form="prompt-form" type="submit">${submit}</button>`
});
F.promptSubmit = v => closeModal(v);
/* Run a trusted operation with success feedback and a refresh. */
export const run = async (op, payload, okMsg, opts = {}) => {
  try {
    const r = await callOp(op, payload);
    await refreshSession();
    if (okMsg) toast(okMsg, opts.c || 'green');
    if (opts.then) await opts.then(r);
    if (opts.go) go(opts.go); else if (!opts.noRender) await renderMain();
    return r;
  } catch (e) { showErr(e); throw e; }
};
/* ----- Page map: each logical route lives in its own folder ----- */
export const PAGES = [
  ['/', '/'], ['/discover', '/discover/'], ['/sports', '/sports/'], ['/sports/:id', '/sports/view/'], ['/games', '/games/'], ['/games/:id', '/games/view/'], ['/teams', '/teams/'], ['/teams/:id', '/teams/view/'],
  ['/coaches', '/coaches/'], ['/coaches/:id', '/coaches/view/'], ['/facilities', '/facilities/'], ['/facilities/:id', '/facilities/view/'], ['/marketplace', '/marketplace/'], ['/marketplace/product/:id', '/marketplace/product/'], ['/marketplace/store/:id', '/marketplace/store/'], ['/cart', '/marketplace/cart/'], ['/checkout', '/marketplace/checkout/'],
  ['/tournaments', '/tournaments/'], ['/tournaments/:id', '/tournaments/view/'], ['/athletes', '/athletes/'], ['/players/:id', '/athletes/profile/'], ['/search', '/search/'], ['/community', '/community/'], ['/membership', '/membership/'], ['/advertise', '/advertise/'], ['/legal/:page', '/legal/'],
  ['/signin', '/auth/login/'], ['/join', '/auth/register/'], ['/join/:type', '/auth/register/form/'], ['/setup', '/setup/'],
  ['/app', '/dashboard/'], ['/app/membership', '/dashboard/player/membership/'], ['/app/games/new', '/games/new/'], ['/app/games', '/dashboard/player/games/'], ['/app/bookings', '/dashboard/player/bookings/'], ['/app/teams/new', '/dashboard/team/new/'], ['/app/teams', '/dashboard/player/teams/'], ['/app/stats', '/dashboard/player/stats/'], ['/app/requests', '/dashboard/player/requests/'], ['/app/transfers', '/dashboard/player/transfers/'], ['/app/payments', '/dashboard/player/payments/'], ['/app/orders', '/dashboard/player/orders/'],
  ['/app/calendar', '/dashboard/calendar/'], ['/app/messages/:id', '/dashboard/messages/'], ['/app/messages', '/dashboard/messages/'], ['/app/notifications', '/dashboard/notifications/'], ['/app/profile', '/dashboard/profile/'], ['/app/settings', '/dashboard/settings/'], ['/app/ads', '/dashboard/advertising/'],
  ['/app/team', '/dashboard/team/'], ['/app/team/squad', '/dashboard/team/squad/'], ['/app/team/fixtures', '/dashboard/team/fixtures/'], ['/app/team/challenges', '/dashboard/team/challenges/'], ['/app/team/training', '/dashboard/team/training/'], ['/app/team/transfers', '/dashboard/team/transfers/'],
  ['/app/coach', '/dashboard/coach/'], ['/app/coach/roster', '/dashboard/coach/roster/'], ['/app/coach/training', '/dashboard/coach/training/'], ['/app/coach/academy', '/dashboard/coach/academy/'],
  ['/app/store', '/dashboard/vendor/'], ['/app/store/products', '/dashboard/vendor/products/'], ['/app/store/orders', '/dashboard/vendor/orders/'], ['/app/store/promotions', '/dashboard/vendor/promotions/'], ['/app/store/reviews', '/dashboard/vendor/reviews/'], ['/app/store/payouts', '/dashboard/vendor/payouts/'], ['/app/store/profile', '/dashboard/vendor/profile/'],
  ['/app/facility', '/dashboard/facility/'], ['/app/facility/bookings', '/dashboard/facility/bookings/'], ['/app/facility/pitches', '/dashboard/facility/pitches/'], ['/app/facility/maintenance', '/dashboard/facility/availability/'], ['/app/facility/staff', '/dashboard/facility/staff/'], ['/app/facility/settlements', '/dashboard/facility/settlements/'], ['/app/facility/reviews', '/dashboard/facility/reviews/'], ['/app/facility/profile', '/dashboard/facility/profile/'],
  ['/app/org', '/dashboard/organisation/'], ['/app/org/competitions/:id', '/dashboard/organisation/competitions/manage/'], ['/app/org/competitions', '/dashboard/organisation/competitions/'], ['/app/org/registrations', '/dashboard/organisation/registrations/'], ['/app/org/reports', '/dashboard/organisation/reports/'], ['/app/org/announcements', '/dashboard/organisation/announcements/'],
  ['/app/scout', '/dashboard/scout/'], ['/app/scout/requests', '/dashboard/scout/requests/'],
  ['/admin', '/admin/'], ['/admin/:module', '/admin/*/']
];
export const pageFor = logical => {
  for (const [pattern, file] of PAGES) {
    const keys = [], re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$'), m = logical.match(re);
    if (m) return { pattern, file, keys, values: m.slice(1).map(decodeURIComponent) };
  }
  return null;
};
/* Turns a logical path such as /games/abc?x=1 into its real address, /games/view/?id=abc&x=1 */
export const toUrl = path => {
  const [p, qs] = String(path).replace(/^#/, '').split('?'), page = pageFor(p);
  if (!page) return path;
  if (page.pattern === '/admin/:module') return `/admin/${page.values[0]}/${qs ? `?${qs}` : ''}`;
  const q = new URLSearchParams(qs || '');
  page.keys.forEach((k, i) => q.set(k, page.values[i]));
  const s = q.toString();
  return page.file + (s ? `?${s}` : '');
};
export const samePage = url => url.split('?')[0].replace(/index\.html$/, '') === location.pathname.replace(/index\.html$/, '');
export const PARAM_KEYS = ['id', 'page', 'type'];
export const go = (path, replace) => {
  const url = toUrl(path);
  if (samePage(url) && PAGE) { history[replace ? 'replaceState' : 'pushState']({}, '', url); syncLocation(); renderMain(renderToken, false); return; }
  if (replace) location.replace(url); else location.assign(url);
};
export const syncLocation = () => {
  const q = Object.fromEntries(new URLSearchParams(location.search));
  S.params = {}; PARAM_KEYS.forEach(k => { if (q[k] !== undefined) { S.params[k] = q[k]; delete q[k]; } });
  S.query = q;
  S.path = PAGE ? PAGE.pattern.replace(/:([a-zA-Z]+)/g, (_, k) => encodeURIComponent(S.params[k] || '')) : '/';
  if (PAGE && PAGE.pattern === '/app/messages' && S.params.id) S.path = `/app/messages/${encodeURIComponent(S.params.id)}`;
};
export const setQuery = patch => {
  const merged = { ...S.query, ...patch }, p = new URLSearchParams();
  Object.entries(merged).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
  const qs = p.toString();
  go(S.path + (qs ? `?${qs}` : ''), true);
};
/* ----- Page lifecycle ----- */
export let PAGE = null, renderToken = 0;
/* Search engines read the rendered page: each page keeps its own written title and description unless a view
   names the record it shows (a game, a venue). The canonical address keeps only the record id, so filtered
   lists do not compete with each other. Views can add structured data through S.pageLd. */
const BASE_META = { title: document.title, desc: (document.querySelector('meta[name=description]') || {}).content || '' };
const metaTag = (attr, key, val) => { let m = document.head.querySelector(`meta[${attr}="${key}"]`); if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m); } m.setAttribute('content', val); };
export const setMeta = (title, desc, ld, image) => {
  const t = title ? `${title} | SportsHub-KE` : BASE_META.title, d = String(desc || BASE_META.desc).replace(/\s+/g, ' ').trim().slice(0, 160);
  document.title = t;
  metaTag('name', 'description', d); metaTag('property', 'og:title', t); metaTag('property', 'og:description', d); metaTag('name', 'twitter:title', t); metaTag('name', 'twitter:description', d);
  if (image) { const abs = new URL(image, SITE_URL).href; metaTag('property', 'og:image', abs); metaTag('name', 'twitter:image', abs); }
  const q = new URLSearchParams(location.search), keep = new URLSearchParams(); ['id', 'page'].forEach(k => { if (q.get(k)) keep.set(k, q.get(k)); });
  const url = `${SITE_URL}${location.pathname.replace(/index\.html$/, '')}${keep.toString() ? `?${keep}` : ''}`;
  let c = document.head.querySelector('link[rel=canonical]'); if (!c) { c = document.createElement('link'); c.rel = 'canonical'; document.head.appendChild(c); }
  c.href = url; metaTag('property', 'og:url', url);
  let s = document.getElementById('page-ld');
  if (ld) { if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'page-ld'; document.head.appendChild(s); } s.textContent = JSON.stringify({ '@context': 'https://schema.org', ...ld }); }
  else if (s) s.remove();
};
/* While a page loads: one calm loader in the brand colours. The footer stays hidden until the content is in. */
export const skeleton = () => html`<div class="loader" role="status" aria-live="polite"><span class="ld-ring" aria-hidden="true">${raw('<i></i>'.repeat(8))}</span><span class="ld-t">Loading</span></div>`;
export const runLeave = () => { while (onLeaveQ.length) { try { onLeaveQ.pop()(); } catch (e) { console.warn(e); } } };
export const flushMount = root => {
  while (onMountQ.length) { try { onMountQ.shift()(root); } catch (e) { console.warn(e); } }
  observeReveal(root); bindAds(root); countUp(root);
};
export const slot = () => $('#page-slot') || $('#main');
/* Scroll reveals slide in as an element enters the view and back out as it leaves, in both directions.
   Tall elements count as in view once a quarter of the screen shows them, so they never stay hidden.
   Add .keep to an element that should stay once revealed. */
const REVEAL_SEL = '.rv,.lnr,.img-rv,.idx,.draw-in,.eight,[data-reveal],.reveal,.reveal-left,.reveal-right,.reveal-scale,.reveal-fade,.reveal-rotate';
/* Each watched element maps to the elements it reveals. A photo behind a closed curtain (.img-rv) is fully
   clipped, and browsers report a fully clipped element as never on screen, so its container is watched instead. */
const revealMap = new Map();
export const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  const on = e.isIntersecting && (e.intersectionRatio >= .15 || e.intersectionRect.height >= innerHeight * .25);
  (revealMap.get(e.target) || []).forEach(el => {
    if (!el.isConnected) return;
    if (el.classList.contains('keep') && el.classList.contains('in')) return;
    el.classList.toggle('in', on);
  });
}), { threshold: [0, .05, .1, .15, .25, .5], rootMargin: '0px 0px -40px 0px' }) : null;
/* A lazy image inside a hidden reveal may not start loading on its own; start those well before they scroll in. */
const imgWarm = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  $$('img[loading=lazy]', e.target).forEach(i => { i.loading = 'eager'; });
  imgWarm.unobserve(e.target);
}), { rootMargin: '900px 0px' }) : null;
const watch = (target, el) => {
  if (!revealMap.has(target)) { revealMap.set(target, new Set()); revealObserver.observe(target); }
  revealMap.get(target).add(el);
};
export const observeReveal = root => { $$(REVEAL_SEL, root).forEach(el => {
  if (el.dataset.rvo) return; el.dataset.rvo = 1;
  if (!revealObserver) { el.classList.add('in'); return; }
  if (imgWarm && el.querySelector('img[loading=lazy]')) imgWarm.observe(el);
  watch(el.classList.contains('img-rv') && el.parentElement ? el.parentElement : el, el);
}); };
/* Statistics count up when they enter the view. */
export const reduced = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
export const countObserver = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  countObserver.unobserve(e.target);
  const el = e.target, m = el.textContent.trim().match(/^(\D*?)([\d,]+)(\D*)$/);
  if (!m || el.dataset.done || reduced()) return;
  el.dataset.done = 1;
  const target = Number(m[2].replace(/,/g, '')), t0 = performance.now(), dur = 1000;
  if (!target) return;
  const tick = t => { const p = Math.min(1, (t - t0) / dur), v = Math.round(target * (1 - Math.pow(1 - p, 3))); el.textContent = `${m[1]}${v.toLocaleString('en-KE')}${m[3]}`; if (p < 1 && el.isConnected) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), { threshold: .4 }) : null;
export const countUp = root => { if (countObserver) $$('[data-countup]:not([data-done])', root).forEach(el => countObserver.observe(el)); };
export async function renderMain(token = renderToken, entering = false) {
  const box = slot(); if (!box || !PAGE) return;
  const y = window.scrollY;
  let usedCache = null;
  try {
    runLeave();
    const content = await PAGE.view(S.params);
    /* The first draw of a page may come from this device's cache; check it against live data straight after. */
    if (instantOpen) { instantOpen = false; usedCache = instantPages.stop(); }
    if (token !== renderToken) { onMountQ.length = 0; return; }
    if (content === undefined) return;
    box.innerHTML = fmtHtml(content);
    if (entering) { box.classList.remove('page-enter'); void box.offsetWidth; box.classList.add('page-enter'); } else window.scrollTo({ top: y, behavior: 'instant' });
    setMeta(S.pageTitle, S.pageDesc, S.pageLd, S.pageImage); S.pageTitle = undefined; S.pageDesc = undefined; S.pageLd = undefined; S.pageImage = undefined;
    flushMount(box); updateChrome(); document.body.dataset.ready = '1';
    if (usedCache && usedCache.length) revalidate(usedCache);
  } catch (e) {
    if (instantOpen) { instantOpen = false; instantPages.stop(); }
    console.error(e);
    if (token === renderToken) box.innerHTML = html`<div class="wrap section" style="padding-top:120px">${emptyState('triangle-alert', 'This page could not load', e.message || 'Please try again.', html`<button class="btn" data-act="reload">Try again</button>`)}</div>`.s;
  }
}
A.reload = () => renderMain();
/* Instant pages: reads between boot and the first draw may be answered from cache (firebase.js). */
let instantOpen = false;
const revalidate = async used => {
  const token = renderToken;
  if (!(await instantPages.changed(used)) || token !== renderToken) return;
  try { await loadCatalog(); await refreshSession(); } catch (e) { console.warn('Refresh failed:', e); }
  if (token !== renderToken) return;
  if (S.shell === 'public') { const h = $('.head-acts'); if (h) { h.innerHTML = headActs().s; rewriteLinks(); } }
  renderMain(renderToken, false);
};
/* Sports catalogue and platform settings, needed by every page. */
const loadCatalog = async () => {
  const [sports, settings] = await Promise.all([db.list('sports', { limit: 100 }), db.get('systemSettings', 'platform')]);
  /* A brand-new project has no sports until first-run setup; the catalogue shows until then. */
  S.sports = (sports.length ? sports : SPORTS_CATALOGUE).map(s => ({ ...s, photo: sportPhoto(s) })).sort((a, b) => { const x = SPORTS_CATALOGUE.findIndex(c => c.id === a.id), y = SPORTS_CATALOGUE.findIndex(c => c.id === b.id); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
  if (settings) S.settings = { ...S.settings, ...settings };
};
export const notFound = async () => { S.pageTitle = 'Page not found'; return html`<div class="wrap section" style="padding-top:130px">${emptyState('map-pin-off', 'We could not find that page', 'It may have moved, or the record may no longer be available.', html`<a class="btn" href="#/">Back to home</a>`)}</div>`; };
/* Each page calls route() once. The platform boots, the shell draws, then the view renders. */
export const route = (pattern, view, meta = {}) => {
  PAGE = { pattern, view, meta };
  syncLocation();
  boot();
};
export let booted = false;
export const boot = async () => {
  if (booted) return; booted = true;
  S.shell = PAGE.meta.shell || 'public';
  if (S.shell === 'public') drawShell();
  /* Show the loader straight away, so a page never flashes empty or shows its footer first. */
  { const b = slot(); if (b && !b.children.length) b.innerHTML = skeleton().s; }
  try {
    const ready = await backend.init();
    if (!ready.ok) { renderSetupScreen(ready.reason); return; }
    instantOpen = true; instantPages.start();
    await loadCatalog();
    let first = true;
    auth.onChange(async uid => {
      if (S.registering) return; /* The registration form finishes its own steps. */
      S.uid = uid;
      /* A failed read must never leave a blank page; the page renders with what it has. */
      try { await refreshSession(); startLiveCounts(); } catch (e) { console.error('Session could not load:', e); }
      if (first) { first = false; startPage(); }
    });
  } catch (e) {
    console.error(e);
    renderSetupScreen(e.message);
  }
};
/* Pages can swap in a different view before they start. gates.admin draws the administrator sign-in
   (features.js), shown on any admin address until someone with an admin role signs in. */
export const gates = {};
export const startPage = () => {
  const { meta } = PAGE;
  if (meta.admin && !S.adminRole && gates.admin) {
    S.shell = 'auth'; PAGE = { ...PAGE, view: gates.admin, meta: { ...meta, title: 'Administrator sign in' } };
    const box = slot(); if (box) box.classList.remove('app-page');
    renderMain(++renderToken, true); return;
  }
  if (meta.auth && !S.uid) { S.afterLogin = location.pathname + location.search; location.replace('/auth/login/'); return; }
  if (meta.auth && !S.user && !location.pathname.startsWith('/auth/')) { location.replace('/auth/register/'); return; }
  if (meta.admin && !S.adminRole) { location.replace(S.uid ? '/dashboard/' : '/auth/login/'); return; }
  /* An administrator with no member profile has only the admin dashboard. */
  if (meta.auth && !meta.admin && S.user && S.user.staffOnly) { location.replace('/admin/'); return; }
  if (S.shell === 'public') { const h = $('.head-acts'); if (h) { h.innerHTML = headActs().s; const d = $('.d-acts'); if (d) d.innerHTML = drawerActs().s; rewriteLinks(); } }
  else drawShell();
  const box = slot();
  if (box && !box.children.length) box.innerHTML = skeleton().s;
  renderMain(++renderToken, true);
};
export const renderSetupScreen = reason => {
  $('#root').innerHTML = html`<main id="main" class="setup-card"><div class="stack">${logo('/')}<h1 style="font-size:clamp(26px,4vw,38px)">Connect SportsHub to Firebase</h1>
    <p class="lede">SportsHub-KE runs on your Firebase project. It needs one of these before it can start.</p>
    <div class="panel stack"><h3>Your live project</h3><p class="small muted">Put your project credentials in <code>shared/js/config.js</code>, then deploy with <code>firebase deploy</code>.</p></div>
    <div class="panel stack"><h3>On this computer</h3><p class="small muted">Run <code>firebase emulators:start --project demo-sportshub</code> in the project folder, then open <code>http://localhost:5000</code>. This runs the real system locally, with an empty database.</p></div>
    ${reason ? html`<p class="xs faint">${reason}</p>` : ''}</div></main>`.s;
};
/* ----- Event delegation: every interactive element routes through here ----- */
/* Templates write logical links such as #/games/abc; this resolves them to real page folders. */
export const rewriteLinks = (root = document) => { $$('a[href^="#/"]', root).forEach(a => a.setAttribute('href', toUrl(a.getAttribute('href').slice(1)))); };
export const linkObserver = new MutationObserver(() => rewriteLinks());
if (document.body) { rewriteLinks(); linkObserver.observe(document.body, { childList: true, subtree: true }); }
document.addEventListener('click', async e => {
  const bg = e.target.closest('[data-modal-bg]');
  if (bg && e.target === bg) { closeModal(); return; }
  const el = e.target.closest('[data-act]');
  if (el) {
    const fn = A[el.dataset.act];
    if (!fn) { console.error('No action registered:', el.dataset.act); return; }
    if (el.matches('a')) e.preventDefault();
    if (el.disabled || el.getAttribute('aria-busy') === 'true') return;
    const done = busy(el);
    try { await fn(el.dataset, el, e); } catch (err) { if (err && err.name !== 'Handled') showErr(err); }
    finally { done(); }
    return;
  }
  /* A button-styled link that opens another page spins until that page takes over. */
  const link = e.target.closest('a.btn[href]');
  if (link && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0 && !link.target && !link.hasAttribute('download')) {
    const u = new URL(link.href, location.href);
    if (u.origin === location.origin && !(u.pathname === location.pathname && u.search === location.search)) link.classList.add('is-busy');
  }
  $$('.menu[data-open]').forEach(m => { if (!m.parentElement.contains(e.target)) m.remove(); });
  if (!e.target.closest('.search-box,.search-drop')) $$('.search-drop').forEach(d => d.remove());
});
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const fn = F[form.dataset.form];
  if (!fn) { console.error('No form registered:', form.dataset.form); return; }
  const btn = (e.submitter && e.submitter.matches('.btn') ? e.submitter : null) || form.querySelector('[type=submit]') || $(`[form="${form.id}"]`);
  if (btn && btn.getAttribute('aria-busy') === 'true') return;
  const errBox = $('.form-err', form); if (errBox) errBox.classList.add('hide');
  const done = btn ? busy(btn) : () => {};
  try { await fn(formValues(form), form, e); }
  catch (err) { if (err && err.name !== 'Handled') { if (errBox) { errBox.textContent = err.message; errBox.classList.remove('hide'); } showErr(err); } }
  finally { done(); }
});
/* Busy buttons show a spinner, stay unclickable while the work runs, and spin for at least a moment
   so even a quick step (such as Continue) is seen to respond. */
const BUSY_MIN = 450;
function busy(el) {
  const t0 = performance.now();
  el.classList.add('is-busy'); el.setAttribute('aria-busy', 'true');
  /* Clickable again as soon as the work ends (say, after an error); the spinner alone finishes its moment. */
  return () => { el.removeAttribute('aria-busy'); setTimeout(() => { if (el.getAttribute('aria-busy') !== 'true') el.classList.remove('is-busy'); }, Math.max(0, BUSY_MIN - (performance.now() - t0))); };
}
/* Coming back with the browser's Back button restores the page as it was left; clear any spinning links. */
window.addEventListener('pageshow', e => { if (e.persisted) $$('a.btn.is-busy').forEach(a => a.classList.remove('is-busy')); });
/* Show or hide a password. */
document.addEventListener('click', e => {
  const eye = e.target.closest('[data-pw-eye]'); if (!eye) return;
  const input = eye.parentElement.querySelector('input'); if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  eye.setAttribute('aria-pressed', String(show)); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  eye.innerHTML = ic(show ? 'eye-off' : 'eye').s;
  input.focus({ preventScroll: true });
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches('[data-county-select]')) {
    const list = $('#towns-list', t.closest('form') || document) || $('#towns-list');
    if (list) list.innerHTML = townsOf(t.value).map(x => `<option value="${esc(x)}"></option>`).join('');
  }
  if (t.matches('[data-image-for]')) {
    const form = t.closest('.filepick'), hidden = $(`input[name="${t.dataset.imageFor}"]`, form), prev = $('img', form);
    try {
      const f = t.files[0]; if (!f) return;
      if (!S.uid) { toast('You can add images once your account is created, from your profile.', 'yellow'); t.value = ''; return; }
      const blob = await readImage(f);
      const url = await backend.upload(blob, `uploads/${S.uid}/${genId('img')}.jpg`);
      hidden.value = url; prev.src = url; prev.classList.remove('hide');
    } catch (err) { showErr(err); t.value = ''; }
  }
  if (t.matches('[data-filter]')) setQuery({ [t.name]: t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value });
  if (t.matches('[data-change]') && A[t.dataset.change]) A[t.dataset.change](t.dataset, t, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#modal-root') && $('#modal-root').firstChild) closeModal();
    closeDrawer();
    $$('.menu[data-open],.search-drop').forEach(m => m.remove());
  }
  /* Keep Tab inside an open dialog. */
  if (e.key === 'Tab' && $('#modal-root .modal')) {
    const f = $$('#modal-root a[href],#modal-root button,#modal-root input:not([type=hidden]),#modal-root select,#modal-root textarea').filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
window.addEventListener('popstate', () => { if (PAGE) { syncLocation(); renderMain(renderToken, false); } });
window.addEventListener('scroll', () => {
  const h = document.documentElement, y = window.scrollY, bar = $('#bar'), head = $('.site-head'), up = $('#up');
  if (bar) bar.style.width = `${y / Math.max(1, h.scrollHeight - innerHeight) * 100}%`;
  if (head) head.classList.toggle('sm', y > 40);
  if (up) up.classList.toggle('show', y > 500);
}, { passive: true });
/* ----- Session ----- */
export let sessionUnsubs = [];
export async function refreshSession() {
  S.uid = auth.uid();
  if (!S.uid) { Object.assign(S, { user: null, profile: null, membership: null, period: null, adminRole: null, activeRole: null, cart: [] }); return; }
  const [user, profile, membership, adminDoc, cart] = await Promise.all([db.get('users', S.uid), db.get('playerProfiles', S.uid), db.get('memberships', S.uid), db.get('adminRoles', S.uid, true), db.get('carts', S.uid)]); /* Administrator access is always read live, never from the instant cache. */
  /* Staff accounts are created on the server and may have no member profile. They are never sent to registration. */
  const me = auth.current() || {};
  S.user = user || (adminDoc ? { id: S.uid, uid: S.uid, name: adminDoc.name || me.name || (me.email || 'Administrator').split('@')[0], email: me.email || '', roles: ['admin'], staffOnly: true } : null);
  S.profile = profile; S.membership = membership; S.adminRole = adminDoc ? adminDoc.role : null; S.cart = (cart && cart.items) || [];
  S.period = membership && membership.currentPeriodId ? await db.get('membershipPeriods', membership.currentPeriodId) : null;
  S.origin = S.origin && S.origin.precise ? S.origin : profile && profile.county ? countyLatLng(profile.county) : user && user.county ? countyLatLng(user.county) : null;
  const avail = rolesAvailable();
  if (!S.activeRole || !avail.includes(S.activeRole)) {
    let stored = null; try { stored = localStorage.getItem(`shke.role.${S.uid}`); } catch (e) { /* no stored preference */ }
    /* Each dashboard folder belongs to a role, so opening one always shows that role's navigation. */
    const p = PAGE ? PAGE.pattern : '', here = p.startsWith('/admin') ? 'admin' : p.startsWith('/app/team') ? 'captain' : p.startsWith('/app/coach') ? 'coach' : p.startsWith('/app/store') ? 'vendor' : p.startsWith('/app/facility') ? 'facility' : p.startsWith('/app/org') ? 'organiser' : p.startsWith('/app/scout') ? 'scout' : /^\/app\/(membership|games|bookings|teams|stats|requests|transfers|payments|orders)/.test(p) ? 'player' : null;
    S.activeRole = here && avail.includes(here) ? here : stored && avail.includes(stored) ? stored : avail[0] || 'player';
  }
}
export const rolesAvailable = () => {
  const r = (S.user && S.user.roles) || [], order = ['admin', 'facility', 'vendor', 'organiser', 'coach', 'scout', 'captain', 'player'];
  const list = order.filter(x => r.includes(x) && x !== 'admin');
  if (r.includes('coach_applicant') && !list.includes('coach')) list.unshift('coach');
  if (r.includes('vendor_applicant') && !list.includes('vendor')) list.unshift('vendor');
  if (r.includes('facility_applicant') && !list.includes('facility')) list.unshift('facility');
  if (S.adminRole) list.unshift('admin');
  return list.length ? list : ['player'];
};
export const startLiveCounts = () => {
  sessionUnsubs.forEach(u => u()); sessionUnsubs = [];
  if (!S.uid) { S.unreadN = 0; S.unreadM = 0; return; }
  sessionUnsubs.push(db.watch('notifications', { where: [['uid', '==', S.uid], ['read', '==', false]], limit: 50 }, rows => { S.unreadN = rows.length; updateChrome(); }));
  sessionUnsubs.push(db.watch('conversations', { where: [['members', 'array-contains', S.uid]], limit: 100 }, rows => { S.unreadM = rows.reduce((a, c) => a + ((c.unread && c.unread[S.uid]) || 0), 0); updateChrome(); }));
  const beat = () => { db.set('presence', S.uid, { at: new Date().toISOString() }).catch(() => {}); };
  beat(); const t = setInterval(beat, 60000); sessionUnsubs.push(() => clearInterval(t));
};
export const updateChrome = () => {
  $$('[data-count=notif]').forEach(el => { el.textContent = S.unreadN || ''; el.classList.toggle('hide', !S.unreadN); });
  $$('[data-count=msg]').forEach(el => { el.textContent = S.unreadM || ''; el.classList.toggle('hide', !S.unreadM); });
  const cartN = S.cart.reduce((a, i) => a + i.qty, 0);
  $$('[data-count=cart]').forEach(el => { el.textContent = cartN || ''; el.classList.toggle('hide', !cartN); });
  updateActiveNav();
};
export const updateActiveNav = () => {
  const here = location.pathname.replace(/index\.html$/, '');
  $$('.nav a,.side-link,.tabbar a,.d-nav a').forEach(a => {
    const href = (a.getAttribute('href') || '').split('?')[0];
    if (!href || href.startsWith('#')) return;
    const exact = ['/', '/dashboard/', '/admin/', '/dashboard/team/', '/dashboard/coach/', '/dashboard/vendor/', '/dashboard/facility/', '/dashboard/organisation/', '/dashboard/scout/'].includes(href);
    const on = exact ? here === href : here.startsWith(href);
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
};
/* ----- Shells ----- */
/* The logo is the artwork itself, never typed out: the light version on white, the dark version on black. */
export const logo = (href = '#/', tone = 'light') => html`<a class="brand" href="${href}" aria-label="SportsHub-KE home"><img src="${tone === 'dark' ? BRAND.dark : BRAND.light}" alt="SportsHub-KE" width="640" height="${tone === 'dark' ? 231 : 213}"></a>`;
export const PUBLIC_NAV = [['/discover', 'Discover'], ['/sports', 'Sports'], ['/games', 'Games'], ['/teams', 'Teams'], ['/facilities', 'Facilities'], ['/marketplace', 'Marketplace'], ['/tournaments', 'Tournaments']];
export const searchBox = (id = 'gs') => html`<div class="search-box" role="search">${ic('search')}<input id="${id}" type="search" placeholder="Search players, teams, venues, products" aria-label="Search SportsHub" data-search autocomplete="off"></div>`;
export const accountActions = () => S.uid ? html`
  <a class="icon-btn hide-m" href="#/cart" aria-label="Cart">${ic('shopping-bag')}<span class="count hide" data-count="cart"></span></a>
  <a class="icon-btn hide-m" href="#/app/messages" aria-label="Messages">${ic('message-square')}<span class="count hide" data-count="msg"></span></a>
  <a class="icon-btn" href="#/app/notifications" aria-label="Notifications">${ic('bell')}<span class="count hide" data-count="notif"></span></a>
  <div style="position:relative"><button class="icon-btn" data-act="accountMenu" aria-label="Account menu" aria-haspopup="true">${avatar(S.user ? S.user.name : '', S.user && S.user.photo, 'sm')}</button></div>` : '';
export const drawerHtml = (title, body, foot) => html`<div class="drawer-scrim" data-act="closeDrawerAct"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${title}" hidden><div class="d-top">${logo()}<button class="icon-btn" data-act="closeDrawerAct" aria-label="Close menu">${ic('x')}</button></div><nav class="d-nav" aria-label="${title}">${body}</nav><div class="d-acts">${foot}</div></aside>`;
export const footerHtml = () => html`<footer class="site-foot"><div class="wrap"><div class="foot-grid">
    <div class="stack">${logo('#/', 'dark')}<p class="small" style="max-width:34ch">One platform. Every sport. Every player. Built in Kenya, ready for the world.</p><span class="lanes" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>
    <div><h5>Play</h5><a href="#/games">Find a game</a><a href="#/teams">Teams and clubs</a><a href="#/coaches">Coaches</a><a href="#/membership">Membership</a></div>
    <div><h5>Compete</h5><a href="#/tournaments">Tournaments</a><a href="#/athletes">Athletes</a><a href="#/community">Community</a><a href="#/sports">All sports</a></div>
    <div><h5>Business</h5><a href="#/facilities">Facilities</a><a href="#/marketplace">Marketplace</a><a href="#/advertise">Advertise</a><a href="#/join/facility">List your facility</a></div>
    <div><h5>Trust</h5><a href="#/legal/privacy">Privacy and data protection</a><a href="#/legal/terms">Terms and policies</a><a href="#/legal/minors">Young athletes</a></div>
  </div><div class="foot-end"><span>© ${new Date().getFullYear()} SportsHub-KE</span><span>Nairobi, Kenya</span></div></div></footer>
  <button id="up" class="up" aria-label="Back to top" data-act="toTop">${ic('arrow-up')}</button>`;
A.toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
export const headActs = () => html`<a class="icon-btn hide-m" href="#/search" aria-label="Search">${ic('search')}</a>${S.uid ? html`${accountActions()}<a class="btn btn-blue hide-t" href="#/app">Dashboard</a>` : html`<a class="btn btn-ghost hide-t" href="#/signin">Sign In</a><a class="btn btn-blue" href="#/join">Join SportsHub</a>`}<button class="icon-btn burger" data-act="openDrawerAct" aria-label="Open menu">${ic('menu')}</button>`;
export const drawerActs = () => S.uid ? html`<a class="btn btn-blue btn-block" href="#/app">Dashboard</a><button class="btn btn-ghost on-dark btn-block" data-act="signOut">Sign out</button>` : html`<a class="btn btn-ghost on-dark btn-block" href="#/signin">Sign In</a><a class="btn btn-blue btn-block" href="#/join">Join SportsHub</a>`;
export const drawShell = () => {
  const root = $('#root'), main = $('#main');
  if (S.shell === 'auth') return;
  if (S.shell === 'app') {
    const nav = navFor(S.activeRole), tabs = tabsFor(S.activeRole), avail = rolesAvailable(), c = ROLE_COLOR[S.activeRole] || 'blue';
    main.classList.add('app-page');
    const wrap = document.createElement('div');
    wrap.className = `app c-${c} ${S.activeRole === 'admin' ? 'is-admin' : ''}`;
    wrap.innerHTML = html`<aside class="side" aria-label="Dashboard navigation">${logo('#/', 'dark')}
        ${avail.length > 1 ? html`<div class="role-switch"><label for="role-sw">Viewing as</label><select id="role-sw" data-change="switchRole">${avail.map(r => opt(r, ROLE_LABEL[r] || r, S.activeRole))}</select></div>` : html`<div class="role-switch"><label>Account</label><span class="strong small">${ROLE_LABEL[S.activeRole] || 'Member'}</span></div>`}
        ${nav.map(g => html`<nav class="side-group" aria-label="${g.title || 'Main'}">${g.title ? html`<h6>${g.title}</h6>` : ''}${g.items.map(([href, icon, label, n]) => html`<a class="side-link" href="#${href}">${ic(icon)}<span>${label}</span>${n ? raw(`<span class="n" data-count="${esc(n)}"></span>`) : ''}</a>`)}</nav>`)}</aside>
      <div class="app-main"><header class="app-top">${searchBox()}<div style="flex:1"></div>${accountActions()}</header><div id="main-host"></div></div>
      <nav class="tabbar" aria-label="Quick navigation">${tabs.map(([href, icon, label]) => html`<a href="#${href}">${ic(icon)}${label}</a>`)}<button data-act="openNavSheet">${ic('menu')}More</button></nav>`.s;
    root.innerHTML = ''; root.append(wrap);
    wrap.querySelector('#main-host').replaceWith(main);
    root.insertAdjacentHTML('beforeend', drawerHtml('Menu', html`${nav.map(g => html`${g.title ? html`<h6>${g.title}</h6>` : ''}${g.items.map(([href, icon, label]) => html`<a href="#${href}">${ic(icon)} ${label}</a>`)}`)}`, html`<button class="btn btn-ghost on-dark btn-block" data-act="signOut">${ic('log-out')} Sign out</button>`).s);
    rewriteLinks(root); updateActiveNav();
    return;
  }
  main.insertAdjacentHTML('beforebegin', html`<header class="site-head"><div class="wrap">${logo()}
      <nav class="nav" aria-label="Main">${PUBLIC_NAV.map(([h, l]) => html`<a href="#${h}">${l}</a>`)}</nav>
      <div class="head-acts">${headActs()}</div></div></header>`.s);
  main.insertAdjacentHTML('afterend', footerHtml().s);
  root.insertAdjacentHTML('beforeend', drawerHtml('Menu', html`${PUBLIC_NAV.map(([h, l]) => html`<a href="#${h}">${l}</a>`)}<a href="#/coaches">Coaches</a><a href="#/community">Community</a><a href="#/membership">Membership</a><a href="#/search">Search</a>`, drawerActs()).s);
  rewriteLinks(root); updateActiveNav();
};
export const openDrawer = () => { const d = $('.drawer'); if (!d) return; d.hidden = false; requestAnimationFrame(() => { d.classList.add('open'); $('.drawer-scrim').classList.add('on'); document.documentElement.classList.add('dlock'); }); };
export const closeDrawer = () => { const d = $('.drawer'); if (!d || d.hidden) return; d.classList.remove('open'); $('.drawer-scrim').classList.remove('on'); document.documentElement.classList.remove('dlock'); setTimeout(() => { d.hidden = true; }, 320); };
A.openDrawerAct = () => openDrawer();
A.closeDrawerAct = () => closeDrawer();
A.openNavSheet = () => openDrawer();
export const ROLE_HOME = { captain: '/app/team', coach: '/app/coach', vendor: '/app/store', facility: '/app/facility', organiser: '/app/org', scout: '/app/scout', player: '/app' };
A.switchRole = (d, el) => {
  S.activeRole = el.value;
  try { localStorage.setItem(`shke.role.${S.uid}`, el.value); } catch (e) { /* preference only */ }
  location.assign(el.value === 'admin' ? '/admin/' : toUrl(ROLE_HOME[el.value] || '/app'));
};
A.accountMenu = (d, el) => {
  const host = el.parentElement, old = $('.menu', host);
  if (old) { old.remove(); return; }
  const div = document.createElement('div');
  div.className = 'menu'; div.dataset.open = '1';
  div.innerHTML = html`<a href="#/app">${ic('layout-dashboard')} Dashboard</a><a href="#/players/${S.uid}">${ic('user')} Public profile</a><a href="#/app/settings">${ic('settings')} Settings</a><button data-act="signOut">${ic('log-out')} Sign out</button>`.s;
  host.append(div);
};
A.signOut = async () => { await auth.signOut(); location.assign('/'); };
/* ----- Global search: token queries, never a full download ----- */
export const SEARCH_SOURCES = [
  { label: 'Players', col: 'playerProfiles', icon: 'user', where: () => [['visibility', '==', 'public']], t: x => x.name, s: x => `${x.town || x.county} · ${x.skill}`, href: x => `/players/${x.id}` },
  { label: 'Teams', col: 'teams', icon: 'users', where: () => [], t: x => x.name, s: x => `${x.sportName} · ${x.county}`, href: x => `/teams/${x.id}` },
  { label: 'Coaches', col: 'coaches', icon: 'clipboard-list', where: () => [['verified', '==', true]], t: x => x.name, s: x => `${x.academy || 'Coach'} · ${x.county}`, href: x => `/coaches/${x.id}` },
  { label: 'Facilities', col: 'facilities', icon: 'map-pin', where: () => [['status', '==', 'approved']], t: x => x.name, s: x => `${x.town}, ${x.county}`, href: x => `/facilities/${x.id}` },
  { label: 'Games', col: 'games', icon: 'calendar-days', where: () => [['status', '==', 'open']], t: x => x.title, s: x => `${fmtDT(x.start)} · ${x.town}`, href: x => `/games/${x.id}` },
  { label: 'Tournaments', col: 'tournaments', icon: 'trophy', where: () => [], t: x => x.name, s: x => `${x.sportName} · ${x.county}`, href: x => `/tournaments/${x.id}` },
  { label: 'Shops', col: 'stores', icon: 'store', where: () => [['active', '==', true]], t: x => x.name, s: x => `${x.town}, ${x.county}`, href: x => `/marketplace/store/${x.id}` },
  { label: 'Products', col: 'products', icon: 'package', where: () => [['status', '==', 'active']], t: x => x.title, s: x => `${money(x.salePrice || x.price)} · ${x.storeName}`, href: x => `/marketplace/product/${x.id}` },
  { label: 'Organisations', col: 'organisations', icon: 'building-2', where: () => [['verified', '==', true]], t: x => x.name, s: x => x.county, href: x => `/search?q=${encodeURIComponent(x.name)}` }
];
export const searchAll = async (term, perSource = 4, only) => {
  const tok = term.trim().toLowerCase().split(/\s+/)[0].slice(0, 12);
  if (tok.length < 2) return [];
  const srcs = only ? SEARCH_SOURCES.filter(s => s.label === only) : SEARCH_SOURCES;
  const res = await Promise.all(srcs.map(async s => ({ ...s, rows: await db.list(s.col, { where: [['searchTokens', 'array-contains', tok], ...s.where()], limit: perSource }) })));
  return res.filter(r => r.rows.length);
};
document.addEventListener('input', debounce(async e => {
  const t = e.target; if (!t.matches || !t.matches('[data-search]')) return;
  const host = t.parentElement; $$('.search-drop', host).forEach(d => d.remove());
  const q = t.value.trim();
  if (q.length < 2) return;
  const groups = await searchAll(q, 3);
  const box = document.createElement('div'); box.className = 'search-drop';
  box.innerHTML = groups.length ? html`${groups.map(g => html`<h6>${g.label}</h6>${g.rows.map(x => html`<a href="#${g.href(x)}">${ic(g.icon)}<span class="grow"><span class="semi clip" style="display:block">${g.t(x)}</span><span class="xs faint clip" style="display:block">${g.s(x)}</span></span></a>`)}`)}<a class="semi" href="#/search?q=${encodeURIComponent(q)}">See all results ${ic('arrow-right')}</a>`.s : html`<div class="small muted" style="padding:12px">No results for that search yet.</div>`.s;
  host.append(box);
}, 200));
document.addEventListener('keydown', e => {
  const t = e.target;
  if (e.key === 'Enter' && t.matches && t.matches('[data-search]') && t.value.trim()) { $$('.search-drop').forEach(d => d.remove()); go(`/search?q=${encodeURIComponent(t.value.trim())}`); }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const s = $('[data-search]'); if (s) { e.preventDefault(); s.focus(); } }
});
/* ----- Advertising slots: only in discovery and dashboards, never inside booking flows ----- */
export const adSlot = async placement => {
  const rows = await db.list('advertisingCampaigns', { where: [['status', '==', 'active'], ['approvedPlacements', 'array-contains', placement]], limit: 12 });
  const nowIso = new Date().toISOString();
  const fit = rows.filter(a => a.start <= nowIso && a.end > nowIso && (!(a.counties || []).length || (S.user && a.counties.includes(S.user.county))) && (!(a.sports || []).length || (S.profile && a.sports.some(s => (S.profile.sports || []).includes(s)))));
  if (!fit.length) return '';
  const a = fit[Math.floor(Math.random() * fit.length)];
  return html`<aside class="ad-slot" data-ad="${a.id}" data-placement="${placement}" aria-label="Sponsored"><div class="ad-in">
    <div class="pic">${a.creative ? html`<img src="${a.creative}" alt="" loading="lazy">` : ''}</div>
    <div><div class="ad-label">Sponsored · ${a.business}</div><div class="semi">${a.title}</div><div class="small muted clip">${a.description}</div></div>
    <button class="btn btn-ghost btn-sm" data-act="adClick" data-id="${a.id}" data-placement="${placement}" data-url="${a.destination}">Learn more ${ic('external-link')}</button>
  </div></aside>`;
};
export const adSeen = new Set();
export const adObserver = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  const k = e.target.dataset.ad + e.target.dataset.placement + location.href;
  adObserver.unobserve(e.target);
  if (adSeen.has(k)) return; adSeen.add(k);
  callOp('trackAd', { id: e.target.dataset.ad, placement: e.target.dataset.placement, kind: 'impression' }).catch(() => {});
}), { threshold: .5 }) : null;
export const bindAds = root => { if (adObserver) $$('[data-ad]', root).forEach(el => adObserver.observe(el)); };
A.adClick = async d => {
  callOp('trackAd', { id: d.id, placement: d.placement, kind: 'click' }).catch(() => {});
  if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
};
/* ----- Charts: thin single-axis marks with accessible titles; no chart library ----- */
export const barChart = (data, { c = 'var(--bk)', h = 150, fmtV = compact } = {}) => {
  const W = 400, pad = 26, max = Math.max(1, ...data.map(d => d.v)), step = (W - 8) / Math.max(1, data.length), bw = Math.min(28, step * .55);
  return html`<svg class="chart" viewBox="0 0 ${W} ${h + pad}" role="img" aria-label="${data.map(d => `${d.l}: ${fmtV(d.v)}`).join(', ')}">
    <line x1="0" x2="${W}" y1="${h}" y2="${h}" stroke="var(--line)"/>
    ${data.map((d, i) => { const bh = Math.max(d.v ? 2 : 0, d.v / max * (h - 20)), x = i * step + step / 2 - bw / 2; return html`<g><title>${d.l}: ${fmtV(d.v)}</title><rect x="${i * step}" y="0" width="${step}" height="${h}" fill="transparent"/><rect class="b" x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="4" fill="${c}" style="animation-delay:${i * 70}ms"/><text x="${x + bw / 2}" y="${h - bh - 6}" text-anchor="middle">${d.v ? fmtV(d.v) : ''}</text><text x="${x + bw / 2}" y="${h + 16}" text-anchor="middle">${d.l}</text></g>`; })}
  </svg>`;
};
export const hbars = (rows, c = 'var(--bk)', fmtV = v => v) => { const max = Math.max(1, ...rows.map(r => r[1])); return html`<div>${rows.map(([l, v], i) => html`<div class="hbar"><span class="clip" title="${l}">${l}</span><span class="track"><i style="width:${v / max * 100}%;background:${c};animation-delay:${i * 60}ms"></i></span><span class="tar nums semi">${fmtV(v)}</span></div>`)}</div>`; };
/* The eight monthly sessions, one marker each: available, reserved, or attended. */
export const creditMeter = (p, pop) => {
  const granted = (p.granted || 0) + (p.transferredIn || 0) - (p.transferredOut || 0), n = Math.max(granted, 1), used = p.used || 0, held = p.held || 0;
  const cells = Array.from({ length: n }, (_, i) => i < used ? 'used' : i < used + held ? 'held' : 'free');
  return html`<div class="meter ${pop ? 'pop' : ''}" style="--n:${n}" role="img" aria-label="${used} attended, ${held} reserved, ${n - used - held} available of ${n} sessions">${cells.map((c, i) => html`<div class="cred ${c}" data-n="${i + 1}" style="animation-delay:${i * 60}ms"></div>`)}</div>
  <div class="legend mt"><span><i class="lg-free"></i>Available ${n - used - held}</span><span><i class="lg-held"></i>Reserved ${held}</span><span><i class="lg-used"></i>Attended ${used}</span></div>`;
};
/* ----- Shared decorative pieces ----- */
export const pgHero = ({ c = 'blue', eye, title, lede, action }) => html`<div class="pg-hero c-${c}"><div class="wrap"><div class="ph-copy"><span class="eyebrow rv f">${eye}</span><h1 style="margin-top:18px"><span class="lnr" style="--d:.05s"><span>${title}</span></span></h1>${lede ? html`<p class="lede rv u" style="--d:.2s">${lede}</p>` : ''}</div>${action ? html`<div class="row rv u" style="--d:.3s">${action}</div>` : ''}</div><span class="ph-line"></span></div>`;
/* Role dashboards open with a clear header: who you are, where you are, what to do next. No decoration. */
export const dashHero = ({ c = 'blue', title, sub, action, photo, kick }) => html`<header class="dash-hero c-${c} ${photo ? 'has-photo' : ''}">${photo ? html`<span class="dh-photo img-rv">${raw(`<img src="${esc(photo)}" alt="">`)}</span>` : ''}<div class="dh-c"><span class="dh-k">${kick || ROLE_LABEL[S.activeRole] || 'SportsHub'}</span><h1><span class="lnr"><span>${title}</span></span></h1>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>${action ? html`<div class="dh-a">${action}</div>` : ''}</header>`;

/* ----- Role navigation ----- */
/* ----- Registration and member dashboards. Each account type has its own navigation, home and priorities. ----- */
export const COMMON_NAV = { title: 'Connect', items: [['/app/calendar', 'calendar', 'Calendar'], ['/app/messages', 'message-square', 'Messages', 'msg'], ['/app/notifications', 'bell', 'Notifications', 'notif'], ['/community', 'newspaper', 'Community']] };
export const ACCOUNT_NAV = { title: 'Account', items: [['/app/profile', 'user', 'Profile'], ['/app/payments', 'receipt', 'Payments'], ['/app/ads', 'megaphone', 'Advertising'], ['/app/settings', 'settings', 'Settings']] };
export const navFor = role => {
  if (role === 'admin') return adminNav();
  const map = {
    player: [{ items: [['/app', 'layout-dashboard', 'Home'], ['/app/membership', 'badge-check', 'Membership'], ['/app/games', 'calendar-days', 'My games'], ['/app/bookings', 'ticket', 'Bookings'], ['/app/teams', 'users', 'My teams']] },
      { title: 'Performance', items: [['/app/stats', 'chart-column', 'Statistics'], ['/app/requests', 'inbox', 'Contact requests']] },
      { title: 'Money', items: [['/app/transfers', 'arrow-left-right', 'Session transfers'], ['/app/orders', 'shopping-bag', 'Orders']] }, COMMON_NAV, ACCOUNT_NAV],
    captain: [{ items: [['/app/team', 'layout-dashboard', 'Team home'], ['/app/team/squad', 'users', 'Squad'], ['/app/team/fixtures', 'calendar-days', 'Fixtures'], ['/app/team/challenges', 'swords', 'Challenges'], ['/app/team/training', 'dumbbell', 'Training'], ['/app/team/transfers', 'arrow-left-right', 'Transfers']] }, COMMON_NAV, ACCOUNT_NAV],
    coach: [{ items: [['/app/coach', 'layout-dashboard', 'Coach home'], ['/app/coach/roster', 'users', 'Roster'], ['/app/coach/training', 'dumbbell', 'Training'], ['/app/coach/academy', 'building-2', 'Academy profile']] }, COMMON_NAV, ACCOUNT_NAV],
    vendor: [{ items: [['/app/store', 'layout-dashboard', 'Sales overview'], ['/app/store/products', 'package', 'Products and inventory'], ['/app/store/orders', 'shopping-bag', 'Orders'], ['/app/store/promotions', 'tag', 'Promotions'], ['/app/store/reviews', 'star', 'Reviews'], ['/app/store/payouts', 'wallet', 'Commissions and payouts'], ['/app/store/profile', 'store', 'Store profile']] }, COMMON_NAV, ACCOUNT_NAV],
    facility: [{ items: [['/app/facility', 'layout-dashboard', 'Facility home'], ['/app/facility/bookings', 'ticket', 'Bookings and check-ins'], ['/app/facility/pitches', 'land-plot', 'Pitches and courts'], ['/app/facility/maintenance', 'wrench', 'Availability and maintenance'], ['/app/facility/staff', 'id-card', 'Staff'], ['/app/facility/settlements', 'wallet', 'Revenue and settlements'], ['/app/facility/reviews', 'star', 'Reviews'], ['/app/facility/profile', 'map-pin', 'Facility profile']] }, COMMON_NAV, ACCOUNT_NAV],
    organiser: [{ items: [['/app/org', 'layout-dashboard', 'Organisation home'], ['/app/org/competitions', 'trophy', 'Competitions'], ['/app/org/registrations', 'clipboard-list', 'Registrations'], ['/app/org/reports', 'file-text', 'Reports'], ['/app/org/announcements', 'megaphone', 'Announcements']] }, COMMON_NAV, ACCOUNT_NAV],
    scout: [{ items: [['/app/scout', 'search', 'Talent discovery'], ['/app/scout/requests', 'inbox', 'Sent requests']] }, COMMON_NAV, ACCOUNT_NAV]
  };
  return map[role] || map.player;
};
export const tabsFor = role => role === 'admin' ? [['/admin', 'layout-dashboard', 'Overview'], ['/admin/payments', 'banknote', 'Confirm'], ['/admin/revenue', 'trending-up', 'Revenue'], ['/admin/users', 'users', 'Users']] : ({
  player: [['/app', 'layout-dashboard', 'Home'], ['/games', 'calendar-days', 'Games'], ['/app/membership', 'badge-check', 'Sessions'], ['/app/messages', 'message-square', 'Chat']],
  captain: [['/app/team', 'layout-dashboard', 'Team'], ['/app/team/squad', 'users', 'Squad'], ['/app/team/fixtures', 'calendar-days', 'Fixtures'], ['/app/messages', 'message-square', 'Chat']],
  coach: [['/app/coach', 'layout-dashboard', 'Home'], ['/app/coach/roster', 'users', 'Roster'], ['/app/coach/training', 'dumbbell', 'Training'], ['/app/messages', 'message-square', 'Chat']],
  vendor: [['/app/store', 'layout-dashboard', 'Sales'], ['/app/store/products', 'package', 'Products'], ['/app/store/orders', 'shopping-bag', 'Orders'], ['/app/messages', 'message-square', 'Chat']],
  facility: [['/app/facility', 'layout-dashboard', 'Home'], ['/app/facility/bookings', 'ticket', 'Bookings'], ['/app/facility/settlements', 'wallet', 'Revenue'], ['/app/messages', 'message-square', 'Chat']],
  organiser: [['/app/org', 'layout-dashboard', 'Home'], ['/app/org/competitions', 'trophy', 'Events'], ['/app/org/registrations', 'clipboard-list', 'Entries'], ['/app/messages', 'message-square', 'Chat']],
  scout: [['/app/scout', 'search', 'Talent'], ['/app/scout/requests', 'inbox', 'Requests'], ['/app/calendar', 'calendar', 'Calendar'], ['/app/messages', 'message-square', 'Chat']]
}[role] || []);
export const page = (...c) => html`<div class="page">${c}</div>`;
/* ----- Administration. Hiding a module is a courtesy; the trusted operations and rules enforce each role. ----- */
export const ADMIN_MODULES = [
  ['Overview', [['overview', 'layout-dashboard', 'Overview and analytics', 'overview']]],
  ['People', [['users', 'users', 'User management', 'users'], ['verify', 'shield-check', 'Account verification', 'verify'], ['teams', 'shield', 'Team management', 'teams'], ['coaches', 'clipboard-list', 'Coach applications', 'verify'], ['players', 'user', 'Player management', 'players']]],
  ['Sport', [['sports', 'volleyball', 'Sports and disciplines', 'sports'], ['games', 'calendar-days', 'Games and events', 'games'], ['tournaments', 'trophy', 'Tournament management', 'tournaments']]],
  ['Venues', [['facilities', 'map-pin', 'Facility approvals', 'facilities'], ['venues', 'land-plot', 'Venue management', 'facilities']]],
  ['Marketplace', [['vendors', 'store', 'Vendor approvals', 'vendors'], ['moderation-products', 'package-check', 'Marketplace moderation', 'marketplace'], ['products', 'package', 'Product management', 'marketplace'], ['orders', 'shopping-bag', 'Orders and disputes', 'orders']]],
  ['Finance', [['revenue', 'trending-up', 'Revenue', 'payments'], ['payments', 'banknote', 'M-Pesa confirmations', 'payments'], ['membership', 'badge-check', 'Membership management', 'membership'], ['pay-registration', 'receipt', 'Registration payments', 'payments'], ['pay-membership', 'credit-card', 'Monthly subscription payments', 'payments'], ['credits', 'coins', 'Session-credit management', 'credits'], ['transfers', 'arrow-left-right', 'Membership transfers', 'transfers'], ['settlements', 'wallet', 'Facility settlements', 'settlements']]],
  ['Commercial', [['ads', 'megaphone', 'Advertising management', 'ads'], ['sponsorship', 'layout-template', 'Sponsorship and featured', 'featured']]],
  ['Trust', [['mod-messages', 'message-square-warning', 'Messaging moderation', 'moderation'], ['mod-feed', 'newspaper', 'Social feed moderation', 'moderation'], ['announce', 'bell-ring', 'Notifications and announcements', 'notifications']]],
  ['System', [['reports', 'file-text', 'Reports and exports', 'reports'], ['config', 'settings', 'System configuration', 'config'], ['roles', 'key-round', 'Roles and permissions', 'roles'], ['audit', 'scroll-text', 'Audit logs', 'audit']]]
];
export const adminNav = () => ADMIN_MODULES.map(([title, mods]) => ({ title, items: mods.filter(m => canAdmin(m[3])).map(m => [m[0] === 'overview' ? '/admin' : `/admin/${m[0]}`, m[1], m[2]]) })).filter(g => g.items.length);
