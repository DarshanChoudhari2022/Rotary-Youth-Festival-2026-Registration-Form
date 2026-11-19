const { createHash } = require('node:crypto');
const { timedHandler } = require('../lib/performance');
const { authorize, db, qr } = require('../lib/tickets');
const { enabled } = require('../lib/easebuzz');
const { rpc } = require('../lib/staff');
const path = require('node:path');
const fs = require('node:fs');

function participantAge(dob, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return 'Unavailable';
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4))
    - Number(date.slice(5) < dob.slice(5));
  return `${years} years`;
}

let cachedFont;
function ticketFont() {
  if (cachedFont) return cachedFont;
  const locations = [
    path.join(process.cwd(), 'fonts', 'NotoSansDevanagari.ttf'),
    path.join(__dirname, '../fonts/NotoSansDevanagari.ttf'),
  ];
  const filename = locations.find(location => fs.existsSync(location));
  cachedFont = filename ? fs.readFileSync(filename) : 'Helvetica';
  return cachedFont;
}

function heading(doc, label, logos) {
  const width = doc.page.width;
  doc.image(logos, 48, 27, { width: width - 96 });
  doc.rect(0, 107, width, 77).fill('#14263D');
  doc.rect(0, 184, width / 2, 4).fill('#bd1451');
  doc.rect(width / 2, 184, width / 2, 4).fill('#e87515');
  doc.fillColor('#FFFFFF').fontSize(25).text('Naya Bharat 2047', 48, 120);
  doc.fontSize(11).text('Rotary & Rotaract Youth Festival', 48, 154);
  doc.fillColor('#14263D').fontSize(18).text(label, 48, 207).moveDown(0.45);
}

function bookedDate(doc, visit, isDemo) {
  const top = doc.y;
  const width = doc.page.width - 96;
  const date = isDemo ? 'Demo only' : visit === 'both' ? '21–22 November 2026'
    : visit === '21' ? '21 November 2026' : '22 November 2026';
  const caption = isDemo ? 'Payment test. No festival admission.'
    : visit === 'both' ? 'Saturday and Sunday' : visit === '21' ? 'Saturday' : 'Sunday';
  doc.roundedRect(48, top, width, 76, 8).fill('#eef4fa');
  doc.fillColor('#18568e').fontSize(10).text(isDemo ? 'TEST PASS' : 'BOOKED DATES', 61, top + 8);
  doc.fillColor('#14263D').fontSize(24).text(date, 61, top + 23, { width: width - 26 });
  doc.fillColor(isDemo ? '#9E1649' : '#526475').fontSize(10).text(caption, 61, top + 53);
  doc.x = 48;
  doc.y = top + 88;
}

function detail(doc, label, value) {
  doc.fillColor('#526475').fontSize(9).text(label);
  doc.fillColor('#14263D').fontSize(12).text(value).moveDown(0.45);
}
module.exports = timedHandler('booking', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  let body, id;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; id = authorize(body?.access); }
  catch { return res.status(401).json({ error: 'Booking access is missing or expired. Contact support with your registration ID.' }); }
  return sendBooking(res, id, body.action);
});

// Callers must authorize access before invoking this function.
async function sendBooking(res, id, action, ticketId, saveArtifact) {
  try {
    const data = await rpc('festival_booking_document', { p_booking: id, p_download: action === 'download' });
    if (!data?.booking) return res.status(404).json({ error: 'Booking not found.' });
    const { booking, payment, tickets: allTickets, people } = data;
    const paid = booking.status === 'paid' && payment?.amount_paise === booking.amount_paise;
    const isDemo = booking.checkout_test || booking.visit === 'demo';
    const visitLabel = isDemo ? 'Demo only - no event date'
      : booking.visit === 'both' ? 'Saturday, 21 November and Sunday, 22 November 2026'
        : booking.visit === '21' ? 'Saturday, 21 November 2026' : 'Sunday, 22 November 2026';
    if (action !== 'download') return res.json({ ...booking, status: paid ? 'paid' : 'pending', payment_enabled: enabled() && booking.status === 'pending' });
    if (!paid) return res.status(409).json({ error: 'Tickets are available only after verified payment.' });
    const tickets = allTickets.filter(ticket => !ticket.revoked_at && (!ticketId || ticket.id === ticketId));
    if (allTickets.length !== booking.quantity || !tickets.length) return res.status(409).json({ error: 'Tickets are unavailable. Please contact event support.' });
    let fingerprint;
    if (!ticketId && (saveArtifact || process.env.FESTIVAL_TICKET_ARTIFACTS === 'true')) {
      fingerprint = createHash('sha256').update(JSON.stringify([
        2, process.env.FESTIVAL_TICKET_TEMPLATE_VERSION || '1', booking, payment, people,
        tickets.map(ticket => [ticket.position, qr(ticket.id)]),
      ])).digest('hex');
      if (!saveArtifact) {
        const filter = 'festival_ticket_artifacts?registration_id=eq.' + id + '&fingerprint=eq.' + fingerprint + '&select=pdf_base64';
        const [artifact] = await db(filter).catch(() => []);
        if (artifact?.pdf_base64) return sendPdf(res, id, Buffer.from(artifact.pdf_base64, 'base64'));
      }
    }
    const PDFDocument = require('pdfkit');
    const QRCode = require('qrcode');
    const doc = new PDFDocument({ size: 'A4', margin: 48, font: ticketFont(), autoFirstPage: !ticketId });
    const logos = doc.openImage(path.join(__dirname, '../assets/ticket-logos.png'));
    const chunks = [];
    const completed = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    if (!ticketId) {
      heading(doc, 'Payment acknowledgement', logos);
      detail(doc, 'Registration', id);
      detail(doc, 'Amount paid', `INR ${(booking.amount_paise / 100).toFixed(2)}`);
      detail(doc, 'Ticket coverage', visitLabel);
      detail(doc, 'Participants', String(booking.quantity));
      detail(doc, 'Payment reference', payment.transaction_id);
      detail(doc, 'Verified at', payment.verified_at);
      doc.text('This is a payment acknowledgement, not a GST tax invoice.');
    }
    const ageDate = isDemo ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(payment.verified_at))
      : booking.visit === '22' ? '2026-11-22' : '2026-11-21';
    for (const ticket of tickets) {
      const person = people.find(p => p.position === ticket.position);
      doc.addPage();
      heading(doc, isDemo ? 'Demo ticket' : 'Participant entry ticket', logos);
      bookedDate(doc, booking.visit, isDemo);
      detail(doc, 'Participant', `${person.first_name} ${person.last_name}`);
      detail(doc, 'Mobile', person.mobile || 'Unavailable');
      detail(doc, 'Email', person.email || 'Unavailable');
      detail(doc, isDemo ? 'Age on payment date' : 'Age on first booked day', participantAge(person.date_of_birth, ageDate));
      if (person.organization) detail(doc, 'College / organisation', person.organization);
      if (person.city) detail(doc, 'City', person.city);
      if (!isDemo && person.date_of_birth >= '2010-11-01') {
        detail(doc, 'Food coupon', 'FREE food coupon included. Collect at the designated counter.');
      }
      if (!isDemo) detail(doc, 'Venue', 'Fergusson College, Pune');
      detail(doc, 'Registration / ticket ID', `${id} / ${ticket.id}`);
      const qrImage = await QRCode.toBuffer(qr(ticket.id), { width: 300, errorCorrectionLevel: 'M' });
      const qrTop = doc.y;
      doc.image(qrImage, 48, qrTop, { width: 112 });
      doc.fillColor('#526475').fontSize(10).text(isDemo
        ? 'Scan this QR to test the gate scanner. Support: +91 90110 23332.'
        : 'Present this QR and your identification. One admission per booked day. Support: +91 90110 23332.', 176, qrTop + 16);
    }
    doc.end();
    const pdf = await completed;
    if (saveArtifact) await saveArtifact(fingerprint, pdf);
    return sendPdf(res, id, pdf);
  } catch (error) {
    console.error('Booking request failed', { action: action === 'download' ? 'download' : 'status', type: error.name, code: error.code });
    return res.status(503).json({ error: 'Could not prepare your booking details. Please retry. If payment is verified, do not pay again.' });
  }
}

function sendPdf(res, id, pdf) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + id + '-tickets.pdf"');
  return res.end(pdf);
}

module.exports.sendBooking = sendBooking;
