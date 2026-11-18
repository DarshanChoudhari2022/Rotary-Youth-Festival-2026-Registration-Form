module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY || '',
    enabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
    adminEnabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) });
};
