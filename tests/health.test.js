const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { nextMidnight, startHealthScheduler } = require('../apps/api/src/services/healthScheduler');
const health = require('../apps/api/src/services/databaseHealthService');
const app = require('../apps/api/src/app');

test('daily health schedule follows midnight WITA across year boundaries', () => {
  assert.equal(
    new Date(nextMidnight(Date.parse('2026-12-31T15:59:59Z'))).toISOString(),
    '2026-12-31T16:00:00.000Z',
  );
  assert.equal(
    new Date(nextMidnight(Date.parse('2026-12-31T16:00:00Z'))).toISOString(),
    '2027-01-01T16:00:00.000Z',
  );
});

test('scheduler hits API, retries failures three times and cancels on shutdown', async () => {
  const jobs = [];
  let hits = 0;
  let cancelled;
  const current = Date.parse('2026-10-06T15:00:00Z');
  const stop = startHealthScheduler({
    url: 'http://127.0.0.1:3001/api/health/database',
    token: 'fixture',
    now: () => current,
    setTimer: (fn, delay) => {
      jobs.push({ fn, delay });
      return jobs.length;
    },
    clearTimer: (id) => {
      cancelled = id;
    },
    logger: { info() {}, error() {} },
    fetcher: async (url, options) => {
      hits++;
      assert.equal(options.headers['X-Healthcheck-Token'], 'fixture');
      assert.ok(options.signal);
      return { ok: false };
    },
  });
  assert.equal(jobs[0].delay, 0);
  await jobs[0].fn();
  assert.equal(jobs[1].delay, 30000);
  await jobs[1].fn();
  assert.equal(jobs[2].delay, 30000);
  await jobs[2].fn();
  assert.equal(hits, 3);
  assert.equal(jobs[3].delay, 3600000);
  stop();
  assert.equal(cancelled, 4);
  await jobs[3].fn();
  assert.equal(hits, 3);
});

test('health jobs never overlap and shutdown aborts in-flight probes', async () => {
  let job;
  let finish;
  let signal;
  let hits = 0;
  const stop = startHealthScheduler({
    url: 'http://localhost/check',
    token: 'fixture',
    setTimer: (fn) => {
      job = fn;
      return 1;
    },
    clearTimer() {},
    logger: { info() {}, error() {} },
    fetcher: async (_url, options) => {
      hits++;
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const running = job();
  await job();
  assert.equal(hits, 1);
  stop();
  assert.equal(signal.aborted, true);
  finish({ ok: true, json: async () => ({ status: 'ok' }) });
  await running;
});

test('database health API requires internal token and reports database failures', async () => {
  await request(app).get('/api/health/database').expect(401);
  await request(app).get('/api/health/database').set('X-Healthcheck-Token', 'invalid').expect(401);
  const original = health.probeDatabase;
  try {
    health.probeDatabase = async () => ({ ok: true, checked_at: 'fixture' });
    const result = await request(app)
      .get('/api/health/database')
      .set('X-Healthcheck-Token', health.token)
      .expect(200);
    assert.equal(result.body.database.ok, true);
    health.probeDatabase = async () => {
      throw new Error('private database error');
    };
    const failure = await request(app)
      .get('/api/health/database')
      .set('X-Healthcheck-Token', health.token)
      .expect(503);
    assert.deepEqual(failure.body, { status: 'unhealthy' });
  } finally {
    health.probeDatabase = original;
  }
});
