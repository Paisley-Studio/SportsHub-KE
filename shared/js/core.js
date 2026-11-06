/* SportsHub-KE core: reference data, utilities and the matchmaking engine. */
import { TZ, LOCALE, CURRENCY } from './config.js';

/* ==========================================================================
   SPORTSHUB-KE CORE: reference data, utilities and the matchmaking engine.
   ========================================================================== */
/* Photography lives in /assets/photos: web-sized copies of the originals in /Img (see README).
   Older names used by pages not yet redesigned point at the nearest new photograph. */
const PHOTO_ALIAS = { 'football-pitch': 'football-boot-night', 'football-orange': 'football-boot-tall', 'football-dust': 'football-sunset', 'football-ghana': 'rugby-kenya', 'football-boot': 'football-boot-night', 'hero-football': 'football-sunset', 'basketball-game': 'basketball-net', 'basketball-crowd': 'basketball-dunk', 'basketball-court': 'basketball-net', 'basketball-hoop': 'basketball-net', 'basketball-team': 'basketball-dunk', 'athletics-javelin': 'kenya-athlete-flag', 'athletics-runner': 'kenya-runners', 'athletics-start': 'kenya-runners', 'golf-pair': 'golf-tee', 'tennis-court': 'tennis-serve', 'tennis-racket': 'tennis-balls', 'swim-race': 'swim-butterfly', 'swim-aerial': 'swim-lane', volleyball: 'volleyball-beach', rugby: 'rugby-kenya', cricket: 'cricket-batter', 'shop-golf': 'equipment-grass', 'shop-shoes': 'equipment-dark', 'shop-store': 'equipment-dark' };
export const img = name => `/assets/photos/${PHOTO_ALIAS[name] || name}.webp`;
export const BRAND = { light: '/assets/branding/logo-light.webp', dark: '/assets/branding/logo-dark.webp', poster: '/assets/branding/brand-poster.webp' };
/* ----- Reference data ----- */
/* County, approximate centre and main towns. Used for nearby matching only, never for showing where a person lives. */
export const COUNTIES = {
  'Baringo': [0.49, 35.97, 'Kabarnet,Eldama Ravine,Marigat'], 'Bomet': [-0.78, 35.34, 'Bomet,Sotik'], 'Bungoma': [0.57, 34.56, 'Bungoma,Webuye,Kimilili'], 'Busia': [0.46, 34.11, 'Busia,Malaba'], 'Elgeyo-Marakwet': [0.67, 35.51, 'Iten,Kapsowar'], 'Embu': [-0.54, 37.46, 'Embu,Runyenjes'], 'Garissa': [-0.45, 39.65, 'Garissa,Dadaab'], 'Homa Bay': [-0.53, 34.46, 'Homa Bay,Oyugis,Mbita'], 'Isiolo': [0.35, 37.58, 'Isiolo,Merti'], 'Kajiado': [-1.85, 36.78, 'Kitengela,Ngong,Ongata Rongai,Kajiado'], 'Kakamega': [0.28, 34.75, 'Kakamega,Mumias,Malava'], 'Kericho': [-0.37, 35.28, 'Kericho,Litein'], 'Kiambu': [-1.03, 36.83, 'Thika,Ruiru,Kikuyu,Kiambu,Juja'], 'Kilifi': [-3.51, 39.91, 'Kilifi,Malindi,Watamu'], 'Kirinyaga': [-0.56, 37.28, 'Kerugoya,Sagana'], 'Kisii': [-0.68, 34.77, 'Kisii,Ogembo'], 'Kisumu': [-0.09, 34.77, 'Kisumu,Ahero,Maseno'], 'Kitui': [-1.37, 38.01, 'Kitui,Mwingi'], 'Kwale': [-4.17, 39.45, 'Kwale,Ukunda,Diani'], 'Laikipia': [0.2, 36.8, 'Nanyuki,Nyahururu'], 'Lamu': [-2.27, 40.9, 'Lamu,Mpeketoni'], 'Machakos': [-1.52, 37.26, 'Machakos,Athi River,Mlolongo'], 'Makueni': [-2.28, 37.83, 'Wote,Makindu'], 'Mandera': [3.94, 41.86, 'Mandera,Elwak'], 'Marsabit': [2.33, 37.99, 'Marsabit,Moyale'], 'Meru': [0.05, 37.65, 'Meru,Maua,Nkubu'], 'Migori': [-1.06, 34.47, 'Migori,Rongo,Awendo'], 'Mombasa': [-4.04, 39.67, 'Nyali,Likoni,Kisauni,Mombasa Island'], "Murang'a": [-0.72, 37.15, "Murang'a,Kenol"], 'Nairobi': [-1.29, 36.82, 'Westlands,Kasarani,Langata,Karen,Embakasi,Kibra,Eastleigh,South B,Dagoretti,Parklands'], 'Nakuru': [-0.3, 36.07, 'Nakuru,Naivasha,Gilgil'], 'Nandi': [0.18, 35.1, 'Kapsabet,Nandi Hills'], 'Narok': [-1.08, 35.87, 'Narok,Kilgoris'], 'Nyamira': [-0.56, 34.94, 'Nyamira,Keroka'], 'Nyandarua': [-0.18, 36.48, 'Ol Kalou,Engineer'], 'Nyeri': [-0.42, 36.95, 'Nyeri,Karatina'], 'Samburu': [1.1, 36.7, 'Maralal,Baragoi'], 'Siaya': [0.06, 34.29, 'Siaya,Bondo,Ugunja'], 'Taita-Taveta': [-3.4, 38.37, 'Voi,Wundanyi,Taveta'], 'Tana River': [-1.5, 40.03, 'Hola,Garsen'], 'Tharaka-Nithi': [-0.3, 37.8, 'Chuka,Marimanti'], 'Trans-Nzoia': [1.02, 35, 'Kitale,Kiminini'], 'Turkana': [3.12, 35.6, 'Lodwar,Kakuma'], 'Uasin Gishu': [0.52, 35.27, 'Eldoret,Turbo,Moiben'], 'Vihiga': [0.05, 34.72, 'Vihiga,Mbale,Luanda'], 'Wajir': [1.75, 40.06, 'Wajir,Habaswein'], 'West Pokot': [1.24, 35.11, 'Kapenguria,Makutano']
};
export const COUNTY_NAMES = Object.keys(COUNTIES).sort();
export const townsOf = c => (COUNTIES[c] ? COUNTIES[c][2].split(',') : []);
export const PRODUCT_CATEGORIES = ['Football boots', 'Football kits', 'Basketball shoes', 'Basketball jerseys', 'Running shoes', 'Athletics equipment', 'Golf clubs', 'Golf accessories', 'Tennis equipment', 'Swimming equipment', 'Sportswear', 'Sports bags', 'Caps', 'Tracksuits', 'Gym equipment', 'Protective equipment', 'Sports accessories', 'Wearables', 'Other'];
export const CATEGORY_ICON = { 'Football boots': 'footprints', 'Football kits': 'shirt', 'Basketball shoes': 'footprints', 'Basketball jerseys': 'shirt', 'Running shoes': 'footprints', 'Athletics equipment': 'timer', 'Golf clubs': 'flag', 'Golf accessories': 'flag', 'Tennis equipment': 'circle-dot', 'Swimming equipment': 'waves', 'Sportswear': 'shirt', 'Sports bags': 'backpack', 'Caps': 'hard-hat', 'Tracksuits': 'shirt', 'Gym equipment': 'dumbbell', 'Protective equipment': 'shield', 'Sports accessories': 'package', 'Wearables': 'watch', 'Other': 'package' };
export const AD_PLACEMENTS = { home_hero: 'Homepage hero sponsor', home_feature: 'Homepage featured campaign', player_dash: 'Player dashboard banner', team_dash: 'Team dashboard promotion', coach_dash: 'Coach dashboard promotion', marketplace: 'Marketplace advertising', game_discovery: 'Game discovery sponsorship', facility_discovery: 'Facility discovery sponsorship', tournament: 'Tournament sponsorship', featured_store: 'Featured storefront', sponsored_product: 'Sponsored product placement', news: 'Community feed sponsorship' };
export const AVAILABILITY = ['Weekday mornings', 'Weekday afternoons', 'Weekday evenings', 'Saturday', 'Sunday'];
export const GAME_TYPES = ['Open games', 'Team matches', 'Training sessions', 'Tournaments', 'Casual fitness'];
export const SKILLS = ['Beginner', 'Recreational', 'Intermediate', 'Advanced', 'Elite'];
export const ROLE_LABEL = { player: 'Player', captain: 'Team captain', coach: 'Coach', vendor: 'Vendor', facility: 'Facility owner', organiser: 'Organisation', scout: 'Scout', admin: 'Administrator' };
export const ROLE_COLOR = { player: 'blue', captain: 'green', coach: 'yellow', vendor: 'magenta', facility: 'green', organiser: 'yellow', scout: 'blue', admin: 'blue' };
export const STATUS_TONE = { active: 'ok', approved: 'ok', confirmed: 'ok', success: 'ok', paid: 'ok', completed: 'ok', delivered: 'ok', attended: 'ok', checked_in: 'ok', open: 'ok', published: 'ok', accepted: 'ok', consumed: 'ok', running: 'info', processing: 'info', shipped: 'info', scheduled: 'info', submitted: 'info', held: 'info', pending: 'warn', awaiting_verification: 'info', pending_payment: 'warn', requested: 'warn', waitlist: 'warn', invited: 'warn', draft: 'warn', info_required: 'warn', awaiting_recipient: 'warn', awaiting_approval: 'warn', paused: 'warn', external: 'warn', inactive: 'neutral', expired: 'neutral', closed: 'neutral', finished: 'neutral', released: 'neutral', dismissed: 'neutral', hidden: 'neutral', removed: 'neutral', rejected: 'bad', failed: 'bad', cancelled: 'bad', suspended: 'bad', declined: 'bad', no_show: 'bad', disputed: 'bad', refunded: 'bad', actioned: 'ok' };
/* ----- Utilities ----- */
/* Safe HTML templating. Everything interpolated is escaped unless it is already a template result. */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtHtml = v => v instanceof Safe ? v.s : Array.isArray(v) ? v.map(fmtHtml).join('') : (v === null || v === undefined || v === false || v === true) ? '' : esc(v);
export const html = (st, ...vals) => new Safe(st.reduce((out, s, i) => out + s + (i < vals.length ? fmtHtml(vals[i]) : ''), ''));
export const raw = s => new Safe(String(s));
export const ic = (name, cls = '') => raw(`<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg#i-${name}"/></svg>`);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const debounce = (fn, ms = 220) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const money = (n, cur = CURRENCY) => `${cur} ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
export const compact = n => { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n.toLocaleString('en-KE'); };
export const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
export const titleCase = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const fmt = (d, o) => new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, ...o }).format(new Date(d));
export const fmtDate = d => d ? fmt(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtDay = d => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = d => fmt(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const fmtDT = d => d ? `${fmtDay(d)}, ${fmtTime(d)}` : '';
export const dayKey = d => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)); return p; };
/* Convert a date and time typed in the platform time zone to UTC. Correct for any configured zone. */
export const zonedISO = (date, time = '00:00') => {
  const guess = new Date(`${date}T${time}:00Z`);
  const shown = new Date(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).format(guess) + ' UTC');
  return new Date(guess.getTime() - (shown.getTime() - guess.getTime())).toISOString();
};
export const timeAgo = d => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
};
export const haversine = (a, b, c, d) => {
  if (!a && !b || !c && !d) return null;
  const R = 6371, r = x => x * Math.PI / 180, x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
export const countyLatLng = c => COUNTIES[c] ? { lat: COUNTIES[c][0], lng: COUNTIES[c][1] } : { lat: 0, lng: 0 };
export const csvDownload = (name, rows) => {
  const head = Object.keys(rows[0] || {});
  /* Prefix formula-like cells so exported data cannot execute in a spreadsheet. */
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const body = [head.map(cell).join(','), ...rows.map(r => head.map(h => cell(r[h])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
/* Image intake: type and size checked, EXIF stripped and size reduced by redrawing to canvas. */
export const ALLOWED_IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
export const readImage = (file, maxSide = 900, quality = .8) => new Promise((resolve, reject) => {
  if (!ALLOWED_IMAGES.includes(file.type)) return reject(new Error('Please choose a JPG, PNG or WebP image.'));
  if (file.size > 8 * 1024 * 1024) return reject(new Error('Images must be 8 MB or smaller.'));
  const im = new Image(), u = URL.createObjectURL(file);
  im.onload = () => {
    const k = Math.min(1, maxSide / Math.max(im.width, im.height)), cv = document.createElement('canvas');
    cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
    cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(u);
    cv.toBlob(b => resolve(b), 'image/jpeg', quality);
  };
  im.onerror = () => { URL.revokeObjectURL(u); reject(new Error('That file could not be read as an image.')); };
  im.src = u;
});
/* ==========================================================================
   4. MATCHMAKING ENGINE
   Scores real stored activities against a player's profile. Every point has a
   stated reason, which the interface shows so recommendations are explainable.
   ========================================================================== */
export const WEIGHTS = { proximity: 30, sport: 28, availability: 12, skill: 12, age: 6, format: 4, team: 4, type: 4 };
export const slotOf = iso => {
  const day = Number(fmt(iso, { day: 'numeric' })) && new Date(new Date(iso).getTime() + 3 * 36e5).getUTCDay();
  const h = Number(fmt(iso, { hour: 'numeric', hourCycle: 'h23' }));
  if (day === 6) return 'Saturday'; if (day === 0) return 'Sunday';
  return h < 12 ? 'Weekday mornings' : h < 17 ? 'Weekday afternoons' : 'Weekday evenings';
};
export const scoreGame = (g, profile, origin) => {
  if (!profile) return { score: 0, reasons: [] };
  let score = 0; const reasons = [];
  const dist = origin && (g.lat || g.lng) ? haversine(origin.lat, origin.lng, g.lat, g.lng) : null;
  if (dist !== null) {
    const k = Math.max(0, 1 - dist / 60); score += WEIGHTS.proximity * k;
    if (dist < 25) reasons.push(`${Math.max(1, Math.round(dist))} km away`);
  } else if (g.county === profile.county) { score += WEIGHTS.proximity * .8; reasons.push(`In ${g.county}`); }
  if ((profile.sports || []).includes(g.sportId)) { score += WEIGHTS.sport; reasons.push('Your sport'); }
  if ((profile.availability || []).includes(slotOf(g.start))) { score += WEIGHTS.availability; reasons.push('Fits your availability'); }
  const gi = SKILLS.indexOf(g.skill), pi = SKILLS.indexOf(profile.skill);
  if (gi < 0 || pi < 0) score += WEIGHTS.skill * .7;
  else { const gap = Math.abs(gi - pi); score += WEIGHTS.skill * Math.max(0, 1 - gap / 3); if (gap <= 1) reasons.push('Your level'); }
  const eligible = (!g.minAge && !g.maxAge) || !profile.ageBand || !profile.isMinor;
  score += eligible ? WEIGHTS.age : 0;
  if (g.format) score += WEIGHTS.format * .5;
  if ((profile.gameTypes || []).includes('Open games')) score += WEIGHTS.type;
  if (g.covered) reasons.push('Covered by membership');
  score += (profile.teamIds || []).length ? WEIGHTS.team * .5 : WEIGHTS.team;
  return { score: Math.round(Math.min(100, score)), reasons, dist };
};
export const scoreTeam = (t, profile, origin) => {
  if (!profile) return { score: 0, reasons: [] };
  let score = 0; const reasons = [];
  if ((profile.sports || []).includes(t.sportId)) { score += 45; reasons.push('Your sport'); }
  if (t.county === profile.county) { score += 30; reasons.push(`In ${t.county}`); }
  const gap = Math.abs(SKILLS.indexOf(t.skill) - SKILLS.indexOf(profile.skill));
  if (gap <= 1) { score += 15; reasons.push('Your level'); }
  if (t.recruiting) { score += 10; reasons.push('Recruiting'); }
  const mine = profile.positions && profile.positions[t.sportId];
  if (mine && (t.lookingFor || []).some(p => p.toLowerCase() === String(mine).toLowerCase())) { score += 20; reasons.unshift(`Needs a ${mine.toLowerCase()}`); }
  return { score: Math.min(100, score), reasons };
};
/* Read-only copies of published rules, for display. The server enforces the real ones. */
export const ADMIN_ROLES_INFO = {
  super: { label: 'Super Administrator', perms: ['*'] },
  platform: { label: 'Platform Administrator', perms: ['overview', 'users', 'verify', 'teams', 'players', 'sports', 'games', 'tournaments', 'facilities', 'vendors', 'marketplace', 'orders', 'membership', 'ads', 'moderation', 'notifications', 'reports', 'featured', 'audit'] },
  finance: { label: 'Finance Administrator', perms: ['overview', 'membership', 'payments', 'credits', 'transfers', 'settlements', 'orders', 'reports', 'audit'] },
  sports_ops: { label: 'Sports Operations Manager', perms: ['overview', 'teams', 'players', 'sports', 'games', 'tournaments', 'facilities', 'notifications', 'reports'] },
  verification: { label: 'Verification Officer', perms: ['overview', 'users', 'verify', 'teams', 'facilities', 'vendors'] },
  marketplace: { label: 'Marketplace Manager', perms: ['overview', 'vendors', 'marketplace', 'orders', 'reports'] },
  advertising: { label: 'Advertising Manager', perms: ['overview', 'ads', 'featured', 'reports'] },
  support: { label: 'Customer Support', perms: ['overview', 'users', 'players', 'membership', 'orders', 'moderation', 'notifications'] },
  content: { label: 'Content Manager', perms: ['overview', 'moderation', 'notifications', 'featured'] }
};
export const Rules = {
  ADMIN_ROLES: ADMIN_ROLES_INFO,
  can: (role, perm) => { const r = ADMIN_ROLES_INFO[role]; return !!r && (r.perms.includes('*') || r.perms.includes(perm)); },
  DEFAULT_SETTINGS: { registrationFee: 500, membershipFee: 1500, sessionsPerPeriod: 8, currency: 'KES', timeZone: 'Africa/Nairobi', country: 'Kenya', commissionRate: 0.1, settlementRatePerSession: 120, cancelWindowHours: 6, strikeLimit: 3, restrictDays: 7, maxTransferCredits: 4, autoApproveProducts: false, mpesaNumber: '0720274530', mpesaName: '' },
  remaining: p => (p.granted || 0) + (p.transferredIn || 0) - (p.transferredOut || 0) - (p.used || 0),
  available: p => Rules.remaining(p) - (p.held || 0),
  hourStamps: (start, end) => { const out = [], t = new Date(start); t.setUTCMinutes(0, 0, 0); for (; t < new Date(end); t.setUTCHours(t.getUTCHours() + 1)) out.push(t.toISOString().slice(0, 13).replace(/[-T]/g, '')); return out; },
  ageOn: (dob, nowIso) => { const b = new Date(dob), n = new Date(nowIso); let a = n.getUTCFullYear() - b.getUTCFullYear(); if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--; return a; }
};
export const SPORT_COLORS = { football: 'blue', basketball: 'magenta', athletics: 'green', 'road-running': 'green', golf: 'yellow', tennis: 'blue', swimming: 'green', volleyball: 'yellow', rugby: 'magenta', cricket: 'blue', hockey: 'magenta', netball: 'magenta', badminton: 'yellow', 'table-tennis': 'blue', boxing: 'magenta', 'martial-arts': 'yellow', cycling: 'green', gymnastics: 'magenta', fitness: 'green', weightlifting: 'yellow', handball: 'blue', motorsports: 'magenta', other: 'blue' };
/* ----- Starting sports catalogue, loaded into Firestore by first-run setup ----- */
export const STD_SKILL = SKILLS, AGE_STD = ['U13', 'U16', 'U18', 'U21', 'Senior', 'Veterans'];
export const sp = (id, name, icon, photo, type, cfg) => ({ id, name, icon, photo, type, color: SPORT_COLORS[id] || 'blue', disciplines: [], positions: [], formats: [], teamSizes: [], ageCategories: AGE_STD, skillLevels: STD_SKILL, durationMinutes: 60, scoring: '', statFields: [], facilityRequirements: [], competitionFormats: type === 'individual' ? ['individual'] : ['knockout', 'round_robin', 'league', 'groups'], active: true, ...cfg });
export const N = (key, label, unit = '') => ({ key, label, type: 'number', unit }), T = (key, label) => ({ key, label, type: 'text', unit: '' });
export const SPORTS_CATALOGUE = [
  sp('football', 'Football', 'goal', 'football-boot-tall', 'team', { disciplines: ['Association', 'Futsal', 'Beach'], positions: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'], formats: ['5-a-side', '7-a-side', '11-a-side'], teamSizes: ['5', '7', '11'], durationMinutes: 90, scoring: 'Goals', statFields: [N('appearances', 'Appearances'), N('goals', 'Goals'), N('assists', 'Assists'), N('cleanSheets', 'Clean sheets'), N('cards', 'Cards')], facilityRequirements: ['Pitch', 'Goals'] }),
  sp('basketball', 'Basketball', 'circle-dot-dashed', 'basketball-net', 'team', { disciplines: ['5x5', '3x3'], positions: ['Point guard', 'Shooting guard', 'Small forward', 'Power forward', 'Center'], formats: ['3x3', '5x5'], teamSizes: ['3', '5'], durationMinutes: 48, scoring: 'Points', statFields: [N('points', 'Points'), N('rebounds', 'Rebounds'), N('assists', 'Assists'), N('steals', 'Steals'), N('blocks', 'Blocks')], facilityRequirements: ['Court', 'Hoops'] }),
  sp('athletics', 'Athletics', 'timer', 'kenya-athlete-flag', 'individual', { disciplines: ['100m', '200m', '400m', '800m', '1500m', '5000m', '10000m', 'Long jump', 'High jump', 'Javelin', 'Shot put'], formats: ['Time trial', 'Meet'], scoring: 'Time or distance', statFields: [T('event', 'Event'), T('time', 'Recorded time'), N('distance', 'Distance', 'm'), T('personalBest', 'Personal best')], facilityRequirements: ['Track'] }),
  sp('road-running', 'Road running', 'footprints', 'kenya-runners', 'individual', { disciplines: ['5K', '10K', 'Half marathon', 'Marathon'], formats: ['Group run', 'Race'], scoring: 'Time', statFields: [T('event', 'Event'), T('time', 'Recorded time'), N('distance', 'Distance', 'km'), T('personalBest', 'Personal best')], facilityRequirements: ['Marked route'] }),
  sp('golf', 'Golf', 'flag', 'golf-tee', 'individual', { disciplines: ['Stroke play', 'Match play', 'Stableford'], formats: ['9 holes', '18 holes', 'Fourball'], durationMinutes: 240, scoring: 'Strokes', statFields: [N('handicap', 'Handicap'), N('rounds', 'Rounds'), N('score', 'Score'), T('result', 'Tournament result')], facilityRequirements: ['Course'] }),
  sp('tennis', 'Tennis', 'circle-dot', 'tennis-serve', 'both', { disciplines: ['Singles', 'Doubles', 'Mixed doubles'], formats: ['Singles', 'Doubles'], teamSizes: ['1', '2'], durationMinutes: 90, scoring: 'Sets', statFields: [N('matches', 'Matches'), N('wins', 'Wins'), N('aces', 'Aces')], facilityRequirements: ['Court', 'Net'] }),
  sp('swimming', 'Swimming', 'waves', 'swim-lane', 'individual', { disciplines: ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'Medley'], formats: ['Lane session', 'Gala'], scoring: 'Time', statFields: [T('stroke', 'Stroke'), N('distance', 'Distance', 'm'), T('time', 'Recorded time'), T('personalBest', 'Personal best')], facilityRequirements: ['Pool'] }),
  sp('volleyball', 'Volleyball', 'volleyball', 'volleyball-beach', 'team', { disciplines: ['Indoor', 'Beach'], positions: ['Setter', 'Outside hitter', 'Middle blocker', 'Opposite', 'Libero'], formats: ['6v6', '2v2'], teamSizes: ['6', '2'], durationMinutes: 75, scoring: 'Sets', statFields: [N('points', 'Points'), N('aces', 'Aces'), N('blocks', 'Blocks'), N('digs', 'Digs')], facilityRequirements: ['Court', 'Net'] }),
  sp('rugby', 'Rugby', 'shield', 'rugby-kenya', 'team', { disciplines: ['Fifteens', 'Sevens'], positions: ['Prop', 'Hooker', 'Lock', 'Flanker', 'Scrum half', 'Fly half', 'Centre', 'Wing', 'Fullback'], formats: ['7s', '15s'], teamSizes: ['7', '15'], durationMinutes: 80, scoring: 'Points', statFields: [N('appearances', 'Appearances'), N('tries', 'Tries'), N('conversions', 'Conversions'), N('tackles', 'Tackles')], facilityRequirements: ['Pitch', 'Posts'] }),
  sp('cricket', 'Cricket', 'target', 'cricket-batter', 'team', { disciplines: ['T20', 'One day'], positions: ['Batter', 'Bowler', 'All-rounder', 'Wicket keeper'], formats: ['T20', '50 overs'], teamSizes: ['11'], durationMinutes: 180, scoring: 'Runs', statFields: [N('runs', 'Runs'), N('wickets', 'Wickets'), N('catches', 'Catches')], facilityRequirements: ['Oval', 'Pitch'] }),
  sp('hockey', 'Hockey', 'swords', '', 'team', { positions: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'], formats: ['11-a-side', '5-a-side'], teamSizes: ['11', '5'], durationMinutes: 60, scoring: 'Goals', statFields: [N('appearances', 'Appearances'), N('goals', 'Goals'), N('assists', 'Assists')], facilityRequirements: ['Turf'] }),
  sp('netball', 'Netball', 'circle', '', 'team', { positions: ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'], formats: ['7-a-side'], teamSizes: ['7'], durationMinutes: 60, scoring: 'Goals', statFields: [N('appearances', 'Appearances'), N('goals', 'Goals'), N('interceptions', 'Interceptions')], facilityRequirements: ['Court'] }),
  sp('badminton', 'Badminton', 'feather', '', 'both', { disciplines: ['Singles', 'Doubles'], formats: ['Singles', 'Doubles'], teamSizes: ['1', '2'], scoring: 'Games', statFields: [N('matches', 'Matches'), N('wins', 'Wins')], facilityRequirements: ['Indoor court'] }),
  sp('table-tennis', 'Table tennis', 'disc', '', 'both', { disciplines: ['Singles', 'Doubles'], formats: ['Singles', 'Doubles'], teamSizes: ['1', '2'], durationMinutes: 45, scoring: 'Games', statFields: [N('matches', 'Matches'), N('wins', 'Wins')], facilityRequirements: ['Table'] }),
  sp('boxing', 'Boxing', 'hand-fist', '', 'individual', { disciplines: ['Flyweight', 'Lightweight', 'Welterweight', 'Middleweight', 'Heavyweight'], formats: ['Sparring', 'Bout'], scoring: 'Rounds', statFields: [N('bouts', 'Bouts'), N('wins', 'Wins'), N('knockouts', 'Knockouts')], facilityRequirements: ['Ring'] }),
  sp('martial-arts', 'Martial arts', 'swords', '', 'individual', { disciplines: ['Taekwondo', 'Karate', 'Judo', 'Jiu-jitsu'], formats: ['Class', 'Sparring', 'Grading'], scoring: 'Points', statFields: [T('grade', 'Grade'), N('bouts', 'Bouts'), N('wins', 'Wins')], facilityRequirements: ['Dojo mats'] }),
  sp('cycling', 'Cycling', 'bike', '', 'individual', { disciplines: ['Road', 'Mountain', 'Track'], formats: ['Group ride', 'Time trial', 'Race'], durationMinutes: 120, scoring: 'Time', statFields: [N('distance', 'Distance', 'km'), T('time', 'Recorded time')], facilityRequirements: ['Route'] }),
  sp('gymnastics', 'Gymnastics', 'person-standing', '', 'individual', { disciplines: ['Artistic', 'Rhythmic', 'Trampoline'], formats: ['Class', 'Competition'], scoring: 'Score', statFields: [T('apparatus', 'Apparatus'), N('score', 'Score')], facilityRequirements: ['Mats', 'Apparatus'] }),
  sp('fitness', 'Fitness', 'heart-pulse', '', 'individual', { disciplines: ['HIIT', 'Yoga', 'Circuit', 'Aerobics'], formats: ['Class', 'Bootcamp'], durationMinutes: 45, scoring: 'Attendance', statFields: [N('sessions', 'Sessions'), N('minutes', 'Minutes')], facilityRequirements: ['Studio or open space'] }),
  sp('weightlifting', 'Weightlifting', 'dumbbell', '', 'individual', { disciplines: ['Snatch', 'Clean and jerk', 'Powerlifting'], formats: ['Training', 'Meet'], scoring: 'Kilograms', statFields: [N('snatch', 'Snatch', 'kg'), N('cleanJerk', 'Clean and jerk', 'kg'), N('total', 'Total', 'kg')], facilityRequirements: ['Platform', 'Weights'] }),
  sp('handball', 'Handball', 'hand', '', 'team', { positions: ['Goalkeeper', 'Wing', 'Back', 'Pivot'], formats: ['7-a-side'], teamSizes: ['7'], scoring: 'Goals', statFields: [N('appearances', 'Appearances'), N('goals', 'Goals'), N('saves', 'Saves')], facilityRequirements: ['Court'] }),
  sp('motorsports', 'Motorsports', 'gauge', '', 'individual', { disciplines: ['Rally', 'Circuit', 'Karting'], formats: ['Stage', 'Race'], durationMinutes: 180, scoring: 'Time', statFields: [T('event', 'Event'), T('time', 'Recorded time'), N('position', 'Finish position')], facilityRequirements: ['Circuit or stage'] }),
  sp('other', 'Other sports', 'trophy', '', 'both', { formats: ['Open format'], statFields: [N('sessions', 'Sessions'), T('result', 'Result')] })
];
/* Photos for sports an administrator may add later, so they still get a real photograph. */
const EXTRA_SPORT_PHOTO = { boxing: 'boxing-fighter', 'martial-arts': 'karate-kick', karate: 'karate-kick', taekwondo: 'karate-kick', judo: 'martial-arts', 'table-tennis': 'table-tennis', cycling: 'cycling-rider', 'mountain-biking': 'cycling-trail', badminton: 'badminton-shuttle', motorsport: 'motorsport-pack', motorsports: 'motorsport-pack', 'motor-racing': 'motorsport-lean', gym: 'gym-lift', fitness: 'gym-lift', weightlifting: 'gym-lift', 'beach-volleyball': 'volleyball-beach' };
export const sportPhoto = s => {
  const own = String(s.photo || '');
  if (/^(https?:|data:|blob:)/.test(own)) return own;
  const c = SPORTS_CATALOGUE.find(x => x.id === s.id);
  const name = (c && c.photo) || EXTRA_SPORT_PHOTO[s.id] || own.replace(/^.*\/|\.webp$/g, '');
  return name ? img(name) : '';
};
