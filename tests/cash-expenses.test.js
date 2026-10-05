const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cashExpenseSchema, sumCashItems, applyCashExpenses, summarize } = require('@sawit/shared');

const input = {
  expense_date: '2026-10-06',
  items: [
    { description: 'Ongkos Semprot', amount: 300000 },
    { description: 'Bensin', amount: 100000 },
  ],
  publish: true,
};
test('dynamic cash line items validate descriptions, date, precision and totals', () => {
  assert.equal(cashExpenseSchema.parse(input).items.length, 2);
  assert.equal(sumCashItems([...input.items, { description: 'Pruning', amount: 200000 }]), 600000);
  for (const invalid of [
    { ...input, expense_date: '2026-02-30' },
    { ...input, items: [] },
    { ...input, items: [{ description: ' ', amount: 1 }] },
    { ...input, items: [{ description: 'Bensin', amount: -1 }] },
    { ...input, items: [{ description: 'Bensin', amount: 0.001 }] },
    { ...input, items: [{ description: 'Bensin', amount: 0 }] },
    {
      ...input,
      items: [
        { description: 'A', amount: 1e12 },
        { description: 'B', amount: 1 },
      ],
    },
    { ...input, user_id: 'someone' },
    { ...input, total_expense: 1 },
  ])
    assert.equal(cashExpenseSchema.safeParse(invalid).success, false);
});
test('cash subtracts published garden items once and recalculates after editing', () => {
  const base = {
    ...summarize([]),
    income: 1000000,
    netIncome: 900000,
    expenses: 100000,
    expenseCount: 1,
  };
  const rows = [
    { published_at: '2026-10-06', total_expense: 400000 },
    { published_at: null, total_expense: 999999 },
  ];
  assert.equal(applyCashExpenses(base, rows).netIncome, 500000);
  rows[0].total_expense = 600000;
  const result = applyCashExpenses(base, rows);
  assert.equal(result.netIncome, 300000);
  assert.equal(result.expenses, 700000);
  assert.equal(result.expenseCount, 2);
  assert.equal(sumCashItems([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
  assert.equal(
    applyCashExpenses({ ...base, netIncome: 0.3 }, [{ published_at: 'now', total_expense: 0.1 }])
      .netIncome,
    0.2,
  );
});
