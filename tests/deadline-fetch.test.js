const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { deadlineFetch } = require('../apps/api/src/libs/deadlineFetch');

test('authentication and SQL calls share one bounded deadline, with no mutation retries', async () => {
  const signals = [];
  const bounded = deadlineFetch(25, async (_, options) => {
    signals.push(options.signal);
    await delay(100, undefined, { signal: options.signal });
  });
  const results = await Promise.allSettled([bounded('auth'), bounded('sql', { method: 'POST' })]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
  await assert.rejects(bounded('sql-after-deadline'));
});

test('caller cancellation is preserved and options are forwarded', async () => {
  const controller = new AbortController();
  const bounded = deadlineFetch(1000, async (_, options) => options);
  controller.abort();
  const options = await bounded('sql', {
    signal: controller.signal,
    method: 'PATCH',
    headers: { 'If-Match': '3' },
  });
  assert.equal(options.signal.aborted, true);
  assert.equal(options.method, 'PATCH');
  assert.equal(options.headers['If-Match'], '3');
});
