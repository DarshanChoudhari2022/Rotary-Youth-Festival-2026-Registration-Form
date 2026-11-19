let accessToken, stream, scanning = false, busy = false;
const $ = selector => document.querySelector(selector);
const message = $('#scanner-message');
$('#staff-login').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  const feedback = event.target.querySelector('.login-feedback');
  feedback.textContent = '';
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/staff-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ workspace: 'gate', email: $('#staff-email').value, password: $('#staff-password').value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    accessToken = result.token;
    document.body.classList.remove('signed-out');
    // Warm the decoder while staff position the first ticket.
    loadDecoder().catch(() => {});
    $('#staff-login').hidden = true; $('#scan-panel').hidden = false;
    message.textContent = 'Ready to verify a ticket.'; $('#camera-start').focus({ preventScroll: true });
  } catch (error) { feedback.textContent = error.message; } finally { $('#staff-password').value = ''; button.disabled = false; button.textContent = 'Sign in'; }
});
let cameraSession = 0;
let decoder;
const canvas = document.createElement('canvas');
const pixels = canvas.getContext('2d', { willReadFrequently: true });

function loadDecoder() {
  decoder ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/qr-decoder.js';
    script.onload = () => window.jsQR ? resolve(window.jsQR) : reject(new Error('QR decoder unavailable.'));
    script.onerror = () => { script.remove(); reject(new Error('QR decoder unavailable.')); };
    document.head.append(script);
  }).catch(error => { decoder = undefined; throw error; });
  return decoder;
}

function decodeFrame(decode, source, width, height, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  pixels.drawImage(source, 0, 0, w, h);
  return decode(pixels.getImageData(0, 0, w, h).data, w, h)?.data;
}

function stopCamera() {
  cameraSession++;
  scanning = false;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  const video = $('#camera');
  video.srcObject = null;
  video.hidden = true;
  $('#camera-stop').hidden = true;
  $('#camera-start').disabled = false;
}
$('#logout').onclick = () => { document.body.classList.add('signed-out'); stopCamera(); accessToken = null; delete message.dataset.outcome; $('#ticket-result').replaceChildren(); $('#ticket-token').value = ''; $('#scan-panel').hidden = true; $('#staff-login').hidden = false; message.textContent = 'Signed out.'; };
$('#ticket-token').oninput = () => { delete message.dataset.outcome; $('#ticket-result').replaceChildren(); message.textContent = 'Ready to check in.'; };
function scanRequest(token, data) {
  return fetch('/api/scanner', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
}
const checkInTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
async function check() {
  if (busy || !accessToken) return;
  const sessionToken = accessToken;
  const token = $('#ticket-token').value.trim();
  busy = true;
  $('#ticket-token').disabled = true;
  delete message.dataset.outcome;
  $('#ticket-result').replaceChildren();
  message.textContent = 'Checking…';
  try {
    const response = await scanRequest(sessionToken, { action: 'admit', ticket: token });
    if (sessionToken !== accessToken) return;
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    message.dataset.outcome = result.status;
    const outcomes = { admitted: 'CHECKED IN. Issue the wristband.', already_used: 'ALREADY CHECKED IN. Do not issue another wristband.', wrong_day: 'Not valid for today. Do not admit.', invalid_or_revoked: 'Unpaid or invalid ticket. Do not admit.', unknown: 'Unknown ticket. Do not admit.' };
    message.textContent = result.status === 'test_ticket' ? 'Payment test ticket. Do not admit.' : outcomes[result.status] || 'Unable to verify. Do not admit.';
    const admittedAt = result.admitted_at && checkInTime.format(new Date(result.admitted_at));
    for (const [label, value] of [['Participant', result.name], ['Ticket ID', result.ticket_id], ['Check-in time (IST)', admittedAt],
      ['Checked in by', result.staff_name || result.staff_id], ['Food coupon', admittedAt && result.food_eligible ? 'Eligible' : '']]) {
      if (!value) continue;
      const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; detail.textContent = value; $('#ticket-result').append(term, detail);
    }
  } catch (error) {
    if (sessionToken === accessToken) {
      message.dataset.outcome = 'error';
      message.textContent = ['TimeoutError', 'TypeError', 'AbortError'].includes(error.name)
        ? 'Connection interrupted. Scan the same ticket again before admitting. A completed check-in will show its original time.'
        : error.message;
    }
  }
  finally { busy = false; $('#ticket-token').disabled = false; }
}
$('#scan-form').onsubmit = event => { event.preventDefault(); stopCamera(); check(); };
$('#camera-stop').onclick = stopCamera;
$('#camera-start').onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    message.textContent = 'Open this page over HTTPS in your phone browser, or choose a QR photo below.';
    return;
  }
  stopCamera();
  const session = cameraSession;
  $('#camera-start').disabled = true;
  $('#camera-stop').hidden = false;
  message.textContent = 'Starting camera…';
  try {
    const camera = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    if (session !== cameraSession) { camera.getTracks().forEach(track => track.stop()); return; }
    stream = camera;
    const video = $('#camera');
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    const decode = await loadDecoder();
    if (session !== cameraSession) return;
    scanning = true;
    message.textContent = 'Hold the ticket QR inside the camera view.';
    let frame = 0, lastFrameTime = -1;
    while (scanning && session === cameraSession) {
      let code;
      if (video.readyState >= 2 && video.currentTime !== lastFrameTime) {
        lastFrameTime = video.currentTime;
        // Try a smaller frame first, retaining detail on alternate frames for distant tickets.
        code = decodeFrame(decode, video, video.videoWidth, video.videoHeight, frame++ % 2 ? 720 : 480);
      }
      if (code) { $('#ticket-token').value = code; stopCamera(); await check(); break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch {
    if (session !== cameraSession) return;
    stopCamera();
    message.textContent = 'Camera scanning could not start. Allow camera access or choose a QR photo below.';
  }
};
$('#qr-photo').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || busy) return;
  stopCamera();
  const session = cameraSession;
  delete message.dataset.outcome;
  $('#ticket-result').replaceChildren();
  message.textContent = 'Reading ticket photo�';
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    const [decode] = await Promise.all([loadDecoder(), image.decode()]);
    if (session !== cameraSession) return;
    const { naturalWidth: width, naturalHeight: height } = image;
    let code = decodeFrame(decode, image, width, height, 512);
    if (!code && Math.max(width, height) > 512) code = decodeFrame(decode, image, width, height, 1600);
    if (!code) throw new Error('QR not found');
    $('#ticket-token').value = code;
    await check();
  } catch {
    if (session === cameraSession) message.textContent = 'Could not read the QR. Try a clearer image or use manual verification.';
  } finally {
    URL.revokeObjectURL(url);
  }
};
window.addEventListener('pagehide', stopCamera);
