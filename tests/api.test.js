const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Offline authentication boundary fixture: no real network or production credentials.
process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fixture-public-key';
const config = require('../apps/api/src/config/supabase');
config.createUserClient = (authorization) => ({
  auth: {
    getUser: async () =>
      authorization === 'Bearer valid-fixture-token'
        ? { data: { user: { id: 'owner-123' } }, error: null }
        : { data: { user: null }, error: { message: 'invalid' } },
  },
});
const app = require('../apps/api/src/app');
const service = require('../apps/api/src/services/harvestService');

test('health responds, security headers set, unknown routes return JSON', async () => {
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.headers['x-powered-by'], undefined);
  assert.equal(health.headers['cache-control'], 'no-store');
  await request(app).get('/unknown').expect(404);
});
test('all harvest APIs require valid verified authentication', async () => {
  await request(app).get('/api/harvests').expect(401);
  await request(app).post('/api/harvests').send({}).expect(401);
  await request(app).patch('/api/spks/id').send({}).expect(401);
  await request(app)
    .get('/api/harvests')
    .set('Authorization', 'Bearer expired-fixture-token')
    .expect(401);
});
test('controller validates UUID, fields, and dates before calling service', async () => {
  await request(app)
    .post('/api/harvests')
    .set('Authorization', 'Bearer valid-fixture-token')
    .send({ name: 'Panen', harvest_date: '2026-02-30' })
    .expect(400);
  await request(app)
    .patch('/api/spks/invalid')
    .set('Authorization', 'Bearer valid-fixture-token')
    .send({})
    .expect(400);
  await request(app)
    .post('/api/harvests')
    .set('Authorization', 'Bearer valid-fixture-token')
    .send({ name: 'Panen', harvest_date: '2026-10-05', user_id: 'other' })
    .expect(400);
});
test('ownership comes from verified user, not request body', async () => {
  const original = service.createHarvest;
  service.createHarvest = async (_database, input, userId) => {
    assert.equal(userId, 'owner-123');
    return { id: 'new-harvest', ...input, user_id: userId, spks: [] };
  };
  try {
    const response = await request(app)
      .post('/api/harvests')
      .set('Authorization', 'Bearer valid-fixture-token')
      .send({ name: '  Panen A  ', harvest_date: '2026-10-05' })
      .expect(201);
    assert.equal(response.body.data.name, 'Panen A');
    assert.equal(response.body.status, true);
  } finally {
    service.createHarvest = original;
  }
});
test('malformed JSON is handled without exposing internal errors', async () => {
  const response = await request(app)
    .post('/api/harvests')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  assert.equal(response.body.message, 'JSON tidak valid.');
  assert.equal(response.body.stack, undefined);
});
