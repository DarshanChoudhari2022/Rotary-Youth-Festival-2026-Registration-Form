const crypto = require('node:crypto');
function key() {
  const value = process.env.TICKET_SIGNING_SECRET;
  if (!value || value.length < 64) throw new Error('Ticket service is not configured.');
  return value;
}
function sign(value) { return crypto.createHmac('sha256', key()).update(value).digest('base64url'); }
function equal(a, b) {
  return typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function access(registration, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ registration, expires: now + 7 * 86400000 })).toString('base64url');
  return payload + '.' + sign('download:' + payload);
}
function authorize(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024) throw new Error('Invalid booking access.');
  const [payload, signature, extra] = token.split('.');
  if (extra || !equal(signature, sign('download:' + payload))) throw new Error('Invalid booking access.');
  const data = JSON.parse(Buffer.from(payload, 'base64url'));
  if (!/^RYF26-[A-F0-9]{8}$/.test(data.registration) || !Number.isFinite(data.expires) || data.expires <= now) throw new Error('Booking access expired. Contact event support.');
  return data.registration;
}
function qr(id) { return `RYF26:${id}:${sign('entry:' + id)}`; }
function verifyQr(token) {
  const match = /^RYF26:([a-f0-9-]{36}):([A-Za-z0-9_-]{43})$/.exec(token || '');
  if (!match || !equal(match[2], sign('entry:' + match[1]))) throw new Error('Invalid ticket.');
  return match[1];
}
async function db(resource, options = {}) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Storage unavailable.');
  const response = await fetch(new URL('/rest/v1/' + resource, process.env.SUPABASE_URL), {
    ...options, headers: { apikey: process.env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Storage request failed.');
  return response.json();
}
module.exports = { access, authorize, qr, verifyQr, db };
