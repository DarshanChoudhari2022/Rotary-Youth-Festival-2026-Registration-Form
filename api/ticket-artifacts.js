const authorizedWorker = require('../lib/worker-auth');
const { rpc } = require('../lib/staff');
const { timedHandler, integerSetting } = require('../lib/performance');
const { sendBooking } = require('./booking');

async function generate(job) {
  let fingerprint = null;
  let pdf = null;
  const sink = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader() {},
    json() {},
    end() {},
  };
  await sendBooking(sink, job.registration_id, 'download', undefined, (version, buffer) => {
    if (buffer.length <= 1500000) {
      fingerprint = version;
      pdf = buffer.toString('base64');
    }
  });
  const terminal = [200, 404, 409].includes(sink.statusCode);
  await rpc('finish_festival_ticket_artifact', {
    p_booking: job.registration_id, p_lease: job.lease, p_terminal: terminal,
    p_fingerprint: fingerprint, p_pdf: pdf,
  });
  return Boolean(pdf);
}

module.exports = timedHandler('ticket-artifacts', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (!authorizedWorker(req.headers.authorization)) return res.status(401).json({ error: 'Unauthorized.' });
  if (process.env.FESTIVAL_TICKET_ARTIFACTS !== 'true') return res.status(503).json({ error: 'Ticket artifacts are disabled.' });
  try {
    const jobs = await rpc('claim_festival_ticket_artifacts', {
      p_limit: integerSetting('FESTIVAL_TICKET_ARTIFACT_BATCH', 2, 1, 4),
    });
    const results = await Promise.allSettled(jobs.map(generate));
    const failures = results.filter(result => result.status === 'rejected').length;
    return res.status(failures ? 503 : 200).json({
      checked: jobs.length, generated: results.filter(result => result.value === true).length, leaseUpdateErrors: failures,
    });
  } catch {
    return res.status(503).json({ error: 'Ticket artifact worker is temporarily unavailable.' });
  }
});
