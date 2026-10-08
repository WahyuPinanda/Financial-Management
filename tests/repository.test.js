const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listHarvests } = require('../apps/api/src/repositories/harvestRepository');

test('repository reads beyond Supabase default limits and attaches every SPK to its group', async () => {
  const harvests = Array.from({ length: 1001 }, (_, index) => ({
    id: `harvest-${index}`,
    harvest_date: '2026-10-05',
  }));
  const spks = Array.from({ length: 1203 }, (_, index) => ({
    id: `spk-${index}`,
    harvest_id: 'harvest-0',
    created_at: '2026-10-05T00:00:00Z',
  }));
  const calls = [];
  const expenses = Array.from({ length: 1102 }, (_, index) => ({
    id: `expense-${index}`,
    harvest_id: 'harvest-0',
    created_at: '2026-10-05T00:00:00Z',
  }));
  const database = {
    from(table) {
      return {
        select() {
          return this;
        },
        order() {
          return this;
        },
        async range(start, end) {
          calls.push({ table, start, end });
          return {
            data: (table === 'harvests' ? harvests : table === 'spks' ? spks : expenses).slice(
              start,
              end + 1,
            ),
            error: null,
          };
        },
      };
    },
  };
  const result = await listHarvests(database);
  assert.equal(result.length, 1001);
  assert.equal(result[0].spks.length, 1203);
  assert.equal(result[1000].spks.length, 0);
  assert.equal(result[0].expenses.length, 1102);
  assert.equal(result[1000].expenses.length, 0);
  assert.equal(calls.filter((call) => call.table === 'harvest_expenses').length, 3);
  assert.equal(calls.filter((call) => call.table === 'spks').length, 3);
});
