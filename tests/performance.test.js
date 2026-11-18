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
