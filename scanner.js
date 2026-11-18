let config, accessToken, checkedToken, stream, scanning = false, busy = false;
const $ = selector => document.querySelector(selector);
const message = $('#scanner-message');
fetch('/api/scanner-config').then(r => r.json()).then(c => { config = c; message.textContent = c.enabled ? 'Sign in with your assigned staff account.' : 'Staff access is not configured yet. Contact the organiser.'; }).catch(() => { message.textContent = 'Unable to connect. Please reload.'; });
$('#staff-login').addEventListener('submit', async event => {
  event.preventDefault();
  if (!config?.enabled) return;
  const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const response = await fetch(config.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#staff-email').value, password: $('#staff-password').value }) });
    $('#staff-password').value = '';
    if (!response.ok) throw new Error('Unable to sign in. Check your credentials and try again.');
    accessToken = (await response.json()).access_token;
    $('#staff-login').hidden = true; $('#scan-panel').hidden = false;
    message.textContent = 'Ready to verify a ticket.'; $('#ticket-token').focus();
  } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
});
function stopCamera() { scanning = false; stream?.getTracks().forEach(t => t.stop()); $('#camera').hidden = true; $('#camera-stop').hidden = true; }
$('#logout').onclick = () => { stopCamera(); accessToken = null; checkedToken = null; $('#ticket-result').replaceChildren(); $('#admit').hidden = true; $('#ticket-token').value = ''; $('#scan-panel').hidden = true; $('#staff-login').hidden = false; message.textContent = 'Signed out.'; };
$('#ticket-token').oninput = () => { checkedToken = null; $('#admit').hidden = true; $('#ticket-result').replaceChildren(); };
async function check(action) {
  if (busy) return;
  const token = $('#ticket-token').value.trim();
  if (action === 'admit' && token !== checkedToken) return;
  busy = true;
  $('#ticket-token').disabled = true;
  $('#admit').hidden = true; $('#ticket-result').replaceChildren();
  message.textContent = 'Checking…';
  try {
    const response = await fetch('/api/scanner', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ticket: token }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    const outcomes = { valid: 'Valid ticket. Check identity, then confirm admission.', admitted: 'Admission recorded.', already_used: 'Already admitted today. Do not admit again.', wrong_day: 'Not valid for today. Do not admit.', invalid_or_revoked: 'Unpaid or revoked ticket. Do not admit.', unknown: 'Unknown ticket. Do not admit.' };
    message.textContent = result.status === 'test_ticket' ? 'Payment test ticket. Do not admit.' : outcomes[result.status] || 'Unable to verify. Do not admit.';
    for (const [label, value] of [['Participant', result.name], ['Visit', result.visit], ['Ticket', result.ticket_id], ['Admission time', result.admitted_at]]) {
      if (!value) continue;
      const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; detail.textContent = value; $('#ticket-result').append(term, detail);
    }
    checkedToken = token; $('#admit').hidden = result.status !== 'valid';
  } catch (error) { message.textContent = error.message; checkedToken = null; }
  finally { busy = false; $('#ticket-token').disabled = false; }
}
$('#scan-form').onsubmit = event => { event.preventDefault(); stopCamera(); check('inspect'); };
$('#admit').onclick = () => check('admit');
$('#camera-stop').onclick = stopCamera;
$('#camera-start').onclick = async () => {
  if (!('BarcodeDetector' in window)) { message.textContent = 'Camera scanning is unavailable in this browser. Use a USB/Bluetooth QR reader or paste the decoded QR text.'; return; }
  try {
    stopCamera(); stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('#camera'); video.srcObject = stream; video.hidden = false; $('#camera-stop').hidden = false; await video.play();
    const detector = new BarcodeDetector({ formats: ['qr_code'] }); scanning = true;
    while (scanning) {
      const codes = await detector.detect(video);
      if (codes.length) { $('#ticket-token').value = codes[0].rawValue; stopCamera(); await check('inspect'); break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch { stopCamera(); message.textContent = 'Camera unavailable. Allow camera access or use a QR reader.'; }
};
window.addEventListener('pagehide', stopCamera);
