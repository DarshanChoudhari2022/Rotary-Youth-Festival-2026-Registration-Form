const { timedHandler } = require('../lib/performance');
const { timedFetch } = require('../lib/performance');
const { integerSetting } = require('../lib/performance');
const { db } = require('../lib/tickets');
const { enabled: easebuzzEnabled, reconcile } = require('../lib/easebuzz');
const { uuid, staffRoles, rpc, staffFor, inAllowlist } = require('../lib/staff');
const string = value => typeof value === 'string' ? value.trim() : '';
const emailPattern = /^[^\s@]+@[^\s@]+$/;

async function overviewWithoutMigration() {
  const days = ['21', '22'].map(day => ({ day: '2026-11-' + day, registrations: 0, participants: 0,
    paid: 0, under_16: 0, paid_under_16: 0, collected: 0 }));
  let participants = 0;
  let directoryParticipants = 0;
  let received = 0;
  let tickets = 0;
  let under16 = 0;
  let after = '';
  for (;;) {
    const rows = await db('registrations?select=id,visit,checkout_test,status,amount_paise,festival_payments(amount_paise,revoked_at),registration_participants(date_of_birth,festival_tickets(id,revoked_at))' +
      '&order=id.asc&limit=500' + after);
    for (const booking of rows) {
      for (const payment of [booking.festival_payments].flat()) {
        if (payment && !payment.revoked_at) received += payment.amount_paise;
      }
      directoryParticipants += booking.registration_participants.length;
      if (booking.checkout_test || booking.visit === 'demo') continue;
      const visits = days.filter(d => booking.visit === 'both' || d.day.endsWith(booking.visit));
      const verified = booking.status === 'paid' && [booking.festival_payments].flat().some(p =>
        p && !p.revoked_at && p.amount_paise === booking.amount_paise);
      participants += booking.registration_participants.length;
      for (const day of visits) {
        day.registrations++;
        day.participants += booking.registration_participants.length;
        if (verified) day.collected += booking.amount_paise / visits.length;
      }
      for (const person of booking.registration_participants) {
        const active = verified && [person.festival_tickets].flat().some(t => t && !t.revoked_at);
        if (active) tickets++;
        if (person.date_of_birth > '2010' + visits[0].day.slice(4)) under16++;
        for (const day of visits) {
          const youth = person.date_of_birth > '2010' + day.day.slice(4);
          if (active) day.paid++;
          if (youth) day.under_16++;
          if (youth && active) day.paid_under_16++;
        }
      }
    }
    if (rows.length < 500) return { days, participants, directoryParticipants, tickets, under16, received };
    after = '&id=gt.' + encodeURIComponent(rows.at(-1).id);
  }
}

// Keep older databases usable during rollout without retrying a missing RPC on every view.
let retryOverviewAt = 0;
async function overview() {
  if (Date.now() >= retryOverviewAt) {
    try {
      const result = await rpc('festival_admin_overview');
      if (Number.isInteger(result.directoryParticipants) && Number.isInteger(result.received)) return result;
      retryOverviewAt = Date.now() + 60000;
    }
    catch (error) {
      if (!['PGRST202', '42883'].includes(error.code)) throw error;
      retryOverviewAt = Date.now() + 60000;
    }
  }
  return overviewWithoutMigration();
}

module.exports = timedHandler('admin', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!/^Bearer \S+$/.test(req.headers.authorization || '')) return res.status(401).json({ error: 'Sign in first.' });
  try {
    const staff = await staffFor(req.headers.authorization);
    if (!staff) return res.status(401).json({ error: 'Sign in again.' });
    const { id, role } = staff;
    if (!['super', 'registration', 'operations'].includes(role)) {
      return res.status(403).json({ error: 'This account does not have festival admin access.' });
    }
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: 'Invalid request.' }); }
    if (body?.action === 'session') {
      if (body.includeDirectory !== true) return res.json({ role });
      const directory = await rpc('festival_admin_dashboard', { p_page: 0, p_find: '', p_include_days: false });
      return res.json({ role, directory });
    }
    if (body?.action === 'daily_attendance' && role === 'super') {
      const ttl = integerSetting('FESTIVAL_ATTENDANCE_TTL_SECONDS', 5, 0, 60);
      return res.json(ttl
        ? await rpc('festival_attendance_snapshot', { p_ttl_seconds: ttl })
        : await rpc('festival_daily_attendance'));
    }
    if (body?.action === 'spot' && ['super', 'registration'].includes(role)) {
      const name = string(body.name).replace(/\s+/gu, ' ');
      const mobile = string(body.mobile).replace(/[ ()-]/g, '').replace(/^\+91/, '');
      const email = string(body.email);
      const dob = string(body.dob);
      const school = string(body.school);
      const mode = body.mode;
      const reference = string(body.reference);
      const date = dob ? new Date(dob) : null;
      if (!uuid.test(body.request_id || '') || !name || name.length > 100 || (mobile && !/^[6-9]\d{9}$/.test(mobile))
          || (email && (email.length > 254 || !emailPattern.test(email))) || school.length > 160
          || (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dob))
          || !['cash', 'online'].includes(mode) || body.payment_confirmed !== true
          || (mode === 'online' && !/^[A-Za-z0-9_-]{6,80}$/.test(reference))) {
        return res.status(400).json({ error: 'Check the participant details and confirm that payment was collected.' });
      }
      const advance = body.visit !== undefined;
      if (advance && (!['21','22','both'].includes(body.visit) || mode !== 'cash')) {
        return res.status(400).json({ error: 'Choose a visit and collect cash for an advance ticket.' });
      }
      return res.json(await rpc(advance ? 'festival_counter_register_visit' : 'festival_counter_register', {
        ...(advance ? { p_visit: body.visit } : {}), p_request: body.request_id, p_staff: id,
        p_name: name, p_mobile: mobile ? '+91' + mobile : null, p_email: email || null, p_dob: dob || null,
        p_school: school, p_mode: mode, p_reference: mode === 'online' ? reference : null }));
    }
    if (body?.action === 'operations' && role === 'super') {
      const [report, users] = await Promise.all([rpc('festival_operations_report'), db('festival_staff?select=id,name,email,role&order=name')]);
      return res.json({ report, users });
    }
    if (body?.action === 'staff_role' && role === 'super') {
      if (!uuid.test(body.id || '') || inAllowlist('FESTIVAL_ADMIN_IDS', body.id) || !staffRoles.includes(body.role)) {
        return res.status(400).json({ error: 'Choose a valid staff account and role.' });
      }
      const [updated] = await db(`festival_staff?id=eq.${body.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ role: body.role }),
      });
      return updated ? res.json({ ok: true }) : res.status(404).json({ error: 'Staff account not found.' });
    }
    if (body?.action === 'staff_create' && role === 'super') {
      const name = string(body.name);
      const email = string(body.email).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      if (!name || name.length > 100 || email.length > 254 || !emailPattern.test(email)
          || password.length < 12 || password.length > 72 || !staffRoles.slice(0, 3).includes(body.role)) {
        return res.status(400).json({ error: 'Enter a staff name, valid email, role and password of at least 12 characters.' });
      }
      const url = new URL('/auth/v1/admin/users', process.env.SUPABASE_URL);
      const headers = { apikey: process.env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
      const response = await timedFetch('auth', url, { method: 'POST', headers, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ email, password, email_confirm: true }) });
      if (!response.ok) {
        return res.status(response.status < 500 ? 409 : 503).json({ error: 'Could not create this sign-in. Check whether the email already has an account.' });
      }
      const user = await response.json();
      if (!uuid.test(user.id)) throw new Error('Missing staff account ID.');
      await db('festival_staff', { method: 'POST', body: JSON.stringify({ id: user.id, name, email, role: body.role }) });
      return res.json({ ok: true });
    }
    if (body?.action === 'day_roster') {
      const { day, after } = body;
      if (!['21', '22'].includes(day) || (after != null && !/^RYF26-[A-F0-9]{8}$/.test(after))) {
        return res.status(400).json({ error: 'Invalid roster date or page.' });
      }
      const fields = 'id,visit,status,amount_paise,festival_payments(provider,amount_paise,revoked_at),registration_participants(position,first_name,last_name,organization,city,date_of_birth,festival_tickets(id,revoked_at,festival_admissions(event_date)))';
      const rows = await db(`registrations?select=${fields}&visit=in.(${day},both)&checkout_test=eq.false&order=id.asc&limit=26${after ? '&id=gt.' + after : ''}`);
      const bookings = rows.slice(0, 25).map(({ registration_participants, festival_payments, ...booking }) => ({
        ...booking,
        cash_received: booking.status === 'paid' && [festival_payments].flat().some(payment =>
          payment?.provider === 'counter_cash' && !payment.revoked_at && payment.amount_paise === booking.amount_paise),
        collected: booking.status === 'paid' && [festival_payments].flat().some(p =>
          p && !p.revoked_at && p.amount_paise === booking.amount_paise) ? booking.amount_paise : 0,
        people: registration_participants.sort((a, b) => a.position - b.position).map(person => {
          const ticket = [person.festival_tickets].flat()[0];
          return { position: person.position, name: [person.first_name, person.last_name].filter(Boolean).join(' '),
            organization: person.organization, city: person.city, coupon: person.date_of_birth >= '2010-11-01',
            under16: person.date_of_birth > '2010-11-' + day,
            ticket: ticket?.revoked_at ? 'Revoked' : ticket ? 'Active' : 'Not issued',
            admitted: ticket?.festival_admissions.some(a => a.event_date === '2026-11-' + day) || false };
        }),
      }));
      return res.json({ bookings, next: rows.length > 25 ? bookings.at(-1).id : null });
    }
    if (body?.action === 'registration_breakdown') {
      const result = await overview();
      return res.json(body.includeTotals ? result : result.days);
    }
    if (body?.action === 'verify_payment') {
      const bookingId = body.booking_id;
      if (typeof bookingId !== 'string' || !/^RYF26-[A-F0-9]{8}$/.test(bookingId)) {
        return res.status(400).json({ error: 'Choose a valid booking.' });
      }
      const [[booking], [attempt]] = await Promise.all([
        db(`registrations?id=eq.${bookingId}&select=id,status,amount_paise,festival_payments(amount_paise,revoked_at)`),
        db(`festival_payment_attempts?registration_id=eq.${bookingId}&select=txnid`),
      ]);
      if (!booking) return res.status(404).json({ error: 'Booking not found.' });
      if (booking.status === 'paid') {
        const verified = [booking.festival_payments].flat().some(payment =>
          payment && !payment.revoked_at && payment.amount_paise === booking.amount_paise);
        return res.json({ verified });
      }
      if (booking.status !== 'pending' || !attempt) return res.json({ verified: false });
      if (!easebuzzEnabled()) return res.status(503).json({ error: 'Easebuzz verification is unavailable.' });
      return res.json({ verified: await reconcile(attempt, booking) });
    }
    if (body?.action === 'list') {
      if (body.page != null && (!Number.isSafeInteger(body.page) || body.page < 0 || body.page > 1000)) {
        return res.status(400).json({ error: 'Page unavailable. Search by registration or ticket ID.' });
      }
      const page = body.page ?? 0;
      const find = typeof body.find === 'string' ? body.find.trim().slice(0, 254) : '';
      const result = await rpc('festival_admin_dashboard', { p_page: page, p_find: find, p_include_days: body.includeDays !== false });
      const ids = [...new Set(result.participants.filter(person => person.status === 'paid').map(person => person.booking_id))];
      if (ids.length) {
        const payments = await db('festival_payments?select=registration_id,amount_paise,provider&revoked_at=is.null&registration_id=in.(' +
          ids.map(encodeURIComponent).join(',') + ')');
        const byBooking = new Map(payments.map(payment => [payment.registration_id, payment]));
        for (const person of result.participants) {
          const payment = byBooking.get(person.booking_id);
          if (person.status !== 'paid' || payment?.amount_paise !== person.amount_paise) continue;
          person.received_paise = payment.amount_paise;
          person.cash_received = payment.provider === 'counter_cash';
        }
      }
      return res.json(result);
    }
    if (body?.action === 'download' && /^RYF26-[A-F0-9]{8}$/.test(body.booking_id || '')
        && typeof body.ticket_id === 'string' && uuid.test(body.ticket_id)) {
      return require('./booking').sendBooking(res, body.booking_id, 'download', body.ticket_id);
    }
    if (body?.action === 'edit' && ['super', 'operations'].includes(role)) {
      const fields = ['first_name', 'last_name', 'organization', 'city'].map(name =>
        typeof body[name] === 'string' ? body[name].trim() : '');
      const [first, last, organization, city] = fields;
      if (!/^RYF26-[A-F0-9]{8}$/.test(body.booking_id || '') || !Number.isInteger(body.position)
          || body.position < 1 || !first
          || fields.some((value, index) => value.length > [100, 100, 160, 100][index])) {
        return res.status(400).json({ error: 'Check the participant details and try again.' });
      }
      const updated = await rpc('festival_admin_edit', { p_actor: id, p_booking: body.booking_id,
        p_position: body.position, p_first: first, p_last: last, p_organization: organization, p_city: city });
      return updated ? res.json({ ok: true }) : res.status(404).json({ error: 'Participant not found.' });
    }
    return res.status(403).json({ error: 'This action is unavailable for your role.' });
  } catch (error) {
    if (['PT409', 'PT422'].includes(error.code)) return res.status(Number(error.code.slice(2))).json({ error: error.detail });
    return res.status(503).json({ error: 'Admin service unavailable. Refresh before retrying.' });
  }
});
