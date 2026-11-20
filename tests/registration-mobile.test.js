const assert = require('node:assert/strict');
const { test } = require('node:test');
const register = require('../api/register');

test('registration requires one mobile number for a ten-person booking', async t => {
  const env = { ...process.env };
  t.after(() => { process.env = env; });
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SECRET_KEY = 'test-key';
  delete process.env.TICKET_SIGNING_SECRET;

  const payloads = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json([{ registration_id: 'RYF26-12345678', amount_paise: 200000, status: 'pending' }]);
  });

  const participants = Array.from({ length: 10 }, (_, index) => ({
    first: 'Test', last: `Participant ${index + 1}`, email: 'booking@example.com', dob: '2000-01-01',
  }));
  async function submit(people) {
    const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await register({ method: 'POST', headers: { 'content-type': 'application/json' }, body: {
      requestId: '2d35e60f-58ae-4b18-a2b0-5cb92f346ca4', visit: '22', participants: people,
      declarations: { accuracy: true, policies: true, refund: true, food: true },
    } }, response);
    return response;
  }

  const missing = await submit(participants);
  assert.equal(missing.code, 400);
  assert.equal(missing.body.field, 'mobile');
  assert.equal(missing.body.participant, 1);
  assert.equal(payloads.length, 0);

  const saved = await submit([{ ...participants[0], mobile: '9876543210' }, ...participants.slice(1)]);
  assert.equal(saved.code, 200);
  assert.deepEqual(payloads[0].p_participants.map(person => person.mobile), ['+919876543210', ...Array(9).fill(null)]);
});
