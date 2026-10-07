const { resolve, isAbsolute } = require('node:path');
const { promises: fs } = require('node:fs');
const { backup } = require('./backup');
require('dotenv').config({ path: resolve(__dirname, '../../ops/.env') });
// Single operations instance per deployment; mkdir is an atomic cross-process lock on shared backup storage.
async function tick(config = process.env) {
  if (config.OPS_ENABLED !== 'true') return;
  const root = resolve(config.BACKUP_ROOT || '');
  if (!config.BACKUP_ROOT || !isAbsolute(config.BACKUP_ROOT))
    throw new Error('BACKUP_ROOT must be absolute');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const lock = resolve(root, '.operations-lock');
  try {
    await fs.mkdir(lock);
  } catch (e) {
    if (e.code === 'EEXIST') {
      console.error(
        JSON.stringify({
          event: 'operations_locked',
          action: 'Inspect previous worker before removing lock.',
        }),
      );
      return;
    }
    throw e;
  }
  try {
    await fs.writeFile(
      resolve(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await backup(config);
    await fs.writeFile(
      resolve(root, 'last-success.json'),
      JSON.stringify({ completedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
  } finally {
    await fs.unlink(resolve(lock, 'owner.json')).catch(() => {});
    await fs.rmdir(lock);
  }
}
let stopping = false,
  timer;
function schedule() {
  if (stopping) return;
  const now = new Date(),
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Makassar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  const value = (k) => parts.find((p) => p.type === k).value;
  let next = new Date(
    `${value('year')}-${value('month')}-${value('day')}T01:00:00+08:00`,
  ).getTime();
  if (next <= now.getTime()) next += 86400000;
  timer = setTimeout(async () => {
    try {
      await tick();
    } catch {
      console.error(JSON.stringify({ event: 'scheduled_backup_failed' }));
    } finally {
      schedule();
    }
  }, next - now.getTime());
}
if (require.main === module) {
  if (process.env.OPS_ENABLED !== 'true') {
    console.log('Operations scheduler disabled. Configure ops/.env before enabling.');
  } else {
    console.log(JSON.stringify({ event: 'backup_scheduler_started', time: '01:00 WITA' }));
    schedule();
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.on(signal, () => {
        stopping = true;
        clearTimeout(timer);
      });
  }
}
module.exports = { tick };
