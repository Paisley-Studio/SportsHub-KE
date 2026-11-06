/* SportsHub-KE emails. Every in-app notification written by a trusted operation is also sent by email,
   in the SportsHub theme, through Resend (https://resend.com, HTTP API, free tier 3,000 emails a month).
   Needs the RESEND_API_KEY secret and EMAIL_FROM (a sender on a domain verified in Resend). Without them, emails are skipped.
   Members can switch off a type under Settings > Notification preferences; payment, account and welcome emails always go. */
import { db } from './firestore.js';

const ESSENTIAL = new Set(['payment', 'account', 'welcome', 'verification']);
const COLOR = { blue: '#1FB6F5', green: '#3DB54A', magenta: '#EC1C72', yellow: '#FFB522' };
const TYPE = {
  welcome: ['blue', 'Welcome'], payment: ['green', 'Payment'], membership: ['green', 'Membership'], verification: ['blue', 'Application'],
  account: ['magenta', 'Account'], game: ['blue', 'Games'], booking: ['yellow', 'Booking'], facility: ['yellow', 'Facility'], settlement: ['green', 'Settlement'],
  team: ['magenta', 'Team'], transfer: ['yellow', 'Transfer'], training: ['green', 'Training'], challenge: ['magenta', 'Challenge'], tournament: ['yellow', 'Tournament'],
  coach: ['blue', 'Coaching'], marketplace: ['magenta', 'Marketplace'], order: ['magenta', 'Order'], payout: ['green', 'Payout'], advertising: ['yellow', 'Advertising'],
  scouting: ['blue', 'Scouting'], social: ['blue', 'Community'], announcement: ['magenta', 'Announcement']
};
/* Notification links are the site's short addresses (/app/payments). These are the real pages behind them (same as PAGES in shared/js/ui.js). */
const PAGES = [
  ['/games/:id', '/games/view/'], ['/teams/:id', '/teams/view/'], ['/coaches/:id', '/coaches/view/'], ['/facilities/:id', '/facilities/view/'], ['/tournaments/:id', '/tournaments/view/'], ['/players/:id', '/athletes/profile/'],
  ['/community', '/community/'], ['/app', '/dashboard/'], ['/app/membership', '/dashboard/player/membership/'], ['/app/games', '/dashboard/player/games/'], ['/app/bookings', '/dashboard/player/bookings/'], ['/app/teams', '/dashboard/player/teams/'],
  ['/app/requests', '/dashboard/player/requests/'], ['/app/transfers', '/dashboard/player/transfers/'], ['/app/payments', '/dashboard/player/payments/'], ['/app/orders', '/dashboard/player/orders/'], ['/app/calendar', '/dashboard/calendar/'],
  ['/app/messages/:id', '/dashboard/messages/'], ['/app/notifications', '/dashboard/notifications/'], ['/app/profile', '/dashboard/profile/'], ['/app/settings', '/dashboard/settings/'], ['/app/ads', '/dashboard/advertising/'],
  ['/app/team/squad', '/dashboard/team/squad/'], ['/app/team/fixtures', '/dashboard/team/fixtures/'], ['/app/team/challenges', '/dashboard/team/challenges/'], ['/app/team/transfers', '/dashboard/team/transfers/'],
  ['/app/coach', '/dashboard/coach/'], ['/app/coach/roster', '/dashboard/coach/roster/'], ['/app/store', '/dashboard/vendor/'], ['/app/store/products', '/dashboard/vendor/products/'], ['/app/store/orders', '/dashboard/vendor/orders/'], ['/app/store/payouts', '/dashboard/vendor/payouts/'],
  ['/app/facility', '/dashboard/facility/'], ['/app/facility/bookings', '/dashboard/facility/bookings/'], ['/app/facility/settlements', '/dashboard/facility/settlements/'], ['/app/scout', '/dashboard/scout/'],
  ['/admin', '/admin/'], ['/admin/:module', '/admin/*/']
];
export const realUrl = (site, link) => {
  const [path, hash] = String(link || '/app').split('#');
  for (const [pattern, file] of PAGES) {
    const keys = [], re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$'), m = path.match(re);
    if (!m) continue;
    if (pattern === '/admin/:module') return `${site}/admin/${m[1]}/`;
    const q = keys.length ? '?' + keys.map((k, i) => `${k}=${encodeURIComponent(decodeURIComponent(m[i + 1]))}`).join('&') : '';
    return `${site}${file}${q}${hash ? `#${hash}` : ''}`;
  }
  return `${site}/`;
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* The one SportsHub email layout: table-based so it holds together in Gmail, Outlook and phone mail apps. */
export function renderEmail({ site, name, type, title, body, link }) {
  const [c, label] = TYPE[type] || ['blue', 'SportsHub'], accent = COLOR[c], url = realUrl(site, link), year = new Date().getFullYear();
  const bar = ['blue', 'green', 'magenta', 'yellow'].map(k => `<td width="25%" style="height:5px;background:${COLOR[k]};font-size:0;line-height:0">&nbsp;</td>`).join('');
  const font = "'Quicksand','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#FFFAF2;font-family:${font};color:#1A1D23">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(body).slice(0, 140)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFAF2"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
  <tr><td style="padding:0 4px 16px"><a href="${site}/" style="text-decoration:none;font-family:${font};font-size:22px;font-weight:700;color:#0B0B0D;letter-spacing:-.01em">Sports<span style="color:${COLOR.magenta}">Hub</span><span style="color:#6F7480;font-size:13px;letter-spacing:.18em">&nbsp;KE</span></a></td></tr>
  <tr><td style="background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #EFE9DE">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${bar}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:30px 30px 8px">
      <p style="margin:0 0 14px;font-family:${font};font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${accent}">&#9644;&nbsp; ${esc(label)}</p>
      <h1 style="margin:0 0 14px;font-family:${font};font-size:24px;line-height:1.25;font-weight:700;color:#0B0B0D">${esc(title)}</h1>
      <p style="margin:0 0 6px;font-family:${font};font-size:15px;line-height:1.65;color:#4A4F59">Hi ${esc(name || 'there')},</p>
      ${body ? `<p style="margin:0 0 22px;font-family:${font};font-size:15px;line-height:1.65;color:#4A4F59">${esc(body)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:4px 30px 30px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:${accent}">
      <a href="${url}" style="display:inline-block;padding:13px 28px;font-family:${font};font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${c === 'yellow' ? '#1A1D23' : '#FFFFFF'};text-decoration:none;border-radius:999px">Open SportsHub</a>
    </td></tr></table></td></tr></table>
  </td></tr>
  <tr><td style="padding:20px 6px 0;font-family:${font};font-size:12px;line-height:1.6;color:#6F7480">
    One platform. Every sport. Every player.<br>
    You received this because you have a SportsHub-KE account. Choose which emails you get in <a href="${site}/dashboard/settings/" style="color:#6F7480">Settings</a>.<br>
    &copy; ${year} SportsHub-KE, Kenya
  </td></tr>
</table></td></tr></table></body></html>`;
  const textBody = `Hi ${name || 'there'},\n\n${title}\n${body || ''}\n\nOpen SportsHub: ${url}\n\nSportsHub-KE. One platform. Every sport. Every player.`;
  return { html, text: textBody };
}

/* Sends one email per notification. Called after the transaction commits, inside ctx.waitUntil, so the member never waits for it.
   Cost: one Firestore batchGet plus one Resend call per 100 emails (Cloudflare allows 50 subrequests per request). */
export async function emailNotifications(env, notes) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return;
  notes = (notes || []).filter(n => n && n.uid && (!n.channels || n.channels.includes('email')));
  if (!notes.length) return;
  const uids = [...new Set(notes.map(n => n.uid))].slice(0, 400);
  const docs = await db(env).getMany([...uids.map(u => ['users', u]), ...uids.map(u => ['usersPrivate', u])]);
  const site = (env.SITE_URL || 'https://sportshub.co.ke').replace(/\/+$/, '');
  const msgs = [];
  for (const n of notes) {
    const u = docs.get(`users/${n.uid}`), priv = docs.get(`usersPrivate/${n.uid}`), to = priv && priv.email;
    if (!u || !to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) continue;
    if (!ESSENTIAL.has(n.type) && u.notifPrefs && u.notifPrefs[n.type] === false) continue;
    const { html, text } = renderEmail({ site, name: String(u.name || '').split(' ')[0], type: n.type, title: n.title, body: n.body, link: n.link });
    msgs.push({ from: env.EMAIL_FROM, to: [to], subject: n.title, html, text, ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}) });
  }
  for (let i = 0; i < msgs.length; i += 100) {
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(msgs.slice(i, i + 100)) }).catch(e => ({ ok: false, statusText: e.message }));
    if (!r.ok) console.error('Email send failed:', r.status, await (r.text ? r.text() : r.statusText));
  }
}
