const { timedFetch } = require('./performance');
const { db } = require('./tickets');

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const staffRoles = ['registration', 'gate', 'operations', 'disabled'];
const rpc = (name, payload = {}) => db('rpc/' + name, { method: 'POST', body: JSON.stringify(payload) });
const inAllowlist = (key, id) => (process.env[key] || '').split(',').map(value => value.trim()).includes(id);

async function staffFor(authorization) {
  if (!/^Bearer \S+$/.test(authorization || '')) return null;
  const response = await timedFetch('auth', new URL('/auth/v1/user', process.env.SUPABASE_URL), {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: authorization },
    signal: AbortSignal.timeout(8000),
  });
  if ([401, 403].includes(response.status)) return null;
  if (!response.ok) throw new Error('Sign-in service temporarily unavailable.');
  const { id } = await response.json();
  return staffById(id);
}

async function staffById(id) {
  if (!uuid.test(id)) return null;
  if (inAllowlist('FESTIVAL_ADMIN_IDS', id)) return { id, role: 'super' };
  const [staff] = await db(`festival_staff?id=eq.${id}&select=id,role`);
  return staff || { id, role: inAllowlist('SCANNER_STAFF_IDS', id) ? 'gate' : 'disabled' };
}

module.exports = { uuid, staffRoles, rpc, staffFor, staffById, inAllowlist };
