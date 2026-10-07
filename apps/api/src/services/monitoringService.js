const { randomUUID } = require('node:crypto');
const startedAt = new Date().toISOString();
const counts = { requests: 0, errors: 0, slow: 0 };
const samples = [];
function monitoring(req, res, next) {
  const start = performance.now(),
    id = randomUUID();
  res.setHeader('X-Request-Id', id);
  res.on('finish', () => {
    const duration = Math.round(performance.now() - start);
    counts.requests++;
    if (duration > 2000) counts.slow++;
    if (res.statusCode >= 500) {
      counts.errors++;
      const item = {
        at: new Date().toISOString(),
        requestId: id,
        status: res.statusCode,
        durationMs: duration,
      };
      samples.push(item);
      if (samples.length > 20) samples.shift();
      console.error(JSON.stringify({ event: 'request_failed', ...item }));
    }
  });
  next();
}
const snapshot = () => ({
  startedAt,
  uptimeSeconds: Math.floor(process.uptime()),
  ...counts,
  recentErrors: [...samples],
  memoryMb: Math.round(process.memoryUsage().rss / 1048576),
});
module.exports = { monitoring, snapshot };
