const { timedHandler } = require('../lib/performance');
const { verifyQr } = require('../lib/tickets');
const { staffFor, rpc } = require('../lib/staff');
module.exports = timedHandler('scanner', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const staff = await staffFor(req.headers.authorization);
    if (!staff) return res.status(401).json({ error: 'Please sign in again.' });
    if (!['super', 'gate'].includes(staff.role)) return res.status(403).json({ error: 'This account does not have gate access.' });
    let body, ticket;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: 'Invalid request.' }); }
    if (body?.action === 'session') return res.json({ role: staff.role });
    if (!['inspect', 'admit'].includes(body?.action)) return res.status(400).json({ error: 'Invalid action.' });
    try { ticket = verifyQr(body.ticket); }
    catch { return res.status(400).json({ error: 'Invalid or altered ticket QR.' }); }
    return res.json(await rpc('inspect_festival_ticket', { p_ticket: ticket, p_staff: staff.id, p_admit: body.action === 'admit' }));
  } catch { return res.status(503).json({ error: 'Verification unavailable. Do not admit without verification; contact the gate supervisor.' }); }
});
