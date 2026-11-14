const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRST_VISIT = { 21: '2026-11-21', 22: '2026-11-22', both: '2026-11-21' };

function validate(body) {
  const { requestId, visit, participants, declarations, guardianConsent } = body ?? {};
  if (typeof requestId !== 'string' || !UUID.test(requestId)
      || !Object.hasOwn(FIRST_VISIT, visit) || typeof visit !== 'string'
      || !Array.isArray(participants) || participants.length < 1 || participants.length > 10
      || !['accuracy', 'policies', 'refund', 'food'].every(key => declarations?.[key] === true)) {
    throw new Error('Check the visit, participant count and registration declarations.');
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  let hasMinor = false;
  const people = participants.map((person, index) => {
    const { first, last, email, mobile, dob } = person ?? {};
    const date = typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)
      ? new Date(dob) : new Date(NaN);
    if (![first, last].every(name => typeof name === 'string' && name.trim() && name.trim().length <= 100)
        || typeof mobile !== 'string' || !/^\d{10}$/.test(mobile)
        || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)
        || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dob
        || dob < '0001-01-01' || dob > today) {
      throw new Error(`Check the details for Participant ${index + 1}.`);
    }
    hasMinor ||= dob > FIRST_VISIT[visit].replace('2026', '2008');
    return { first: first.trim(), last: last.trim(), mobile: '+91' + mobile, email, dob };
  });

  if (hasMinor && guardianConsent !== true) {
    throw new Error('Guardian consent is required for participants under 18.');
  }
  return { p_request_id: requestId, p_visit: visit, p_participants: people,
    p_guardian_consent: hasMinor };
}

module.exports = async function register(req, res) {
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
    return res.status(400).json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ error: 'Registration storage is not configured yet.' });
  }

  try {
    const result = await fetch(new URL('/rest/v1/rpc/create_festival_registration', SUPABASE_URL), {
      method: 'POST',
      headers: { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (result.status === 409) {
      return res.status(409).json({ error: 'This submission reference has already been used. Change your booking details and review again.' });
    }
    if (!result.ok) throw new Error('Supabase rejected the request');
    const [booking] = await result.json();
    if (!booking?.registration_id) throw new Error('Supabase returned no registration');
    return res.status(200).json(booking);
  } catch {
    return res.status(503).json({ error: 'We could not verify that your booking was saved. Please retry.' });
  }
};
