const { createHash, timingSafeEqual } = require('node:crypto');

module.exports = function authorizedWorker(header) {
  const secret = process.env.CRON_SECRET;
  if (!secret || typeof header !== 'string') return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest('Bearer ' + secret));
};
