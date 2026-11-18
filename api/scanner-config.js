module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY || '',
    enabled: Boolean(process.env.SCANNER_STAFF_IDS && process.env.SUPABASE_PUBLISHABLE_KEY),
    adminEnabled: Boolean(process.env.FESTIVAL_ADMIN_IDS && process.env.SUPABASE_PUBLISHABLE_KEY) });
};
