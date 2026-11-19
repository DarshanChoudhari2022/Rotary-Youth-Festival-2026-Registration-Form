let saved;
try { saved = JSON.parse(sessionStorage.getItem('festival-registration')); } catch {}
const message = document.querySelector('#booking-message');
const download = document.querySelector('#download-tickets');
const pay = document.querySelector('#start-payment');
const payerContact = document.querySelector('#payer-contact');
const payerMobile = document.querySelector('#payer-mobile');
async function payment(action) {
  const response = await fetch('/api/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access: saved.access, action, ...(action === 'start' && !payerContact.hidden ? { payerMobile: payerMobile.value } : {}) }),
  });
  const result = await response.json();
  if (result.code === 'PAYER_MOBILE_REQUIRED') {
    saved.needsPayerMobile = true;
    payerContact.hidden = false;
    payerMobile.focus();
  }
  if (!response.ok) throw new Error(result.error);
  return result;
}

pay.addEventListener('click', async () => {
  if (!payerContact.hidden && !payerMobile.reportValidity()) return;
  pay.disabled = true;
  try {
    const result = await payment('start');
    if (result.checkout_url) window.location.assign(result.checkout_url);
    else await refresh();
  } catch (error) { message.textContent = error.message; }
  finally { pay.disabled = false; }
});
async function booking(action = 'status') {
  if (!saved?.access) throw new Error('Secure booking access is unavailable in this tab. Contact support with your registration ID.');
  const response = await fetch('/api/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: saved.access, action }) });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
async function downloadTickets() {
  if (download.disabled) return;
  download.disabled = true;
  try {
    const blob = await (await booking('download')).blob();
    if (blob.type !== 'application/pdf') throw new Error('The ticket PDF is temporarily unavailable. Please retry.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${saved.registration_id}-tickets.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    sessionStorage.setItem('downloaded-' + saved.registration_id, 'yes');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message.textContent = 'Your tickets and payment acknowledgement are ready. If the download did not start, use the download button.';
  } catch (error) { message.textContent = error.message; }
  finally { download.disabled = false; }
}
async function refresh() {
  const button = document.querySelector('#refresh-booking'); button.disabled = true;
  try {
    let result = await (await booking()).json();
    if (result.payment_enabled && (await payment('verify')).verified) result = await (await booking()).json();
    document.querySelector('#payment-status').textContent = result.status === 'paid' ? 'Payment verified' : 'Payment pending';
    download.hidden = result.status !== 'paid';
    pay.hidden = !result.payment_enabled;
    payerContact.hidden = pay.hidden || !saved.needsPayerMobile;
    message.textContent = result.status === 'paid' ? (
      result.visit === 'demo' || result.checkout_test ? 'Demo payment verified. Your PDF is for testing only.' : 'Your booking is confirmed. Keep your tickets ready for entry.')
      : result.payment_enabled ? 'Complete your payment to receive your tickets. If you just paid, check your payment status before trying again.'
      : 'Online payment is currently unavailable. Your registration is saved.';
    if (result.status === 'paid' && !sessionStorage.getItem('downloaded-' + saved.registration_id)) {
      await downloadTickets();
    }
  } catch (error) { message.textContent = error.message; download.hidden = true; pay.hidden = true; }
  finally { button.disabled = false; }
}
function showBooking() {
  document.querySelector('#receipt-heading').textContent = 'Thank you for registering';
  document.querySelector('#receipt-id').textContent = saved.registration_id;
  document.querySelector('#receipt-total').textContent = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(saved.amount_paise / 100);
  document.querySelector('#registration-receipt').hidden = false;
  document.querySelector('#receipt-empty').hidden = true;
  if (saved.access) refresh();
}
const privateAccess = new URLSearchParams(location.hash.slice(1)).get('test-booking');
if (privateAccess) {
  history.replaceState(null, '', location.pathname + location.search);
  fetch('/api/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access: privateAccess, action: 'status' }) })
    .then(async response => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!result.checkout_test) throw new Error();
      saved = { registration_id: result.id, amount_paise: result.amount_paise, access: privateAccess };
      sessionStorage.setItem('festival-registration', JSON.stringify(saved));
      showBooking();
    })
    .catch(() => { document.querySelector('#receipt-empty').textContent = 'This test booking link is unavailable or has expired.'; });
} else if (/^RYF26-[0-9A-F]{8}$/.test(saved?.registration_id) && Number.isSafeInteger(saved.amount_paise)) {
  showBooking();
}
download.addEventListener('click', downloadTickets);
document.querySelector('#refresh-booking').addEventListener('click', refresh);
