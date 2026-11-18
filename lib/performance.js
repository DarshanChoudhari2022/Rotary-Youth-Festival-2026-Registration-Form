function integerSetting(key, fallback, minimum, maximum) {
  const value = process.env[key];
  if (!/^\d+$/.test(value || '')) return fallback;
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

module.exports = { integerSetting };
