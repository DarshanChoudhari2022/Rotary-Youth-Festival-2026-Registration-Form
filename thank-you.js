let saved;
try { saved = JSON.parse(sessionStorage.getItem('festival-registration')); } catch {}
const message = document.querySelector('#booking-message');
const download = document.querySelector('#download-tickets');
async function booking(action = 'status') {
  if (!saved?.access) throw new Error('Secure booking access is unavailable in this tab. Contact support with your registration ID.');
  const response = await fetch('/api/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: saved.access, action }) });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
async function downloadTickets() {
  download.disabled = true;
  try {
    const blob = await (await booking('download')).blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${saved.registration_id}-tickets.pdf`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message.textContent = 'Your tickets and payment acknowledgement are ready. If the download did not start, use the download button.';
  } catch (error) { message.textContent = error.message; }
  finally { download.disabled = false; }
}
async function refresh() {
  const button = document.querySelector('#refresh-booking'); button.disabled = true;
  try {
    const result = await (await booking()).json();
    document.querySelector('#payment-status').textContent = result.status === 'paid' ? 'Payment verified' : 'Payment pending';
    download.hidden = result.status !== 'paid';
    message.textContent = result.status === 'paid' ? 'Your booking is confirmed. Keep your tickets ready for entry.' : 'Online payment will be available soon. This pending registration is not an entry ticket.';
    if (result.status === 'paid' && !sessionStorage.getItem('downloaded-' + saved.registration_id)) {
      sessionStorage.setItem('downloaded-' + saved.registration_id, 'yes'); await downloadTickets();
    }
  } catch (error) { message.textContent = error.message; download.hidden = true; }
  finally { button.disabled = false; }
}
if (/^RYF26-[0-9A-F]{8}$/.test(saved?.registration_id) && Number.isSafeInteger(saved.amount_paise)) {
  document.querySelector('#receipt-heading').textContent = 'Thank you for registering';
  document.querySelector('#receipt-id').textContent = saved.registration_id;
  document.querySelector('#receipt-total').textContent = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(saved.amount_paise / 100);
  document.querySelector('#registration-receipt').hidden = false;
  document.querySelector('#receipt-empty').hidden = true;
  if (saved.access) refresh();
}
download.addEventListener('click', downloadTickets);
document.querySelector('#refresh-booking').addEventListener('click', refresh);
