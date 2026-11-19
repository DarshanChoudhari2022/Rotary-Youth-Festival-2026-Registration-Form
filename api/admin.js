const { timedHandler } = require('../lib/performance');
const { timedFetch } = require('../lib/performance');
const { integerSetting } = require('../lib/performance');
const { db } = require('../lib/tickets');
const { uuid, staffRoles, rpc, staffFor, inAllowlist } = require('../lib/staff');
const string = value => typeof value === 'string' ? value.trim() : '';
const emailPattern = /^[^\s@]+@[^\s@]+$/;

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
      const ttl = integerSetting('FESTIVAL_ATTENDANCE_TTL_SECONDS', 0, 0, 60);
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
      if (!uuid.test(body.request_id || '') || !name || name.length > 100 || !/^[6-9]\d{9}$/.test(mobile)
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
        p_name: name, p_mobile: '+91' + mobile, p_email: email || null, p_dob: dob || null,
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
    if (body?.action === 'registration_breakdown') {
      const result = await rpc('festival_admin_dashboard', { p_page: 0, p_find: '', p_include_days: true });
      return res.json(result.days);
    }
    if (body?.action === 'list') {
      if (body.page != null && (!Number.isSafeInteger(body.page) || body.page < 0 || body.page > 1000)) {
        return res.status(400).json({ error: 'Page unavailable. Search by registration or ticket ID.' });
      }
      const page = body.page ?? 0;
      const find = typeof body.find === 'string' ? body.find.trim().slice(0, 254) : '';
      return res.json(await rpc('festival_admin_dashboard', { p_page: page, p_find: find, p_include_days: body.includeDays !== false }));
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
