const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Offline authentication boundary fixture: no real network or production credentials.
process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fixture-public-key';
const config = require('../apps/api/src/config/supabase');
const financeCalls = [];
const mfaToken = (aal) =>
  `fixture.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.verified`;
config.createUserClient = (authorization) => ({
  rpc: async (name, args) => {
    financeCalls.push({ name, args, authorization });
    return { data: { id: 'fixture-record' }, error: null };
  },
  auth: {
    getUser: async () =>
      authorization === 'Bearer unavailable-fixture-token'
        ? { data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }
        : [mfaToken('aal1'), mfaToken('aal2')].some((token) => authorization === `Bearer ${token}`)
          ? { data: { user: { id: 'owner-123', factors: [{ status: 'verified' }] } }, error: null }
          : authorization === 'Bearer valid-fixture-token'
            ? { data: { user: { id: 'owner-123' } }, error: null }
            : { data: { user: null }, error: { message: 'invalid' } },
  },
});
const app = require('../apps/api/src/app');
const service = require('../apps/api/src/services/harvestService');
const expenseService = require('../apps/api/src/services/expenseService');
const expenseInput = {
  first_weight: 10000,
  second_weight: 4000,
  wage_per_kg: 250,
  driver_cost: 450000,
  publish: true,
};
const harvestId = '00000000-0000-0000-0000-000000000003';

test('verified users cannot call financial API until MFA session reaches AAL2', async () => {
  const before = financeCalls.length;
  await request(app)
    .get('/api/finance/integrity')
    .set('Authorization', `Bearer ${mfaToken('aal1')}`)
    .expect(403);
  assert.equal(financeCalls.length, before);
  await request(app)
    .get('/api/finance/integrity')
    .set('Authorization', `Bearer ${mfaToken('aal2')}`)
    .expect(200);
  assert.equal(financeCalls.length, before + 1);
});

test('template and cost allocation APIs reject forged fields and missing versions before RPC', async () => {
  const auth = 'Bearer valid-fixture-token',
    key = '00000000-0000-0000-0000-000000000099';
  const template = {
    name: 'Bensin',
    category: 'other',
    items: [{ description: 'Bensin', amount: 100 }],
    next_date: '2026-10-08',
    frequency: 'monthly',
    active: true,
  };
  for (const fields of [
    { ...template, user_id: 'forged' },
    { ...template, next_date: '2026-02-30' },
    { ...template, items: [{ description: 'Bensin', amount: 0 }] },
    { ...template, items: [{ description: 'Bensin', amount: 1.001 }] },
  ])
    await request(app)
      .post('/api/productivity/template')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(fields)
      .expect(400);
  await request(app)
    .patch(`/api/productivity/apply_template/${harvestId}`)
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
    .send({})
    .expect(428);
  await request(app)
    .post('/api/productivity/allocate_cost')
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
    .send({ harvest_id: harvestId, cash_expense_id: harvestId, amount: 1, reason: 'short' })
    .expect(400);
  await request(app)
    .post('/api/productivity/template')
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
    .send(template)
    .expect(201);
  assert.equal(financeCalls.at(-1).name, 'productivity_command');
});

test('template page API validates cursors and search, verifies MFA and forwards only bounded owner-scoped arguments', async () => {
  const auth = 'Bearer valid-fixture-token',
    before = financeCalls.length;
  await request(app).get('/api/templates').expect(401);
  await request(app)
    .get('/api/templates')
    .set('Authorization', `Bearer ${mfaToken('aal1')}`)
    .expect(403);
  for (const query of [
    { before: 'invalid' },
    { search: 'x'.repeat(121) },
    { user_id: 'forged' },
    { search: ['a', 'b'] },
  ])
    await request(app).get('/api/templates').query(query).set('Authorization', auth).expect(400);
  assert.equal(financeCalls.length, before);
  await request(app)
    .get('/api/templates')
    .query({ search: 'Semprot', before: harvestId })
    .set('Authorization', auth)
    .expect(200);
  assert.deepEqual(financeCalls.at(-1), {
    name: 'transaction_template_page',
    args: { p_search: 'Semprot', p_before: harvestId },
    authorization: auth,
  });
  await request(app).get('/api/templates').set('Authorization', auth).expect(200);
  assert.deepEqual(financeCalls.at(-1).args, { p_search: '', p_before: null });
});

test('health responds, security headers set, unknown routes return JSON', async () => {
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.headers['x-powered-by'], undefined);
  assert.equal(health.headers['cache-control'], 'no-store');
  await request(app).get('/unknown').expect(404);
});

test('legacy full-history endpoints direct authenticated clients to bounded snapshots', async () => {
  for (const path of ['/api/harvests', '/api/cash-expenses']) {
    const response = await request(app)
      .get(path)
      .set('Authorization', 'Bearer valid-fixture-token')
      .expect(410);
    assert.match(response.body.message, /workspace/);
  }
});

test('auth network failure is a temporary server error rather than an expired session', async () => {
  const response = await request(app)
    .get('/api/workspace')
    .set('Authorization', 'Bearer unavailable-fixture-token')
    .expect(503);
  assert.match(response.body.message, /autentikasi belum tersedia/);
});
test('all harvest APIs require valid verified authentication', async () => {
  await request(app).get('/api/workspace').expect(401);
  await request(app).get('/api/harvests').expect(401);
  await request(app).post('/api/harvests').send({}).expect(401);
  await request(app).patch('/api/spks/id').send({}).expect(401);
  await request(app).post(`/api/harvests/${harvestId}/expenses`).send(expenseInput).expect(401);
  await request(app).patch('/api/expenses/id').send(expenseInput).expect(401);
  await request(app)
    .get('/api/harvests')
    .set('Authorization', 'Bearer expired-fixture-token')
    .expect(401);
});

test('allocation APIs enforce retry keys and edit versions before saving', async () => {
  const input = {
    expense_date: '2026-10-06',
    items: [{ description: 'Allocation', amount: 100 }],
    publish: true,
  };
  for (const category of [
    'savings',
    'investment',
    'savings_expense',
    'investment_expense',
    'other_income',
  ]) {
    await request(app)
      .post(`/api/cash-expenses/${category}`)
      .set('Authorization', 'Bearer valid-fixture-token')
      .send(input)
      .expect(400);
    await request(app)
      .patch(`/api/cash-expenses/${category}/${harvestId}`)
      .set('Authorization', 'Bearer valid-fixture-token')
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .send(input)
      .expect(428);
  }
  await request(app)
    .get('/api/workspace?year=10000')
    .set('Authorization', 'Bearer valid-fixture-token')
    .expect(400);
  await request(app)
    .get('/api/workspace?month=2026-13')
    .set('Authorization', 'Bearer valid-fixture-token')
    .expect(400);
  await request(app)
    .get('/api/workspace?cash_after=invalid')
    .set('Authorization', 'Bearer valid-fixture-token')
    .expect(400);
});
test('expense API validates input and derives ownership from the verified session', async () => {
  await request(app)
    .post(`/api/harvests/${harvestId}/expenses`)
    .set('Authorization', 'Bearer valid-fixture-token')
    .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
    .set('If-Match', '1')
    .send({ ...expenseInput, total_expense: 0 })
    .expect(400);
  await request(app)
    .post(`/api/harvests/${harvestId}/expenses`)
    .set('Authorization', 'Bearer valid-fixture-token')
    .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
    .set('If-Match', '1')
    .send({ ...expenseInput, driver_cost: -1 })
    .expect(400);
  await request(app)
    .patch('/api/expenses/invalid')
    .set('Authorization', 'Bearer valid-fixture-token')
    .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
    .set('If-Match', '1')
    .send(expenseInput)
    .expect(400);
  const original = expenseService.createExpense;
  expenseService.createExpense = async (_database, group, input, userId) => {
    assert.equal(userId, 'owner-123');
    assert.equal(group, harvestId);
    assert.deepEqual(input, expenseInput);
    return { id: 'expense', ...input, overall_weight: 6000, total_expense: 1950000 };
  };
  try {
    const result = await request(app)
      .post(`/api/harvests/${harvestId}/expenses`)
      .set('Authorization', 'Bearer valid-fixture-token')
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .set('If-Match', '1')
      .send(expenseInput)
      .expect(201);
    assert.equal(result.body.data.total_expense, 1950000);
  } finally {
    expenseService.createExpense = original;
  }
});
test('controller validates UUID, fields, and dates before calling service', async () => {
  await request(app)
    .post('/api/harvests')
    .set('Authorization', 'Bearer valid-fixture-token')
    .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
    .set('If-Match', '1')
    .send({ name: 'Panen', harvest_date: '2026-02-30' })
    .expect(400);
  await request(app)
    .patch('/api/spks/invalid')
    .set('Authorization', 'Bearer valid-fixture-token')
    .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
    .set('If-Match', '1')
    .send({})
    .expect(400);
  await request(app)
    .post('/api/harvests')
    .set('Authorization', 'Bearer valid-fixture-token')
    .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
    .set('If-Match', '1')
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
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .set('If-Match', '1')
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

test('cash expense API verifies session, validates category and uses verified ownership', async () => {
  const cashService = require('../apps/api/src/services/cashExpenseService');
  const input = {
    expense_date: '2026-10-06',
    items: [{ description: 'Bensin', amount: 100000 }],
    publish: true,
  };
  await request(app).get('/api/cash-expenses').expect(401);
  await request(app).post('/api/cash-expenses/garden').send(input).expect(401);
  await request(app).patch('/api/cash-expenses/garden/invalid').send(input).expect(401);
  for (const path of ['/api/cash-expenses/invalid', '/api/cash-expenses/garden/invalid']) {
    await request(app)
      [path.endsWith('/invalid') && path.includes('/garden/') ? 'patch' : 'post'](path)
      .set('Authorization', 'Bearer valid-fixture-token')
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .set('If-Match', '1')
      .send(input)
      .expect(400);
  }
  await request(app)
    .post('/api/cash-expenses/garden')
    .set('Authorization', 'Bearer valid-fixture-token')
    .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
    .set('If-Match', '1')
    .send({ ...input, user_id: 'other' })
    .expect(400);
  const original = cashService.save;
  cashService.save = async (_database, category, fields, userId) => {
    assert.equal(category, 'garden');
    assert.equal(userId, 'owner-123');
    assert.deepEqual(fields, input);
    return { total_expense: 100000 };
  };
  try {
    await request(app)
      .post('/api/cash-expenses/garden')
      .set('Authorization', 'Bearer valid-fixture-token')
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .set('If-Match', '1')
      .send(input)
      .expect(201);
  } finally {
    cashService.save = original;
  }
});

test('other expense API supports create/edit and propagates locked-record errors', async () => {
  const cashService = require('../apps/api/src/services/cashExpenseService');
  const { AppError } = require('../apps/api/src/libs/errors');
  const id = '00000000-0000-0000-0000-000000000004';
  const input = {
    expense_date: '2026-10-06',
    items: [{ description: 'Perbaikan alat', amount: 100000 }],
    publish: true,
  };
  const original = cashService.save;
  cashService.save = async (_database, category, fields, userId, requestedId) => {
    assert.equal(category, 'other');
    assert.equal(userId, 'owner-123');
    assert.deepEqual(fields, input);
    if (requestedId) assert.equal(requestedId, id);
    return { id, category, total_expense: 100000 };
  };
  try {
    await request(app)
      .post('/api/cash-expenses/other')
      .set('Authorization', 'Bearer valid-fixture-token')
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .set('If-Match', '1')
      .send(input)
      .expect(201);
    await request(app)
      .patch(`/api/cash-expenses/other/${id}`)
      .set('Authorization', 'Bearer valid-fixture-token')
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .set('If-Match', '1')
      .send(input)
      .expect(200);
    cashService.save = async () => {
      throw new AppError(409, 'Pengeluaran terkunci.');
    };
    await request(app)
      .patch(`/api/cash-expenses/other/${id}`)
      .set('Authorization', 'Bearer valid-fixture-token')
      .set('Idempotency-Key', '00000000-0000-0000-0000-000000000099')
      .set('If-Match', '1')
      .send(input)
      .expect(409);
  } finally {
    cashService.save = original;
  }
});

test('finance commands reject missing retry keys, invalid precision and stale edit context before RPC', async () => {
  const body = { month: '2026-10', category: 'garden', amount: 120 },
    auth = 'Bearer valid-fixture-token',
    key = '00000000-0000-0000-0000-000000000099';
  await request(app).post('/api/finance/budget').set('Authorization', auth).send(body).expect(400);
  for (const fields of [
    { ...body, amount: 1.001 },
    { ...body, month: '0000-01' },
    { ...body, user_id: 'forged-owner' },
  ])
    await request(app)
      .post('/api/finance/budget')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(fields)
      .expect(400);
  await request(app)
    .patch('/api/finance/budget/00000000-0000-0000-0000-000000000003')
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
    .send(body)
    .expect(428);
  const before = financeCalls.length;
  await request(app)
    .post('/api/finance/reconcile')
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
    .send({
      account_id: '00000000-0000-0000-0000-000000000003',
      date: '2026-10-08',
      amount: 120,
      note: '',
    })
    .expect(400);
  assert.equal(financeCalls.length, before);
  await request(app)
    .post('/api/finance/budget')
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
    .send(body)
    .expect(201);
  assert.equal(financeCalls.length, before + 1);
  const call = financeCalls.at(-1);
  assert.equal(call.name, 'finance_command');
  assert.equal(call.args.p_request_key, key);
  assert.deepEqual(call.args.p_fields, body);
  assert.equal(call.authorization, auth);
  assert.equal(call.args.p_fields.user_id, undefined);
  await request(app).get('/api/exports').expect(401);
  await request(app)
    .post('/api/receipts')
    .set('Authorization', auth)
    .send({ source_id: 'invalid' })
    .expect(400);
});
