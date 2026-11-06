// SportsHub-KE trusted business rules. This code runs only on the server (the Cloudflare Worker in
// worker/), inside a Firestore transaction. Payments, credits, bookings, approvals, roles and
// orders change only here: firestore.rules denies those writes from every browser.
const TrustedOps = (() => {
  class OpError extends Error { constructor(code, message) { super(message); this.name = 'OpError'; this.code = code; } }
  const fail = (code, msg) => { throw new OpError(code, msg); };
  const need = (cond, code, msg) => { if (!cond) fail(code, msg); };

  /* ----- Permissions ----- */
  const ADMIN_ROLES = {
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
  const can = (adminRole, perm) => { const r = ADMIN_ROLES[adminRole]; return !!r && (r.perms.includes('*') || r.perms.includes(perm)); };

  /* ----- Small validated readers ----- */
  const clean = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const str = (v, label, max = 200, required = true) => {
    const s = clean(v);
    need(!required || s.length > 0, 'invalid-argument', `${label} is required.`);
    need(s.length <= max, 'invalid-argument', `${label} must be ${max} characters or fewer.`);
    return s;
  };
  const text = (v, label, max = 2000, required = false) => {
    const s = String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim();
    need(!required || s.length > 0, 'invalid-argument', `${label} is required.`);
    need(s.length <= max, 'invalid-argument', `${label} must be ${max} characters or fewer.`);
    return s;
  };
  const num = (v, label, min = 0, max = 1e9) => {
    const n = Number(v);
    need(Number.isFinite(n), 'invalid-argument', `${label} must be a number.`);
    need(n >= min && n <= max, 'invalid-argument', `${label} must be between ${min} and ${max}.`);
    return n;
  };
  const oneOf = (v, list, label) => { need(list.includes(v), 'invalid-argument', `${label} is not valid.`); return v; };
  const arr = (v, max = 50) => (Array.isArray(v) ? v : []).map(clean).filter(Boolean).slice(0, max);
  const iso = (v, label) => { const d = new Date(v); need(!isNaN(d), 'invalid-argument', `${label} is not a valid date.`); return d.toISOString(); };
  const url = (v, label) => { const s = clean(v); if (!s) return ''; need(/^https?:\/\/[^\s]+$/i.test(s) && s.length < 500, 'invalid-argument', `${label} must be a full http(s) link.`); return s; };
  const media = v => { const s = clean(v); return /^(https:\/\/|data:image\/(png|jpeg|webp);base64,|assets\/)/.test(s) ? String(v).trim().slice(0, 400000) : ''; };
  const tokens = (...parts) => {
    const out = new Set();
    parts.filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1).forEach(w => {
      for (let i = 2; i <= Math.min(w.length, 12); i++) out.add(w.slice(0, i));
    });
    return [...out].slice(0, 120);
  };
  const addMonth = isoStr => {
    const d = new Date(isoStr), day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString();
  };
  const ageOn = (dob, nowIso) => {
    const b = new Date(dob), n = new Date(nowIso);
    let a = n.getUTCFullYear() - b.getUTCFullYear();
    if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
    return a;
  };
  const hourInTZ = (isoStr, tz) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(isoStr));
    return Number(parts.find(p => p.type === 'hour').value);
  };
  const hourStamps = (start, end) => {
    const out = [], t = new Date(start); t.setUTCMinutes(0, 0, 0);
    for (; t < new Date(end); t.setUTCHours(t.getUTCHours() + 1)) out.push(t.toISOString().slice(0, 13).replace(/[-T]/g, ''));
    return out;
  };

  /* ----- Shared context helpers ----- */
  const DEFAULT_SETTINGS = {
    registrationFee: 500, membershipFee: 1500, sessionsPerPeriod: 8, currency: 'KES', timeZone: 'Africa/Nairobi', country: 'Kenya',
    commissionRate: 0.1, settlementRatePerSession: 120, cancelWindowHours: 6, strikeLimit: 3, restrictDays: 7, maxTransferCredits: 4, autoApproveProducts: false,
    mpesaNumber: '0720274530', mpesaName: ''
  };
  const settings = async c => Object.assign({}, DEFAULT_SETTINGS, (await c.tx.get('systemSettings', 'platform')) || {});
  const me = async c => {
    need(c.uid, 'unauthenticated', 'Please sign in first.');
    let u = await c.tx.get('users', c.uid);
    if (!u) {
      /* Staff accounts are created on the server and may have no member profile: their adminRoles document stands in for it. */
      const a = await c.tx.get('adminRoles', c.uid);
      if (a && ADMIN_ROLES[a.role]) u = { id: c.uid, uid: c.uid, name: a.name || 'SportsHub-KE staff', roles: ['admin'], status: 'active', registrationStatus: 'paid', staffOnly: true };
    }
    need(u, 'failed-precondition', 'Your account profile is incomplete.');
    need(u.status !== 'suspended', 'permission-denied', 'This account is suspended. Please contact support.');
    return u;
  };
  const adminOf = async c => { if (!c.uid) return null; const a = await c.tx.get('adminRoles', c.uid); return a ? a.role : null; };
  const requirePerm = async (c, perm) => {
    const role = await adminOf(c), u = await me(c);
    need(can(role, perm), 'permission-denied', 'Your administrator role does not permit this action.');
    return { user: u, role };
  };
  const audit = (c, action, target, meta = {}) => c.tx.set('auditLogs', c.nid('log'), { actorId: c.uid || 'system', action, target: target || '', meta, at: c.now });
  const notify = (c, uid, type, title, body, link) => { if (uid) c.tx.set('notifications', c.nid('ntf'), { uid, type, title, body: body || '', link: link || '', read: false, at: c.now, channels: ['in_app', 'email'] }); };
  /* Tells every administrator whose role holds this permission (in app, and by email through the Worker). */
  const notifyAdmins = async (c, perm, type, title, body, link) => {
    const admins = await c.tx.query('adminRoles', { limit: 60 });
    admins.filter(a => can(a.role, perm)).forEach(a => notify(c, a.uid || a.id, type, title, body, link));
  };
  const withRole = (u, role) => (u.roles || []).includes(role) ? u.roles : [...(u.roles || []), role];
  const nextMemberId = async c => {
    const cnt = (await c.tx.get('systemSettings', 'counters')) || { member: 1000 };
    const n = (cnt.member || 1000) + 1;
    c.tx.set('systemSettings', 'counters', { ...cnt, member: n });
    return 'SH-KE-' + String(n).padStart(6, '0');
  };
  const genRef = (c, prefix) => prefix + '-' + c.nid('r').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(-10);

  /* ----- Membership ledger helpers ----- */
  const remaining = p => (p.granted || 0) + (p.transferredIn || 0) - (p.transferredOut || 0) - (p.used || 0);
  const available = p => remaining(p) - (p.held || 0);
  const ledger = (c, e) => c.tx.set('membershipLedger', c.nid('led'), { uid: e.uid, periodId: e.periodId, type: e.type, delta: e.delta || 0, balanceAfter: e.balanceAfter, availableAfter: e.availableAfter, ref: e.ref || '', note: e.note || '', by: c.uid || 'system', at: c.now });
  const patchPeriod = (c, p, patch, entry) => {
    const next = { ...p, ...patch };
    need(remaining(next) >= 0 && (next.held || 0) >= 0 && available(next) >= 0, 'failed-precondition', 'This change would make the session balance negative.');
    c.tx.update('membershipPeriods', p.id, patch);
    ledger(c, { uid: p.uid, periodId: p.id, balanceAfter: remaining(next), availableAfter: available(next), ...entry });
    return next;
  };
  const activePeriod = async (c, uid) => {
    const m = await c.tx.get('memberships', uid);
    if (!m || m.status !== 'active' || !m.currentPeriodId) return { m, p: null };
    const p = await c.tx.get('membershipPeriods', m.currentPeriodId);
    if (!p || p.status !== 'active' || p.end <= c.now) return { m, p: null };
    return { m, p };
  };
  const addStrike = async (c, uid, reason) => {
    const m = await c.tx.get('memberships', uid), s = await settings(c);
    if (!m) return;
    const strikes = (m.strikes || 0) + 1, patch = { strikes };
    if (strikes >= s.strikeLimit) {
      patch.restrictedUntil = new Date(new Date(c.now).getTime() + s.restrictDays * 864e5).toISOString();
      patch.strikes = 0;
      notify(c, uid, 'membership', 'Booking temporarily restricted', `You reached ${s.strikeLimit} late cancellations or no-shows, so new session bookings are paused for ${s.restrictDays} days. No credits were deducted.`, '/app/membership');
    } else {
      notify(c, uid, 'membership', 'Attendance policy note', `${reason}. This is strike ${strikes} of ${s.strikeLimit}. No credit was deducted.`, '/app/membership');
    }
    c.tx.update('memberships', uid, patch);
  };
  const assertNoClash = async (c, uid, start, end, ignoreSource) => {
    const rows = await c.tx.query('sessionBookings', { where: [['uid', '==', uid], ['status', '==', 'held']], limit: 100 });
    const clash = rows.find(r => r.sourceId !== ignoreSource && r.start < end && r.end > start);
    need(!clash, 'failed-precondition', `This clashes with "${clash ? clash.title : ''}" already in your calendar.`);
  };
  /* Reserve a session. A covered session places a HOLD on one credit; the credit is only spent on verified attendance. */
  const holdSession = async (c, { uid, covered, source, sourceId, facilityId, resourceId, start, end, title }) => {
    const sid = `${source}_${sourceId}_${uid}`;
    let periodId = null;
    if (covered) {
      const { m, p } = await activePeriod(c, uid);
      need(p, 'membership-required', 'This session is covered by SportsHub membership. An active membership is required.');
      need(!m.restrictedUntil || m.restrictedUntil <= c.now, 'failed-precondition', 'New session bookings are temporarily restricted under the attendance policy.');
      need(start < p.end, 'failed-precondition', 'This session falls after your current membership period ends. Renew first to reserve it.');
      need(available(p) > 0, 'no-credits', 'You have no unreserved sessions left in this membership period.');
      patchPeriod(c, p, { held: (p.held || 0) + 1 }, { type: 'hold', ref: sid, note: `Reserved: ${title}` });
      periodId = p.id;
    }
    c.tx.set('sessionBookings', sid, { uid, covered: !!covered, periodId, source, sourceId, facilityId: facilityId || '', resourceId: resourceId || '', start, end, title, status: 'held', createdAt: c.now });
    return sid;
  };
  const releaseSession = async (c, uid, source, sourceId, status, note) => {
    const sid = `${source}_${sourceId}_${uid}`, sb = await c.tx.get('sessionBookings', sid);
    if (!sb || sb.status !== 'held') return null;
    c.tx.update('sessionBookings', sid, { status, closedAt: c.now });
    if (sb.covered && sb.periodId) {
      const p = await c.tx.get('membershipPeriods', sb.periodId);
      if (p && (p.held || 0) > 0) patchPeriod(c, p, { held: p.held - 1 }, { type: 'release', ref: sid, note });
    }
    return sb;
  };
  /* The only code path that spends a credit: verified attendance on a reserved session. */
  const consumeSession = async (c, uid, source, sourceId) => {
    const sid = `${source}_${sourceId}_${uid}`, sb = await c.tx.get('sessionBookings', sid);
    need(sb, 'not-found', 'No reservation exists for this member.');
    if (sb.status === 'consumed') return { already: true };
    need(sb.status === 'held', 'failed-precondition', 'This reservation is no longer open.');
    c.tx.update('sessionBookings', sid, { status: 'consumed', closedAt: c.now });
    if (sb.covered) {
      const p = await c.tx.get('membershipPeriods', sb.periodId);
      need(p && p.status === 'active', 'failed-precondition', 'The membership period for this session has closed.');
      const next = patchPeriod(c, p, { held: Math.max(0, (p.held || 0) - 1), used: (p.used || 0) + 1 }, { type: 'consume', delta: -1, ref: sid, note: `Attended: ${sb.title}` });
      c.tx.set('sessionAttendance', sid, { uid, periodId: p.id, facilityId: sb.facilityId, resourceId: sb.resourceId, source, sourceId, title: sb.title, at: c.now, month: c.now.slice(0, 7), settled: false });
      notify(c, uid, 'membership', 'Session recorded', `${sb.title}. ${remaining(next)} sessions left this month.`, '/app/membership');
      return { consumed: true, remaining: remaining(next) };
    }
    return { consumed: false };
  };
  const openPeriod = (c, s, uid, start, paymentTxId, activate) => {
    const id = c.nid('per'), end = addMonth(start);
    const p = { id, uid, start, end, allowance: s.sessionsPerPeriod, granted: s.sessionsPerPeriod, used: 0, held: 0, transferredIn: 0, transferredOut: 0, status: activate ? 'active' : 'scheduled', paymentTxId, createdAt: c.now };
    c.tx.set('membershipPeriods', id, p);
    ledger(c, { uid, periodId: id, type: 'grant', delta: s.sessionsPerPeriod, balanceAfter: s.sessionsPerPeriod, availableAfter: s.sessionsPerPeriod, ref: paymentTxId, note: activate ? 'Membership period opened' : 'Renewal period scheduled' });
    return p;
  };
  /* Close one period, expire unused credits in the ledger and activate any scheduled renewal. */
  const closePeriod = async (c, p) => {
    const openHolds = await c.tx.query('sessionBookings', { where: [['periodId', '==', p.id], ['status', '==', 'held']], limit: 50 });
    let period = p;
    for (const sb of openHolds) {
      c.tx.update('sessionBookings', sb.id, { status: 'released', closedAt: c.now });
      period = patchPeriod(c, period, { held: Math.max(0, (period.held || 0) - 1) }, { type: 'release', ref: sb.id, note: 'Attendance not recorded before period close' });
    }
    const left = remaining(period);
    c.tx.update('membershipPeriods', p.id, { status: 'closed', closedAt: c.now, expired: left });
    ledger(c, { uid: p.uid, periodId: p.id, type: 'expire', delta: -left, balanceAfter: 0, availableAfter: 0, note: `${left} unused sessions expired at period end` });
    const next = (await c.tx.query('membershipPeriods', { where: [['uid', '==', p.uid], ['status', '==', 'scheduled']], limit: 1 }))[0];
    if (next) {
      c.tx.update('membershipPeriods', next.id, { status: 'active' });
      c.tx.update('memberships', p.uid, { status: 'active', currentPeriodId: next.id, start: next.start, end: next.end, strikes: 0 });
      notify(c, p.uid, 'membership', 'New membership month started', `${next.granted} sessions are ready to use.`, '/app/membership');
    } else {
      c.tx.update('memberships', p.uid, { status: 'expired', currentPeriodId: null, strikes: 0 });
      notify(c, p.uid, 'membership', 'Membership expired', 'Renew to keep playing at participating facilities without ground-access fees.', '/app/membership');
    }
  };

  /* ----- Payment event processing (idempotent) ----- */
  const applyPaymentEvent = async (c, { txId, eventId, outcome, providerRef }) => {
    const t = await c.tx.get('paymentTransactions', txId);
    need(t, 'not-found', 'Payment not found.');
    const evId = `${txId}_${eventId}`;
    if (await c.tx.get('paymentEvents', evId)) return { duplicate: true, status: t.status, txId, reason: 'event-already-processed' };
    const open = t.status === 'pending' || t.status === 'awaiting_verification';
    c.tx.set('paymentEvents', evId, { txId, eventId, outcome, at: c.now, ignored: !open });
    if (!open) return { duplicate: true, status: t.status, txId, reason: 'transaction-already-final' };
    if (outcome === 'failed' || outcome === 'cancelled') {
      c.tx.update('paymentTransactions', txId, { status: outcome, completedAt: c.now, providerRef: providerRef || '' });
      notify(c, t.uid, 'payment', outcome === 'failed' ? 'Payment failed' : 'Payment cancelled', `${t.description} was not completed. You were not charged.`, '/app/payments');
      for (const orderId of t.orderIds || []) await cancelOrderInternal(c, orderId, 'Payment ' + outcome);
      return { status: outcome, txId };
    }
    need(outcome === 'success', 'invalid-argument', 'Unknown payment outcome.');
    const receiptNo = genRef(c, t.simulated ? 'SIM-RCPT' : 'RCPT');
    c.tx.update('paymentTransactions', txId, { status: 'success', completedAt: c.now, receiptNo, providerRef: providerRef || '' });
    const s = await settings(c);
    if (t.type === 'registration') {
      c.tx.update('memberships', t.uid, { registrationStatus: 'paid', registrationTxId: txId, registeredAt: c.now, registrationAmount: t.amount });
      c.tx.update('users', t.uid, { registrationStatus: 'paid' });
    } else if (t.type === 'membership') {
      const m = await c.tx.get('memberships', t.uid);
      const cur = m.currentPeriodId ? await c.tx.get('membershipPeriods', m.currentPeriodId) : null;
      const running = m.status === 'active' && cur && cur.status === 'active' && cur.end > c.now;
      if (running) {
        const queued = (await c.tx.query('membershipPeriods', { where: [['uid', '==', t.uid], ['status', '==', 'scheduled']], limit: 1 }))[0];
        need(!queued, 'failed-precondition', 'A renewal is already scheduled for next month.');
        const p = openPeriod(c, s, t.uid, cur.end, txId, false);
        c.tx.update('paymentTransactions', txId, { periodId: p.id });
        c.tx.update('memberships', t.uid, { renewal: m.renewal === 'cancelled' ? 'manual' : m.renewal });
      } else {
        if (cur && cur.status === 'active') await closePeriod(c, cur);
        const p = openPeriod(c, s, t.uid, c.now, txId, true);
        c.tx.update('paymentTransactions', txId, { periodId: p.id });
        c.tx.update('memberships', t.uid, { status: 'active', currentPeriodId: p.id, start: p.start, end: p.end, firstActivatedAt: m.firstActivatedAt || c.now, renewal: m.renewal === 'cancelled' ? 'manual' : (m.renewal || 'manual'), strikes: 0 });
      }
    } else if (t.type === 'order') {
      for (const orderId of t.orderIds || []) {
        const o = await c.tx.get('orders', orderId);
        if (o && o.status === 'pending_payment') {
          c.tx.update('orders', orderId, { status: 'paid', paidAt: c.now, history: [...o.history, { status: 'paid', at: c.now }] });
          notify(c, o.vendorId, 'order', 'New paid order', `Order ${o.number}: ${o.items.length} item(s).`, '/app/store/orders');
        }
      }
    }
    notify(c, t.uid, 'payment', 'Payment successful', `${t.description}. Receipt ${receiptNo}.${t.simulated ? ' Simulated: no real money moved.' : ''}`, '/app/payments');
    audit(c, 'payment.success', txId, { type: t.type, amount: t.amount, simulated: !!t.simulated });
    return { status: 'success', txId, receiptNo };
  };
  const cancelOrderInternal = async (c, orderId, reason) => {
    const o = await c.tx.get('orders', orderId);
    if (!o || ['cancelled', 'refunded'].includes(o.status)) return;
    for (const it of o.items) {
      const pr = await c.tx.get('products', it.productId);
      if (pr) c.tx.update('products', pr.id, { stock: (pr.stock || 0) + it.qty, sold: Math.max(0, (pr.sold || 0) - it.qty) });
    }
    c.tx.update('orders', orderId, { status: 'cancelled', history: [...o.history, { status: 'cancelled', at: c.now, note: reason }] });
  };

  /* ----- Game & facility helpers ----- */
  const facilityFor = async (c, id) => { const f = await c.tx.get('facilities', id); need(f, 'not-found', 'Facility not found.'); return f; };
  const isFacilityStaff = (f, uid) => f.ownerId === uid || (f.staffIds || []).includes(uid);
  const lockSlots = async (c, resource, start, end, bookingId, kind) => {
    const stamps = hourStamps(start, end);
    for (const st of stamps) {
      const ex = await c.tx.get('facilitySlots', `${resource.id}_${st}`);
      need(!ex, 'slot-conflict', 'That time overlaps an existing booking on this resource. Please choose another slot.');
    }
    stamps.forEach(st => c.tx.set('facilitySlots', `${resource.id}_${st}`, { resourceId: resource.id, facilityId: resource.facilityId, bookingId, kind, stamp: st, start, end }));
  };
  const freeSlots = (c, resourceId, start, end) => hourStamps(start, end).forEach(st => c.tx.del('facilitySlots', `${resourceId}_${st}`));
  const assertOpen = async (c, res, start, end) => {
    const s = await settings(c), hS = hourInTZ(start, s.timeZone), hE = hourInTZ(new Date(new Date(end).getTime() - 60000).toISOString(), s.timeZone);
    need(hS >= (res.open ?? 6) && hE < (res.close ?? 22), 'failed-precondition', `${res.name} is open ${res.open ?? 6}:00 to ${res.close ?? 22}:00.`);
  };
  const seatJoin = async (c, g, uid, name, status) => {
    const pid = `${g.id}_${uid}`, u = await c.tx.get('users', uid);
    if (u && u.isMinor) name = 'Junior member'; /* Participant lists are visible to members, so minors stay unnamed. */
    c.tx.set('gameParticipants', pid, { gameId: g.id, uid, name, status, joinedAt: c.now, sportId: g.sportId, title: g.title, start: g.start, end: g.end, covered: !!g.covered });
  };
  const isTeamOfficial = (t, uid) => t.captainId === uid || t.viceId === uid || (t.adminIds || []).includes(uid);
  const teamFor = async (c, id) => { const t = await c.tx.get('teams', id); need(t, 'not-found', 'Team not found.'); return t; };
  const requireTeamOfficial = async (c, id) => { const t = await teamFor(c, id); need(isTeamOfficial(t, c.uid), 'permission-denied', 'Only team officials can do this.'); return t; };
  const ops = {
    /* ===== Accounts ===== */
    async registerAccount(c, p) {
      need(c.uid, 'unauthenticated', 'Please sign in first.');
      need(!(await c.tx.get('users', c.uid)), 'already-exists', 'This account is already registered.');
      const name = str(p.name, 'Full name', 80), dob = p.dob ? iso(p.dob, 'Date of birth') : null;
      const type = oneOf(p.accountType, ['player', 'team', 'coach', 'vendor', 'facility', 'organisation', 'scout'], 'Account type');
      const age = dob ? ageOn(dob, c.now) : null;
      need(type !== 'player' || dob, 'invalid-argument', 'Date of birth is required for player accounts.');
      need(age === null || age >= 6, 'invalid-argument', 'Players must be at least 6 years old.');
      const isMinor = age !== null && age < 18;
      if (isMinor) {
        need(clean(p.guardianName) && clean(p.guardianPhone), 'invalid-argument', 'Players under 18 need a parent or guardian name and phone number.');
        need(p.guardianConsent === true, 'invalid-argument', 'A parent or guardian must give consent for players under 18.');
      }
      const memberId = await nextMemberId(c);
      const county = str(p.county, 'County', 60), town = str(p.town, 'Town', 80, false), area = str(p.area, 'Playing area', 80, false);
      const photo = media(p.photo);
      const sports = arr(p.sports, 20);
      c.tx.set('users', c.uid, { id: c.uid, name, memberId, roles: type === 'player' ? ['player'] : ['player'], primaryType: type, county, town, status: 'active', isMinor, photo, createdAt: c.now, registrationStatus: 'unpaid', notifPrefs: {}, searchTokens: tokens(name, memberId) });
      c.tx.set('usersPrivate', c.uid, { email: str(p.email, 'Email', 120, false), phone: str(p.phone, 'Phone', 30, type === 'player'), dob, gender: str(p.gender, 'Gender', 30, false), area, guardian: isMinor ? { name: clean(p.guardianName), phone: clean(p.guardianPhone), consentAt: c.now, verified: false } : null });
      c.tx.set('playerProfiles', c.uid, {
        id: c.uid, uid: c.uid, name, memberId, photo, county, town, area: isMinor ? '' : area, sports, disciplines: arr(p.disciplines), positions: p.positions && typeof p.positions === 'object' ? p.positions : {},
        skill: str(p.skill, 'Skill level', 30, false) || 'Recreational', availability: arr(p.availability, 21), gameTypes: arr(p.gameTypes), teamIds: [], coachId: '', achievements: [], personalBests: [], certificates: [], media: [],
        visibility: isMinor ? 'protected' : 'public', isMinor, ageBand: age === null ? '' : age < 13 ? 'U13' : age < 16 ? 'U16' : age < 18 ? 'U18' : age < 21 ? 'U21' : 'Senior', guardianVerified: false, createdAt: c.now,
        lat: num(p.lat ?? 0, 'Latitude', -90, 90), lng: num(p.lng ?? 0, 'Longitude', -180, 180), searchTokens: isMinor ? [] : tokens(name, memberId, county, town)
      });
      c.tx.set('memberships', c.uid, { id: c.uid, uid: c.uid, memberId, registrationStatus: 'unpaid', status: 'inactive', currentPeriodId: null, renewal: 'manual', strikes: 0, createdAt: c.now });
      notify(c, c.uid, 'welcome', 'Welcome to SportsHub-KE', `Your member ID is ${memberId}.`, '/app');
      audit(c, 'account.register', c.uid, { type });
      return { memberId, isMinor };
    },
    async updateProfile(c, p) {
      const u = await me(c), prof = await c.tx.get('playerProfiles', c.uid);
      const patch = {};
      if (p.name !== undefined) patch.name = str(p.name, 'Name', 80);
      if (p.county !== undefined) patch.county = str(p.county, 'County', 60);
      if (p.town !== undefined) patch.town = str(p.town, 'Town', 80, false);
      if (p.photo !== undefined) patch.photo = media(p.photo);
      c.tx.update('users', c.uid, patch);
      if (prof) {
        const pp = { ...patch };
        if (p.area !== undefined) pp.area = u.isMinor ? '' : str(p.area, 'Area', 80, false);
        if (p.sports !== undefined) pp.sports = arr(p.sports, 20);
        if (p.positions !== undefined && typeof p.positions === 'object') pp.positions = p.positions;
        if (p.skill !== undefined) pp.skill = str(p.skill, 'Skill', 30);
        if (p.availability !== undefined) pp.availability = arr(p.availability, 21);
        if (p.gameTypes !== undefined) pp.gameTypes = arr(p.gameTypes);
        if (p.bio !== undefined) pp.bio = text(p.bio, 'Bio', 400);
        if (p.visibility !== undefined) { need(!u.isMinor, 'permission-denied', 'Profiles of players under 18 stay protected.'); pp.visibility = oneOf(p.visibility, ['public', 'members', 'private'], 'Visibility'); }
        if (p.achievements !== undefined) pp.achievements = arr(p.achievements, 30);
        if (p.personalBests !== undefined) pp.personalBests = arr(p.personalBests, 30);
        if (p.certificates !== undefined) pp.certificates = arr(p.certificates, 30);
        if (p.media !== undefined) pp.media = (Array.isArray(p.media) ? p.media : []).slice(0, 20).map(v => url(v, 'Video link')).filter(Boolean);
        pp.searchTokens = u.isMinor ? [] : tokens(pp.name || prof.name, prof.memberId, pp.county || prof.county, pp.town || prof.town);
        c.tx.update('playerProfiles', c.uid, pp);
      }
      const priv = {};
      if (p.phone !== undefined) priv.phone = str(p.phone, 'Phone', 30, false);
      if (Object.keys(priv).length) c.tx.update('usersPrivate', c.uid, priv);
      return { ok: true };
    },
    async setNotifPrefs(c, p) { await me(c); c.tx.update('users', c.uid, { notifPrefs: p.prefs && typeof p.prefs === 'object' ? p.prefs : {} }); return { ok: true }; },
    async requestAccountDeletion(c, p) {
      await me(c);
      c.tx.set('deletionRequests', c.uid, { uid: c.uid, reason: text(p.reason, 'Reason', 500), status: 'pending', at: c.now });
      audit(c, 'account.deletion_requested', c.uid);
      notify(c, c.uid, 'account', 'Deletion request received', 'Our team will process it within 30 days as required by the Data Protection Act, 2019.', '/app/settings');
      return { ok: true };
    },
    async processDeletion(c, p) {
      await requirePerm(c, 'users');
      const uid = str(p.uid, 'User');
      c.tx.update('users', uid, { name: 'Deleted member', status: 'deleted', photo: '', searchTokens: [] });
      c.tx.del('usersPrivate', uid);
      if (await c.tx.get('playerProfiles', uid)) c.tx.update('playerProfiles', uid, { name: 'Deleted member', photo: '', visibility: 'private', area: '', searchTokens: [] });
      c.tx.update('deletionRequests', uid, { status: 'completed', completedAt: c.now });
      audit(c, 'account.deleted', uid, { note: 'Personal data removed. Financial ledger retained as a legal record.' });
      return { ok: true };
    },

    /* ===== Payments ===== */
    async paymentInitiate(c, p) {
      const u = await me(c), s = await settings(c), m = await c.tx.get('memberships', c.uid);
      const type = oneOf(p.type, ['registration', 'membership'], 'Payment type');
      need(m, 'failed-precondition', 'Membership record not found.');
      if (type === 'registration') need(m.registrationStatus !== 'paid', 'failed-precondition', 'Your one-time registration fee is already paid.');
      if (type === 'membership') {
        need(m.registrationStatus === 'paid', 'failed-precondition', 'Please pay the one-time registration fee first.');
        need(m.status !== 'suspended', 'permission-denied', 'This membership is suspended.');
        const queued = await c.tx.query('membershipPeriods', { where: [['uid', '==', c.uid], ['status', '==', 'scheduled']], limit: 1 });
        need(!queued.length, 'failed-precondition', 'Your next month is already paid and scheduled.');
      }
      need(c.env.paymentProvider !== 'simulation' || c.env.allowSimulation, 'failed-precondition', 'Online payments are not enabled yet. Please try again soon.');
      const amount = type === 'registration' ? s.registrationFee : s.membershipFee, id = c.nid('pay');
      const description = type === 'registration' ? 'SportsHub registration fee (one time)' : `SportsHub monthly membership (${s.sessionsPerPeriod} sessions)`;
      c.tx.set('paymentTransactions', id, { id, uid: c.uid, userName: u.name, memberId: u.memberId, type, description, amount, currency: s.currency, provider: c.env.paymentProvider, simulated: c.env.paymentProvider === 'simulation', status: 'pending', ref: genRef(c, c.env.paymentProvider === 'simulation' ? 'SIM' : 'TX'), initiatedAt: c.now, phone: str(p.phone, 'Phone', 30, false) });
      return { txId: id, amount, description, currency: s.currency };
    },
    async paymentSimulateOutcome(c, p) {
      need(c.env.allowSimulation, 'permission-denied', 'Simulated payments are disabled in this environment.');
      await me(c);
      const t = await c.tx.get('paymentTransactions', str(p.txId, 'Payment'));
      need(t && t.uid === c.uid && t.simulated, 'permission-denied', 'This is not your simulated payment.');
      return applyPaymentEvent(c, { txId: t.id, eventId: str(p.eventId, 'Event'), outcome: oneOf(p.outcome, ['success', 'failed', 'cancelled'], 'Outcome'), providerRef: 'SIMULATED' });
    },
    /* Lipa na M-Pesa (Send Money). The member pays the platform number, then gives the M-Pesa confirmation code here.
       Nothing is granted until a finance administrator matches the code against the M-Pesa statement (paymentReview). */
    async paymentSubmitCode(c, p) {
      const u = await me(c), t = await c.tx.get('paymentTransactions', str(p.txId, 'Payment'));
      need(t && t.uid === c.uid, 'permission-denied', 'This is not your payment.');
      need(t.status === 'pending', 'failed-precondition', t.status === 'awaiting_verification' ? 'This payment is already waiting for confirmation.' : 'This payment is already closed.');
      const code = clean(p.code).toUpperCase().replace(/\s+/g, '');
      need(/^[A-Z0-9]{10}$/.test(code) && /[A-Z]/.test(code) && /[0-9]/.test(code), 'invalid-argument', 'Enter the 10-character M-Pesa code from your confirmation SMS, for example SGH7K2L9QX.');
      need(!(await c.tx.get('mpesaCodes', code)), 'already-exists', 'That M-Pesa code has already been submitted.');
      c.tx.set('mpesaCodes', code, { code, txId: t.id, uid: c.uid, at: c.now });
      c.tx.update('paymentTransactions', t.id, { status: 'awaiting_verification', mpesaCode: code, payerPhone: str(p.phone, 'Phone', 30, false), submittedAt: c.now });
      notify(c, c.uid, 'payment', 'Payment received for confirmation', `We received M-Pesa code ${code} for ${t.description} (KES ${t.amount}). You will be notified as soon as it is confirmed.`, '/app/payments');
      await notifyAdmins(c, 'payments', 'payment', 'M-Pesa payment to confirm', `${u.name} (${u.memberId || 'member'}) sent KES ${t.amount} for ${t.description}. Code ${code}.`, '/admin/payments');
      audit(c, 'payment.submitted', t.id, { code, amount: t.amount });
      return { status: 'awaiting_verification', txId: t.id };
    },
    async paymentReview(c, p) {
      await requirePerm(c, 'payments');
      const t = await c.tx.get('paymentTransactions', str(p.txId, 'Payment')), decision = oneOf(p.decision, ['approve', 'reject'], 'Decision');
      need(t, 'not-found', 'Payment not found.');
      need(t.status === 'awaiting_verification', 'failed-precondition', 'This payment is not waiting for confirmation.');
      if (decision === 'approve') {
        const r = await applyPaymentEvent(c, { txId: t.id, eventId: `review_${t.mpesaCode}`, outcome: 'success', providerRef: t.mpesaCode });
        c.tx.update('paymentTransactions', t.id, { reviewedBy: c.uid, reviewedAt: c.now });
        audit(c, 'payment.approved', t.id, { code: t.mpesaCode, amount: t.amount });
        return r;
      }
      const reason = text(p.reason, 'Reason', 300) || 'The M-Pesa code could not be matched to a payment.';
      c.tx.update('paymentTransactions', t.id, { status: 'rejected', completedAt: c.now, reviewedBy: c.uid, reviewedAt: c.now, rejectReason: reason });
      if (t.mpesaCode) c.tx.del('mpesaCodes', t.mpesaCode); /* A genuine code that was rejected by mistake can be sent again. */
      for (const orderId of t.orderIds || []) await cancelOrderInternal(c, orderId, 'Payment not confirmed');
      notify(c, t.uid, 'payment', 'Payment not confirmed', `${t.description}: ${reason} If you did pay, start the payment again and enter the exact code from your M-Pesa SMS.`, '/app/payments');
      audit(c, 'payment.rejected', t.id, { code: t.mpesaCode, reason });
      return { status: 'rejected' };
    },
    async providerPaymentEvent(c, p) {
      need(c.env.trustedCaller === true, 'permission-denied', 'Only the payment webhook can report this.');
      return applyPaymentEvent(c, p);
    },
    async refundPayment(c, p) {
      await requirePerm(c, 'payments');
      const t = await c.tx.get('paymentTransactions', str(p.txId, 'Payment')), reason = str(p.reason, 'Reason', 300);
      need(t && t.status === 'success', 'failed-precondition', 'Only successful payments can be refunded.');
      let refund = t.amount;
      if (t.type === 'membership') {
        const per = await c.tx.get('membershipPeriods', t.periodId);
        need(per, 'not-found', 'Membership period not found.');
        need(!(per.held > 0), 'failed-precondition', 'This period has reserved sessions. Release them before refunding.');
        const left = remaining(per);
        refund = Math.round(t.amount * left / (per.granted || 1));
        patchPeriod(c, per, { transferredOut: (per.transferredOut || 0) + left }, { type: 'reverse', delta: -left, ref: t.id, note: `Refund: ${reason}` });
        c.tx.update('membershipPeriods', per.id, { status: 'closed', closedAt: c.now, refunded: true });
        const m = await c.tx.get('memberships', t.uid);
        if (m.currentPeriodId === per.id) c.tx.update('memberships', t.uid, { status: 'cancelled', currentPeriodId: null });
      } else if (t.type === 'registration') {
        const m = await c.tx.get('memberships', t.uid);
        need(!m.firstActivatedAt, 'failed-precondition', 'Registration cannot be refunded once a membership has been activated.');
        c.tx.update('memberships', t.uid, { registrationStatus: 'refunded' });
        c.tx.update('users', t.uid, { registrationStatus: 'refunded' });
      } else if (t.type === 'order') {
        for (const id of t.orderIds || []) await cancelOrderInternal(c, id, 'Refunded');
      }
      c.tx.update('paymentTransactions', t.id, { status: 'refunded', refundAmount: refund, refundedAt: c.now, refundReason: reason });
      notify(c, t.uid, 'payment', 'Refund processed', `KES ${refund} for ${t.description}.`, '/app/payments');
      audit(c, 'payment.refund', t.id, { amount: refund, reason });
      return { refund };
    },

    /* ===== Membership ===== */
    async membershipSetRenewal(c, p) {
      await me(c);
      const renewal = oneOf(p.renewal, ['auto', 'manual', 'cancelled'], 'Renewal');
      c.tx.update('memberships', c.uid, { renewal });
      audit(c, 'membership.renewal', c.uid, { renewal });
      if (renewal === 'cancelled') notify(c, c.uid, 'membership', 'Membership will not renew', 'You keep your sessions until the current period ends.', '/app/membership');
      return { ok: true };
    },
    async sweepMemberships(c) {
      if (!c.env.trustedCaller) await requirePerm(c, 'membership');
      const due = await c.tx.query('membershipPeriods', { where: [['status', '==', 'active'], ['end', '<=', c.now]], limit: 100 });
      for (const p of due) await closePeriod(c, p);
      const stale = await c.tx.query('sessionBookings', { where: [['status', '==', 'held'], ['end', '<=', new Date(new Date(c.now).getTime() - 864e5).toISOString()]], limit: 100 });
      let released = 0;
      for (const sb of stale) {
        if (due.some(p => p.id === sb.periodId)) continue;
        await releaseSession(c, sb.uid, sb.source, sb.sourceId, 'released', 'Attendance not recorded within 24 hours');
        released++;
      }
      audit(c, 'membership.sweep', '', { closed: due.length, released });
      return { closed: due.length, released };
    },
    async membershipSuspend(c, p) {
      await requirePerm(c, 'membership');
      const uid = str(p.uid, 'Member'), m = await c.tx.get('memberships', uid), reason = str(p.reason, 'Reason', 300);
      need(m, 'not-found', 'Membership not found.');
      if (p.suspend) { c.tx.update('memberships', uid, { status: 'suspended', statusBefore: m.status, suspendReason: reason }); }
      else { need(m.status === 'suspended', 'failed-precondition', 'This membership is not suspended.'); c.tx.update('memberships', uid, { status: m.statusBefore || 'inactive', suspendReason: '' }); }
      notify(c, uid, 'membership', p.suspend ? 'Membership suspended' : 'Membership restored', reason, '/app/membership');
      audit(c, p.suspend ? 'membership.suspend' : 'membership.restore', uid, { reason });
      return { ok: true };
    },
    async adjustCredits(c, p) {
      await requirePerm(c, 'credits');
      const uid = str(p.uid, 'Member'), delta = Math.trunc(num(p.delta, 'Adjustment', -8, 8)), reason = str(p.reason, 'Reason', 300);
      need(delta !== 0, 'invalid-argument', 'Adjustment cannot be zero.');
      const { p: per } = await activePeriod(c, uid);
      need(per, 'failed-precondition', 'This member has no active period.');
      patchPeriod(c, per, { granted: per.granted + delta }, { type: 'adjust', delta, ref: 'admin', note: reason });
      notify(c, uid, 'membership', 'Session balance adjusted', `${delta > 0 ? '+' : ''}${delta} session(s): ${reason}`, '/app/membership');
      audit(c, 'credits.adjust', uid, { delta, reason });
      return { ok: true };
    },

    /* ===== Membership credit transfers ===== */
    async requestCreditTransfer(c, p) {
      const u = await me(c), s = await settings(c), credits = Math.trunc(num(p.credits, 'Sessions', 1, s.maxTransferCredits)), memberId = str(p.toMemberId, 'Member ID', 20).toUpperCase();
      const { p: per } = await activePeriod(c, c.uid);
      need(per, 'membership-required', 'You need an active membership to transfer sessions.');
      need(available(per) >= credits, 'no-credits', `You only have ${available(per)} unreserved session(s).`);
      const to = (await c.tx.query('users', { where: [['memberId', '==', memberId]], limit: 1 }))[0];
      need(to, 'not-found', 'No member with that SportsHub ID.');
      need(to.id !== c.uid, 'invalid-argument', 'You cannot transfer sessions to yourself.');
      const id = c.nid('trf');
      /* Credits move into escrow as a hold immediately, so the sender cannot spend them while the request is open. */
      patchPeriod(c, per, { held: (per.held || 0) + credits }, { type: 'hold', ref: id, note: `Escrow for transfer to ${to.memberId}` });
      c.tx.set('membershipTransfers', id, { id, fromUid: c.uid, fromName: u.name, fromMemberId: u.memberId, toUid: to.id, toName: to.name, toMemberId: to.memberId, credits, reason: text(p.reason, 'Reason', 300), periodId: per.id, status: 'awaiting_recipient', participants: [c.uid, to.id], createdAt: c.now });
      notify(c, to.id, 'transfer', 'Session transfer offered', `${u.name} wants to transfer ${credits} session(s) to you.`, '/app/transfers');
      audit(c, 'transfer.request', id, { credits, to: to.id });
      return { id };
    },
    async respondCreditTransfer(c, p) {
      const u = await me(c), t = await c.tx.get('membershipTransfers', str(p.id, 'Transfer'));
      need(t && t.toUid === c.uid && t.status === 'awaiting_recipient', 'failed-precondition', 'This transfer is not awaiting your response.');
      if (p.accept) {
        const { p: per } = await activePeriod(c, c.uid);
        need(per, 'membership-required', 'You need an active membership to receive sessions.');
        c.tx.update('membershipTransfers', t.id, { status: 'awaiting_approval', recipientPeriodId: per.id, respondedAt: c.now });
        notify(c, t.fromUid, 'transfer', 'Recipient accepted', `${u.name} accepted. Awaiting administrator approval.`, '/app/transfers');
      } else {
        const fromP = await c.tx.get('membershipPeriods', t.periodId);
        if (fromP && fromP.status === 'active') patchPeriod(c, fromP, { held: fromP.held - t.credits }, { type: 'release', ref: t.id, note: 'Transfer declined' });
        c.tx.update('membershipTransfers', t.id, { status: 'declined', respondedAt: c.now });
        notify(c, t.fromUid, 'transfer', 'Transfer declined', `${u.name} declined. Your sessions were returned.`, '/app/transfers');
      }
      audit(c, 'transfer.respond', t.id, { accept: !!p.accept });
      return { ok: true };
    },
    async cancelCreditTransfer(c, p) {
      await me(c);
      const t = await c.tx.get('membershipTransfers', str(p.id, 'Transfer'));
      need(t && t.fromUid === c.uid && ['awaiting_recipient', 'awaiting_approval'].includes(t.status), 'failed-precondition', 'This transfer can no longer be cancelled.');
      const fromP = await c.tx.get('membershipPeriods', t.periodId);
      if (fromP && fromP.status === 'active') patchPeriod(c, fromP, { held: fromP.held - t.credits }, { type: 'release', ref: t.id, note: 'Transfer cancelled by sender' });
      c.tx.update('membershipTransfers', t.id, { status: 'cancelled', respondedAt: c.now });
      audit(c, 'transfer.cancel', t.id);
      return { ok: true };
    },
    async reviewCreditTransfer(c, p) {
      await requirePerm(c, 'transfers');
      const t = await c.tx.get('membershipTransfers', str(p.id, 'Transfer'));
      need(t && t.status === 'awaiting_approval', 'failed-precondition', 'This transfer is not awaiting approval.');
      const fromP = await c.tx.get('membershipPeriods', t.periodId);
      need(fromP, 'not-found', 'Sender period not found.');
      if (!p.approve) {
        if (fromP.status === 'active') patchPeriod(c, fromP, { held: fromP.held - t.credits }, { type: 'release', ref: t.id, note: 'Transfer rejected' });
        c.tx.update('membershipTransfers', t.id, { status: 'rejected', reviewedBy: c.uid, reviewedAt: c.now, reviewNote: text(p.note, 'Note', 300) });
        notify(c, t.fromUid, 'transfer', 'Transfer rejected', 'Your sessions were returned.', '/app/transfers');
      } else {
        need(fromP.status === 'active', 'failed-precondition', "The sender's membership period has closed.");
        const toP = await c.tx.get('membershipPeriods', t.recipientPeriodId);
        need(toP && toP.status === 'active' && toP.end > c.now, 'failed-precondition', "The recipient's membership period is no longer active.");
        patchPeriod(c, fromP, { held: fromP.held - t.credits, transferredOut: (fromP.transferredOut || 0) + t.credits }, { type: 'transfer_out', delta: -t.credits, ref: t.id, note: `To ${t.toMemberId}` });
        patchPeriod(c, toP, { transferredIn: (toP.transferredIn || 0) + t.credits }, { type: 'transfer_in', delta: t.credits, ref: t.id, note: `From ${t.fromMemberId}` });
        c.tx.update('membershipTransfers', t.id, { status: 'completed', reviewedBy: c.uid, reviewedAt: c.now });
        notify(c, t.toUid, 'transfer', 'Sessions received', `${t.credits} session(s) added. They expire with your current period.`, '/app/membership');
        notify(c, t.fromUid, 'transfer', 'Transfer completed', `${t.credits} session(s) moved to ${t.toName}.`, '/app/membership');
      }
      audit(c, p.approve ? 'transfer.approve' : 'transfer.reject', t.id, { credits: t.credits, from: t.fromUid, to: t.toUid });
      return { ok: true };
    },

    /* ===== Games ===== */
    async createGame(c, p) {
      const u = await me(c), s = await settings(c), sport = await c.tx.get('sports', str(p.sportId, 'Sport'));
      need(sport, 'not-found', 'Sport not found. An administrator needs to load the sports catalogue (run worker/seed.mjs or /setup).');
      need(u.registrationStatus === 'paid' || can(await adminOf(c), 'games'), 'failed-precondition', 'Complete your one-time registration to host games.');
      need(!u.isMinor, 'permission-denied', 'Players under 18 cannot host open games.');
      const start = iso(p.start, 'Start time'), end = iso(p.end, 'End time');
      need(start > c.now, 'invalid-argument', 'The game must start in the future.');
      need(end > start, 'invalid-argument', 'End time must be after the start time.');
      const capacity = Math.trunc(num(p.capacity, 'Maximum participants', 2, 500));
      const id = c.nid('gam');
      let facility = null, resource = null, covered = false, venueName = str(p.venueName, 'Venue', 120, false), county = str(p.county, 'County', 60, false), town = str(p.town, 'Town', 80, false), lat = 0, lng = 0;
      if (p.resourceId) {
        resource = await c.tx.get('facilityResources', str(p.resourceId, 'Resource'));
        need(resource && resource.active !== false, 'not-found', 'That pitch or court is not available.');
        facility = await facilityFor(c, resource.facilityId);
        need(facility.status === 'approved', 'failed-precondition', 'That facility is not approved yet.');
        await assertOpen(c, resource, start, end);
        await lockSlots(c, resource, start, end, `game:${id}`, 'game');
        covered = !!(facility.participating && resource.memberEligible);
        venueName = `${facility.name} · ${resource.name}`; county = facility.county; town = facility.town; lat = facility.lat; lng = facility.lng;
      }
      need(county, 'invalid-argument', 'Please choose a facility or a county.');
      const g = {
        id, title: str(p.title, 'Game title', 100), sportId: sport.id, sportName: sport.name, start, end, capacity, requiredPlayers: Math.trunc(num(p.required ?? capacity, 'Required players', 1, capacity)), skill: str(p.skill, 'Skill level', 30, false) || 'All levels',
        format: str(p.format, 'Format', 40, false), fee: num(p.fee ?? 0, 'Fee', 0, 100000), rules: text(p.rules, 'Rules', 1000), visibility: oneOf(p.visibility || 'public', ['public', 'members', 'private'], 'Visibility'), approvalRequired: !!p.approvalRequired,
        facilityId: facility ? facility.id : '', resourceId: resource ? resource.id : '', venueName, county, town, lat, lng, covered, hostId: c.uid, hostName: u.name, status: 'open', joined: 1, waitlist: 0, createdAt: c.now, searchTokens: tokens(p.title, sport.name, county, town, venueName), minAge: Math.trunc(num(p.minAge ?? 0, 'Minimum age', 0, 100)), maxAge: Math.trunc(num(p.maxAge ?? 0, 'Maximum age', 0, 100))
      };
      c.tx.set('games', id, g);
      await seatJoin(c, g, c.uid, u.name, 'confirmed');
      /* A host with no spare credit still plays; their seat simply is not membership-covered. */
      const { p: hostPeriod } = covered ? await activePeriod(c, c.uid) : { p: null };
      const hostCovered = !!(hostPeriod && available(hostPeriod) > 0 && start < hostPeriod.end);
      await holdSession(c, { uid: c.uid, covered: hostCovered, source: 'game', sourceId: id, facilityId: g.facilityId, resourceId: g.resourceId, start, end, title: g.title });
      if (resource) {
        c.tx.set('facilityBookings', `game_${id}`, { id: `game_${id}`, facilityId: facility.id, ownerId: facility.ownerId, resourceId: resource.id, resourceName: resource.name, facilityName: facility.name, uid: c.uid, userName: u.name, start, end, kind: 'game', status: 'confirmed', price: 0, gameId: id, createdAt: c.now });
        notify(c, facility.ownerId, 'booking', 'Game scheduled at your venue', `${g.title} on ${resource.name}.`, '/app/facility/bookings');
      }
      /* Recommend the game to relevant players. */
      const fans = await c.tx.query('playerProfiles', { where: [['sports', 'array-contains', sport.id], ['county', '==', county]], limit: 20 });
      fans.filter(f => f.id !== c.uid && !f.isMinor).slice(0, 12).forEach(f => notify(c, f.id, 'game', 'New game near you', `${g.title} in ${town || county}.`, `/games/${id}`));
      audit(c, 'game.create', id);
      return { id, covered };
    },
    async joinGame(c, p) {
      const u = await me(c), g = await c.tx.get('games', str(p.gameId, 'Game'));
      need(g, 'not-found', 'Game not found.');
      need(g.status === 'open', 'failed-precondition', 'This game is not open for registration.');
      need(g.end > c.now, 'failed-precondition', 'This game has already finished.');
      need(u.registrationStatus === 'paid', 'failed-precondition', 'Complete your one-time registration to join games.');
      const pid = `${g.id}_${c.uid}`, ex = await c.tx.get('gameParticipants', pid);
      need(!ex || ex.status === 'cancelled', 'already-exists', 'You are already registered for this game.');
      if (g.minAge || g.maxAge) {
        const priv = await c.tx.get('usersPrivate', c.uid), age = priv && priv.dob ? ageOn(priv.dob, c.now) : null;
        need(age !== null && (!g.minAge || age >= g.minAge) && (!g.maxAge || age <= g.maxAge), 'failed-precondition', 'You do not meet the age requirement for this game.');
      }
      if (g.visibility === 'private') {
        const inv = await c.tx.get('gameInvites', `${g.id}_${c.uid}`);
        need(inv || g.hostId === c.uid, 'permission-denied', 'This is an invitation-only game.');
      }
      if (g.approvalRequired) {
        await seatJoin(c, g, c.uid, u.name, 'requested');
        notify(c, g.hostId, 'game', 'Join request', `${u.name} asked to join ${g.title}.`, `/games/${g.id}`);
        return { status: 'requested' };
      }
      if (g.joined >= g.capacity) {
        await seatJoin(c, g, c.uid, u.name, 'waitlist');
        c.tx.update('games', g.id, { waitlist: (g.waitlist || 0) + 1 });
        notify(c, c.uid, 'game', 'Added to waitlist', `${g.title} is full. We will promote you automatically if a place opens.`, `/games/${g.id}`);
        return { status: 'waitlist' };
      }
      await assertNoClash(c, c.uid, g.start, g.end, g.id);
      await holdSession(c, { uid: c.uid, covered: g.covered, source: 'game', sourceId: g.id, facilityId: g.facilityId, resourceId: g.resourceId, start: g.start, end: g.end, title: g.title });
      await seatJoin(c, g, c.uid, u.name, 'confirmed');
      c.tx.update('games', g.id, { joined: g.joined + 1, status: 'open' });
      notify(c, c.uid, 'game', 'You are in', `${g.title}.${g.covered ? ' One session is reserved and only used if you attend.' : ''}`, `/games/${g.id}`);
      notify(c, g.hostId, 'game', 'New participant', `${u.name} joined ${g.title}.`, `/games/${g.id}`);
      return { status: 'confirmed' };
    },
    async leaveGame(c, p) {
      const u = await me(c), s = await settings(c), g = await c.tx.get('games', str(p.gameId, 'Game'));
      need(g, 'not-found', 'Game not found.');
      const pid = `${g.id}_${c.uid}`, ex = await c.tx.get('gameParticipants', pid);
      need(ex && !['cancelled', 'attended', 'no_show'].includes(ex.status), 'failed-precondition', 'You are not registered for this game.');
      need(g.start > c.now, 'failed-precondition', 'This game has already started.');
      c.tx.update('gameParticipants', pid, { status: 'cancelled', cancelledAt: c.now });
      const patch = {};
      if (ex.status === 'waitlist') patch.waitlist = Math.max(0, (g.waitlist || 0) - 1);
      if (ex.status === 'confirmed') {
        await releaseSession(c, c.uid, 'game', g.id, 'released', 'Cancelled by member');
        const late = new Date(g.start).getTime() - new Date(c.now).getTime() < s.cancelWindowHours * 36e5;
        if (late && g.covered) await addStrike(c, c.uid, `Late cancellation of ${g.title}`);
        /* Promote the longest-waiting eligible player. */
        const queue = await c.tx.query('gameParticipants', { where: [['gameId', '==', g.id], ['status', '==', 'waitlist']], orderBy: ['joinedAt', 'asc'], limit: 5 });
        let promoted = null;
        for (const w of queue) {
          if (w.uid === c.uid) continue;
          if (g.covered) { const { p: per } = await activePeriod(c, w.uid); if (!per || available(per) < 1 || g.start >= per.end) continue; }
          promoted = w; break;
        }
        if (promoted) {
          await holdSession(c, { uid: promoted.uid, covered: g.covered, source: 'game', sourceId: g.id, facilityId: g.facilityId, resourceId: g.resourceId, start: g.start, end: g.end, title: g.title });
          c.tx.update('gameParticipants', `${g.id}_${promoted.uid}`, { status: 'confirmed', promotedAt: c.now });
          patch.waitlist = Math.max(0, (g.waitlist || 0) - 1);
          notify(c, promoted.uid, 'game', 'A place opened up', `You moved from the waitlist into ${g.title}.`, `/games/${g.id}`);
        } else patch.joined = Math.max(0, g.joined - 1);
      }
      if (Object.keys(patch).length) c.tx.update('games', g.id, patch);
      notify(c, g.hostId, 'game', 'Participant cancelled', `${u.name} left ${g.title}.`, `/games/${g.id}`);
      return { ok: true };
    },
    async reviewJoinRequest(c, p) {
      await me(c);
      const g = await c.tx.get('games', str(p.gameId, 'Game')), uid = str(p.uid, 'Player');
      need(g && g.hostId === c.uid, 'permission-denied', 'Only the host can review requests.');
      const pid = `${g.id}_${uid}`, ex = await c.tx.get('gameParticipants', pid);
      need(ex && ex.status === 'requested', 'failed-precondition', 'This request is no longer open.');
      if (!p.approve) { c.tx.update('gameParticipants', pid, { status: 'cancelled' }); notify(c, uid, 'game', 'Request declined', `The host declined your request for ${g.title}.`, `/games/${g.id}`); return { ok: true }; }
      if (g.joined >= g.capacity) { c.tx.update('gameParticipants', pid, { status: 'waitlist' }); c.tx.update('games', g.id, { waitlist: (g.waitlist || 0) + 1 }); notify(c, uid, 'game', 'Added to waitlist', `${g.title} is full.`, `/games/${g.id}`); return { status: 'waitlist' }; }
      await holdSession(c, { uid, covered: g.covered, source: 'game', sourceId: g.id, facilityId: g.facilityId, resourceId: g.resourceId, start: g.start, end: g.end, title: g.title });
      c.tx.update('gameParticipants', pid, { status: 'confirmed' });
      c.tx.update('games', g.id, { joined: g.joined + 1 });
      notify(c, uid, 'game', 'Request approved', `You are confirmed for ${g.title}.`, `/games/${g.id}`);
      return { status: 'confirmed' };
    },
    async inviteToGame(c, p) {
      const u = await me(c), g = await c.tx.get('games', str(p.gameId, 'Game'));
      need(g, 'not-found', 'Game not found.');
      const found = (await c.tx.query('users', { where: [['memberId', '==', str(p.memberId, 'SportsHub ID', 20).toUpperCase()]], limit: 1 }))[0];
      need(found, 'not-found', 'No member with that SportsHub ID.');
      const uid = found.id, prof = await c.tx.get('playerProfiles', uid);
      need(prof && !prof.isMinor, 'permission-denied', 'That player cannot be invited directly.');
      c.tx.set('gameInvites', `${g.id}_${uid}`, { gameId: g.id, uid, by: c.uid, at: c.now });
      notify(c, uid, 'game', 'Game invitation', `${u.name} invited you to ${g.title}.`, `/games/${g.id}`);
      return { ok: true };
    },
    async cancelGame(c, p) {
      const u = await me(c), g = await c.tx.get('games', str(p.gameId, 'Game')), role = await adminOf(c);
      need(g && (g.hostId === c.uid || can(role, 'games')), 'permission-denied', 'Only the host or an administrator can cancel this game.');
      need(g.status !== 'cancelled', 'failed-precondition', 'This game is already cancelled.');
      const rows = await c.tx.query('gameParticipants', { where: [['gameId', '==', g.id]], limit: 500 });
      for (const r of rows.filter(r => !['cancelled', 'attended', 'no_show'].includes(r.status))) {
        await releaseSession(c, r.uid, 'game', g.id, 'released', 'Game cancelled');
        c.tx.update('gameParticipants', r.id, { status: 'cancelled' });
        if (r.uid !== c.uid) notify(c, r.uid, 'game', 'Game cancelled', `${g.title} was cancelled. Your session was returned.`, `/games/${g.id}`);
      }
      if (g.resourceId) {
        freeSlots(c, g.resourceId, g.start, g.end);
        c.tx.update('facilityBookings', `game_${g.id}`, { status: 'cancelled' });
      }
      c.tx.update('games', g.id, { status: 'cancelled', cancelledBy: u.name });
      audit(c, 'game.cancel', g.id);
      return { ok: true };
    },
    async markGameAttendance(c, p) {
      await me(c);
      const g = await c.tx.get('games', str(p.gameId, 'Game')), uid = str(p.uid, 'Player'), role = await adminOf(c);
      need(g, 'not-found', 'Game not found.');
      const f = g.facilityId ? await c.tx.get('facilities', g.facilityId) : null;
      need(g.hostId === c.uid || (f && isFacilityStaff(f, c.uid)) || can(role, 'games'), 'permission-denied', 'Only the host or venue staff can record attendance.');
      need(c.env.relaxAttendance || new Date(g.start).getTime() - 9e5 <= new Date(c.now).getTime(), 'failed-precondition', 'Attendance opens 15 minutes before the start time.');
      const pid = `${g.id}_${uid}`, ex = await c.tx.get('gameParticipants', pid);
      need(ex, 'not-found', 'This player is not on the list.');
      if (ex.status === 'attended' || ex.status === 'no_show') return { already: true, status: ex.status };
      need(ex.status === 'confirmed', 'failed-precondition', 'Only confirmed participants can be marked.');
      if (p.attended) {
        const r = await consumeSession(c, uid, 'game', g.id);
        c.tx.update('gameParticipants', pid, { status: 'attended', markedAt: c.now, markedBy: c.uid });
        return { status: 'attended', ...r };
      }
      await releaseSession(c, uid, 'game', g.id, 'no_show', 'No-show: credit returned, strike recorded');
      c.tx.update('gameParticipants', pid, { status: 'no_show', markedAt: c.now, markedBy: c.uid });
      if (g.covered) await addStrike(c, uid, `No-show at ${g.title}`);
      return { status: 'no_show' };
    },

    /* ===== Facilities ===== */
    async submitFacility(c, p) {
      const u = await me(c), id = c.nid('fac');
      const res = (Array.isArray(p.resources) ? p.resources : []).slice(0, 20);
      need(res.length >= 1, 'invalid-argument', 'Add at least one pitch, court or bookable space.');
      const sportIds = arr(p.sportIds, 30);
      need(sportIds.length, 'invalid-argument', 'Choose at least one supported sport.');
      c.tx.set('facilities', id, {
        id, ownerId: c.uid, ownerName: u.name, name: str(p.name, 'Facility name', 100), county: str(p.county, 'County', 60), town: str(p.town, 'Town', 80), location: str(p.location, 'Location', 160, false),
        lat: num(p.lat ?? 0, 'Latitude', -90, 90), lng: num(p.lng ?? 0, 'Longitude', -180, 180), contactPhone: str(p.contactPhone, 'Contact phone', 30), contactEmail: str(p.contactEmail, 'Contact email', 120, false), sportIds,
        amenities: arr(p.amenities), hours: str(p.hours, 'Opening hours', 120, false) || 'Mon to Sun, 06:00 to 22:00', rules: text(p.rules, 'Rules', 1000), capacity: Math.trunc(num(p.capacity ?? 0, 'Capacity', 0, 200000)), description: text(p.description, 'Description', 1500), photos: arr(p.photos, 8).map(media).filter(Boolean),
        priceFrom: 0, status: 'pending', verified: false, participating: false, settlementAgreed: !!p.settlementAgreed, staffIds: [], staff: [], offers: [], rating: 0, reviewCount: 0, createdAt: c.now, searchTokens: tokens(p.name, p.county, p.town, p.location)
      });
      let minRate = 0;
      for (const r of res) {
        const rid = c.nid('res'), rate = num(r.hourlyRate ?? 0, 'Hourly rate', 0, 1e6);
        minRate = minRate ? Math.min(minRate, rate) : rate;
        c.tx.set('facilityResources', rid, { id: rid, facilityId: id, name: str(r.name, 'Resource name', 80), sportIds: arr(r.sportIds).length ? arr(r.sportIds) : sportIds, hourlyRate: rate, capacity: Math.trunc(num(r.capacity ?? 0, 'Capacity', 0, 1000)), open: Math.trunc(num(r.open ?? 6, 'Open', 0, 23)), close: Math.trunc(num(r.close ?? 22, 'Close', 1, 24)), memberEligible: r.memberEligible !== false, approvalRequired: !!r.approvalRequired, active: true });
      }
      c.tx.update('facilities', id, { priceFrom: minRate });
      c.tx.update('users', c.uid, { roles: withRole(u, 'facility_applicant') });
      notify(c, c.uid, 'verification', 'Facility application received', 'Our team will check your venue details and let you know when it is approved.', '/app/facility');
      await notifyAdmins(c, 'facilities', 'verification', 'New facility to verify', `${u.name} submitted a facility for approval.`, '/admin/facilities');
      audit(c, 'facility.submit', id);
      return { id };
    },
    async reviewFacility(c, p) {
      await requirePerm(c, 'facilities');
      const f = await facilityFor(c, str(p.id, 'Facility')), decision = oneOf(p.decision, ['approved', 'rejected', 'suspended', 'info_required'], 'Decision'), owner = await c.tx.get('users', f.ownerId);
      const patch = { status: decision, verified: decision === 'approved', reviewNote: text(p.note, 'Note', 500), reviewedAt: c.now, reviewedBy: c.uid };
      if (decision === 'approved') patch.participating = f.settlementAgreed ? p.participating !== false : false;
      else patch.participating = false;
      c.tx.update('facilities', f.id, patch);
      if (decision === 'approved' && owner) c.tx.update('users', f.ownerId, { roles: withRole(owner, 'facility') });
      notify(c, f.ownerId, 'verification', `Facility ${decision.replace('_', ' ')}`, `${f.name}: ${patch.reviewNote || 'Review complete.'}`, '/app/facility');
      audit(c, `facility.${decision}`, f.id, { note: patch.reviewNote });
      return { ok: true };
    },
    async updateFacility(c, p) {
      await me(c);
      const f = await facilityFor(c, str(p.id, 'Facility'));
      need(f.ownerId === c.uid, 'permission-denied', 'Only the owner can edit this facility.');
      const patch = {};
      ['name', 'location', 'hours', 'contactPhone', 'contactEmail'].forEach(k => { if (p[k] !== undefined) patch[k] = str(p[k], k, 160, false); });
      ['description', 'rules'].forEach(k => { if (p[k] !== undefined) patch[k] = text(p[k], k, 1500); });
      if (p.amenities !== undefined) patch.amenities = arr(p.amenities);
      if (p.photos !== undefined) patch.photos = (Array.isArray(p.photos) ? p.photos : []).slice(0, 8).map(media).filter(Boolean);
      if (p.settlementAgreed !== undefined) patch.settlementAgreed = !!p.settlementAgreed;
      if (p.offer) patch.offers = [...(f.offers || []), { id: c.nid('off'), title: str(p.offer, 'Offer', 120), at: c.now }].slice(-10);
      if (p.removeOffer) patch.offers = (f.offers || []).filter(o => o.id !== p.removeOffer);
      c.tx.update('facilities', f.id, patch);
      audit(c, 'facility.update', f.id);
      return { ok: true };
    },
    async upsertResource(c, p) {
      await me(c);
      const f = await facilityFor(c, str(p.facilityId, 'Facility'));
      need(f.ownerId === c.uid, 'permission-denied', 'Only the owner can manage resources.');
      const id = p.id || c.nid('res');
      if (p.id) { const ex = await c.tx.get('facilityResources', p.id); need(ex && ex.facilityId === f.id, 'not-found', 'Resource not found.'); }
      c.tx.set('facilityResources', id, { id, facilityId: f.id, name: str(p.name, 'Name', 80), sportIds: arr(p.sportIds).length ? arr(p.sportIds) : f.sportIds, hourlyRate: num(p.hourlyRate ?? 0, 'Hourly rate', 0, 1e6), capacity: Math.trunc(num(p.capacity ?? 0, 'Capacity', 0, 1000)), open: Math.trunc(num(p.open ?? 6, 'Opening hour', 0, 23)), close: Math.trunc(num(p.close ?? 22, 'Closing hour', 1, 24)), memberEligible: p.memberEligible !== false, approvalRequired: !!p.approvalRequired, active: true });
      return { id };
    },
    async removeResource(c, p) {
      await me(c);
      const r = await c.tx.get('facilityResources', str(p.id, 'Resource'));
      need(r, 'not-found', 'Resource not found.');
      const f = await facilityFor(c, r.facilityId);
      need(f.ownerId === c.uid, 'permission-denied', 'Only the owner can remove resources.');
      c.tx.update('facilityResources', r.id, { active: false });
      audit(c, 'resource.remove', r.id);
      return { ok: true };
    },
    async addFacilityStaff(c, p) {
      await me(c);
      const f = await facilityFor(c, str(p.facilityId, 'Facility'));
      need(f.ownerId === c.uid, 'permission-denied', 'Only the owner can manage staff.');
      const member = (await c.tx.query('users', { where: [['memberId', '==', str(p.memberId, 'Member ID', 20).toUpperCase()]], limit: 1 }))[0];
      need(member, 'not-found', 'No member with that SportsHub ID.');
      need(!(f.staffIds || []).includes(member.id), 'already-exists', 'Already on your staff list.');
      c.tx.update('facilities', f.id, { staffIds: [...(f.staffIds || []), member.id], staff: [...(f.staff || []), { uid: member.id, name: member.name, role: str(p.role, 'Role', 40) }] });
      notify(c, member.id, 'facility', 'Added as facility staff', `${f.name} added you as ${clean(p.role)}.`, `/facilities/${f.id}`);
      audit(c, 'facility.staff_add', f.id, { staff: member.id });
      return { ok: true };
    },
    async removeFacilityStaff(c, p) {
      await me(c);
      const f = await facilityFor(c, str(p.facilityId, 'Facility'));
      need(f.ownerId === c.uid, 'permission-denied', 'Only the owner can manage staff.');
      c.tx.update('facilities', f.id, { staffIds: (f.staffIds || []).filter(x => x !== p.uid), staff: (f.staff || []).filter(x => x.uid !== p.uid) });
      return { ok: true };
    },
    async blockSlot(c, p) {
      const u = await me(c), r = await c.tx.get('facilityResources', str(p.resourceId, 'Resource'));
      need(r, 'not-found', 'Resource not found.');
      const f = await facilityFor(c, r.facilityId);
      need(isFacilityStaff(f, c.uid), 'permission-denied', 'Only facility staff can block slots.');
      const start = iso(p.start, 'Start'), end = iso(p.end, 'End');
      need(end > start, 'invalid-argument', 'End must be after start.');
      const id = c.nid('bkg');
      await lockSlots(c, r, start, end, id, 'maintenance');
      c.tx.set('facilityBookings', id, { id, facilityId: f.id, ownerId: f.ownerId, facilityName: f.name, resourceId: r.id, resourceName: r.name, uid: c.uid, userName: u.name, start, end, kind: 'maintenance', status: 'confirmed', price: 0, note: str(p.reason, 'Reason', 200, false) || 'Maintenance', createdAt: c.now });
      audit(c, 'facility.block', id);
      return { id };
    },
    async bookFacility(c, p) {
      const u = await me(c), s = await settings(c), r = await c.tx.get('facilityResources', str(p.resourceId, 'Resource'));
      need(r && r.active !== false, 'not-found', 'That pitch or court is not available.');
      const f = await facilityFor(c, r.facilityId);
      need(f.status === 'approved', 'failed-precondition', 'This facility is not approved for bookings.');
      const start = iso(p.start, 'Start'), end = iso(p.end, 'End'), kind = oneOf(p.kind, ['covered', 'external', 'private'], 'Booking type');
      need(start > c.now, 'invalid-argument', 'Please choose a future time.');
      need(end > start, 'invalid-argument', 'End must be after the start.');
      need(new Date(start).getUTCMinutes() === 0 && new Date(end).getUTCMinutes() === 0, 'invalid-argument', 'Bookings start and end on the hour.');
      const hours = hourStamps(start, end).length;
      need(hours <= 8, 'invalid-argument', 'Bookings are limited to 8 hours.');
      await assertOpen(c, r, start, end);
      const id = c.nid('bkg'), title = `${f.name} · ${r.name}`;
      if (kind === 'covered') {
        need(f.participating && r.memberEligible, 'failed-precondition', 'This resource is not part of the SportsHub membership programme. It can still be booked as an external booking.');
        need(hours === 1, 'invalid-argument', 'A covered membership session is one hour.');
      }
      await assertNoClash(c, c.uid, start, end, id);
      await lockSlots(c, r, start, end, id, kind);
      await holdSession(c, { uid: c.uid, covered: kind === 'covered', source: 'booking', sourceId: id, facilityId: f.id, resourceId: r.id, start, end, title });
      /* Never charge a ground-access fee on a covered session. */
      const price = kind === 'covered' ? 0 : r.hourlyRate * hours;
      const status = r.approvalRequired && kind !== 'covered' ? 'pending' : 'confirmed';
      c.tx.set('facilityBookings', id, { id, facilityId: f.id, ownerId: f.ownerId, facilityName: f.name, resourceId: r.id, resourceName: r.name, uid: c.uid, userName: u.name, memberId: u.memberId, start, end, kind, status, price, currency: s.currency, paymentNote: kind === 'covered' ? 'Covered by membership' : 'Pay at venue', note: text(p.note, 'Note', 300), createdAt: c.now });
      notify(c, f.ownerId, 'booking', status === 'pending' ? 'Booking awaiting approval' : 'New booking', `${u.name}: ${r.name}.`, '/app/facility/bookings');
      notify(c, c.uid, 'booking', status === 'pending' ? 'Booking requested' : 'Booking confirmed', `${title}.${kind === 'covered' ? ' One session reserved; no ground-access fee.' : ''}`, '/app/bookings');
      audit(c, 'booking.create', id, { kind });
      return { id, status, price };
    },
    async reviewBooking(c, p) {
      await me(c);
      const b = await c.tx.get('facilityBookings', str(p.id, 'Booking'));
      need(b && b.status === 'pending', 'failed-precondition', 'This booking is not awaiting review.');
      const f = await facilityFor(c, b.facilityId);
      need(isFacilityStaff(f, c.uid), 'permission-denied', 'Only facility staff can review bookings.');
      if (p.approve) c.tx.update('facilityBookings', b.id, { status: 'confirmed' });
      else {
        c.tx.update('facilityBookings', b.id, { status: 'rejected' });
        freeSlots(c, b.resourceId, b.start, b.end);
        await releaseSession(c, b.uid, 'booking', b.id, 'released', 'Booking rejected');
      }
      notify(c, b.uid, 'booking', p.approve ? 'Booking confirmed' : 'Booking declined', `${b.facilityName} · ${b.resourceName}.`, '/app/bookings');
      return { ok: true };
    },
    async cancelBooking(c, p) {
      await me(c);
      const s = await settings(c), b = await c.tx.get('facilityBookings', str(p.id, 'Booking'));
      need(b && ['pending', 'confirmed'].includes(b.status), 'failed-precondition', 'This booking can no longer be cancelled.');
      need(b.kind !== 'game', 'failed-precondition', 'Cancel the game itself to release this slot.');
      const f = await facilityFor(c, b.facilityId), staff = isFacilityStaff(f, c.uid);
      need(b.uid === c.uid || staff, 'permission-denied', 'You cannot cancel this booking.');
      c.tx.update('facilityBookings', b.id, { status: 'cancelled', cancelledAt: c.now, cancelledBy: c.uid });
      freeSlots(c, b.resourceId, b.start, b.end);
      if (b.kind !== 'maintenance') {
        await releaseSession(c, b.uid, 'booking', b.id, 'released', 'Booking cancelled');
        const late = new Date(b.start).getTime() - new Date(c.now).getTime() < s.cancelWindowHours * 36e5;
        if (late && b.kind === 'covered' && b.uid === c.uid) await addStrike(c, c.uid, 'Late cancellation');
        notify(c, b.uid === c.uid ? b.ownerId : b.uid, 'booking', 'Booking cancelled', `${b.facilityName} · ${b.resourceName}.`, b.uid === c.uid ? '/app/facility/bookings' : '/app/bookings');
      }
      return { ok: true };
    },
    async checkInBooking(c, p) {
      await me(c);
      const b = await c.tx.get('facilityBookings', str(p.id, 'Booking'));
      need(b, 'not-found', 'Booking not found.');
      const f = await facilityFor(c, b.facilityId);
      need(isFacilityStaff(f, c.uid), 'permission-denied', 'Only facility staff can check members in.');
      if (b.status === 'checked_in' || b.status === 'no_show') return { already: true, status: b.status };
      need(b.status === 'confirmed' && b.kind !== 'maintenance' && b.kind !== 'game', 'failed-precondition', 'This booking cannot be checked in.');
      need(c.env.relaxAttendance || new Date(b.start).getTime() - 9e5 <= new Date(c.now).getTime(), 'failed-precondition', 'Check-in opens 15 minutes before the start time.');
      if (p.attended) {
        const r = await consumeSession(c, b.uid, 'booking', b.id);
        c.tx.update('facilityBookings', b.id, { status: 'checked_in', checkedInAt: c.now });
        audit(c, 'booking.check_in', b.id);
        return { status: 'checked_in', ...r };
      }
      await releaseSession(c, b.uid, 'booking', b.id, 'no_show', 'No-show: credit returned, strike recorded');
      c.tx.update('facilityBookings', b.id, { status: 'no_show' });
      if (b.kind === 'covered') await addStrike(c, b.uid, `No-show at ${b.facilityName}`);
      return { status: 'no_show' };
    },
    async generateSettlements(c, p) {
      await requirePerm(c, 'settlements');
      const s = await settings(c), month = str(p.month, 'Month', 7);
      need(/^\d{4}-\d{2}$/.test(month), 'invalid-argument', 'Month must look like 2026-10.');
      const rows = await c.tx.query('sessionAttendance', { where: [['month', '==', month], ['settled', '==', false]], limit: 400 });
      const by = {};
      rows.filter(r => r.facilityId).forEach(r => { (by[r.facilityId] = by[r.facilityId] || []).push(r); });
      for (const [fid, list] of Object.entries(by)) {
        const f = await c.tx.get('facilities', fid), id = `${fid}_${month}`, ex = await c.tx.get('facilitySettlements', id);
        const sessions = list.length + (ex ? ex.sessions : 0);
        c.tx.set('facilitySettlements', id, { id, facilityId: fid, facilityName: f ? f.name : fid, ownerId: f ? f.ownerId : '', month, sessions, rate: s.settlementRatePerSession, amount: sessions * s.settlementRatePerSession, status: 'draft', generatedAt: c.now });
        list.forEach(r => c.tx.update('sessionAttendance', r.id, { settled: true, settlementId: id }));
      }
      audit(c, 'settlement.generate', month, { facilities: Object.keys(by).length, sessions: rows.length });
      return { facilities: Object.keys(by).length, sessions: rows.length };
    },
    async updateSettlement(c, p) {
      await requirePerm(c, 'settlements');
      const st = await c.tx.get('facilitySettlements', str(p.id, 'Settlement')), status = oneOf(p.status, ['approved', 'paid'], 'Status');
      need(st, 'not-found', 'Settlement not found.');
      need(status === 'paid' ? st.status === 'approved' : st.status === 'draft', 'failed-precondition', 'Settlements move from draft to approved to paid.');
      c.tx.update('facilitySettlements', st.id, { status, [`${status}At`]: c.now, [`${status}By`]: c.uid });
      notify(c, st.ownerId, 'settlement', `Settlement ${status}`, `${st.month}: KES ${st.amount}.`, '/app/facility/settlements');
      audit(c, `settlement.${status}`, st.id, { amount: st.amount });
      return { ok: true };
    },

    /* ===== Teams ===== */
    async createTeam(c, p) {
      const u = await me(c), sport = await c.tx.get('sports', str(p.sportId, 'Main sport'));
      need(sport, 'not-found', 'Sport not found.');
      need(!u.isMinor, 'permission-denied', 'Players under 18 cannot register as captain.');
      const id = c.nid('tem'), name = str(p.name, 'Team name', 80);
      c.tx.set('teams', id, { id, name, logo: media(p.logo), sportId: sport.id, sportName: sport.name, extraSports: arr(p.extraSports), county: str(p.county, 'County', 60), town: str(p.town, 'Town', 80), area: str(p.area, 'Playing area', 80, false), description: text(p.description, 'Description', 800), skill: str(p.skill, 'Skill level', 30, false) || 'Recreational', format: str(p.format, 'Team format', 40, false), captainId: c.uid, captainName: u.name, viceId: '', adminIds: [], memberCount: 1, recruiting: p.recruiting !== false, lookingFor: arr(p.lookingFor, 12), stats: { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0 }, achievements: [], createdAt: c.now, searchTokens: tokens(name, sport.name, p.county, p.town) });
      c.tx.set('teamMembers', `${id}_${c.uid}`, { teamId: id, teamName: name, uid: c.uid, name: u.name, role: 'captain', status: 'active', joinedAt: c.now });
      const prof = await c.tx.get('playerProfiles', c.uid);
      if (prof) c.tx.update('playerProfiles', c.uid, { teamIds: [...(prof.teamIds || []), id] });
      c.tx.update('users', c.uid, { roles: withRole(u, 'captain'), activeTeamId: id });
      let invited = 0;
      for (const mem of (Array.isArray(p.members) ? p.members : []).slice(0, 40)) {
        const mname = clean(mem.name), mid = clean(mem.memberId).toUpperCase();
        if (!mname && !mid) continue;
        const found = mid ? (await c.tx.query('users', { where: [['memberId', '==', mid]], limit: 1 }))[0] : null;
        const key = found ? found.id : c.nid('ext');
        if (found && found.id === c.uid) continue;
        c.tx.set('teamMembers', `${id}_${key}`, { teamId: id, teamName: name, uid: key, name: found ? found.name : mname, role: 'member', status: found ? 'invited' : 'external', invitedBy: c.uid, joinedAt: c.now });
        /* An outside player's contact details stay in a record only team officials can read. */
        if (!found && clean(mem.contact)) c.tx.set('teamExternalInvites', `${id}_${key}`, { teamId: id, captainId: c.uid, name: mname, contact: clean(mem.contact), at: c.now });
        if (found) notify(c, found.id, 'team', 'Team invitation', `${u.name} invited you to ${name}.`, '/app/teams');
        invited++;
      }
      audit(c, 'team.create', id);
      return { id, invited };
    },
    async updateTeam(c, p) {
      const t = await requireTeamOfficial(c, str(p.id, 'Team')), patch = {};
      ['town', 'area', 'skill', 'format'].forEach(k => { if (p[k] !== undefined) patch[k] = str(p[k], k, 80, false); });
      if (p.description !== undefined) patch.description = text(p.description, 'Description', 800);
      if (p.recruiting !== undefined) patch.recruiting = !!p.recruiting;
      if (p.lookingFor !== undefined) patch.lookingFor = arr(p.lookingFor, 12);
      if (p.logo !== undefined) patch.logo = media(p.logo);
      if (p.achievement) patch.achievements = [...(t.achievements || []), str(p.achievement, 'Achievement', 120)].slice(-20);
      c.tx.update('teams', t.id, patch);
      return { ok: true };
    },
    async teamInvite(c, p) {
      const u = await me(c), t = await requireTeamOfficial(c, str(p.teamId, 'Team'));
      const mid = clean(p.memberId).toUpperCase();
      if (mid) {
        const found = (await c.tx.query('users', { where: [['memberId', '==', mid]], limit: 1 }))[0];
        need(found, 'not-found', 'No member with that SportsHub ID.');
        const ex = await c.tx.get('teamMembers', `${t.id}_${found.id}`);
        need(!ex || ex.status === 'removed', 'already-exists', 'This player is already linked to the team.');
        c.tx.set('teamMembers', `${t.id}_${found.id}`, { teamId: t.id, teamName: t.name, uid: found.id, name: found.name, role: 'member', status: 'invited', invitedBy: c.uid, joinedAt: c.now });
        notify(c, found.id, 'team', 'Team invitation', `${u.name} invited you to ${t.name}.`, '/app/teams');
      } else {
        const key = c.nid('ext');
        c.tx.set('teamMembers', `${t.id}_${key}`, { teamId: t.id, teamName: t.name, uid: key, name: str(p.name, 'Player name', 80), role: 'member', status: 'external', invitedBy: c.uid, joinedAt: c.now });
        if (clean(p.contact)) c.tx.set('teamExternalInvites', `${t.id}_${key}`, { teamId: t.id, captainId: t.captainId, name: clean(p.name), contact: str(p.contact, 'Contact', 120), at: c.now });
      }
      audit(c, 'team.invite', t.id);
      return { ok: true };
    },
    async teamRespondInvite(c, p) {
      const u = await me(c), t = await teamFor(c, str(p.teamId, 'Team')), id = `${t.id}_${c.uid}`, tm = await c.tx.get('teamMembers', id);
      need(tm && tm.status === 'invited', 'failed-precondition', 'There is no open invitation.');
      if (p.accept) {
        c.tx.update('teamMembers', id, { status: 'active', joinedAt: c.now });
        c.tx.update('teams', t.id, { memberCount: (t.memberCount || 0) + 1 });
        const prof = await c.tx.get('playerProfiles', c.uid);
        if (prof) c.tx.update('playerProfiles', c.uid, { teamIds: [...new Set([...(prof.teamIds || []), t.id])] });
      } else c.tx.update('teamMembers', id, { status: 'removed' });
      notify(c, t.captainId, 'team', p.accept ? 'Invitation accepted' : 'Invitation declined', `${u.name}: ${t.name}.`, '/app/team/squad');
      return { ok: true };
    },
    async teamRequestJoin(c, p) {
      const u = await me(c), t = await teamFor(c, str(p.teamId, 'Team')), id = `${t.id}_${c.uid}`, tm = await c.tx.get('teamMembers', id);
      need(!tm || tm.status === 'removed', 'already-exists', 'You are already linked to this team.');
      need(t.recruiting, 'failed-precondition', 'This team is not recruiting right now.');
      c.tx.set('teamMembers', id, { teamId: t.id, teamName: t.name, uid: c.uid, name: u.name, role: 'member', status: 'requested', message: text(p.message, 'Message', 300), joinedAt: c.now });
      notify(c, t.captainId, 'team', 'Join request', `${u.name} wants to join ${t.name}.`, '/app/team/squad');
      return { ok: true };
    },
    async teamReviewRequest(c, p) {
      const t = await requireTeamOfficial(c, str(p.teamId, 'Team')), uid = str(p.uid, 'Player'), id = `${t.id}_${uid}`, tm = await c.tx.get('teamMembers', id);
      need(tm && tm.status === 'requested', 'failed-precondition', 'This request is no longer open.');
      c.tx.update('teamMembers', id, { status: p.approve ? 'active' : 'removed' });
      if (p.approve) {
        c.tx.update('teams', t.id, { memberCount: (t.memberCount || 0) + 1 });
        const prof = await c.tx.get('playerProfiles', uid);
        if (prof) c.tx.update('playerProfiles', uid, { teamIds: [...new Set([...(prof.teamIds || []), t.id])] });
      }
      notify(c, uid, 'team', p.approve ? 'Welcome to the team' : 'Request declined', t.name, `/teams/${t.id}`);
      audit(c, p.approve ? 'team.member_approve' : 'team.member_reject', t.id, { uid });
      return { ok: true };
    },
    async teamRemoveMember(c, p) {
      const t = await requireTeamOfficial(c, str(p.teamId, 'Team')), uid = str(p.uid, 'Player'), id = `${t.id}_${uid}`, tm = await c.tx.get('teamMembers', id);
      need(tm, 'not-found', 'Member not found.');
      need(uid !== t.captainId, 'failed-precondition', 'Transfer the captaincy before removing the captain.');
      c.tx.update('teamMembers', id, { status: 'removed' });
      if (tm.status === 'active') {
        c.tx.update('teams', t.id, { memberCount: Math.max(1, (t.memberCount || 1) - 1), viceId: t.viceId === uid ? '' : t.viceId, adminIds: (t.adminIds || []).filter(x => x !== uid) });
        const prof = await c.tx.get('playerProfiles', uid);
        if (prof) c.tx.update('playerProfiles', uid, { teamIds: (prof.teamIds || []).filter(x => x !== t.id) });
        notify(c, uid, 'team', 'Removed from team', t.name, '/app/teams');
      }
      audit(c, 'team.member_remove', t.id, { uid });
      return { ok: true };
    },
    async teamSetRole(c, p) {
      const t = await teamFor(c, str(p.teamId, 'Team')), uid = str(p.uid, 'Player'), role = oneOf(p.role, ['captain', 'vice', 'admin', 'member'], 'Role');
      need(t.captainId === c.uid, 'permission-denied', 'Only the captain can change team roles.');
      const id = `${t.id}_${uid}`, tm = await c.tx.get('teamMembers', id);
      need(tm && tm.status === 'active', 'failed-precondition', 'Roles can only be given to active members.');
      const patch = { adminIds: (t.adminIds || []).filter(x => x !== uid), viceId: t.viceId === uid ? '' : t.viceId };
      if (role === 'admin') patch.adminIds.push(uid);
      if (role === 'vice') patch.viceId = uid;
      if (role === 'captain') {
        patch.captainId = uid; patch.captainName = tm.name;
        c.tx.update('teamMembers', `${t.id}_${c.uid}`, { role: 'member' });
        const nu = await c.tx.get('users', uid);
        if (nu) c.tx.update('users', uid, { roles: withRole(nu, 'captain'), activeTeamId: t.id });
      } else if (t.viceId && role === 'vice' && t.viceId !== uid) c.tx.update('teamMembers', `${t.id}_${t.viceId}`, { role: 'member' });
      c.tx.update('teams', t.id, patch);
      c.tx.update('teamMembers', id, { role });
      notify(c, uid, 'team', 'Team role updated', `${t.name}: ${role}.`, `/teams/${t.id}`);
      audit(c, 'team.role', t.id, { uid, role });
      return { ok: true };
    },
    async teamLeave(c, p) {
      await me(c);
      const t = await teamFor(c, str(p.teamId, 'Team')), id = `${t.id}_${c.uid}`, tm = await c.tx.get('teamMembers', id);
      need(tm && tm.status === 'active', 'failed-precondition', 'You are not an active member.');
      need(t.captainId !== c.uid, 'failed-precondition', 'Transfer the captaincy before leaving.');
      c.tx.update('teamMembers', id, { status: 'removed' });
      c.tx.update('teams', t.id, { memberCount: Math.max(1, (t.memberCount || 1) - 1), viceId: t.viceId === c.uid ? '' : t.viceId, adminIds: (t.adminIds || []).filter(x => x !== c.uid) });
      const prof = await c.tx.get('playerProfiles', c.uid);
      if (prof) c.tx.update('playerProfiles', c.uid, { teamIds: (prof.teamIds || []).filter(x => x !== t.id) });
      return { ok: true };
    },
    async requestTeamTransfer(c, p) {
      const u = await me(c), from = await teamFor(c, str(p.fromTeamId, 'Current team')), to = await teamFor(c, str(p.toTeamId, 'New team'));
      need(from.id !== to.id, 'invalid-argument', 'Choose a different team.');
      const tm = await c.tx.get('teamMembers', `${from.id}_${c.uid}`);
      need(tm && tm.status === 'active', 'failed-precondition', 'You are not an active member of that team.');
      need(from.captainId !== c.uid, 'failed-precondition', 'Transfer the captaincy first.');
      const id = c.nid('ttr');
      c.tx.set('teamTransfers', id, { id, uid: c.uid, name: u.name, fromTeamId: from.id, fromName: from.name, toTeamId: to.id, toName: to.name, fromApproved: false, toApproved: false, status: 'pending', officials: [from.captainId, to.captainId], reason: text(p.reason, 'Reason', 300), createdAt: c.now });
      notify(c, from.captainId, 'transfer', 'Player transfer request', `${u.name} asked to move to ${to.name}.`, '/app/team/transfers');
      notify(c, to.captainId, 'transfer', 'Incoming transfer request', `${u.name} wants to join from ${from.name}.`, '/app/team/transfers');
      return { id };
    },
    async reviewTeamTransfer(c, p) {
      await me(c);
      const tr = await c.tx.get('teamTransfers', str(p.id, 'Transfer'));
      need(tr && tr.status === 'pending', 'failed-precondition', 'This transfer is closed.');
      const from = await teamFor(c, tr.fromTeamId), to = await teamFor(c, tr.toTeamId), isFrom = isTeamOfficial(from, c.uid), isTo = isTeamOfficial(to, c.uid);
      need(isFrom || isTo, 'permission-denied', 'Only officials of these teams can review this transfer.');
      if (!p.approve) { c.tx.update('teamTransfers', tr.id, { status: 'rejected', reviewedAt: c.now }); notify(c, tr.uid, 'transfer', 'Transfer declined', `${tr.fromName} to ${tr.toName}.`, '/app/teams'); return { ok: true }; }
      const fromApproved = tr.fromApproved || isFrom, toApproved = tr.toApproved || isTo;
      if (fromApproved && toApproved) {
        c.tx.update('teamMembers', `${from.id}_${tr.uid}`, { status: 'removed' });
        c.tx.set('teamMembers', `${to.id}_${tr.uid}`, { teamId: to.id, teamName: to.name, uid: tr.uid, name: tr.name, role: 'member', status: 'active', joinedAt: c.now });
        c.tx.update('teams', from.id, { memberCount: Math.max(1, from.memberCount - 1) });
        c.tx.update('teams', to.id, { memberCount: to.memberCount + 1 });
        const prof = await c.tx.get('playerProfiles', tr.uid);
        if (prof) c.tx.update('playerProfiles', tr.uid, { teamIds: [...new Set([...(prof.teamIds || []).filter(x => x !== from.id), to.id])] });
        c.tx.update('teamTransfers', tr.id, { status: 'completed', fromApproved, toApproved, completedAt: c.now });
        notify(c, tr.uid, 'transfer', 'Transfer complete', `You now play for ${to.name}.`, `/teams/${to.id}`);
        audit(c, 'team.transfer', tr.id);
      } else c.tx.update('teamTransfers', tr.id, { fromApproved, toApproved });
      return { ok: true };
    },
    async createTraining(c, p) {
      const u = await me(c), type = oneOf(p.ownerType, ['team', 'coach'], 'Owner');
      if (type === 'team') await requireTeamOfficial(c, str(p.ownerId, 'Team')); else need((u.roles || []).includes('coach'), 'permission-denied', 'Verified coach privileges are required.');
      const id = c.nid('trn'), start = iso(p.start, 'Start'), end = iso(p.end, 'End');
      need(end > start, 'invalid-argument', 'End must be after the start.');
      const ownerId = type === 'team' ? p.ownerId : c.uid;
      let members = [];
      if (type === 'team') members = (await c.tx.query('teamMembers', { where: [['teamId', '==', ownerId], ['status', '==', 'active']], limit: 60 })).map(x => x.uid);
      else members = (await c.tx.query('coachRoster', { where: [['coachId', '==', c.uid]], limit: 60 })).map(x => x.uid).filter(Boolean);
      c.tx.set('trainingSessions', id, { id, ownerType: type, ownerId, title: str(p.title, 'Title', 100), start, end, venue: str(p.venue, 'Venue', 120, false), members, attendance: {}, createdBy: c.uid, createdAt: c.now });
      members.filter(m => m !== c.uid).forEach(m => notify(c, m, 'training', 'New training session', clean(p.title), '/app/calendar'));
      return { id };
    },
    async markTrainingAttendance(c, p) {
      await me(c);
      const tr = await c.tx.get('trainingSessions', str(p.id, 'Session'));
      need(tr, 'not-found', 'Session not found.');
      if (tr.ownerType === 'team') await requireTeamOfficial(c, tr.ownerId); else need(tr.ownerId === c.uid, 'permission-denied', 'Only the coach can mark this.');
      c.tx.update('trainingSessions', tr.id, { attendance: { ...tr.attendance, [str(p.uid, 'Player')]: !!p.present } });
      return { ok: true };
    },

    /* ===== Team challenges & fixtures ===== */
    async createChallenge(c, p) {
      const u = await me(c), from = await requireTeamOfficial(c, str(p.fromTeamId, 'Your team')), to = await teamFor(c, str(p.toTeamId, 'Opponent'));
      need(from.id !== to.id, 'invalid-argument', 'A team cannot challenge itself.');
      const id = c.nid('chl'), when = iso(p.start, 'Proposed date');
      need(when > c.now, 'invalid-argument', 'Please propose a future date.');
      c.tx.set('challenges', id, { id, fromTeamId: from.id, fromName: from.name, toTeamId: to.id, toName: to.name, officials: [from.captainId, to.captainId], sportId: str(p.sportId, 'Sport') || from.sportId, start: when, venue: str(p.venue, 'Venue', 120, false), format: str(p.format, 'Format', 40, false), terms: text(p.terms, 'Terms', 500), status: 'pending', awaitingTeamId: to.id, history: [{ by: from.name, action: 'proposed', start: when, at: c.now }], createdAt: c.now });
      notify(c, to.captainId, 'challenge', 'Team challenge received', `${from.name} challenged ${to.name}.`, '/app/team/challenges');
      audit(c, 'challenge.create', id);
      return { id };
    },
    async respondChallenge(c, p) {
      await me(c);
      const ch = await c.tx.get('challenges', str(p.id, 'Challenge')), action = oneOf(p.action, ['accept', 'decline', 'counter'], 'Action');
      need(ch && ch.status === 'pending', 'failed-precondition', 'This challenge is closed.');
      const team = await requireTeamOfficial(c, ch.awaitingTeamId), otherId = ch.awaitingTeamId === ch.fromTeamId ? ch.toTeamId : ch.fromTeamId, other = await teamFor(c, otherId);
      const history = [...ch.history, { by: team.name, action, start: p.start ? iso(p.start, 'Date') : ch.start, at: c.now }];
      if (action === 'decline') { c.tx.update('challenges', ch.id, { status: 'declined', history }); notify(c, other.captainId, 'challenge', 'Challenge declined', `${team.name} declined.`, '/app/team/challenges'); return { ok: true }; }
      if (action === 'counter') {
        const start = iso(p.start, 'New date');
        need(start > c.now, 'invalid-argument', 'Please propose a future date.');
        c.tx.update('challenges', ch.id, { start, awaitingTeamId: otherId, history });
        notify(c, other.captainId, 'challenge', 'New date proposed', `${team.name} proposed another date.`, '/app/team/challenges');
        return { ok: true };
      }
      const fid = c.nid('fix'), a = await teamFor(c, ch.fromTeamId), b = await teamFor(c, ch.toTeamId);
      c.tx.set('fixtures', fid, { id: fid, kind: 'challenge', challengeId: ch.id, sportId: ch.sportId, homeId: a.id, homeName: a.name, awayId: b.id, awayName: b.name, teamIds: [a.id, b.id], start: ch.start, venue: ch.venue, status: 'scheduled', createdAt: c.now });
      c.tx.update('challenges', ch.id, { status: 'accepted', fixtureId: fid, history });
      notify(c, other.captainId, 'challenge', 'Challenge accepted', `${team.name} accepted. The fixture is on your calendar.`, '/app/team/fixtures');
      audit(c, 'challenge.accept', ch.id, { fixture: fid });
      return { fixtureId: fid };
    },
    async recordResult(c, p) {
      await me(c);
      const f = await c.tx.get('fixtures', str(p.fixtureId, 'Fixture')), role = await adminOf(c);
      need(f, 'not-found', 'Fixture not found.');
      need(f.status !== 'completed', 'failed-precondition', 'This result has already been recorded.');
      const hs = Math.trunc(num(p.home, 'Home score', 0, 10000)), as = Math.trunc(num(p.away, 'Away score', 0, 10000));
      let tournament = null;
      if (f.tournamentId) {
        tournament = await c.tx.get('tournaments', f.tournamentId);
        need(tournament && (tournament.organiserId === c.uid || (tournament.officialIds || []).includes(c.uid) || can(role, 'tournaments')), 'permission-denied', 'Only the organiser or appointed officials can record this result.');
      } else {
        const home = await c.tx.get('teams', f.homeId), away = await c.tx.get('teams', f.awayId);
        need((home && isTeamOfficial(home, c.uid)) || (away && isTeamOfficial(away, c.uid)) || can(role, 'games'), 'permission-denied', 'Only team officials can record this result.');
      }
      c.tx.update('fixtures', f.id, { status: 'completed', homeScore: hs, awayScore: as, completedAt: c.now, recordedBy: c.uid });
      c.tx.set('matchResults', f.id, { fixtureId: f.id, tournamentId: f.tournamentId || '', homeId: f.homeId, awayId: f.awayId, homeName: f.homeName, awayName: f.awayName, homeScore: hs, awayScore: as, sportId: f.sportId, verified: !!f.tournamentId, at: c.now });
      if (!f.tournamentId) {
        for (const [id, gf, ga] of [[f.homeId, hs, as], [f.awayId, as, hs]]) {
          const t = await c.tx.get('teams', id); if (!t) continue;
          const st = { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, ...(t.stats || {}) };
          st.played++; st.for += gf; st.against += ga; if (gf > ga) st.won++; else if (gf < ga) st.lost++; else st.drawn++;
          c.tx.update('teams', id, { stats: st });
        }
      } else await applyTournamentResult(c, tournament, f, hs, as);
      audit(c, 'fixture.result', f.id, { hs, as });
      return { ok: true };
    },

    /* ===== Tournaments ===== */
    async createTournament(c, p) {
      const u = await me(c), role = await adminOf(c);
      need((u.roles || []).includes('organiser') || can(role, 'tournaments'), 'permission-denied', 'Only verified organisers can create competitions.');
      const sport = await c.tx.get('sports', str(p.sportId, 'Sport'));
      need(sport, 'not-found', 'Sport not found.');
      const id = c.nid('trm'), start = iso(p.start, 'Start date'), end = iso(p.end, 'End date');
      need(end >= start, 'invalid-argument', 'End date must be on or after the start.');
      c.tx.set('tournaments', id, { id, name: str(p.name, 'Name', 100), sportId: sport.id, sportName: sport.name, format: oneOf(p.format, ['knockout', 'round_robin', 'league', 'groups', 'individual'], 'Format'), organiserId: c.uid, organiserName: u.name, start, end, venue: str(p.venue, 'Venue', 120), county: str(p.county, 'County', 60), ageCategory: str(p.ageCategory, 'Age category', 40, false) || 'Open', capacity: Math.trunc(num(p.capacity, 'Capacity', 2, 512)), entryFee: num(p.entryFee ?? 0, 'Entry fee', 0, 1e6), requirements: text(p.requirements, 'Requirements', 800), description: text(p.description, 'Description', 1200), registrationType: p.format === 'individual' ? 'individual' : oneOf(p.registrationType || 'team', ['team', 'individual'], 'Registration type'), status: 'open', registered: 0, officials: [], officialIds: [], standings: {}, leaderboard: [], winner: '', metricLabel: str(p.metricLabel, 'Metric', 40, false), lowerIsBetter: !!p.lowerIsBetter, createdAt: c.now, searchTokens: tokens(p.name, sport.name, p.county, p.venue) });
      audit(c, 'tournament.create', id);
      return { id };
    },
    async setTournamentStatus(c, p) {
      await me(c);
      const t = await c.tx.get('tournaments', str(p.id, 'Tournament')), role = await adminOf(c);
      need(t && (t.organiserId === c.uid || can(role, 'tournaments')), 'permission-denied', 'Only the organiser can do this.');
      c.tx.update('tournaments', t.id, { status: oneOf(p.status, ['open', 'closed', 'running', 'finished', 'cancelled'], 'Status') });
      audit(c, 'tournament.status', t.id, { status: p.status });
      return { ok: true };
    },
    async registerTournament(c, p) {
      const u = await me(c), t = await c.tx.get('tournaments', str(p.tournamentId, 'Tournament'));
      need(t, 'not-found', 'Tournament not found.');
      need(t.status === 'open', 'failed-precondition', 'Registration is closed.');
      need(t.registered < t.capacity, 'failed-precondition', 'This competition is at capacity.');
      let entrantId = c.uid, entrantName = u.name;
      if (t.registrationType === 'team') {
        const team = await requireTeamOfficial(c, str(p.teamId, 'Team'));
        need(team.sportId === t.sportId || (team.extraSports || []).includes(t.sportId), 'failed-precondition', `That team is not registered for ${t.sportName}.`);
        entrantId = team.id; entrantName = team.name;
      }
      const id = `${t.id}_${entrantId}`;
      need(!(await c.tx.get('tournamentRegistrations', id)), 'already-exists', 'Already registered for this competition.');
      c.tx.set('tournamentRegistrations', id, { id, tournamentId: t.id, tournamentName: t.name, entrantId, entrantName, type: t.registrationType, by: c.uid, status: 'pending', feeDue: t.entryFee, createdAt: c.now, sportId: t.sportId, start: t.start, organiserId: t.organiserId });
      c.tx.update('tournaments', t.id, { registered: t.registered + 1 });
      notify(c, t.organiserId, 'tournament', 'New registration', `${entrantName}: ${t.name}.`, `/tournaments/${t.id}`);
      notify(c, c.uid, 'tournament', 'Registration received', `${t.name}. Awaiting the organiser's confirmation.`, `/tournaments/${t.id}`);
      return { id };
    },
    async reviewTournamentRegistration(c, p) {
      await me(c);
      const r = await c.tx.get('tournamentRegistrations', str(p.id, 'Registration'));
      need(r, 'not-found', 'Registration not found.');
      const t = await c.tx.get('tournaments', r.tournamentId), role = await adminOf(c);
      need(t.organiserId === c.uid || can(role, 'tournaments'), 'permission-denied', 'Only the organiser can review entries.');
      c.tx.update('tournamentRegistrations', r.id, { status: p.approve ? 'confirmed' : 'rejected' });
      if (!p.approve) c.tx.update('tournaments', t.id, { registered: Math.max(0, t.registered - 1) });
      notify(c, r.by, 'tournament', p.approve ? 'Entry confirmed' : 'Entry declined', t.name, `/tournaments/${t.id}`);
      return { ok: true };
    },
    async addTournamentOfficial(c, p) {
      await me(c);
      const t = await c.tx.get('tournaments', str(p.id, 'Tournament'));
      need(t && t.organiserId === c.uid, 'permission-denied', 'Only the organiser can appoint officials.');
      const memberId = clean(p.memberId).toUpperCase(), found = memberId ? (await c.tx.query('users', { where: [['memberId', '==', memberId]], limit: 1 }))[0] : null;
      need(!memberId || found, 'not-found', 'No member with that SportsHub ID.');
      const off = { name: found ? found.name : str(p.name, 'Official name', 80), role: str(p.role, 'Role', 40), uid: found ? found.id : '' };
      c.tx.update('tournaments', t.id, { officials: [...(t.officials || []), off], officialIds: found ? [...(t.officialIds || []), found.id] : (t.officialIds || []) });
      if (found) notify(c, found.id, 'tournament', 'Appointed as official', `${t.name}: ${off.role}.`, `/tournaments/${t.id}`);
      return { ok: true };
    },
    async generateFixtures(c, p) {
      await me(c);
      const t = await c.tx.get('tournaments', str(p.id, 'Tournament')), role = await adminOf(c);
      need(t && (t.organiserId === c.uid || can(role, 'tournaments')), 'permission-denied', 'Only the organiser can generate fixtures.');
      need(t.format !== 'individual', 'failed-precondition', 'Individual competitions use a results leaderboard rather than fixtures.');
      const existing = await c.tx.query('fixtures', { where: [['tournamentId', '==', t.id]], limit: 1 });
      need(!existing.length, 'already-exists', 'Fixtures have already been generated.');
      const entries = (await c.tx.query('tournamentRegistrations', { where: [['tournamentId', '==', t.id], ['status', '==', 'confirmed']], limit: 128 }));
      need(entries.length >= 2, 'failed-precondition', 'At least two confirmed entries are needed.');
      const seeded = entries.map(e => ({ id: e.entrantId, name: e.entrantName }));
      const dayMs = 864e5, base = new Date(t.start).getTime();
      const add = (a, b, round, group, label, offset) => {
        const fid = c.nid('fix');
        c.tx.set('fixtures', fid, { id: fid, kind: 'tournament', tournamentId: t.id, tournamentName: t.name, sportId: t.sportId, homeId: a.id, homeName: a.name, awayId: b.id, awayName: b.name, teamIds: [a.id, b.id], round, group: group || '', roundLabel: label || `Round ${round}`, start: new Date(base + offset * dayMs).toISOString(), venue: t.venue, status: 'scheduled', createdAt: c.now });
      };
      const roundRobin = (list, group, offset = 0, legs = 1) => {
        const pool = [...list]; if (pool.length % 2) pool.push(null);
        const n = pool.length; let count = 0;
        for (let leg = 0; leg < legs; leg++) {
          const ring = [...pool];
          for (let r = 0; r < n - 1; r++) {
            for (let i = 0; i < n / 2; i++) {
              const a = ring[i], b = ring[n - 1 - i];
              if (a && b) { add(leg ? b : a, leg ? a : b, leg * (n - 1) + r + 1, group, `${group ? `Group ${group} · ` : ''}Round ${leg * (n - 1) + r + 1}`, offset + (leg * (n - 1) + r) * 7); count++; }
            }
            ring.splice(1, 0, ring.pop());
          }
        }
        return count;
      };
      let made = 0;
      const initTable = (list, g) => list.reduce((acc, e) => { acc[e.id] = { name: e.name, group: g || '', played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, points: 0 }; return acc; }, {});
      let standings = {};
      if (t.format === 'knockout') {
        const size = 2 ** Math.ceil(Math.log2(seeded.length)), byes = size - seeded.length;
        const players = seeded.slice(byes); /* Top seeds receive byes; byes are carried into round 2. */
        for (let i = 0; i < players.length / 2; i++) { add(players[i], players[players.length - 1 - i], 1, '', size === 2 ? 'Final' : size === 4 ? 'Semi-final' : size === 8 ? 'Quarter-final' : `Round of ${size}`, 0); made++; }
        c.tx.update('tournaments', t.id, { byes: seeded.slice(0, byes), bracketSize: size, status: 'running', currentRound: 1 });
      } else if (t.format === 'groups') {
        const groupCount = Math.max(2, Math.round(seeded.length / 4)), groups = Array.from({ length: groupCount }, () => []);
        seeded.forEach((e, i) => groups[i % groupCount].push(e));
        groups.forEach((g, i) => { const label = String.fromCharCode(65 + i); made += roundRobin(g, label); standings = { ...standings, ...initTable(g, label) }; });
        c.tx.update('tournaments', t.id, { status: 'running', standings });
      } else {
        made = roundRobin(seeded, '', 0, t.format === 'league' ? 2 : 1);
        c.tx.update('tournaments', t.id, { status: 'running', standings: initTable(seeded) });
      }
      audit(c, 'tournament.fixtures', t.id, { fixtures: made });
      return { fixtures: made };
    },
    async recordIndividualResult(c, p) {
      await me(c);
      const t = await c.tx.get('tournaments', str(p.id, 'Tournament')), role = await adminOf(c);
      need(t && (t.organiserId === c.uid || (t.officialIds || []).includes(c.uid) || can(role, 'tournaments')), 'permission-denied', 'Only the organiser or officials can record results.');
      const entrantId = str(p.entrantId, 'Entrant'), reg = await c.tx.get('tournamentRegistrations', `${t.id}_${entrantId}`);
      need(reg && reg.status === 'confirmed', 'failed-precondition', 'This entrant is not confirmed.');
      const value = num(p.value, 'Result', 0, 1e9);
      const board = [...(t.leaderboard || []).filter(x => x.id !== entrantId), { id: entrantId, name: reg.entrantName, value }].sort((a, b) => t.lowerIsBetter ? a.value - b.value : b.value - a.value);
      c.tx.update('tournaments', t.id, { leaderboard: board, status: 'running' });
      if (reg.type === 'individual' && await c.tx.get('playerProfiles', entrantId)) {
        c.tx.set('playerStatistics', `${t.id}_${entrantId}`, { id: `${t.id}_${entrantId}`, uid: entrantId, sportId: t.sportId, fields: { event: t.name, [t.metricLabel || 'result']: value }, source: 'verified', verifiedBy: c.uid, date: c.now, note: `Competition: ${t.name}`, createdAt: c.now });
      }
      return { ok: true };
    },
    async publishWinner(c, p) {
      await me(c);
      const t = await c.tx.get('tournaments', str(p.id, 'Tournament')), role = await adminOf(c);
      need(t && (t.organiserId === c.uid || can(role, 'tournaments')), 'permission-denied', 'Only the organiser can publish winners.');
      c.tx.update('tournaments', t.id, { winner: str(p.winner, 'Winner', 100), status: 'finished' });
      audit(c, 'tournament.winner', t.id, { winner: p.winner });
      return { ok: true };
    },

    /* ===== Coaches ===== */
    async submitCoachApplication(c, p) {
      const u = await me(c), players = (Array.isArray(p.players) ? p.players : []).map(x => ({ name: clean(x.name), sportId: clean(x.sportId), position: clean(x.position), age: Number(x.age) || 0, memberId: clean(x.memberId).toUpperCase() })).filter(x => x.name);
      need(new Set(players.map(x => x.name.toLowerCase())).size >= 3, 'failed-precondition', 'A coach application needs at least three different players.');
      const ex = await c.tx.get('coachApplications', c.uid);
      need(!ex || ['rejected', 'info_required'].includes(ex.status), 'already-exists', 'You already have an application on file.');
      const sports = arr(p.sports, 12);
      need(sports.length, 'invalid-argument', 'Choose at least one sport specialisation.');
      c.tx.set('coachApplications', c.uid, { id: c.uid, uid: c.uid, name: str(p.name || u.name, 'Name', 80), phone: str(p.phone, 'Phone', 30), email: str(p.email, 'Email', 120, false), county: str(p.county, 'County', 60), area: str(p.area, 'Operating area', 80, false), sports, experienceYears: num(p.experienceYears ?? 0, 'Experience', 0, 70), experience: text(p.experience, 'Experience', 1000), qualifications: text(p.qualifications, 'Qualifications', 800), certificates: arr(p.certificates, 10), academy: str(p.academy, 'Affiliation', 100, false), documents: arr(p.documents, 10).map(media).filter(Boolean), players, status: 'pending', submittedAt: c.now });
      c.tx.update('users', c.uid, { roles: withRole(u, 'coach_applicant') });
      notify(c, c.uid, 'verification', 'Coach application received', 'Our team will review your qualifications and let you know the outcome.', '/app/coach');
      await notifyAdmins(c, 'verify', 'verification', 'New coach application', `${u.name} applied to coach.`, '/admin/coaches');
      audit(c, 'coach.apply', c.uid, { players: players.length });
      return { status: 'pending' };
    },
    async reviewCoachApplication(c, p) {
      await requirePerm(c, 'verify');
      const a = await c.tx.get('coachApplications', str(p.uid, 'Applicant')), decision = oneOf(p.decision, ['approved', 'rejected', 'suspended', 'info_required'], 'Decision'), note = text(p.note, 'Note', 500);
      need(a, 'not-found', 'Application not found.');
      const u = await c.tx.get('users', a.uid);
      c.tx.update('coachApplications', a.uid, { status: decision, reviewNote: note, reviewedAt: c.now, reviewedBy: c.uid });
      if (decision === 'approved') {
        c.tx.set('coaches', a.uid, { id: a.uid, uid: a.uid, name: a.name, photo: u.photo || '', county: a.county, area: a.area, sports: a.sports, experienceYears: a.experienceYears, bio: a.experience, qualifications: a.qualifications, academy: a.academy, accepting: true, verified: true, playerCount: a.players.length, approvedAt: c.now, searchTokens: tokens(a.name, a.county, a.area, a.academy) });
        for (const pl of a.players) {
          const rid = c.nid('ros'), linked = pl.memberId ? (await c.tx.query('users', { where: [['memberId', '==', pl.memberId]], limit: 1 }))[0] : null;
          c.tx.set('coachRoster', rid, { id: rid, coachId: a.uid, name: pl.name, sportId: pl.sportId, position: pl.position, age: pl.age, uid: linked ? linked.id : '', notes: [], metrics: [], status: 'active', addedAt: c.now });
          if (linked) c.tx.update('playerProfiles', linked.id, { coachId: a.uid });
        }
        c.tx.update('users', a.uid, { roles: withRole(u, 'coach').filter(r => r !== 'coach_applicant') });
      } else if (decision === 'suspended') {
        if (await c.tx.get('coaches', a.uid)) c.tx.update('coaches', a.uid, { verified: false, accepting: false });
        c.tx.update('users', a.uid, { roles: (u.roles || []).filter(r => r !== 'coach') });
      }
      notify(c, a.uid, 'verification', `Coach application ${decision.replace('_', ' ')}`, note || 'Review complete.', '/app/coach');
      audit(c, `coach.${decision}`, a.uid, { note });
      return { ok: true };
    },
    async updateCoach(c, p) {
      await me(c);
      const co = await c.tx.get('coaches', c.uid);
      need(co && co.verified, 'permission-denied', 'Verified coach privileges are required.');
      const patch = {};
      if (p.accepting !== undefined) patch.accepting = !!p.accepting;
      if (p.bio !== undefined) patch.bio = text(p.bio, 'Bio', 1000);
      if (p.academy !== undefined) patch.academy = str(p.academy, 'Academy', 100, false);
      c.tx.update('coaches', c.uid, patch);
      return { ok: true };
    },
    async rosterAdd(c, p) {
      await me(c);
      const co = await c.tx.get('coaches', c.uid);
      need(co && co.verified, 'permission-denied', 'Verified coach privileges are required.');
      const id = c.nid('ros'), memberId = clean(p.memberId).toUpperCase(), linked = memberId ? (await c.tx.query('users', { where: [['memberId', '==', memberId]], limit: 1 }))[0] : null;
      c.tx.set('coachRoster', id, { id, coachId: c.uid, name: str(linked ? linked.name : p.name, 'Player name', 80), sportId: str(p.sportId, 'Sport'), position: str(p.position, 'Position', 40, false), age: Number(p.age) || 0, uid: linked ? linked.id : '', notes: [], metrics: [], status: 'active', addedAt: c.now });
      c.tx.update('coaches', c.uid, { playerCount: (co.playerCount || 0) + 1 });
      if (linked) { c.tx.update('playerProfiles', linked.id, { coachId: c.uid }); notify(c, linked.id, 'coach', 'Added to a coach roster', `${co.name} added you to their roster.`, `/coaches/${c.uid}`); }
      return { id };
    },
    async rosterUpdate(c, p) {
      await me(c);
      const r = await c.tx.get('coachRoster', str(p.id, 'Roster entry'));
      need(r && r.coachId === c.uid, 'permission-denied', 'This player is not on your roster.');
      const patch = {};
      if (p.note) patch.notes = [...(r.notes || []), { text: text(p.note, 'Note', 500), at: c.now }].slice(-30);
      if (p.metric) patch.metrics = [...(r.metrics || []), { label: str(p.metric, 'Metric', 60), value: str(p.value, 'Value', 40), at: c.now }].slice(-40);
      if (p.remove) {
        patch.status = 'removed';
        const co = await c.tx.get('coaches', c.uid);
        c.tx.update('coaches', c.uid, { playerCount: Math.max(0, (co.playerCount || 1) - 1) });
      }
      c.tx.update('coachRoster', r.id, patch);
      return { ok: true };
    },
    async requestCoach(c, p) {
      const u = await me(c), co = await c.tx.get('coaches', str(p.coachId, 'Coach'));
      need(co && co.verified, 'not-found', 'This coach is not verified.');
      need(co.accepting, 'failed-precondition', 'This coach is not accepting players right now.');
      const id = `${co.id}_${c.uid}`;
      need(!(await c.tx.get('coachRequests', id)), 'already-exists', 'You have already contacted this coach.');
      c.tx.set('coachRequests', id, { id, coachId: co.id, uid: c.uid, name: u.name, memberId: u.memberId, message: text(p.message, 'Message', 400), status: 'pending', at: c.now });
      notify(c, co.id, 'coach', 'New player request', `${u.name} would like to train with you.`, '/app/coach/roster');
      return { ok: true };
    },
    async reviewCoachRequest(c, p) {
      await me(c);
      const r = await c.tx.get('coachRequests', str(p.id, 'Request'));
      need(r && r.coachId === c.uid && r.status === 'pending', 'failed-precondition', 'This request is closed.');
      c.tx.update('coachRequests', r.id, { status: p.approve ? 'approved' : 'declined' });
      if (p.approve) {
        const rid = c.nid('ros'), prof = await c.tx.get('playerProfiles', r.uid), co = await c.tx.get('coaches', c.uid);
        c.tx.set('coachRoster', rid, { id: rid, coachId: c.uid, name: r.name, sportId: (prof && prof.sports && prof.sports[0]) || (co.sports && co.sports[0]) || '', position: '', age: 0, uid: r.uid, notes: [], metrics: [], status: 'active', addedAt: c.now });
        c.tx.update('coaches', c.uid, { playerCount: (co.playerCount || 0) + 1 });
        if (prof) c.tx.update('playerProfiles', r.uid, { coachId: c.uid });
      }
      notify(c, r.uid, 'coach', p.approve ? 'Coach accepted your request' : 'Coach declined your request', '', `/coaches/${c.uid}`);
      return { ok: true };
    },

    /* ===== Verification of organisers & scouts ===== */
    async submitVerification(c, p) {
      const u = await me(c), kind = oneOf(p.kind, ['organisation', 'scout'], 'Type');
      const id = `${kind}_${c.uid}`, ex = await c.tx.get('verificationRequests', id);
      need(!ex || ['rejected', 'info_required'].includes(ex.status), 'already-exists', 'You already have an application on file.');
      c.tx.set('verificationRequests', id, { id, uid: c.uid, name: u.name, kind, orgName: str(p.orgName, 'Organisation name', 100), county: str(p.county, 'County', 60), contactPhone: str(p.contactPhone, 'Phone', 30), description: text(p.description, 'Description', 1000), credentials: text(p.credentials, 'Credentials', 800), status: 'pending', submittedAt: c.now });
      notify(c, c.uid, 'verification', 'Application received', 'We will review your application and let you know the outcome.', '/app/settings');
      await notifyAdmins(c, 'verify', 'verification', 'New verification request', `${u.name} submitted a verification request.`, '/admin/verify');
      audit(c, 'verification.submit', id);
      return { id };
    },
    async reviewVerification(c, p) {
      await requirePerm(c, 'verify');
      const v = await c.tx.get('verificationRequests', str(p.id, 'Request')), decision = oneOf(p.decision, ['approved', 'rejected', 'info_required'], 'Decision');
      need(v, 'not-found', 'Request not found.');
      const u = await c.tx.get('users', v.uid);
      c.tx.update('verificationRequests', v.id, { status: decision, reviewNote: text(p.note, 'Note', 500), reviewedAt: c.now });
      if (decision === 'approved') {
        const role = v.kind === 'organisation' ? 'organiser' : 'scout';
        c.tx.update('users', v.uid, { roles: withRole(u, role) });
        if (v.kind === 'organisation') c.tx.set('organisations', v.uid, { id: v.uid, name: v.orgName, county: v.county, description: v.description, verified: true, ownerId: v.uid, searchTokens: tokens(v.orgName, v.county) });
      }
      notify(c, v.uid, 'verification', `${v.kind === 'organisation' ? 'Organisation' : 'Scout'} application ${decision.replace('_', ' ')}`, '', '/app');
      audit(c, `verification.${decision}`, v.id);
      return { ok: true };
    },
    async reviewGuardianConsent(c, p) {
      await requirePerm(c, 'verify');
      const uid = str(p.uid, 'Player'), prof = await c.tx.get('playerProfiles', uid), priv = await c.tx.get('usersPrivate', uid);
      need(prof && prof.isMinor, 'failed-precondition', 'This player is not a minor.');
      c.tx.update('playerProfiles', uid, { guardianVerified: !!p.approve });
      c.tx.update('usersPrivate', uid, { guardian: { ...priv.guardian, verified: !!p.approve, verifiedAt: c.now, verifiedBy: c.uid } });
      notify(c, uid, 'verification', p.approve ? 'Guardian consent confirmed' : 'Guardian consent not confirmed', '', '/app/profile');
      audit(c, 'guardian.review', uid, { approve: !!p.approve });
      return { ok: true };
    },

    /* ===== Marketplace ===== */
    async submitVendor(c, p) {
      const u = await me(c), ex = await c.tx.get('vendors', c.uid);
      need(!ex || ['rejected', 'info_required'].includes(ex.status), 'already-exists', 'You already have a vendor application on file.');
      c.tx.set('vendors', c.uid, { id: c.uid, ownerId: c.uid, ownerName: u.name, businessName: str(p.businessName, 'Business name', 100), description: text(p.description, 'Description', 1000, true), county: str(p.county, 'County', 60), town: str(p.town, 'Town', 80), contactPhone: str(p.contactPhone, 'Phone', 30), kraPin: str(p.kraPin, 'KRA PIN', 20, false), logo: media(p.logo), status: 'pending', submittedAt: c.now });
      c.tx.update('users', c.uid, { roles: withRole(u, 'vendor_applicant') });
      notify(c, c.uid, 'verification', 'Store application received', 'We will review your store details and let you know the outcome.', '/app/store');
      await notifyAdmins(c, 'vendors', 'verification', 'New store application', `${u.name} applied to open a store.`, '/admin/vendors');
      audit(c, 'vendor.submit', c.uid);
      return { status: 'pending' };
    },
    async reviewVendor(c, p) {
      await requirePerm(c, 'vendors');
      const v = await c.tx.get('vendors', str(p.uid, 'Vendor')), decision = oneOf(p.decision, ['approved', 'rejected', 'suspended', 'info_required'], 'Decision'), note = text(p.note, 'Note', 500);
      need(v, 'not-found', 'Vendor not found.');
      const u = await c.tx.get('users', v.ownerId);
      c.tx.update('vendors', v.id, { status: decision, reviewNote: note, reviewedAt: c.now });
      if (decision === 'approved') {
        if (!(await c.tx.get('stores', v.id))) c.tx.set('stores', v.id, { id: v.id, vendorId: v.id, name: v.businessName, logo: v.logo || '', cover: '', description: v.description, county: v.county, town: v.town, verified: true, active: true, rating: 0, reviewCount: 0, productCount: 0, createdAt: c.now, searchTokens: tokens(v.businessName, v.county, v.town) });
        else c.tx.update('stores', v.id, { verified: true, active: true });
        c.tx.update('users', v.ownerId, { roles: withRole(u, 'vendor').filter(r => r !== 'vendor_applicant') });
      } else if (decision === 'suspended' && await c.tx.get('stores', v.id)) c.tx.update('stores', v.id, { active: false, verified: false });
      notify(c, v.ownerId, 'verification', `Vendor application ${decision.replace('_', ' ')}`, note, '/app/store');
      audit(c, `vendor.${decision}`, v.id, { note });
      return { ok: true };
    },
    async updateStore(c, p) {
      await me(c);
      const st = await c.tx.get('stores', c.uid);
      need(st, 'permission-denied', 'An approved storefront is required.');
      const patch = {};
      if (p.name !== undefined) patch.name = str(p.name, 'Store name', 100);
      if (p.description !== undefined) patch.description = text(p.description, 'Description', 1000);
      if (p.logo !== undefined) patch.logo = media(p.logo);
      if (p.cover !== undefined) patch.cover = media(p.cover);
      if (p.promotion !== undefined) patch.promotion = str(p.promotion, 'Promotion', 120, false);
      c.tx.update('stores', c.uid, patch);
      return { ok: true };
    },
    async upsertProduct(c, p) {
      await me(c);
      const st = await c.tx.get('stores', c.uid), s = await settings(c);
      need(st && st.active, 'permission-denied', 'An approved storefront is required to list products.');
      const id = p.id || c.nid('prd'), ex = p.id ? await c.tx.get('products', p.id) : null;
      if (p.id) need(ex && ex.vendorId === c.uid, 'permission-denied', 'This is not your product.');
      const title = str(p.title, 'Product name', 120), price = num(p.price, 'Price', 1, 1e7), sale = p.salePrice ? num(p.salePrice, 'Sale price', 1, 1e7) : 0;
      need(!sale || sale < price, 'invalid-argument', 'Sale price must be below the regular price.');
      const doc = { id, vendorId: c.uid, storeId: st.id, storeName: st.name, title, category: str(p.category, 'Category', 60), sportId: str(p.sportId, 'Sport', 40, false), description: text(p.description, 'Description', 2000), price, salePrice: sale, sizes: arr(p.sizes, 20), colours: arr(p.colours, 20), stock: Math.trunc(num(p.stock, 'Stock', 0, 100000)), photo: media(p.photo), status: ex ? (ex.status === 'rejected' ? 'pending' : ex.status) : (s.autoApproveProducts ? 'active' : 'pending'), rating: ex ? ex.rating : 0, reviewCount: ex ? ex.reviewCount : 0, sold: ex ? ex.sold : 0, createdAt: ex ? ex.createdAt : c.now, updatedAt: c.now, searchTokens: tokens(title, p.category, st.name) };
      c.tx.set('products', id, doc);
      if (!ex) c.tx.update('stores', st.id, { productCount: (st.productCount || 0) + 1 });
      return { id, status: doc.status };
    },
    async removeProduct(c, p) {
      await me(c);
      const pr = await c.tx.get('products', str(p.id, 'Product'));
      need(pr && pr.vendorId === c.uid, 'permission-denied', 'This is not your product.');
      c.tx.update('products', pr.id, { status: 'hidden' });
      return { ok: true };
    },
    async moderateProduct(c, p) {
      await requirePerm(c, 'marketplace');
      const pr = await c.tx.get('products', str(p.id, 'Product')), decision = oneOf(p.decision, ['active', 'rejected', 'hidden'], 'Decision');
      need(pr, 'not-found', 'Product not found.');
      c.tx.update('products', pr.id, { status: decision, moderationNote: text(p.note, 'Note', 300) });
      notify(c, pr.vendorId, 'marketplace', `Product ${decision === 'active' ? 'approved' : decision}`, pr.title, '/app/store/products');
      audit(c, `product.${decision}`, pr.id);
      return { ok: true };
    },
    async placeOrder(c, p) {
      const u = await me(c), s = await settings(c), items = Array.isArray(p.items) ? p.items.slice(0, 30) : [];
      need(c.env.paymentProvider !== 'simulation' || c.env.allowSimulation, 'failed-precondition', 'Online payments are not enabled yet. Please try again soon.');
      need(items.length, 'invalid-argument', 'Your cart is empty.');
      const delivery = { name: str(p.delivery && p.delivery.name, 'Recipient name', 80), phone: str(p.delivery && p.delivery.phone, 'Phone', 30), county: str(p.delivery && p.delivery.county, 'County', 60), address: str(p.delivery && p.delivery.address, 'Delivery location', 200) };
      const byStore = {}, seen = {};
      for (const it of items) {
        const pr = await c.tx.get('products', str(it.productId, 'Product')), qty = Math.trunc(num(it.qty, 'Quantity', 1, 100));
        need(pr && pr.status === 'active', 'failed-precondition', 'One item in your cart is no longer available.');
        seen[pr.id] = (seen[pr.id] || 0) + qty;
        need(pr.stock >= seen[pr.id], 'failed-precondition', `Only ${pr.stock} left of ${pr.title}.`);
        need(pr.vendorId !== c.uid, 'failed-precondition', 'You cannot buy from your own store.');
        const unit = pr.salePrice || pr.price;
        (byStore[pr.storeId] = byStore[pr.storeId] || { store: pr, lines: [] }).lines.push({ productId: pr.id, title: pr.title, unit, qty, size: clean(it.size), colour: clean(it.colour), photo: pr.photo || '', category: pr.category });
      }
      const payId = c.nid('pay'), orderIds = [];
      let grand = 0;
      for (const [storeId, { store, lines }] of Object.entries(byStore)) {
        const id = c.nid('ord'), subtotal = lines.reduce((a, l) => a + l.unit * l.qty, 0), commission = Math.round(subtotal * s.commissionRate);
        grand += subtotal; orderIds.push(id);
        c.tx.set('orders', id, { id, number: genRef(c, 'ORD'), buyerId: c.uid, buyerName: u.name, vendorId: store.vendorId, storeId, storeName: store.storeName, items: lines, subtotal, commission, vendorNet: subtotal - commission, total: subtotal, delivery, status: 'pending_payment', paymentTxId: payId, simulated: c.env.paymentProvider === 'simulation', history: [{ status: 'pending_payment', at: c.now }], createdAt: c.now });
      }
      for (const [pid, qty] of Object.entries(seen)) {
        const pr = await c.tx.get('products', pid);
        c.tx.update('products', pid, { stock: pr.stock - qty, sold: (pr.sold || 0) + qty });
      }
      c.tx.set('paymentTransactions', payId, { id: payId, uid: c.uid, userName: u.name, memberId: u.memberId, type: 'order', orderIds, description: `Marketplace order (${items.length} item${items.length > 1 ? 's' : ''})`, amount: grand, currency: s.currency, provider: c.env.paymentProvider, simulated: c.env.paymentProvider === 'simulation', status: 'pending', ref: genRef(c, c.env.paymentProvider === 'simulation' ? 'SIM' : 'TX'), initiatedAt: c.now });
      return { txId: payId, amount: grand, orderIds, description: 'Marketplace order', currency: s.currency };
    },
    async updateOrderStatus(c, p) {
      await me(c);
      const o = await c.tx.get('orders', str(p.id, 'Order')), status = oneOf(p.status, ['processing', 'shipped', 'delivered', 'completed', 'cancelled', 'disputed'], 'Status'), role = await adminOf(c);
      need(o, 'not-found', 'Order not found.');
      const flow = { vendor: { paid: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'] }, buyer: { delivered: ['completed', 'disputed'], shipped: ['disputed'], completed: [] } };
      const isVendor = o.vendorId === c.uid, isBuyer = o.buyerId === c.uid, isAdmin = can(role, 'orders');
      need(isVendor || isBuyer || isAdmin, 'permission-denied', 'This is not your order.');
      const allowed = [...(isVendor ? flow.vendor[o.status] || [] : []), ...(isBuyer ? flow.buyer[o.status] || [] : []), ...(isAdmin && o.status === 'disputed' ? ['completed', 'cancelled'] : [])];
      need(allowed.includes(status), 'failed-precondition', `An order that is ${o.status.replace('_', ' ')} cannot move to ${status}.`);
      if (status === 'cancelled') await cancelOrderInternal(c, o.id, text(p.note, 'Note', 300) || 'Cancelled');
      else c.tx.update('orders', o.id, { status, history: [...o.history, { status, at: c.now, note: text(p.note, 'Note', 300) }] });
      notify(c, isBuyer ? o.vendorId : o.buyerId, 'order', `Order ${status}`, `Order ${o.number}.`, isBuyer ? '/app/store/orders' : '/app/orders');
      if (status === 'disputed') audit(c, 'order.dispute', o.id);
      return { ok: true };
    },
    async createPayout(c, p) {
      await requirePerm(c, 'orders');
      const vendorId = str(p.vendorId, 'Vendor'), rows = await c.tx.query('orders', { where: [['vendorId', '==', vendorId], ['status', '==', 'completed']], limit: 200 }), due = rows.filter(o => !o.payoutId);
      need(due.length, 'failed-precondition', 'No completed orders await payout.');
      const id = c.nid('pyt'), amount = due.reduce((a, o) => a + o.vendorNet, 0), commission = due.reduce((a, o) => a + o.commission, 0);
      c.tx.set('payouts', id, { id, vendorId, amount, commission, orders: due.length, status: 'paid', simulated: c.env.paymentProvider === 'simulation', at: c.now });
      due.forEach(o => c.tx.update('orders', o.id, { payoutId: id }));
      notify(c, vendorId, 'payout', 'Payout recorded', `KES ${amount} for ${due.length} order(s).`, '/app/store/payouts');
      audit(c, 'payout.create', id, { amount });
      return { id, amount };
    },
    async submitReview(c, p) {
      const u = await me(c), type = oneOf(p.targetType, ['product', 'facility', 'store', 'coach'], 'Review type'), targetId = str(p.targetId, 'Target'), rating = Math.trunc(num(p.rating, 'Rating', 1, 5));
      const id = `${type}_${targetId}_${c.uid}`;
      need(!(await c.tx.get('reviews', id)), 'already-exists', 'You have already reviewed this.');
      if (type === 'product' || type === 'store') {
        const orders = await c.tx.query('orders', { where: [['buyerId', '==', c.uid], ['status', '==', 'completed']], limit: 50 });
        need(orders.some(o => type === 'store' ? o.storeId === targetId : o.items.some(i => i.productId === targetId)), 'failed-precondition', 'Only customers with a completed purchase can leave a review.');
      } else if (type === 'facility') {
        const att = await c.tx.query('sessionBookings', { where: [['uid', '==', c.uid], ['status', '==', 'consumed']], limit: 50 });
        need(att.some(a => a.facilityId === targetId), 'failed-precondition', 'Only members who attended a session here can leave a review.');
      }
      const colMap = { product: 'products', facility: 'facilities', store: 'stores', coach: 'coaches' }, target = await c.tx.get(colMap[type], targetId);
      need(target, 'not-found', 'Not found.');
      c.tx.set('reviews', id, { id, targetType: type, targetId, ownerId: target.vendorId || target.ownerId || target.uid || '', uid: c.uid, name: u.name, rating, text: text(p.text, 'Review', 800), at: c.now });
      const n = (target.reviewCount || 0) + 1;
      c.tx.update(colMap[type], targetId, { reviewCount: n, rating: Math.round((((target.rating || 0) * (n - 1) + rating) / n) * 10) / 10 });
      return { ok: true };
    },

    /* ===== Advertising ===== */
    async submitCampaign(c, p) {
      const u = await me(c), id = c.nid('adv'), start = iso(p.start, 'Start date'), end = iso(p.end, 'End date');
      need(end > start, 'invalid-argument', 'End date must be after the start date.');
      const placements = arr(p.placements, 12);
      need(placements.length, 'invalid-argument', 'Choose at least one preferred placement.');
      const status = p.draft ? 'draft' : 'submitted';
      c.tx.set('advertisingCampaigns', id, { id, ownerId: c.uid, ownerName: u.name, business: str(p.business, 'Business name', 100), title: str(p.title, 'Campaign title', 100), description: text(p.description, 'Description', 400, true), creative: media(p.creative), destination: url(p.destination, 'Destination URL'), start, end, counties: arr(p.counties, 47), sports: arr(p.sports, 30), audience: str(p.audience, 'Audience', 60, false) || 'All members', placements, budget: num(p.budget, 'Budget', 0, 1e9), contact: str(p.contact, 'Contact', 120), status, impressions: 0, clicks: 0, conversions: 0, byPlacement: {}, createdAt: c.now });
      audit(c, 'campaign.submit', id, { status });
      return { id, status };
    },
    async campaignAction(c, p) {
      await me(c);
      const a = await c.tx.get('advertisingCampaigns', str(p.id, 'Campaign')), action = oneOf(p.action, ['submit', 'pause', 'resume'], 'Action');
      need(a && a.ownerId === c.uid, 'permission-denied', 'This is not your campaign.');
      const map = { submit: [['draft', 'rejected'], 'submitted'], pause: [['active'], 'paused'], resume: [['paused'], 'active'] }[action];
      need(map[0].includes(a.status), 'failed-precondition', `A campaign that is ${a.status} cannot do this.`);
      c.tx.update('advertisingCampaigns', a.id, { status: map[1] });
      return { ok: true };
    },
    async reviewCampaign(c, p) {
      await requirePerm(c, 'ads');
      const a = await c.tx.get('advertisingCampaigns', str(p.id, 'Campaign')), decision = oneOf(p.decision, ['pending', 'approved', 'active', 'paused', 'completed', 'rejected'], 'Decision');
      need(a, 'not-found', 'Campaign not found.');
      const patch = { status: decision, reviewNote: text(p.note, 'Note', 400), reviewedAt: c.now };
      if (decision === 'approved' || decision === 'active') {
        need(a.destination || a.creative || a.description, 'failed-precondition', 'Campaign content is incomplete.');
        patch.status = a.start <= c.now && a.end > c.now ? 'active' : 'approved';
        patch.approvedPlacements = arr(p.placements).length ? arr(p.placements) : a.placements;
        patch.bookedRevenue = a.budget;
      }
      c.tx.update('advertisingCampaigns', a.id, patch);
      notify(c, a.ownerId, 'advertising', `Campaign ${patch.status}`, a.title, '/app/ads');
      audit(c, `campaign.${patch.status}`, a.id);
      return { status: patch.status };
    },
    async trackAd(c, p) {
      const a = await c.tx.get('advertisingCampaigns', str(p.id, 'Campaign')), kind = oneOf(p.kind, ['impression', 'click', 'conversion'], 'Kind'), place = str(p.placement, 'Placement', 40);
      if (!a || a.status !== 'active') return { ok: false };
      const byP = { ...(a.byPlacement || {}) }, row = { impressions: 0, clicks: 0, ...(byP[place] || {}) };
      if (kind === 'impression') row.impressions++; if (kind === 'click') row.clicks++;
      byP[place] = row;
      c.tx.update('advertisingCampaigns', a.id, { impressions: (a.impressions || 0) + (kind === 'impression' ? 1 : 0), clicks: (a.clicks || 0) + (kind === 'click' ? 1 : 0), conversions: (a.conversions || 0) + (kind === 'conversion' ? 1 : 0), byPlacement: byP });
      return { ok: true };
    },

    /* ===== Performance & scouting ===== */
    async addStat(c, p) {
      await me(c);
      const id = c.nid('sta'), sport = await c.tx.get('sports', str(p.sportId, 'Sport'));
      need(sport, 'not-found', 'Sport not found.');
      const fields = {};
      (sport.statFields || []).forEach(f => { const v = p.fields && p.fields[f.key]; if (v !== undefined && v !== '') fields[f.key] = f.type === 'number' ? num(v, f.label, 0, 1e9) : str(v, f.label, 60, false); });
      need(Object.keys(fields).length, 'invalid-argument', 'Enter at least one statistic.');
      c.tx.set('playerStatistics', id, { id, uid: c.uid, sportId: sport.id, fields, source: 'self', date: iso(p.date, 'Date'), note: str(p.note, 'Note', 200, false), createdAt: c.now });
      return { id };
    },
    async verifyStat(c, p) {
      const u = await me(c), st = await c.tx.get('playerStatistics', str(p.id, 'Statistic')), role = await adminOf(c);
      need(st, 'not-found', 'Statistic not found.');
      const prof = await c.tx.get('playerProfiles', st.uid);
      need((prof && prof.coachId === c.uid) || (u.roles || []).includes('organiser') || can(role, 'players'), 'permission-denied', "Only the player's coach, a verified organiser or an administrator can verify records.");
      need(st.uid !== c.uid, 'permission-denied', 'You cannot verify your own records.');
      c.tx.update('playerStatistics', st.id, { source: 'verified', verifiedBy: c.uid, verifiedByName: u.name, verifiedAt: c.now });
      audit(c, 'stat.verify', st.id);
      return { ok: true };
    },
    async contactRequest(c, p) {
      const u = await me(c), role = await adminOf(c);
      need(['scout', 'coach', 'organiser'].some(r => (u.roles || []).includes(r)) || role, 'permission-denied', 'Only verified scouts, coaches and organisations can send contact requests.');
      const toUid = str(p.toUid, 'Player'), prof = await c.tx.get('playerProfiles', toUid);
      need(prof, 'not-found', 'Player not found.');
      if (prof.isMinor) need(prof.guardianVerified, 'permission-denied', 'This player is under 18 and has no verified guardian consent. Contact is not possible.');
      const id = `${c.uid}_${toUid}`;
      need(!(await c.tx.get('contactRequests', id)), 'already-exists', 'You have already sent a request to this player.');
      c.tx.set('contactRequests', id, { id, fromUid: c.uid, fromName: u.name, fromRoles: u.roles, toUid, toName: prof.name, message: text(p.message, 'Message', 500, true), viaGuardian: !!prof.isMinor, status: 'pending', participants: [c.uid, toUid], at: c.now });
      notify(c, toUid, 'scouting', prof.isMinor ? 'Contact request for your guardian to review' : 'Scouting contact request', `${u.name} would like to connect.`, '/app/requests');
      audit(c, 'scout.contact_request', toUid);
      return { ok: true };
    },
    async respondContactRequest(c, p) {
      const u = await me(c), r = await c.tx.get('contactRequests', str(p.id, 'Request'));
      need(r && r.toUid === c.uid && r.status === 'pending', 'failed-precondition', 'This request is closed.');
      c.tx.update('contactRequests', r.id, { status: p.accept ? 'accepted' : 'declined' });
      if (p.accept) {
        const cid = 'dm_' + [r.fromUid, r.toUid].sort().join('_');
        if (!(await c.tx.get('conversations', cid))) c.tx.set('conversations', cid, { id: cid, type: 'direct', title: '', members: [r.fromUid, r.toUid], memberNames: { [r.fromUid]: r.fromName, [r.toUid]: u.name }, last: null, unread: {}, readAt: {}, typing: {}, blocked: false, updatedAt: c.now, createdAt: c.now });
        notify(c, r.fromUid, 'scouting', 'Contact request accepted', `${u.name} accepted your request.`, `/app/messages/${cid}`);
      } else notify(c, r.fromUid, 'scouting', 'Contact request declined', '', '/app/scout');
      return { ok: true };
    },

    /* ===== Social ===== */
    async createPost(c, p) {
      const u = await me(c), id = c.nid('pst');
      let author = { type: 'user', id: c.uid, name: u.name };
      if (p.asTeam) { const t = await requireTeamOfficial(c, p.asTeam); author = { type: 'team', id: t.id, name: t.name }; }
      if (p.asFacility) { const f = await facilityFor(c, p.asFacility); need(f.ownerId === c.uid && f.status === 'approved', 'permission-denied', 'Only approved facility owners can post as a facility.'); author = { type: 'facility', id: f.id, name: f.name }; }
      if (p.asCoach) { const co = await c.tx.get('coaches', c.uid); need(co && co.verified, 'permission-denied', 'Verified coach privileges are required.'); author = { type: 'coach', id: co.id, name: co.name }; }
      const body = text(p.text, 'Post', 1500, true);
      c.tx.set('socialPosts', id, { id, authorUid: c.uid, author, kind: oneOf(p.kind || 'update', ['update', 'highlight', 'achievement', 'announcement', 'result', 'event', 'training'], 'Post type'), text: body, photo: media(p.photo), video: url(p.video, 'Video link'), sportId: str(p.sportId, 'Sport', 40, false), visibility: u.isMinor ? 'members' : oneOf(p.visibility || 'public', ['public', 'members', 'followers'], 'Visibility'), likes: 0, comments: 0, shares: 0, status: 'published', at: c.now });
      return { id };
    },
    async deletePost(c, p) {
      await me(c);
      const po = await c.tx.get('socialPosts', str(p.id, 'Post'));
      need(po && po.authorUid === c.uid, 'permission-denied', 'This is not your post.');
      c.tx.update('socialPosts', po.id, { status: 'removed', removedBy: 'author' });
      return { ok: true };
    },
    async commentPost(c, p) {
      const u = await me(c), po = await c.tx.get('socialPosts', str(p.postId, 'Post'));
      need(po && po.status === 'published', 'not-found', 'Post not found.');
      const id = c.nid('cmt');
      c.tx.set('comments', id, { id, postId: po.id, uid: c.uid, name: u.name, text: text(p.text, 'Comment', 600, true), status: 'published', at: c.now });
      c.tx.update('socialPosts', po.id, { comments: (po.comments || 0) + 1 });
      if (po.authorUid !== c.uid) notify(c, po.authorUid, 'social', 'New comment', `${u.name} commented on your post.`, `/community#${po.id}`);
      return { id };
    },
    async toggleLike(c, p) {
      await me(c);
      const po = await c.tx.get('socialPosts', str(p.postId, 'Post')), id = `${po.id}_${c.uid}`, ex = await c.tx.get('postLikes', id);
      if (ex) c.tx.del('postLikes', id); else c.tx.set('postLikes', id, { postId: po.id, uid: c.uid, at: c.now });
      c.tx.update('socialPosts', po.id, { likes: Math.max(0, (po.likes || 0) + (ex ? -1 : 1)) });
      return { liked: !ex };
    },
    async sharePost(c, p) {
      await me(c);
      const po = await c.tx.get('socialPosts', str(p.postId, 'Post'));
      need(po, 'not-found', 'Post not found.');
      c.tx.update('socialPosts', po.id, { shares: (po.shares || 0) + 1 });
      return { ok: true };
    },
    async toggleFollow(c, p) {
      const u = await me(c), target = str(p.uid, 'Member'), id = `${c.uid}_${target}`, ex = await c.tx.get('follows', id);
      need(target !== c.uid, 'invalid-argument', 'You cannot follow yourself.');
      if (ex) c.tx.del('follows', id); else { c.tx.set('follows', id, { from: c.uid, to: target, at: c.now }); notify(c, target, 'social', 'New follower', `${u.name} started following you.`, `/players/${c.uid}`); }
      return { following: !ex };
    },
    async reportContent(c, p) {
      const u = await me(c), id = c.nid('rpt');
      c.tx.set('reports', id, { id, targetType: oneOf(p.targetType, ['post', 'comment', 'message', 'user', 'product', 'conversation'], 'Report type'), targetId: str(p.targetId, 'Target', 120), reason: str(p.reason, 'Reason', 300), excerpt: text(p.excerpt, 'Excerpt', 300), reporterId: c.uid, reporterName: u.name, status: 'open', at: c.now });
      return { id };
    },
    async resolveReport(c, p) {
      await requirePerm(c, 'moderation');
      const r = await c.tx.get('reports', str(p.id, 'Report')), action = oneOf(p.action, ['dismiss', 'remove'], 'Action');
      need(r, 'not-found', 'Report not found.');
      if (action === 'remove') {
        if (r.targetType === 'post') c.tx.update('socialPosts', r.targetId, { status: 'removed', removedBy: 'moderator' });
        if (r.targetType === 'comment') c.tx.update('comments', r.targetId, { status: 'removed' });
        if (r.targetType === 'message') c.tx.update('messages', r.targetId, { removed: true, text: '' });
        if (r.targetType === 'product') c.tx.update('products', r.targetId, { status: 'hidden' });
      }
      c.tx.update('reports', r.id, { status: action === 'remove' ? 'actioned' : 'dismissed', resolvedAt: c.now, resolvedBy: c.uid });
      audit(c, `report.${action}`, r.id, { target: r.targetId });
      return { ok: true };
    },
    async moderatePost(c, p) {
      await requirePerm(c, 'moderation');
      const po = await c.tx.get('socialPosts', str(p.id, 'Post'));
      need(po, 'not-found', 'Post not found.');
      c.tx.update('socialPosts', po.id, { status: p.remove ? 'removed' : 'published', removedBy: p.remove ? 'moderator' : '' });
      audit(c, p.remove ? 'post.remove' : 'post.restore', po.id);
      return { ok: true };
    },

    /* ===== Messaging (conversation setup; message delivery is a direct, rules-protected write) ===== */
    async startConversation(c, p) {
      const u = await me(c), type = oneOf(p.type || 'direct', ['direct', 'group', 'team', 'game', 'store', 'booking', 'coach'], 'Conversation type');
      let members = [...new Set([c.uid, ...arr(p.members, 100)])], title = str(p.title, 'Title', 80, false), ctxRef = str(p.contextRef, 'Context', 120, false);
      let id = c.nid('cnv');
      if (type === 'team') {
        const t = await teamFor(c, str(p.teamId, 'Team')), mine = await c.tx.get('teamMembers', `${t.id}_${c.uid}`);
        need(mine && mine.status === 'active', 'permission-denied', 'Only team members can open team chat.');
        members = (await c.tx.query('teamMembers', { where: [['teamId', '==', t.id], ['status', '==', 'active']], limit: 100 })).map(m => m.uid);
        title = `${t.name} · Team chat`; id = `team_${t.id}`; ctxRef = t.id;
      } else if (type === 'game') {
        const g = await c.tx.get('games', str(p.gameId, 'Game')), mine = await c.tx.get('gameParticipants', `${p.gameId}_${c.uid}`);
        need(g && (g.hostId === c.uid || (mine && mine.status === 'confirmed')), 'permission-denied', 'Only confirmed participants can open game chat.');
        members = (await c.tx.query('gameParticipants', { where: [['gameId', '==', g.id], ['status', '==', 'confirmed']], limit: 100 })).map(m => m.uid);
        title = `${g.title} · Players`; id = `game_${g.id}`; ctxRef = g.id;
      } else if (type !== 'group') {
        need(members.length === 2, 'invalid-argument', 'Choose one person to message.');
        id = (type === 'direct' ? 'dm_' : `${type}_`) + [...members].sort().join('_');
        const other = members.find(x => x !== c.uid), op = await c.tx.get('playerProfiles', other);
        if (op && op.isMinor) {
          const isCoach = op.coachId === c.uid;
          let official = false;
          for (const tid of op.teamIds || []) { const t = await c.tx.get('teams', tid); if (t && isTeamOfficial(t, c.uid)) official = true; }
          need(isCoach || official, 'permission-denied', 'Only their coach or team officials can message a player under 18.');
        }
        const blk = await c.tx.get('blocks', `${other}_${c.uid}`);
        need(!blk, 'permission-denied', 'You cannot message this member.');
      }
      const existing = await c.tx.get('conversations', id);
      if (existing) {
        if (type === 'team' || type === 'game') c.tx.update('conversations', id, { members, memberNames: { ...existing.memberNames, [c.uid]: u.name } });
        return { id };
      }
      const names = { [c.uid]: u.name };
      for (const m of members) if (!names[m]) { const mu = await c.tx.get('users', m); names[m] = mu ? mu.name : 'Member'; }
      c.tx.set('conversations', id, { id, type, title, members, admins: type === 'group' ? [c.uid] : [], memberNames: names, contextRef: ctxRef, last: null, unread: {}, readAt: {}, typing: {}, blocked: false, updatedAt: c.now, createdAt: c.now });
      return { id };
    },
    async manageGroup(c, p) {
      await me(c);
      const cv = await c.tx.get('conversations', str(p.id, 'Conversation'));
      need(cv && cv.type === 'group' && (cv.admins || []).includes(c.uid), 'permission-denied', 'Only group admins can manage members.');
      let members = cv.members, names = { ...cv.memberNames };
      if (p.addMemberId) {
        const f = (await c.tx.query('users', { where: [['memberId', '==', clean(p.addMemberId).toUpperCase()]], limit: 1 }))[0];
        need(f, 'not-found', 'No member with that SportsHub ID.');
        const fp = await c.tx.get('playerProfiles', f.id);
        need(!(fp && fp.isMinor), 'permission-denied', 'Players under 18 cannot be added to open groups.');
        members = [...new Set([...members, f.id])]; names[f.id] = f.name;
      }
      if (p.removeUid) { need(p.removeUid !== c.uid, 'invalid-argument', 'Leave the group instead.'); members = members.filter(m => m !== p.removeUid); }
      c.tx.update('conversations', cv.id, { members, memberNames: names });
      return { ok: true };
    },
    async toggleBlock(c, p) {
      await me(c);
      const target = str(p.uid, 'Member'), id = `${c.uid}_${target}`, ex = await c.tx.get('blocks', id), cid = 'dm_' + [c.uid, target].sort().join('_'), cv = await c.tx.get('conversations', cid), reverse = await c.tx.get('blocks', `${target}_${c.uid}`);
      if (ex) c.tx.del('blocks', id); else c.tx.set('blocks', id, { from: c.uid, to: target, at: c.now });
      if (cv) c.tx.update('conversations', cid, { blocked: !ex || !!reverse });
      audit(c, ex ? 'user.unblock' : 'user.block', target);
      return { blocked: !ex };
    },

    /* ===== Administration ===== */
    async setUserStatus(c, p) {
      await requirePerm(c, 'users');
      const uid = str(p.uid, 'User'), status = oneOf(p.status, ['active', 'suspended'], 'Status');
      need(uid !== c.uid, 'failed-precondition', 'You cannot change your own account status.');
      const target = await c.tx.get('adminRoles', uid), mine = await adminOf(c);
      need(!target || mine === 'super', 'permission-denied', 'Only a Super Administrator can suspend another administrator.');
      c.tx.update('users', uid, { status, statusReason: text(p.reason, 'Reason', 300) });
      notify(c, uid, 'account', status === 'suspended' ? 'Account suspended' : 'Account restored', text(p.reason, 'Reason', 300), '/app/settings');
      audit(c, `user.${status}`, uid, { reason: p.reason });
      return { ok: true };
    },
    async assignAdminRole(c, p) {
      await requirePerm(c, 'roles');
      const uid = str(p.uid, 'User'), role = p.role ? oneOf(p.role, Object.keys(ADMIN_ROLES), 'Role') : null, target = await c.tx.get('users', uid);
      need(target, 'not-found', 'User not found.');
      need(uid !== c.uid, 'failed-precondition', 'You cannot change your own administrator role.');
      if (role) { c.tx.set('adminRoles', uid, { id: uid, uid, name: target.name, role, assignedBy: c.uid, at: c.now }); c.tx.update('users', uid, { roles: withRole(target, 'admin') }); }
      else { c.tx.del('adminRoles', uid); c.tx.update('users', uid, { roles: (target.roles || []).filter(r => r !== 'admin') }); }
      notify(c, uid, 'account', role ? `Administrator role: ${ADMIN_ROLES[role].label}` : 'Administrator role removed', '', '/admin');
      audit(c, 'admin.role', uid, { role });
      return { ok: true };
    },
    async upsertSport(c, p) {
      await requirePerm(c, 'sports');
      const name = str(p.name, 'Sport name', 60), id = p.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const ex = await c.tx.get('sports', id);
      const stat = (Array.isArray(p.statFields) ? p.statFields : []).slice(0, 12).map(f => ({ key: clean(f.key).toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: clean(f.label), type: f.type === 'text' ? 'text' : 'number', unit: clean(f.unit) })).filter(f => f.key && f.label);
      c.tx.set('sports', id, { ...(ex || {}), id, name, color: oneOf(p.color || (ex && ex.color) || 'blue', ['blue', 'green', 'magenta', 'yellow'], 'Identity colour'), icon: str(p.icon, 'Icon', 40, false) || (ex && ex.icon) || 'trophy', photo: p.photo !== undefined ? media(p.photo) : (ex ? ex.photo : ''), type: oneOf(p.type || 'team', ['team', 'individual', 'both'], 'Classification'), disciplines: arr(p.disciplines), positions: arr(p.positions), formats: arr(p.formats), teamSizes: arr(p.teamSizes), ageCategories: arr(p.ageCategories), skillLevels: arr(p.skillLevels).length ? arr(p.skillLevels) : ['Beginner', 'Recreational', 'Intermediate', 'Advanced', 'Elite'], durationMinutes: num(p.durationMinutes ?? 60, 'Duration', 1, 1440), scoring: str(p.scoring, 'Scoring', 200, false), statFields: stat, facilityRequirements: arr(p.facilityRequirements), competitionFormats: arr(p.competitionFormats), active: p.active !== false, updatedAt: c.now });
      audit(c, ex ? 'sport.update' : 'sport.create', id);
      return { id };
    },
    async updateSettings(c, p) {
      await requirePerm(c, 'config');
      const cur = await settings(c), patch = {};
      [['registrationFee', 0, 1e6], ['membershipFee', 0, 1e6], ['sessionsPerPeriod', 1, 60], ['settlementRatePerSession', 0, 1e6], ['cancelWindowHours', 0, 72], ['strikeLimit', 1, 20], ['restrictDays', 0, 90], ['maxTransferCredits', 0, 60]].forEach(([k, a, b]) => { if (p[k] !== undefined && p[k] !== '') patch[k] = num(p[k], k, a, b); });
      if (p.commissionRate !== undefined && p.commissionRate !== '') patch.commissionRate = num(p.commissionRate, 'Commission rate', 0, 1);
      if (p.autoApproveProducts !== undefined) patch.autoApproveProducts = !!p.autoApproveProducts;
      if (p.mpesaNumber !== undefined) { const n = clean(p.mpesaNumber).replace(/\s+/g, ''); need(/^(\+?254|0)?[17]\d{8}$/.test(n), 'invalid-argument', 'Enter a valid Safaricom number for M-Pesa payments.'); patch.mpesaNumber = n; }
      if (p.mpesaName !== undefined) patch.mpesaName = str(p.mpesaName, 'M-Pesa account name', 60, false);
      c.tx.set('systemSettings', 'platform', { ...cur, ...patch });
      audit(c, 'settings.update', 'platform', { before: Object.fromEntries(Object.keys(patch).map(k => [k, cur[k]])), after: patch });
      return { ok: true };
    },
    async setFeatured(c, p) {
      await requirePerm(c, 'featured');
      const cur = (await c.tx.get('systemSettings', 'homepage')) || {}, section = oneOf(p.section, ['games', 'teams', 'facilities', 'tournaments', 'products', 'athletes', 'posts', 'coaches'], 'Section');
      c.tx.set('systemSettings', 'homepage', { ...cur, [section]: arr(p.ids, 12) });
      audit(c, 'homepage.featured', section, { ids: p.ids });
      return { ok: true };
    },
    async sendAnnouncement(c, p) {
      const { user } = await requirePerm(c, 'notifications');
      const id = c.nid('ann'), audience = oneOf(p.audience || 'all', ['all', 'player', 'captain', 'coach', 'vendor', 'facility', 'organiser'], 'Audience'), title = str(p.title, 'Title', 100), body = text(p.body, 'Message', 1000, true);
      const q = audience === 'all' ? { where: [['status', '==', 'active']], limit: 450 } : { where: [['roles', 'array-contains', audience]], limit: 450 };
      const rows = await c.tx.query('users', q);
      rows.forEach(r => notify(c, r.id, 'announcement', title, body, '/app/notifications'));
      c.tx.set('announcements', id, { id, title, body, audience, by: user.name, recipients: rows.length, at: c.now });
      audit(c, 'announcement.send', id, { audience, recipients: rows.length });
      return { recipients: rows.length };
    },
    async logExport(c, p) { await requirePerm(c, 'reports'); audit(c, 'report.export', str(p.name, 'Report', 80), { rows: p.rows }); return { ok: true }; }
  };

  /* ----- Tournament result application (standings and knockout progress) ----- */
  async function applyTournamentResult(c, t, f, hs, as) {
    if (t.format === 'knockout') {
      need(hs !== as, 'invalid-argument', 'A knockout match needs a winner. Enter the deciding score.');
      const roundFx = await c.tx.query('fixtures', { where: [['tournamentId', '==', t.id], ['round', '==', f.round]], limit: 256 });
      const done = roundFx.map(x => x.id === f.id ? { ...x, status: 'completed', homeScore: hs, awayScore: as } : x);
      if (done.every(x => x.status === 'completed')) {
        const winners = done.map(x => x.homeScore > x.awayScore ? { id: x.homeId, name: x.homeName } : { id: x.awayId, name: x.awayName });
        const pool = f.round === 1 ? [...(t.byes || []), ...winners] : winners;
        if (pool.length === 1) { c.tx.update('tournaments', t.id, { winner: pool[0].name, status: 'finished' }); notify(c, t.organiserId, 'tournament', 'Competition complete', `${pool[0].name} won ${t.name}.`, `/tournaments/${t.id}`); return; }
        const round = f.round + 1, label = pool.length === 2 ? 'Final' : pool.length === 4 ? 'Semi-final' : pool.length === 8 ? 'Quarter-final' : `Round of ${pool.length}`;
        for (let i = 0; i < pool.length / 2; i++) {
          const fid = c.nid('fix'), a = pool[i], b = pool[pool.length - 1 - i];
          c.tx.set('fixtures', fid, { id: fid, kind: 'tournament', tournamentId: t.id, tournamentName: t.name, sportId: t.sportId, homeId: a.id, homeName: a.name, awayId: b.id, awayName: b.name, teamIds: [a.id, b.id], round, group: '', roundLabel: label, start: new Date(new Date(f.start).getTime() + 7 * 864e5).toISOString(), venue: t.venue, status: 'scheduled', createdAt: c.now });
        }
        c.tx.update('tournaments', t.id, { currentRound: round });
      }
      return;
    }
    const table = { ...(t.standings || {}) };
    [[f.homeId, hs, as], [f.awayId, as, hs]].forEach(([id, gf, ga]) => {
      const r = { ...(table[id] || { name: id === f.homeId ? f.homeName : f.awayName, played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, points: 0 }) };
      r.played++; r.for += gf; r.against += ga;
      if (gf > ga) { r.won++; r.points += 3; } else if (gf === ga) { r.drawn++; r.points += 1; } else r.lost++;
      table[id] = r;
    });
    c.tx.update('tournaments', t.id, { standings: table });
  }

  return { ops, OpError, ADMIN_ROLES, can, tokens, DEFAULT_SETTINGS, remaining, available, addMonth, hourStamps, ageOn, PUBLIC_OPS: ['trackAd'] };
})();
export default TrustedOps;
