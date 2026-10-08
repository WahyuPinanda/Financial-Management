const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarvestExpenseCsv } = require('@sawit/shared');
const expense = {
  id: 'expense-1',
  first_weight: 10000,
  second_weight: 4000,
  overall_weight: 6000,
  wage_per_kg: 250,
  labor_cost: 1500000,
  driver_cost: 450000,
  total_expense: 1950000,
  published_at: '2026-10-08T00:30:00Z',
  editable: true,
};

test('expense export contains displayed costs and publication state, never SPK revenue', () => {
  const csv = createHarvestExpenseCsv({
    name: 'Kebun A',
    harvest_date: '2026-10-08',
    spks: [{ company_name: 'Wrong SPK', total_income: 987654321 }],
    expenses: [
      expense,
      {
        ...expense,
        id: 'draft-2',
        driver_cost: 450000.25,
        total_expense: 1950000.25,
        published_at: null,
      },
      { ...expense, id: 'locked-3', editable: false },
    ],
  });
  assert.ok(csv.startsWith('\ufeff'));
  assert.equal(csv.split('\r\n').length, 4);
  assert.ok(csv.includes('"6000";"250";"1500000";"450000";"1950000";"Publikasi"'));
  assert.ok(csv.includes('"450000,25";"1950000,25";"Draft";"Belum dipublikasikan"'));
  assert.ok(csv.includes('"Terkunci"'));
  assert.ok(csv.includes('08.30'));
  assert.equal(csv.includes('Wrong SPK'), false);
  assert.equal(csv.includes('987654321'), false);
  assert.equal(csv.includes('Pendapatan Rp'), false);
});
test('expense export handles selected empty pages, quoted descriptions and spreadsheet formulas', () => {
  assert.equal(
    createHarvestExpenseCsv({ name: 'Empty', harvest_date: '2026-10-08', expenses: [] }).split(
      '\r\n',
    ).length,
    1,
  );
  const csv = createHarvestExpenseCsv({
    name: '=HYPERLINK("bad");Kebun',
    harvest_date: '2026-10-08',
    expenses: [expense],
  });
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"");Kebun"'));
  assert.equal(csv.split('\r\n').length, 2);
});
