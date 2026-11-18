const { authorize, db, qr } = require('../lib/tickets');
const { enabled } = require('../lib/easebuzz');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('node:path');
const fs = require('node:fs');

function participantAge(dob, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return 'Unavailable';
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4))
    - Number(date.slice(5) < dob.slice(5));
  return `${years} years`;
}

function ticketFont() {
  const locations = [
    path.join(process.cwd(), 'fonts', 'NotoSansDevanagari.ttf'),
    path.join(__dirname, '../fonts/NotoSansDevanagari.ttf'),
  ];
  const filename = locations.find(location => fs.existsSync(location));
  return filename ? fs.readFileSync(filename) : 'Helvetica';
}

function heading(doc, label) {
  doc.rect(0, 0, doc.page.width, 112).fill('#14263D');
  doc.fillColor('#FFFFFF').fontSize(26).text('Naya Bharat 2047', 48, 36);
  doc.fontSize(11).text('Rotary & Rotaract District 3131');
  doc.fillColor('#14263D').fontSize(19).text(label, 48, 142).moveDown(0.6);
}

function detail(doc, label, value) {
  doc.fillColor('#526475').fontSize(9).text(label);
  doc.fillColor('#14263D').fontSize(12).text(value).moveDown(0.45);
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  let body, id;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; id = authorize(body?.access); }
  catch { return res.status(401).json({ error: 'Booking access is missing or expired. Contact support with your registration ID.' }); }
  return sendBooking(res, id, body.action);
};

// Callers must authorize access before invoking this function.
async function sendBooking(res, id, action, ticketId) {
  try {
    const [booking] = await db(`registrations?id=eq.${id}&select=id,visit,quantity,amount_paise,status,checkout_test`);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    const [payment] = await db(`festival_payments?registration_id=eq.${id}&revoked_at=is.null`);
    const paid = booking.status === 'paid' && payment?.amount_paise === booking.amount_paise;
    const isDemo = booking.checkout_test || booking.visit === 'demo';
    const visitLabel = isDemo ? 'Demo only - no event date'
      : booking.visit === 'both' ? 'Saturday, 21 November and Sunday, 22 November 2026'
        : booking.visit === '21' ? 'Saturday, 21 November 2026' : 'Sunday, 22 November 2026';
    if (action !== 'download') return res.json({ ...booking, status: paid ? 'paid' : 'pending', payment_enabled: enabled() && booking.status === 'pending' });
    if (!paid) return res.status(409).json({ error: 'Tickets are available only after verified payment.' });
    const allTickets = await db(`festival_tickets?registration_id=eq.${id}&order=position`);
    const tickets = allTickets.filter(ticket => !ticket.revoked_at && (!ticketId || ticket.id === ticketId));
    const people = await db(`registration_participants?registration_id=eq.${id}&order=position`);
    if (allTickets.length !== booking.quantity || !tickets.length) return res.status(409).json({ error: 'Tickets are unavailable. Please contact event support.' });
    const doc = new PDFDocument({ size: 'A4', margin: 48, font: ticketFont(), autoFirstPage: !ticketId });
    const chunks = [];
    const completed = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    if (!ticketId) {
      heading(doc, 'Payment acknowledgement');
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
      heading(doc, isDemo ? 'Demo ticket' : 'Participant entry ticket');
      if (isDemo) doc.fillColor('#9E1649').fontSize(11).text('PAYMENT TEST - NOT VALID FOR EVENT ADMISSION').moveDown();
      detail(doc, 'Participant', `${person.first_name} ${person.last_name}`);
      detail(doc, 'Mobile', person.mobile || 'Unavailable');
      detail(doc, 'Email', person.email || 'Unavailable');
      detail(doc, isDemo ? 'Age on payment date' : 'Age on first booked day', participantAge(person.date_of_birth, ageDate));
      if (person.organization) detail(doc, 'College / organisation', person.organization);
      if (person.city) detail(doc, 'City', person.city);
      detail(doc, 'Booked dates', visitLabel);
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
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-tickets.pdf"`);
    return res.end(pdf);
  } catch (error) {
    console.error('Booking request failed', { action: action === 'download' ? 'download' : 'status', type: error.name, code: error.code });
    return res.status(503).json({ error: 'Could not prepare your booking details. Please retry. If payment is verified, do not pay again.' });
  }
}

module.exports.sendBooking = sendBooking;
