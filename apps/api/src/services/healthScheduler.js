const DAY = 86400000;
const WITA = 8 * 3600000;
function nextMidnight(now) {
  return (Math.floor((now + WITA) / DAY) + 1) * DAY - WITA;
}

function startHealthScheduler({
  url,
  token,
  fetcher = fetch,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
}) {
  let stopped = false;
  let timer;
  let active;
  let retry = 0;
  function schedule(delay) {
    if (stopped) return;
    timer = setTimer(run, delay);
    timer.unref?.();
  }
  async function run() {
    if (stopped || active) return;
    active = new AbortController();
    try {
      const response = await fetcher(url, {
        headers: { 'X-Healthcheck-Token': token },
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok || (await response.json()).status !== 'ok')
        throw new Error('Health check tidak sehat');
      logger.info('Database health check berhasil', new Date(now()).toISOString());
      retry = 0;
    } catch {
      logger.error('Database health check gagal; periksa koneksi dan log server.');
      retry += 1;
    } finally {
      active = undefined;
      if (!stopped) {
        if (retry > 0 && retry < 3) schedule(30000);
        else {
          retry = 0;
          schedule(nextMidnight(now()) - now());
        }
      }
    }
  }
  // Also check on startup, catching failures after server downtime.
  schedule(0);
  return () => {
    stopped = true;
    clearTimer(timer);
    active?.abort();
  };
}
module.exports = { nextMidnight, startHealthScheduler };
