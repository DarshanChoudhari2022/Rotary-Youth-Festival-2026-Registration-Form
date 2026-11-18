const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const fs = require('node:fs');

test('attendance snapshots share a refresh and expire after the configured TTL', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of fs.readdirSync('supabase/migrations').sort()) {
      await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    }
    const snapshot = async ttl => (await db.query('select festival_attendance_snapshot($1) as snapshot', [ttl])).rows[0].snapshot;
    assert.deepEqual(await snapshot(0), await snapshot(5));
    await db.exec(`
      insert into registrations(id, request_id, visit, quantity, guardian_consent)
        values ('RYF26-AAAAAAAA',gen_random_uuid(),'both',1,false);
      insert into registration_participants(registration_id, position, first_name,last_name,mobile,email,date_of_birth)
        values ('RYF26-AAAAAAAA',1,'Test','100%','+919000000001','person@example.test','2000-01-01');
    `);
    assert.deepEqual((await snapshot(5)).map(day => day.registered), [0, 0]);
    assert.deepEqual((await snapshot(0)).map(day => day.registered), [1, 1]);
    const search = async term => (await db.query('select festival_admin_dashboard(0,$1,false) as result',[term])).rows[0].result.participants;
    for (const term of ['100%', 'person@example.test', '9000000001', 'ryf26-aaaaaaaa']) {
      assert.equal((await search(term))[0].booking_id, 'RYF26-AAAAAAAA');
    }
    assert.equal((await search('100_')).length, 0);
    await db.exec('set role anon');
    await assert.rejects(snapshot(5), /permission denied/);
  } finally {
    await db.close();
  }
});

test('timed handlers log dependency counts without logging request data', async t => {
  const { timedHandler, timedFetch } = require('../lib/performance');
  const logs = t.mock.method(console, 'info', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const previous = process.env.FESTIVAL_PERFORMANCE_LOG_PERCENT;
  process.env.FESTIVAL_PERFORMANCE_LOG_PERCENT = '100';
  try {
    const handler = timedHandler('test', async () => timedFetch('database', 'https://example.test/private-token'));
    await handler({ body: { password: 'private-password' } }, { statusCode: 200 });
    const record = logs.mock.calls[0].arguments[1];
    assert.equal(record.databaseCalls, 1);
    assert.doesNotMatch(JSON.stringify(record), /private-token|private-password/);
  } finally {
    if (previous === undefined) delete process.env.FESTIVAL_PERFORMANCE_LOG_PERCENT;
    else process.env.FESTIVAL_PERFORMANCE_LOG_PERCENT = previous;
  }
});

test('payment recovery worker authenticates and settles only verified or terminal attempts', async t => {
  const worker = require('../api/payment-recovery');
  const lease = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const rows = [
    { registration_id: 'RYF26-AAAAAAAA', txnid: 'a'.repeat(24), amount_paise: 20000, lease },
    { registration_id: 'RYF26-BBBBBBBB', txnid: 'b'.repeat(24), amount_paise: 20000, lease },
  ];
  const finishes = [];
  const fulfilled = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/festival_claim_payments')) return Response.json(rows);
    if (path.endsWith('/retrieve')) {
      const txnid = options.body.get('txnid');
      return Response.json(txnid === rows[0].txnid
        ? { status: true, msg: { status: 'success', txnid, key: 'fixture', amount: '200.00', easepayid: 'fixture-payment' } }
        : { status: false });
    }
    const body = JSON.parse(options.body);
    if (path.endsWith('/fulfill_festival_payment')) fulfilled.push(body.p_registration);
    else if (path.endsWith('/festival_finish_payment_check')) finishes.push(body);
    else throw new Error('Unexpected dependency');
    return Response.json(null);
  });
  const env = { CRON_SECRET: 'fixture-secret', EASEBUZZ_LIVE_ENABLED: 'true', EASEBUZZ_KEY: 'fixture', EASEBUZZ_SALT: 'fixture-salt',
    SUPABASE_URL: 'https://storage.example.test', SUPABASE_SECRET_KEY: 'fixture-database-key' };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } });
    const denied = response();
    await worker({ method: 'GET', headers: {} }, denied);
    assert.equal(denied.statusCode, 401);
    const accepted = response();
    await worker({ method: 'GET', headers: { authorization: 'Bearer fixture-secret' } }, accepted);
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(fulfilled, ['RYF26-AAAAAAAA']);
    assert.deepEqual(finishes.map(item => [item.p_booking, item.p_verified]).sort(), [['RYF26-AAAAAAAA', true], ['RYF26-BBBBBBBB', false]]);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('payment-recovery leases prevent duplicate claims and fence stale workers', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of fs.readdirSync('supabase/migrations').sort()) {
      await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    }
    await db.exec(`
      insert into registrations(id, request_id, visit, quantity, guardian_consent)
      values ('RYF26-BBBBBBBB', gen_random_uuid(), '22', 1, false);
      insert into festival_payment_attempts(registration_id, txnid, next_check_at)
      values ('RYF26-BBBBBBBB', repeat('b',24), now() - interval '1 second');
    `);
    const claim = async () => (await db.query('select * from festival_claim_payments(4)')).rows;
    const expire = () => db.exec("update festival_payment_attempts set next_check_at = now() - interval '1 second'");
    const [first] = await claim();
    assert.ok(first.lease);
    assert.deepEqual(await claim(), []);
    await expire();
    const [second] = await claim();
    assert.notEqual(second.lease, first.lease);
    const finish = lease => db.query('select festival_finish_payment_check($1,$2,false)', [first.registration_id, lease]);
    await finish(first.lease);
    assert.equal((await db.query('select check_count from festival_payment_attempts')).rows[0].check_count, 0);
    await db.exec('update festival_payment_attempts set check_count = 23');
    await finish(second.lease);
    const row = (await db.query('select check_count, next_check_at, recovery_exhausted_at from festival_payment_attempts')).rows[0];
    assert.equal(row.check_count, 24);
    assert.equal(row.next_check_at, null);
    assert.ok(row.recovery_exhausted_at);
    await db.exec('set role anon');
    await assert.rejects(claim(), /permission denied/);
  } finally {
    await db.close();
  }
});
