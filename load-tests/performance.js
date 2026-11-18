import http from 'k6/http';
import { check } from 'k6';
import { randomBytes } from 'k6/crypto';
import { scenario } from 'k6/execution';

const base = __ENV.BASE_URL || 'http://127.0.0.1:3001';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base)) {
  throw new Error('Use an isolated loopback fixture or a local staging tunnel.');
}
const users = Number(__ENV.VUS || 10);
const scenarioFor = exec => ({ executor: 'constant-vus', exec, vus: users, duration: __ENV.DURATION || '10s' });
const scenarios = { bookings: scenarioFor('book') };
if (__ENV.ADMIN_TOKEN) scenarios.admin = scenarioFor('admin');
if (__ENV.GATE_TOKEN && __ENV.GATE_QR) scenarios.gate = scenarioFor('gate');
if (/^[a-f0-9]{24}$/.test(__ENV.CALLBACK_TXN || '')) scenarios.callbacks = scenarioFor('callback');

export const options = {
  scenarios,
  summaryTrendStats: ['count', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate<0.01'] },
  maxRedirects: 0,
};

function post(path, payload, operation, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return http.post(base + path, JSON.stringify(payload), { headers, tags: { name: operation } });
}

function uuid() {
  const bytes = new Uint8Array(randomBytes(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function book() {
  const sequence = Number(__ENV.MOBILE_OFFSET || 1000000) + scenario.iterationInTest;
  const mobile = '9' + String(sequence).padStart(9, '0');
  const response = post('/api/register', {
    requestId: uuid(), visit: __ENV.VISIT || '22',
    participants: [{ first: 'Load', last: 'Fixture', mobile, email: 'load@example.test', dob: '2000-01-01' }],
    declarations: { accuracy: true, policies: true, refund: true, food: true },
  }, 'registration');
  check(response, { 'registration persisted': r => r.status === 200 && Boolean(r.json('registration_id')) });
}

export function admin() {
  const list = post('/api/admin', { action: 'list', page: 0, find: '', includeDays: __ENV.BASELINE === '1' },
    'admin directory', __ENV.ADMIN_TOKEN);
  check(list, { 'admin returns a page': r => r.status === 200 && Array.isArray(r.json('participants')) });
  const report = post('/api/admin', { action: 'daily_attendance' }, 'admin attendance', __ENV.ADMIN_TOKEN);
  check(report, { 'admin returns attendance': r => r.status === 200 && Array.isArray(r.json()) });
}

export function gate() {
  const response = post('/api/scanner', { action: 'admit', ticket: __ENV.GATE_QR }, 'gate contention', __ENV.GATE_TOKEN);
  check(response, { 'gate admission is definitive': r => r.status === 200 && ['admitted', 'already_used'].includes(r.json('status')) });
}

export function callback() {
  const response = http.post(base + '/api/payment', { txnid: __ENV.CALLBACK_TXN }, {
    tags: { name: 'payment return burst' },
  });
  check(response, { 'callback acknowledged': r => r.status === 303 });
}
