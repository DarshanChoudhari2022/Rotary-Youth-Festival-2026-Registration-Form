const { timedHandler } = require('../lib/performance');
const { db } = require('../lib/tickets');
const { enabled, reconcile, verifyNotification } = require('../lib/easebuzz');

module.exports = timedHandler('payment-webhook', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!enabled()) return res.status(503).json({ error: 'Payment verification is unavailable.' });

  const contentType = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (!['application/x-www-form-urlencoded', 'application/json'].includes(contentType)) {
    return res.status(415).json({ error: 'Unsupported notification format.' });
  }
  let payload = req.body;
  if (Buffer.isBuffer(payload)) payload = payload.toString('utf8');
  if (typeof payload === 'string') {
    try {
      payload = contentType === 'application/json' ? JSON.parse(payload) : Object.fromEntries(new URLSearchParams(payload));
    } catch {
      return res.status(400).json({ error: 'Invalid notification.' });
    }
  }
  if (!verifyNotification(payload)) return res.status(401).json({ error: 'Invalid notification signature.' });
  if (payload.status !== 'success') return res.json({ received: true });

  try {
    const [attempt] = await db(`festival_payment_attempts?txnid=eq.${payload.txnid}&select=txnid,registrations(id,status,amount_paise)`);
    const booking = attempt?.registrations;
    if (!booking || booking.status !== 'pending') return res.json({ received: true });
    if (await reconcile(attempt, booking)) return res.json({ received: true });
  } catch {
    return res.status(503).json({ error: 'Payment verification is temporarily unavailable.' });
  }
  return res.status(503).json({ error: 'Payment has not yet been confirmed.' });
});
