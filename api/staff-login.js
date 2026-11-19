const { timedHandler, timedFetch } = require('../lib/performance');
const { db } = require('../lib/tickets');
const { staffById, inAllowlist, uuid } = require('../lib/staff');

module.exports = timedHandler('staff-login', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to sign in.' });
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return res.status(415).json({ error: 'Send JSON.' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid sign-in request.' }); }
  if (!['admin','gate'].includes(body?.workspace) || typeof body.email !== 'string' || !body.email.trim() ||
      body.email.length > 254 || typeof body.password !== 'string' || !body.password || body.password.length > 4096) {
    return res.status(400).json({ error: 'Enter your staff email and password.' });
  }
  try {
    // Look up the roster while Supabase authenticates. Only use a role whose ID
    // matches the authenticated account; email alone never grants access.
    const email = body.email.trim().toLowerCase();
    const lookup = db('festival_staff?select=id,role&limit=1&email=eq.' + encodeURIComponent(email))
      .then(rows => rows[0]).catch(() => null);
    const response = await timedFetch('auth', new URL('/auth/v1/token?grant_type=password', process.env.SUPABASE_URL), {
      method: 'POST', headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email.trim(), password: body.password }), signal: AbortSignal.timeout(10000),
    });
    if (response.status === 429) return res.status(429).json({ error: 'Too many attempts. Wait a moment before signing in again.' });
    if ([400,401,403,422].includes(response.status)) return res.status(401).json({ error: 'Check your staff email and password and try again.' });
    if (!response.ok) throw new Error();
    const { user, access_token } = await response.json();
    if (!access_token || !user?.id) throw new Error();
    if (!uuid.test(user.id)) throw new Error();
    let staff;
    if (inAllowlist('FESTIVAL_ADMIN_IDS', user.id)) staff = { id: user.id, role: 'super' };
    else {
      const candidate = await lookup;
      staff = candidate?.id === user.id ? candidate : await staffById(user.id);
    }
    const roles = body.workspace === 'gate' ? ['gate','super'] : ['registration','operations','super'];
    if (!roles.includes(staff?.role)) return res.status(403).json({ error: 'This account does not have access to this workspace.' });
    return res.json({ token: access_token, role: staff.role });
  } catch { return res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again.' }); }
});
