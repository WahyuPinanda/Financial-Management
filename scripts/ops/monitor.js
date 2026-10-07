const { resolve } = require('node:path');
const { readFile } = require('node:fs/promises');
require('dotenv').config({ path: resolve(__dirname, '../../ops/.env') });
async function probe(config = process.env) {
  const url = new URL(config.MONITOR_API_URL || 'http://127.0.0.1:3001/api/health/database');
  if (!config.HEALTHCHECK_TOKEN) throw new Error('HEALTHCHECK_TOKEN required');
  const response = await fetch(url, {
    headers: { 'X-Healthcheck-Token': config.HEALTHCHECK_TOKEN },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('API/database unavailable');
  const result = await response.json();
  if (result.status !== 'ok') throw new Error('API/database unhealthy');
  const fresh = (value, limit) =>
    Number.isFinite(Date.parse(value)) &&
    Date.now() - Date.parse(value) <= limit &&
    Date.parse(value) <= Date.now() + 300000;
  if (config.BACKUP_ROOT) {
    const last = JSON.parse(
      await readFile(resolve(config.BACKUP_ROOT, 'last-success.json'), 'utf8'),
    );
    if (!fresh(last.completedAt, 36 * 3600000))
      throw new Error('No successful backup in the last 36 hours');
    if (config.RESTORE_TEST_DATABASE_URL) {
      const tested = JSON.parse(
        await readFile(resolve(config.BACKUP_ROOT, 'last-restore-success.json'), 'utf8'),
      );
      if (!fresh(tested.testedAt, 30 * 86400000))
        throw new Error('No successful restore test in the last 30 days');
    }
  }
  return { status: 'ok' };
}
if (require.main === module) {
  let timer,
    stopped = false,
    previous = 'unknown';
  async function run() {
    let status = 'ok';
    try {
      await probe();
    } catch {
      status = 'unhealthy';
    }
    if (status !== previous) {
      console.log(
        JSON.stringify({ event: 'uptime_state_changed', status, at: new Date().toISOString() }),
      );
      previous = status;
    }
    if (!stopped) timer = setTimeout(run, 60000);
  }
  void run();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      stopped = true;
      clearTimeout(timer);
    });
}
module.exports = { probe };
