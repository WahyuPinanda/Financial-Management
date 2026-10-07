const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeCashFlow,
  growthPercent,
  cashFlowEvents,
  applyCashExpenses,
  summarize,
} = require('@sawit/shared');

const publication = '2026-10-06T00:00:00Z';
const harvests = [
  {
    harvest_date: '2026-01-30',
    spks: [
      { delivery_date: '2025-12-30', published_at: publication, total_income: 1000 },
      { delivery_date: '2026-01-30', published_at: publication, total_income: 2000 },
      { delivery_date: '2026-02-01', published_at: publication, total_income: 4000 },
      { delivery_date: '2026-02-01', published_at: null, total_income: 99999 },
    ],
    expenses: [
      { published_at: publication, total_expense: 100 },
      { published_at: null, total_expense: 99999 },
    ],
  },
];
const cash = [
  { expense_date: '2026-01-15', category: 'garden', published_at: publication, total_expense: 200 },
  { expense_date: '2026-01-15', category: 'other', published_at: publication, total_expense: 200 },
  { expense_date: '2026-02-15', category: 'other', published_at: publication, total_expense: 1000 },
  { expense_date: '2026-02-15', category: 'other', published_at: null, total_expense: 99999 },
];

test('other income adds cash and income without increasing costs or counting drafts', () => {
  const additional = [
    ...cash,
    {
      category: 'other_income',
      expense_date: '2026-02-01',
      published_at: publication,
      total_expense: 1250.25,
    },
    {
      category: 'other_income',
      expense_date: '2026-02-01',
      published_at: null,
      total_expense: 99999,
    },
  ];
  const rows = analyzeCashFlow(harvests, additional, {
    period: 'month',
    year: 2026,
    asOf: '2026-02-20',
  });
  assert.equal(rows[1].otherIncome, 1250.25);
  assert.equal(rows[1].income, 5250.25);
  assert.equal(rows[1].expenses, 1000);
  assert.equal(rows[1].closingCash, 6750.25);
  const totals = applyCashExpenses(
    summarize(
      harvests.flatMap((row) => row.spks),
      harvests.flatMap((row) => row.expenses),
    ),
    additional,
  );
  assert.equal(totals.income, 8250.25);
  assert.equal(totals.expenses, 1500);
  assert.equal(totals.expenseCount, 4);
  assert.equal(totals.netIncome, rows[1].closingCash);
  additional.find((row) => row.category === 'other_income').total_expense = 1500.25;
  assert.equal(
    analyzeCashFlow(harvests, additional, { period: 'year', year: 2026 }).at(-1).closingCash,
    7000.25,
  );
});

test('allocation expenses remain separate from allocations and reduce preview cash exactly once', () => {
  const entries = [
    ...cash,
    ...[
      ['savings', 100],
      ['investment', 200],
      ['savings_expense', 25],
      ['investment_expense', 50],
    ].map(([category, total_expense]) => ({
      category,
      total_expense,
      expense_date: '2026-02-01',
      published_at: publication,
    })),
    {
      category: 'savings_expense',
      total_expense: 99999,
      expense_date: '2026-02-01',
      published_at: null,
    },
  ];
  const rows = analyzeCashFlow(harvests, entries, {
    period: 'month',
    year: 2026,
    asOf: '2026-02-20',
  });
  const february = rows[1];
  assert.equal(february.savingsAllocations, 100);
  assert.equal(february.investmentAllocations, 200);
  assert.equal(february.savingsExpenses, 25);
  assert.equal(february.investmentExpenses, 50);
  assert.equal(february.net, 2625);
  assert.equal(february.closingCash, 5125);
  entries.find((row) => row.category === 'savings_expense' && row.published_at).total_expense = 75;
  assert.equal(
    analyzeCashFlow(harvests, entries, { period: 'year', year: 2026 }).at(-1).closingCash,
    5075,
  );
});
test('monthly analysis reconciles all cash costs, dated SPKs and year-crossing growth', () => {
  const rows = analyzeCashFlow(harvests, cash, { period: 'month', year: 2026, asOf: '2026-02-20' });
  assert.equal(rows.length, 2); // Future months do not create false declines.
  assert.equal(rows[0].income, 2000);
  assert.equal(rows[0].expenses, 500);
  assert.equal(rows[0].net, 1500);
  assert.equal(rows[0].openingCash, 1000);
  assert.equal(rows[0].growthPercent, 50); // Compare December 2025.
  assert.equal(rows[1].income, 4000); // SPK date, not harvest date.
  assert.equal(rows[1].net, 3000);
  assert.equal(rows[1].growthPercent, 100);
  assert.equal(rows[1].closingCash, 5500);
  assert.equal(rows[1].partial, true);
  const totals = applyCashExpenses(
    summarize(
      harvests.flatMap((harvest) => harvest.spks),
      harvests.flatMap((harvest) => harvest.expenses),
    ),
    cash,
  );
  assert.equal(rows[1].closingCash, totals.netIncome);
  assert.equal(cashFlowEvents(harvests, cash).length, 7);
});
test('annual analysis uses all twelve months, independent costs and cumulative balance', () => {
  const rows = analyzeCashFlow(harvests, cash, { period: 'year', year: 2026, asOf: '2026-10-06' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].net, 1000);
  assert.equal(rows[0].growthPercent, null);
  assert.equal(rows[1].income, 6000);
  assert.equal(rows[1].expenses, 1500);
  assert.equal(rows[1].growthPercent, 350);
  assert.equal(rows[1].closingCash, 5500);
});
test('zero and negative periods remain finite and missing months are included', () => {
  assert.equal(growthPercent(10, 0), null);
  assert.equal(growthPercent(-100, -200), 50);
  assert.equal(growthPercent(100, -100), 200);
  assert.equal(growthPercent(0, 100), -100);
  const rows = analyzeCashFlow(harvests, cash, { period: 'month', year: 2026 });
  assert.equal(rows[2].net, 0);
  assert.equal(rows[2].growthPercent, -100);
  assert.equal(rows[3].growthPercent, null);
  assert.equal(rows[3].closingCash, 5500);
  assert.equal(
    analyzeCashFlow([], [], { period: 'month', year: 2026 }).every(
      (row) => row.net === 0 && row.growthPercent === null,
    ),
    true,
  );
});
test('decimal currency sums and edited expenses recalculate every period without duplicate costs', () => {
  const costs = [
    {
      expense_date: '2026-01-01',
      category: 'garden',
      published_at: publication,
      total_expense: 0.1,
    },
    {
      expense_date: '2026-01-01',
      category: 'other',
      published_at: publication,
      total_expense: 0.2,
    },
  ];
  let rows = analyzeCashFlow([], costs, { period: 'month', year: 2026 });
  assert.equal(rows[0].net, -0.3);
  costs[1].total_expense = 0.4;
  rows = analyzeCashFlow([], costs, { period: 'month', year: 2026 });
  assert.equal(rows[0].net, -0.5);
  assert.equal(rows[1].closingCash, -0.5);
  assert.throws(() => analyzeCashFlow([], [], { period: 'invalid', year: 2026 }), /tidak valid/);
});
