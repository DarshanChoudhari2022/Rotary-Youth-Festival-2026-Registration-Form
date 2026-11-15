// Deliberately fail closed until the Easebuzz adapter and reconciliation tests exist.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json({ error: 'Online payment is not available yet. Your saved registration remains pending.' });
};
