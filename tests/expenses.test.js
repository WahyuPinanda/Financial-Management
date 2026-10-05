const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateExpense, expenseSchema, summarize } = require('@sawit/shared');
const service = require('../apps/api/src/services/expenseService');
const repository = require('../apps/api/src/repositories/expenseRepository');

const input = {
  first_weight: 10000,
  second_weight: 4000,
  wage_per_kg: 250,
  driver_cost: 450000,
  publish: true,
};
test('6000 kg x Rp250 + Rp450000 produces Rp1950000 expense', () => {
  assert.deepEqual(calculateExpense(input), {
    overall_weight: 6000,
    labor_cost: 1500000,
    total_expense: 1950000,
  });
  assert.equal(
    calculateExpense({ first_weight: 2, second_weight: 1.9, wage_per_kg: 10.05, driver_cost: 0.2 })
      .total_expense,
    1.21,
  );
});
test('expense validation rejects invalid weights, negative costs, invalid precision and computed/client ownership fields', () => {
  for (const change of [
    { second_weight: 10000 },
    { first_weight: 0 },
    { first_weight: Infinity },
    { wage_per_kg: -1 },
    { driver_cost: -1 },
    { driver_cost: 0.001 },
    { first_weight: 1000001 },
    { driver_cost: 1000000000001 },
    { overall_weight: 10 },
    { labor_cost: 10 },
    { total_expense: 1 },
    { harvest_id: 'other' },
    { user_id: 'other' },
    { published_at: '2020-01-01' },
  ]) {
    assert.equal(
      expenseSchema.safeParse({ ...input, ...change }).success,
      false,
      JSON.stringify(change),
    );
  }
  assert.equal(expenseSchema.safeParse({ ...input, wage_per_kg: 0, driver_cost: 0 }).success, true);
  assert.equal(expenseSchema.safeParse({ ...input, driver_cost: 1500000 }).success, true);
});
test('multiple published expenses automatically reduce income; drafts excluded and edited amounts recalculate', () => {
  const spks = [
    {
      total_income: 17640000,
      net_weight: 5880,
      gross_weight: 6000,
      deduction_kg: 120,
      bunch_count: 500,
      published_at: '2026-10-05',
    },
  ];
  const first = { ...calculateExpense(input), published_at: '2026-10-05' };
  const second = { total_expense: 350000, published_at: '2026-10-05' };
  const draft = { total_expense: 99999999, published_at: null };
  const total = summarize(spks, [first, second, draft]);
  assert.equal(total.income, 17640000);
  assert.equal(total.expenses, 2300000);
  assert.equal(total.netIncome, 15340000);
  assert.equal(total.expenseCount, 2);
  assert.equal(
    summarize(spks, [{ ...first, ...calculateExpense({ ...input, wage_per_kg: 300 }) }, second])
      .netIncome,
    15040000,
  );
  assert.equal(summarize([], [first]).netIncome, -1950000);
  assert.equal(
    summarize(
      [{ ...spks[0], total_income: 0.3 }],
      [{ total_expense: 0.1, published_at: '2026-10-05' }],
    ).netIncome,
    0.2,
  );
});
test('service rejects expired records and preserves original publication time for allowed edits', async () => {
  const originalFind = repository.findExpense;
  const originalUpdate = repository.updateExpense;
  let writes = 0;
  const published = new Date(Date.now() - 1000).toISOString();
  repository.updateExpense = async (_db, id, _input, publishedAt) => {
    writes++;
    assert.equal(publishedAt, published);
    return { id, published_at: publishedAt };
  };
  try {
    repository.findExpense = async () => ({
      published_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    });
    await assert.rejects(service.updateExpense({}, 'expense', input), /Pengeluaran terkunci/);
    assert.equal(writes, 0);
    repository.findExpense = async () => ({ published_at: published });
    const result = await service.updateExpense({}, 'expense', { ...input, publish: false });
    assert.equal(result.published_at, published);
    assert.equal(result.editable, true);
    assert.equal(Date.parse(result.edit_deadline), Date.parse(published) + 7 * 86400000);
    assert.equal(writes, 1);
  } finally {
    repository.findExpense = originalFind;
    repository.updateExpense = originalUpdate;
  }
});
