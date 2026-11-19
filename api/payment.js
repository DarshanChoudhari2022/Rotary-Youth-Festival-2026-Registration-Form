const { timedHandler } = require('../lib/performance');
const { randomBytes } = require('node:crypto');
const { rpc } = require('../lib/staff');
const { authorize, db } = require('../lib/tickets');
const { enabled, initiate, reconcile, checkoutUrl, transactionPattern } = require('../lib/easebuzz');

const attemptTable = 'festival_payment_attempts';
const loadBooking = async id => (await db(`registrations?id=eq.${id}&select=id,amount_paise,status`))[0];

module.exports = timedHandler('payment', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled()) return res.status(503).json({ error: 'Online payment is not available yet.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const contentType = req.headers['content-type']?.split(';')[0];
  if (contentType === 'application/x-www-form-urlencoded') {
    const txnid = typeof req.body === 'string' || Buffer.isBuffer(req.body)
      ? new URLSearchParams(String(req.body)).get('txnid') : req.body?.txnid;
    if (typeof txnid !== 'string' || !transactionPattern.test(txnid)) return res.status(400).json({ error: 'Invalid payment reference.' });
    try {
      if (process.env.FESTIVAL_ASYNC_PAYMENT_RETURN === 'true' && process.env.CRON_SECRET) {
        const known = await rpc('festival_signal_payment', { p_txnid: txnid });
        if (!known) return res.status(404).json({ error: 'Unknown payment reference.' });
        res.setHeader('Location', '/thank-you.html');
        return res.status(303).end();
      }
      const [attempt] = await db(`${attemptTable}?txnid=eq.${txnid}&select=registration_id,txnid`);
      if (!attempt) return res.status(404).json({ error: 'Unknown payment reference.' });
      const booking = await loadBooking(attempt.registration_id);
      // Treat the browser return only as a signal. The authenticated lookup decides payment status.
      if (booking?.status === 'pending') await reconcile(attempt, booking);
      res.setHeader('Location', '/thank-you.html');
      return res.status(303).end();
    } catch {
      return res.status(503).json({ error: 'Verification is temporarily unavailable. Return to your booking and check payment status before paying again.' });
    }
  }
  if (contentType !== 'application/json') return res.status(415).json({ error: 'Send JSON.' });
  let body, id;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    id = authorize(body?.access);
  } catch {
    return res.status(401).json({ error: 'Booking access is missing or expired.' });
  }
  if (!['start', 'verify'].includes(body.action)) return res.status(400).json({ error: 'Invalid payment action.' });
  try {
    const filter = `${attemptTable}?registration_id=eq.${id}`;
    const [booking, [existing], [person]] = await Promise.all([
      loadBooking(id),
      db(filter + '&select=txnid,checkout_key'),
      body.action === 'start'
        ? db(`registration_participants?registration_id=eq.${id}&position=eq.1&select=first_name,email,mobile`)
        : [],
    ]);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status === 'paid') return res.json({ verified: true });
    if (existing && await reconcile(existing, booking)) return res.json({ verified: true });
    if (body.action === 'verify') return res.json({ verified: false });
    if (existing) {
      if (existing.checkout_key) return res.json({ checkout_url: checkoutUrl(existing.checkout_key) });
      return res.status(409).json({ error: 'Checkout is being prepared or could not be confirmed. Check payment status before trying again or contact support.' });
    }
    if (!person) return res.status(409).json({ error: 'Booking contact details are unavailable.' });
    if (!person.mobile) {
      if (typeof body.payerMobile !== 'string' || !/^[6-9]\d{9}$/.test(body.payerMobile)) {
        return res.status(422).json({ code: 'PAYER_MOBILE_REQUIRED', error: 'Enter the payer’s mobile number for checkout.' });
      }
      person.mobile = '+91' + body.payerMobile;
    }
    const [attempt] = await db(attemptTable + '?on_conflict=registration_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ registration_id: id, txnid: randomBytes(12).toString('hex') }),
    });
    if (!attempt) return res.status(409).json({ error: 'Checkout is already being prepared. Please retry shortly.' });
    const checkoutKey = await initiate(attempt, booking, person);
    const attemptFilter = filter + `&txnid=eq.${attempt.txnid}`;
    if (!checkoutKey) {
      await db(attemptFilter, { method: 'DELETE' });
      return res.status(502).json({ error: 'Secure checkout could not open. Please try again or contact booking support.' });
    }
    await db(attemptFilter, { method: 'PATCH', body: JSON.stringify({ checkout_key: checkoutKey }) });
    return res.json({ checkout_url: checkoutUrl(checkoutKey) });
  } catch {
    return res.status(503).json({ error: 'Payment status could not be confirmed. Check your booking before paying again.' });
  }
});
