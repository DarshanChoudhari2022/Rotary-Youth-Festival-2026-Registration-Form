const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcile } = require('../lib/easebuzz');
const paymentHandler = require('../api/payment');
const adminHandler = require('../api/admin');

test('staff can recover a missed payment return using only the saved checkout reference', async t => {
  const booking = { id: 'RYF26-1234ABCD', amount_paise: 20000, status: 'pending' };
  const staffId = '12345678-1234-4321-8123-123456789012';
  const txnid = 'b'.repeat(24);
  for (const [key, value] of Object.entries({
    EASEBUZZ_KEY: 'fixture-key', EASEBUZZ_SALT: 'fixture-salt', EASEBUZZ_LIVE_ENABLED: 'true',
    SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEY: 'fixture-database-secret',
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  let role = 'gate';
  let paymentStatus = 'pending';
  let fulfillments = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.hostname === 'dashboard.easebuzz.in') {
      assert.equal(options.body.get('txnid'), txnid);
      return Response.json({ status: true, msg: {
        txnid, key: 'fixture-key', amount: '200.00', easepayid: 'gateway-receipt', status: paymentStatus,
      } });
    }
    switch (target.pathname.split('/').pop()) {
      case 'user': return Response.json({ id: staffId });
      case 'festival_staff': return Response.json([{ id: staffId, role }]);
      case 'registrations': return Response.json([booking]);
      case 'festival_payment_attempts': return Response.json([{ txnid }]);
      case 'fulfill_festival_payment':
        assert.deepEqual(JSON.parse(options.body), {
          p_registration: booking.id, p_transaction: 'gateway-receipt', p_amount: 20000,
        });
        fulfillments++;
        booking.status = 'paid';
        booking.festival_payments = { amount_paise: 20000, revoked_at: null };
        return new Response(null, { status: 204 });
      default: throw new Error('Unexpected test request');
    }
  });
  async function verify() {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await adminHandler({ method: 'POST', headers: { authorization: 'Bearer fixture' },
      body: { action: 'verify_payment', booking_id: booking.id, txnid: 'untrusted' } }, res);
    return res;
  }
  assert.equal((await verify()).code, 403);
  role = 'registration';
  assert.deepEqual((await verify()).body, { verified: false });
  assert.equal(fulfillments, 0);
  paymentStatus = 'success';
  assert.deepEqual((await verify()).body, { verified: true });
  assert.deepEqual((await verify()).body, { verified: true });
  assert.equal(fulfillments, 1);
});

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

test('async payment return persists a signal before redirecting', async t => {
  const txnid = 'c'.repeat(24);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(new URL(url).pathname.endsWith('/festival_signal_payment'));
    assert.deepEqual(JSON.parse(options.body), { p_txnid: txnid });
    return Response.json(true);
  });
  process.env.FESTIVAL_ASYNC_PAYMENT_RETURN = 'true';
  process.env.CRON_SECRET = 'fixture-secret';
  try {
    const res = { setHeader(key, value) { this[key] = value; }, status(code) { this.code = code; return this; }, end() {} };
    await paymentHandler({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'txnid=' + txnid }, res);
    assert.equal(res.code, 303);
    assert.equal(res.Location, '/thank-you.html');
  } finally {
    delete process.env.FESTIVAL_ASYNC_PAYMENT_RETURN;
    delete process.env.CRON_SECRET;
  }
});
