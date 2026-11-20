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
    const people = Array.from({length: 45}, (_, i) => ({first:'Class',last:'Student',mobile:i % 2 ? cash[3] : null,dob:i ? '2011-01-01':'2000-01-01',email:'class@example.test'}));
    const args = [randomUUID(), '21', JSON.stringify(people), true];
    const book = async () => (await db.query('select * from create_festival_registration($1,$2,$3,$4)',args)).rows[0];
    const group = await book();
    assert.deepEqual(await book(), group);
    assert.equal(group.amount_paise,460000);
    await db.query('select fulfill_festival_payment($1,$2,$3)',[group.registration_id,'class-payment',group.amount_paise]);
    const tickets = await db.query('select id from festival_tickets where registration_id=$1',[group.registration_id]);
    assert.equal(new Set(tickets.rows.map(t => t.id)).size,45);
    const overview = (await db.query('select festival_admin_overview() value')).rows[0].value;
    const previous = (await db.query("select festival_admin_dashboard(0,'',true) value")).rows[0].value;
    assert.deepEqual(overview.days.map(({ collected, ...day }) => day), previous.days);
    assert.deepEqual(overview.days.map(day => day.collected), [470000, 10000]);
    assert.equal(overview.participants, 46);
    const emptyBooking = await db.query('select * from create_festival_registration($1,$2,$3,$4)',
      [randomUUID(), 'both', JSON.stringify([people[0]]), true]);
    await db.query('delete from registration_participants where registration_id=$1', [emptyBooking.rows[0].registration_id]);
    const afterEmpty = (await db.query('select festival_admin_overview() value')).rows[0].value;
    assert.equal(afterEmpty.participants, overview.participants);
    assert.deepEqual(afterEmpty.days.map(d => d.participants), overview.days.map(d => d.participants));
    assert.equal(overview.tickets, 46);
    assert.equal(overview.received, group.amount_paise + issued.amount_paise);
    const cashReport = async () => (await db.query('select festival_operations_report() value')).rows[0].value;
    assert.equal((await cashReport()).cash_paise, issued.amount_paise);
    await db.query('update festival_payments set revoked_at=now() where registration_id=$1', [issued.booking_id]);
    assert.equal((await cashReport()).cash_paise, 0);
    assert.deepEqual((await cashReport()).cash_by_staff, []);
    const youth = { ...people[1], dob: '2023-12-31' };
    const youthRequest = randomUUID();
    const registerWithProof = async (person, requestId = youthRequest) => (await db.query(
      'select * from create_festival_registration_with_proof($1,$2,$3,$4)',
      [requestId, '21', JSON.stringify([person]), true],
    )).rows[0];
    await assert.rejects(registerWithProof(youth), /proof image is required/);
    await assert.rejects(registerWithProof({ ...youth, dob: '2024-01-01' }), /before 2024/);
    const proof = Buffer.from('ffd8ff01ffd9', 'hex');
    const participant = { ...youth, birthProof: proof.toString('base64') };
    const youthBooking = await registerWithProof(participant);
    assert.equal(youthBooking.amount_paise, 10000);
    assert.deepEqual(await registerWithProof(participant), youthBooking);
    const savedProofs = await db.query(
      'select position, encode(image, \'hex\') as image from festival_birth_proofs where registration_id=$1',
      [youthBooking.registration_id],
    );
    assert.deepEqual(savedProofs.rows, [{ position: 1, image: proof.toString('hex') }]);
    await db.query('select fulfill_festival_payment($1,$2,$3)',
      [youthBooking.registration_id, 'youth-payment-1', youthBooking.amount_paise]);

    const nextBooking = await registerWithProof({ ...participant, first: 'Another student' }, randomUUID());
    assert.notEqual(nextBooking.registration_id, youthBooking.registration_id);
    await db.query('select fulfill_festival_payment($1,$2,$3)',
      [nextBooking.registration_id, 'youth-payment-2', nextBooking.amount_paise]);
    const separateTickets = await db.query(
      'select id from festival_tickets where registration_id in ($1, $2)',
      [youthBooking.registration_id, nextBooking.registration_id],
    );
    assert.equal(new Set(separateTickets.rows.map(ticket => ticket.id)).size, 2);
    assert.equal(overview.under16, 44);
    assert.equal((await db.query('select * from festival_admissions')).rows.length,0);
  } finally { await db.close(); }
});
