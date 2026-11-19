const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');

test('advance cash issues a paid pass without admission; existing large bookings support individual tickets', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of fs.readdirSync('supabase/migrations').sort()) {
      const sql = fs.readFileSync('supabase/migrations/' + file, 'utf8');
      await db.exec(sql.replaceAll("(statement_timestamp() at time zone 'Asia/Kolkata')::date", "date '2026-11-19'"));
    }
    const cash = [randomUUID(), randomUUID(), 'Cash Participant', '+919811111111', null, '2010-11-01', '', 'cash', null, 'both'];
    const collect = async args => (await db.query('select festival_counter_register_visit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result', args)).rows[0].result;
    const issued = await collect(cash);
    assert.equal(issued.amount_paise, 20000);
    assert.equal(issued.admitted_at, null);
    assert.deepEqual(await collect(cash), issued);
    await assert.rejects(collect([...cash.slice(0,9), '22']), /already been used/);
    assert.equal((await db.query('select status from registrations where id=$1',[issued.booking_id])).rows[0].status,'paid');
    const people = Array.from({length: 45}, (_, i) => ({first:'Class',last:'Student',mobile:'+9191234500'+String(i).padStart(2,'0'),dob:i ? '2011-01-01':'2000-01-01',email:'class@example.test'}));
    const args = [randomUUID(), '21', JSON.stringify(people), true];
    const book = async () => (await db.query('select * from create_festival_registration($1,$2,$3,$4)',args)).rows[0];
    const group = await book();
    assert.deepEqual(await book(), group);
    assert.equal(group.amount_paise,460000);
    await db.query('select fulfill_festival_payment($1,$2,$3)',[group.registration_id,'class-payment',group.amount_paise]);
    const tickets = await db.query('select id from festival_tickets where registration_id=$1',[group.registration_id]);
    assert.equal(new Set(tickets.rows.map(t => t.id)).size,45);
    assert.equal((await db.query('select * from festival_admissions')).rows.length,0);
  } finally { await db.close(); }
});
