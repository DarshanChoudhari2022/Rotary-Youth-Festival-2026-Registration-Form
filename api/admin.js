const { db } = require('../lib/tickets');

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const rpc = (name, payload) => db('rpc/' + name, { method: 'POST', body: JSON.stringify(payload) });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!/^Bearer \S+$/.test(req.headers.authorization || '')) return res.status(401).json({ error: 'Sign in first.' });
  try {
    const auth = await fetch(new URL('/auth/v1/user', process.env.SUPABASE_URL), {
      headers: { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: req.headers.authorization },
      signal: AbortSignal.timeout(8000),
    });
    if (!auth.ok) return res.status(401).json({ error: 'Sign in again.' });
    const { id } = await auth.json();
    if (!id || !(process.env.FESTIVAL_ADMIN_IDS || '').split(',').map(value => value.trim()).includes(id)) {
      return res.status(403).json({ error: 'This account does not have festival admin access.' });
    }
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: 'Invalid request.' }); }
    if (body?.action === 'list') {
      const page = Number.isSafeInteger(body.page) && body.page >= 0 ? body.page : 0;
      const find = typeof body.find === 'string' ? body.find.trim().slice(0, 64) : '';
      return res.json(await rpc('festival_admin_dashboard', { p_page: page, p_find: find }));
    }
    if (body?.action === 'edit') {
      const fields = ['first_name', 'last_name', 'organization', 'city'].map(name =>
        typeof body[name] === 'string' ? body[name].trim() : '');
      const [first, last, organization, city] = fields;
      if (!/^RYF26-[A-F0-9]{8}$/.test(body.booking_id || '') || !Number.isInteger(body.position)
          || body.position < 1 || body.position > 10 || !first || !last
          || fields.some((value, index) => value.length > [100, 100, 160, 100][index])) {
        return res.status(400).json({ error: 'Check the participant details and try again.' });
      }
      const updated = await rpc('festival_admin_edit', { p_actor: id, p_booking: body.booking_id,
        p_position: body.position, p_first: first, p_last: last, p_organization: organization, p_city: city });
      return updated ? res.json({ ok: true }) : res.status(404).json({ error: 'Participant not found.' });
    }
    if (body?.action === 'revoke' && typeof body.ticket_id === 'string' && uuid.test(body.ticket_id)) {
      const revoked = await rpc('festival_admin_revoke', { p_actor: id, p_ticket: body.ticket_id });
      return revoked ? res.json({ ok: true }) : res.status(409).json({ error: 'Ticket is already revoked or unavailable.' });
    }
    return res.status(400).json({ error: 'Invalid admin action.' });
  } catch {
    return res.status(503).json({ error: 'Admin service unavailable. Refresh before retrying.' });
  }
};
