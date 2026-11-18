const { authorize, db, qr } = require('../lib/tickets');
const { enabled } = require('../lib/easebuzz');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('node:path');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  let body, id;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; id = authorize(body?.access); }
  catch { return res.status(401).json({ error: 'Booking access is missing or expired. Contact support with your registration ID.' }); }
  try {
    const [booking] = await db(`registrations?id=eq.${id}&select=id,visit,quantity,amount_paise,status,checkout_test`);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    const [payment] = await db(`festival_payments?registration_id=eq.${id}&revoked_at=is.null`);
    const paid = booking.status === 'paid' && payment?.amount_paise === booking.amount_paise;
    if (body.action !== 'download') return res.json({ ...booking, status: paid ? 'paid' : 'pending', payment_enabled: enabled() && booking.status === 'pending' });
    if (!paid) return res.status(409).json({ error: 'Tickets are available only after verified payment.' });
    const tickets = await db(`festival_tickets?registration_id=eq.${id}&order=position`);
    const people = await db(`registration_participants?registration_id=eq.${id}&order=position`);
    if (tickets.length !== booking.quantity || tickets.some(t => t.revoked_at)) return res.status(409).json({ error: 'Tickets are unavailable. Please contact event support.' });
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.font(path.join(__dirname, '../fonts/NotoSansDevanagari.ttf'));
    const chunks = [];
    const completed = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    doc.fontSize(26).text('Naya Bharat 2047');
    doc.fontSize(12).text('Rotary & Rotaract District 3131').moveDown();
    doc.fontSize(20).text('Payment acknowledgement').moveDown();
    doc.fontSize(12).text(`Registration: ${id}\nPaid: INR ${(booking.amount_paise / 100).toFixed(2)}\nParticipants: ${booking.quantity}\nPayment reference: ${payment.transaction_id}\nVerified: ${payment.verified_at}`).moveDown();
    doc.text('This is a payment acknowledgement, not a GST tax invoice.');
    for (const ticket of tickets) {
      const person = people.find(p => p.position === ticket.position);
      doc.addPage().fontSize(26).text('Naya Bharat 2047').fontSize(14).text('Participant entry ticket').moveDown();
      if (booking.checkout_test) doc.text('PAYMENT TEST - NOT VALID FOR EVENT ADMISSION').moveDown();
      doc.fontSize(18).text(`${person.first_name} ${person.last_name}`).fontSize(12).moveDown();
      doc.text(`Visit: ${booking.visit === 'both' ? '21 & 22' : booking.visit} November 2026\nVenue: Fergusson College, Pune\nRegistration: ${id}\nTicket: ${ticket.id}`);
      doc.image(await QRCode.toBuffer(qr(ticket.id), { width: 300, errorCorrectionLevel: 'M' }), 48, 260, { width: 240 });
      doc.text('Present this QR and identification at the gate.\nValid for one admission per selected day. Do not share this ticket.\nAuthenticity and admission are checked online by authorised staff.\nSupport: +91 90110 23332', 48, 530);
    }
    doc.end();
    const pdf = await completed;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-tickets.pdf"`);
    return res.end(pdf);
  } catch { return res.status(503).json({ error: 'Unable to verify your booking. Please retry; do not pay again.' }); }
};
