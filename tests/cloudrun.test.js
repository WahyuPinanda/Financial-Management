const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { resolve, join, sep } = require('node:path');
const express = require('express');
const helmet = require('helmet');
const request = require('supertest');
const { createWebRouter, webSecurity } = require('../apps/api/src/middlewares/webMiddleware');
const { healthcheck } = require('../scripts/gcp/healthcheck');

async function webFixture(t) {
  const artifacts = resolve(__dirname, '../artifacts');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'web-test-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(artifacts + sep));
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(directory, 'assets'));
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><html><body>APP SHELL</body></html>',
  );
  await writeFile(join(directory, 'assets/app-abc123.js'), 'console.log("fixture")');
  await writeFile(join(directory, '.env'), 'PRIVATE_FIXTURE_NOT_FOR_BROWSER');
  const app = express();
  app.use(helmet(webSecurity('https://fixture.supabase.co')));
  app.use(createWebRouter(directory));
  app.use((_req, res) => res.status(404).json({ status: false }));
  return app;
}

test('combined Cloud Run frontend serves deep links with Supabase CSP and uncached HTML', async (t) => {
  const app = await webFixture(t);
  for (const route of ['/', '/login', '/future-investment-goals', '/template-transaksi']) {
    const response = await request(app).get(route).set('Accept', 'text/html').expect(200);
    assert.match(response.text, /APP SHELL/);
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.match(
      response.headers['content-security-policy'],
      /connect-src 'self' https:\/\/fixture\.supabase\.co(?:;|$)/,
    );
    assert.match(response.headers['content-security-policy'], /script-src 'self';/);
  }
});

test('missing API, assets, dotfiles and JSON requests never receive the SPA shell', async (t) => {
  const app = await webFixture(t);
  for (const route of ['/api', '/api/unknown', '/assets/missing.js', '/.env', '/.secret/path']) {
    const response = await request(app).get(route).set('Accept', 'text/html').expect(404);
    assert.doesNotMatch(response.text, /APP SHELL|PRIVATE_FIXTURE/);
  }
  await request(app).get('/rekening').set('Accept', 'application/json').expect(404);
});

test('hashed production assets retain immutable caching', async (t) => {
  const app = await webFixture(t);
  const asset = await request(app).get('/assets/app-abc123.js').expect(200);
  assert.match(asset.headers['cache-control'], /max-age=31536000, immutable/);
  assert.match(asset.headers['content-type'], /javascript/);
});

const jobEnv = {
  CLOUD_RUN_JOB: 'fixture',
  HEALTHCHECK_API_URL: 'https://cash-flow-fixture.run.app/api/health/database',
  HEALTHCHECK_TOKEN: 'h'.repeat(64),
};
test('scheduled Cloud Run probe uses service identity plus a separate secret without exposing either', async () => {
  const calls = [];
  const result = await healthcheck(jobEnv, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response('fixture.identity.signature')
      : Response.json({ status: 'ok', database: { ok: true } });
  });
  assert.match(calls[0].url, /^http:\/\/metadata.google.internal\//);
  assert.ok(calls[0].url.includes(encodeURIComponent('https://cash-flow-fixture.run.app')));
  assert.equal(calls[0].options.headers['Metadata-Flavor'], 'Google');
  assert.equal(calls[0].options.headers['X-Healthcheck-Token'], undefined);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fixture.identity.signature');
  assert.equal(calls[1].options.headers['X-Healthcheck-Token'], jobEnv.HEALTHCHECK_TOKEN);
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(result.event, 'database_healthcheck_ok');
  assert.doesNotMatch(JSON.stringify(result), /fixture.identity|hhhh/);
});

test('scheduled health probe refuses invalid destinations and credentials before network access', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error('Unexpected request');
  };
  for (const fields of [
    { HEALTHCHECK_API_URL: 'http://cash-flow-fixture.run.app/api/health/database' },
    { HEALTHCHECK_API_URL: 'https://other.invalid/api/health/database' },
    { HEALTHCHECK_API_URL: 'https://cash-flow-fixture.run.app/api/health/database?token=unsafe' },
    { HEALTHCHECK_API_URL: 'https://user:password@cash-flow-fixture.run.app/api/health/database' },
    { HEALTHCHECK_TOKEN: '' },
    { CLOUD_RUN_JOB: '' },
  ])
    await assert.rejects(healthcheck({ ...jobEnv, ...fields }, fetcher), /configuration/);
  assert.equal(calls, 0);
});

test('health job fails when identity or database readiness fails', async () => {
  await assert.rejects(
    healthcheck(jobEnv, async () => new Response('', { status: 403 })),
    /identity/,
  );
  await assert.rejects(
    healthcheck(jobEnv, async () => new Response('not-a-token')),
    /identity/,
  );
  let calls = 0;
  await assert.rejects(
    healthcheck(jobEnv, async () =>
      ++calls === 1
        ? new Response('fixture.identity.signature')
        : Response.json({ status: 'unhealthy' }, { status: 503 }),
    ),
    /failed/,
  );
});
