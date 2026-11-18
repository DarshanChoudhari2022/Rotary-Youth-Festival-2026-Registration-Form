const { AsyncLocalStorage } = require('node:async_hooks');

const timing = new AsyncLocalStorage();

function integerSetting(key, fallback, minimum, maximum) {
  const value = process.env[key];
  if (!/^\d+$/.test(value || '')) return fallback;
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function timedHandler(route, handler) {
  return async (req, res) => {
    const percent = integerSetting('FESTIVAL_PERFORMANCE_LOG_PERCENT', 0, 0, 100);
    if (Math.random() * 100 >= percent) return handler(req, res);
    const start = performance.now();
    const record = { route, databaseCalls: 0, authCalls: 0, gatewayCalls: 0 };
    return timing.run(record, async () => {
      try {
        return await handler(req, res);
      } finally {
        console.info('festival_request_timing', {
          ...record, status: res.statusCode, durationMs: Math.round(performance.now() - start),
        });
      }
    });
  };
}

async function timedFetch(dependency, url, options) {
  const record = timing.getStore();
  if (!record) return fetch(url, options);
  const start = performance.now();
  record[dependency + 'Calls'] += 1;
  try {
    return await fetch(url, options);
  } finally {
    const field = dependency + 'Ms';
    record[field] = (record[field] || 0) + Math.round(performance.now() - start);
  }
}

module.exports = { integerSetting, timedHandler, timedFetch };
