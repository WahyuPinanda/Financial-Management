const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateSpk,
  canEdit,
  EDIT_WINDOW_MS,
  spkSchema,
  harvestSchema,
  summarize,
} = require('@sawit/shared');

const input = {
  company_name: 'PT. Sawit',
  delivery_date: '2026-10-05',
  bunch_count: 500,
  first_weight: 10000,
  second_weight: 4000,
  deduction_kg: 120,
  price_per_kg: 3000,
  publish: true,
};

test('SPK: potongan 120 kg dari 6000 kg = 2%; pendapatan Rp17.640.000', () => {
  assert.deepEqual(calculateSpk(input), {
    gross_weight: 6000,
    net_weight: 5880,
    deduction_percent: 2,
    total_income: 17640000,
  });
});
test('income preview rounds decimal ties like PostgreSQL NUMERIC', () => {
  assert.equal(
    calculateSpk({ first_weight: 2, second_weight: 1.9, deduction_kg: 0, price_per_kg: 10.05 })
      .total_income,
    1.01,
  );
});
test('reject invalid weights, deduction, date, decimals, and untrusted computed fields', () => {
  for (const change of [
    { second_weight: 10000 },
    { deduction_kg: 6001 },
    { price_per_kg: 0 },
    { bunch_count: 0 },
    { bunch_count: 1.5 },
    { first_weight: NaN },
    { deduction_kg: 1.111 },
    { delivery_date: '2026-02-30' },
    { delivery_date: '2026-13-01' },
    { total_income: 1 },
    { published_at: '2020-01-01' },
    { user_id: 'other' },
  ]) {
    assert.equal(
      spkSchema.safeParse({ ...input, ...change }).success,
      false,
      JSON.stringify(change),
    );
  }
  assert.equal(harvestSchema.safeParse({ name: ' ', harvest_date: '2026-10-05' }).success, false);
  assert.equal(
    spkSchema.safeParse({ ...input, first_weight: 1.2, second_weight: 1.1, deduction_kg: 0.1 })
      .success,
    true,
  );
});
test('drafts always editable; published SPK locks at exactly 7 x 24 hours', () => {
  const published = '2026-10-01T08:00:00.000Z';
  const deadline = Date.parse(published) + EDIT_WINDOW_MS;
  assert.equal(canEdit(null, deadline + 100), true);
  assert.equal(canEdit(published, deadline - 1), true);
  assert.equal(canEdit(published, deadline), false);
  assert.equal(canEdit(published, deadline + 1), false);
});
test('multi-SPK totals exclude drafts and use weighted deduction percentage', () => {
  const spks = [
    { ...input, ...calculateSpk(input), published_at: '2026-10-05' },
    {
      ...input,
      ...calculateSpk({
        first_weight: 5000,
        second_weight: 3000,
        deduction_kg: 200,
        price_per_kg: 3000,
      }),
      deduction_kg: 200,
      published_at: '2026-10-05',
    },
    { ...input, ...calculateSpk(input), published_at: null },
  ];
  const total = summarize(spks);
  assert.equal(total.income, 23040000);
  assert.equal(total.gross, 8000);
  assert.equal(total.deductionPercent, 4); // 320 / 8000; not (2% + 10%) / 2.
  assert.equal(total.count, 2);
});
