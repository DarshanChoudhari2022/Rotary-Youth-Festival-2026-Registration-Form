const authorizedWorker = require('../lib/worker-auth');
const { enabled, reconcile } = require('../lib/easebuzz');
const { rpc } = require('../lib/staff');
const { timedHandler, integerSetting } = require('../lib/performance');

async function checkAttempt(attempt) {
  let verified = false;
  let gatewayError = false;
  try {
    verified = await reconcile(attempt, { id: attempt.registration_id, amount_paise: attempt.amount_paise });
  } catch {
    gatewayError = true;
  }
  await rpc('festival_finish_payment_check', {
    p_booking: attempt.registration_id, p_lease: attempt.lease, p_verified: verified,
  });
  return { verified, gatewayError };
}

module.exports = timedHandler('payment-recovery', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (!authorizedWorker(req.headers.authorization)) return res.status(401).json({ error: 'Unauthorized.' });
  if (!enabled()) return res.status(503).json({ error: 'Payment recovery is unavailable.' });
  try {
    const concurrency = integerSetting('FESTIVAL_PAYMENT_RECOVERY_BATCH', 4, 1, 16);
    const attempts = await rpc('festival_claim_payments', { p_limit: concurrency });
    const results = await Promise.allSettled(attempts.map(checkAttempt));
    const failures = results.filter(result => result.status === 'rejected').length;
    return res.status(failures ? 503 : 200).json({
      checked: attempts.length,
      verified: results.filter(result => result.value?.verified).length,
      verificationErrors: results.filter(result => result.value?.gatewayError).length,
      leaseUpdateErrors: failures,
    });
  } catch {
    return res.status(503).json({ error: 'Payment recovery is temporarily unavailable.' });
  }
});
