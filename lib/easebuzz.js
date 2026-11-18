const { timedFetch } = require('./performance');
const { createHash } = require('node:crypto');
const { db } = require('./tickets');

const site = 'https://rotaryyouthfestival.samavet.in';
const checkout = 'https://pay.easebuzz.in';
const accessKeyPattern = /^[A-Za-z0-9_-]{8,256}$/;
const transactionPattern = /^[a-f0-9]{24}$/;

function enabled() {
  return process.env.EASEBUZZ_LIVE_ENABLED === 'true'
    && Boolean(process.env.EASEBUZZ_KEY && process.env.EASEBUZZ_SALT);
}

function hash(fields) {
  return createHash('sha512').update([...fields, process.env.EASEBUZZ_SALT].join('|')).digest('hex');
}

async function post(url, fields) {
  const response = await timedFetch('gateway', url, {
    method: 'POST',
    body: new URLSearchParams(fields),
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Easebuzz request failed.');
  return response.json();
}

async function initiate(attempt, booking, person) {
  const fields = {
    key: process.env.EASEBUZZ_KEY,
    txnid: attempt.txnid,
    amount: (booking.amount_paise / 100).toFixed(2),
    productinfo: 'Naya Bharat 2047 festival tickets',
    firstname: person.first_name.replaceAll('|', ' '),
    email: person.email,
    phone: person.mobile.replace(/^\+91/, ''),
    surl: site + '/api/payment',
    furl: site + '/api/payment',
  };
  fields.hash = hash([fields.key, fields.txnid, fields.amount, fields.productinfo,
    fields.firstname, fields.email, ...Array(10).fill('')]);
  const result = await post(checkout + '/payment/initiateLink', fields);
  if (result.status === 0) return null;
  if (result.status !== 1 || typeof result.data !== 'string' || !accessKeyPattern.test(result.data)) {
    throw new Error('Unexpected checkout response.');
  }
  return result.data;
}

function checkoutUrl(accessKey) {
  if (typeof accessKey !== 'string' || !accessKeyPattern.test(accessKey)) throw new Error('Invalid checkout reference.');
  return checkout + '/pay/' + accessKey;
}

async function reconcile(attempt, booking) {
  const { txnid } = attempt;
  const key = process.env.EASEBUZZ_KEY;
  const result = await post('https://dashboard.easebuzz.in/transaction/v2/retrieve',
    { key, txnid, hash: hash([key, txnid]) });
  const payment = result.msg;
  if (result.status !== true || payment?.status !== 'success') return false;
  const amount = String(payment.amount);
  const [whole, fraction = ''] = amount.split('.');
  if (payment.txnid !== txnid || payment.key !== key
      || !/^\d{1,8}(?:\.\d{1,2})?$/.test(amount)
      || Number(whole) * 100 + Number(fraction.padEnd(2, '0')) !== booking.amount_paise
      || !/^[A-Za-z0-9_-]{1,80}$/.test(payment.easepayid || '')) {
    throw new Error('Easebuzz payment details do not match the booking.');
  }
  await db('rpc/fulfill_festival_payment', {
    method: 'POST',
    body: JSON.stringify({ p_registration: booking.id, p_transaction: payment.easepayid, p_amount: booking.amount_paise }),
  });
  return true;
}

module.exports = { enabled, initiate, checkoutUrl, reconcile, transactionPattern };
