const { timedHandler } = require('../lib/performance');
const { timedFetch } = require('../lib/performance');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRST_VISIT = { 21: '2026-11-21', 22: '2026-11-22', both: '2026-11-21', demo: '2026-11-21' };
const MAX_BIRTH_PROOF = 250 * 1024;

function validate(body) {
  const { requestId, visit, participants, declarations, guardianConsent } = body ?? {};
  if (typeof requestId !== 'string' || !UUID.test(requestId)
      || !Object.hasOwn(FIRST_VISIT, visit) || typeof visit !== 'string'
      || !Array.isArray(participants) || participants.length < 1 || participants.length > 10
      || visit === 'demo'
      || !['accuracy', 'policies', 'refund', 'food'].every(key => declarations?.[key] === true)) {
    throw new Error('Check the visit, participant count and registration declarations.');
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  let hasMinor = false;
  const people = participants.map((person, index) => {
    const { first, last, email, mobile, dob, birthProof, organization = "", city = "" } = person ?? {};
    const date = typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)
      ? new Date(dob) : new Date(NaN);
    const position = index + 1;
    const invalid = (field, message) => {
      throw Object.assign(new Error(`Participant ${position}: ${message}`), { participant: position, field });
    };
    for (const [field, value, label] of [['first', first, 'first name'], ['last', last, 'last name']]) {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
        invalid(field, `Enter a ${label} of up to 100 characters.`);
      }
    }
    if (mobile != null && mobile !== '' && (typeof mobile !== 'string' || !/^[6-9]\d{9}$/.test(mobile))) {
      invalid('mobile', 'Enter a 10-digit Indian mobile number beginning with 6, 7, 8 or 9.');
    }
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
      invalid('email', 'Enter a valid email address.');
    }
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dob
        || dob < '0001-01-01' || dob > today) {
      invalid('dob', 'Enter a valid date of birth on or before today.');
    }
    if (dob >= '2024-01-01') invalid('dob', 'Enter a date of birth before 1 January 2024.');
    if (dob >= '2010-11-01') {
      if (typeof birthProof !== 'string' || birthProof.length > 4 * Math.ceil(MAX_BIRTH_PROOF / 3)
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(birthProof)) {
        invalid('birthProof', 'Attach a date-of-birth proof image up to 250 KiB after compression.');
      }
      const image = Buffer.from(birthProof, 'base64');
      if (image.length < 5 || image.length > MAX_BIRTH_PROOF || image.toString('base64') !== birthProof
          || image.readUIntBE(0, 3) !== 0xffd8ff || image.readUInt16BE(image.length - 2) !== 0xffd9) {
        invalid('birthProof', 'Choose a readable proof image and try again.');
      }
    }
    if (typeof organization !== 'string' || organization.length > 160) {
      invalid('organization', 'Use up to 160 characters for college or organization.');
    }
    if (typeof city !== 'string' || city.length > 100) invalid('city', 'Use up to 100 characters for city.');
    hasMinor ||= dob > FIRST_VISIT[visit].replace('2026', '2008');
    return { first: first.trim(), last: last.trim(), mobile: mobile ? '+91' + mobile : null, email, dob,
      organization: organization.trim(), city: city.trim(), ...(dob >= '2010-11-01' && { birthProof }) };
  });

  if (hasMinor && guardianConsent !== true) {
    throw new Error('Guardian consent is required for participants under 18.');
  }
  return { p_request_id: requestId, p_visit: visit, p_participants: people,
    p_guardian_consent: hasMinor };
}

module.exports = timedHandler('register', async function register(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to submit a registration.' });
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return res.status(415).json({ error: 'Send a JSON registration.' });
  }
  let payload;
  try {
    payload = validate(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  } catch (error) {
    return res.status(400).json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message,
      participant: error.participant, field: error.field });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ error: 'Registration storage is not configured yet.' });
  }

  try {
    const result = await timedFetch('database', new URL('/rest/v1/rpc/create_festival_registration_with_proof', SUPABASE_URL), {
      method: 'POST',
      headers: { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (result.status === 422 && (await result.json()).code === 'PT422') {
      return res.status(422).json({ error: 'Only 22 November tickets can be booked today. Return to registration and select 22 November.' });
    }
    if (result.status === 409) {
      return res.status(409).json({ error: 'This submission reference has already been used. Change your booking details and review again.' });
    }
    if (!result.ok) throw new Error('Supabase rejected the request');
    const [booking] = await result.json();
    if (!booking?.registration_id) throw new Error('Supabase returned no registration');
    let access;
    if (process.env.TICKET_SIGNING_SECRET?.length >= 64) access = require('../lib/tickets').access(booking.registration_id);
    return res.status(200).json({ ...booking, access });
  } catch {
    return res.status(503).json({ error: 'We could not verify that your booking was saved. Please retry.' });
  }
});
