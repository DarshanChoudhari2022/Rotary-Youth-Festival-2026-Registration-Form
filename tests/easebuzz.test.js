const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcile } = require('../lib/easebuzz');
const paymentHandler = require('../api/payment');

test('a callback cannot issue tickets until Easebuzz confirms the matching payment', async t => {
  const txnid = 'a'.repeat(24);
  const booking = { id: 'RYF26-1234ABCD', amount_paise: 20000, status: 'pending' };
  process.env.EASEBUZZ_KEY = 'fixture-key';
  process.env.EASEBUZZ_SALT = 'fixture-salt';
  process.env.EASEBUZZ_LIVE_ENABLED = 'true';
  process.env.SUPABASE_URL = 'https://database.example.test';
  process.env.SUPABASE_SECRET_KEY = 'fixture-database-secret';
  let gatewayPayment = { txnid, key: 'fixture-key', amount: '200.00', easepayid: 'payment-ref', status: 'pending' };
  const fulfillments = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.hostname === 'dashboard.easebuzz.in') {
      assert.equal(options.body.get('txnid'), txnid);
      return Response.json({ status: true, msg: gatewayPayment });
    }
    if (target.pathname.endsWith('/festival_payment_attempts')) return Response.json([{ txnid, registration_id: booking.id }]);
    if (target.pathname.endsWith('/registrations')) return Response.json([booking]);
    assert.ok(target.pathname.endsWith('/fulfill_festival_payment'));
    fulfillments.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  });
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, end() {} };
  await paymentHandler({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `txnid=${txnid}&status=success` }, res);
  assert.equal(res.code, 303);
  assert.equal(fulfillments.length, 0);
  gatewayPayment = { ...gatewayPayment, status: 'success', amount: '1.00' };
  await assert.rejects(reconcile({ txnid }, booking), /do not match/);
  gatewayPayment = { ...gatewayPayment, amount: '200.00', key: 'different-merchant' };
  await assert.rejects(reconcile({ txnid }, booking), /do not match/);
  gatewayPayment.key = 'fixture-key';
  assert.equal(await reconcile({ txnid }, booking), true);
  assert.deepEqual(fulfillments, [{
    p_registration: booking.id, p_transaction: 'payment-ref', p_amount: 20000,
  }]);
});
