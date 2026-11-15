const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
process.env.TICKET_SIGNING_SECRET = 'test-only-'.repeat(10);
const { access, authorize, qr, verifyQr } = require('../lib/tickets');
test('booking capability rejects edits, expired access and entry tokens', () => {
 const token = access('RYF26-1234ABCD', 1000);
 assert.equal(authorize(token, 1001), 'RYF26-1234ABCD');
 assert.throws(() => authorize(token + 'x', 1001));
 assert.throws(() => authorize(token, 8 * 86400000));
 assert.throws(() => authorize(qr(crypto.randomUUID())));
});
test('QR is stable, unique, and cannot be altered', () => {
 const id = crypto.randomUUID(), token = qr(id);
 assert.equal(qr(id), token); assert.equal(verifyQr(token), id);
 assert.notEqual(qr(crypto.randomUUID()), token);
 assert.throws(() => verifyQr(token.slice(0, -1) + '!'));
});
test('database fulfillment and admission invariants', async () => {
 const db = new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of fs.readdirSync('supabase/migrations').sort()) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  const people = Array.from({length:10}, (_,i) => ({first:'Test',last:'Participant',mobile:'+91900000000'+i,email:'test@example.com',dob:'2000-01-01',organization:'',city:''}));
  const booking = (await db.query('select * from create_festival_registration($1,$2,$3,$4)', [crypto.randomUUID(),'both',JSON.stringify(people),false])).rows[0];
  await assert.rejects(db.query('select fulfill_festival_payment($1,$2,$3)',[booking.registration_id,'test-payment',1]));
  assert.equal((await db.query('select * from festival_tickets')).rows.length,0);
  for(let i=0;i<2;i++) await db.query('select fulfill_festival_payment($1,$2,$3)',[booking.registration_id,'test-payment',400000]);
  const tickets = (await db.query('select * from festival_tickets')).rows;
  assert.equal(tickets.length,10); assert.equal(new Set(tickets.map(t=>t.id)).size,10);
  await assert.rejects(db.query('select fulfill_festival_payment($1,$2,$3)',[booking.registration_id,'different-payment',400000]));
  const staff = crypto.randomUUID();
  assert.equal((await db.query('select inspect_festival_ticket($1,$2,true) result',[tickets[0].id,staff])).rows[0].result.status,'wrong_day');
  // Simulate event date only in isolated test database, never production.
  const sql = fs.readFileSync('supabase/migrations/202611150004_tickets.sql','utf8');
  const func = sql.slice(sql.indexOf('create function public.inspect_festival_ticket'),sql.indexOf('revoke all on function'));
  await db.exec(func.replace('create function','create or replace function').replace("(now() at time zone 'Asia/Kolkata')::date", "'2026-11-21'::date"));
  const inspect = async admit => (await db.query('select inspect_festival_ticket($1,$2,$3) result',[tickets[0].id,staff,admit])).rows[0].result;
  assert.equal((await inspect(false)).status,'valid');
  assert.equal((await inspect(true)).status,'admitted');
  assert.equal((await inspect(true)).status,'already_used');
  await db.query('update festival_tickets set revoked_at=now() where id=$1',[tickets[0].id]);
  assert.equal((await inspect(true)).status,'invalid_or_revoked');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from festival_tickets'));
  await assert.rejects(db.query('select fulfill_festival_payment($1,$2,$3)',[booking.registration_id,'test-payment',400000]));
 } finally { await db.close(); }
});
