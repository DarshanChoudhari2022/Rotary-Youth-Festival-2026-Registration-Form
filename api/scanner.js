const { verifyQr, db } = require('../lib/tickets');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const response = await fetch(new URL('/auth/v1/user', process.env.SUPABASE_URL), { headers: { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: req.headers.authorization || '' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return res.status(401).json({ error: 'Please sign in again.' });
    const user = await response.json();
    if (!(process.env.SCANNER_STAFF_IDS || '').split(',').map(s => s.trim()).includes(user.id)) return res.status(403).json({ error: 'This account does not have gate access.' });
    let body, ticket;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; ticket = verifyQr(body?.ticket); }
    catch { return res.status(400).json({ error: 'Invalid or altered ticket QR.' }); }
    if (!['inspect', 'admit'].includes(body.action)) return res.status(400).json({ error: 'Invalid action.' });
    const [record] = await db(`festival_tickets?id=eq.${ticket}&select=registration_participants(registrations(checkout_test,visit))`);
    const registration = record?.registration_participants?.registrations;
    if (registration?.checkout_test || registration?.visit === 'demo') return res.json({ status: 'test_ticket' });
    return res.json(await db('rpc/inspect_festival_ticket', { method: 'POST', body: JSON.stringify({ p_ticket: ticket, p_staff: user.id, p_admit: body.action === 'admit' }) }));
  } catch { return res.status(503).json({ error: 'Verification unavailable. Do not admit without verification; contact the gate supervisor.' }); }
};
