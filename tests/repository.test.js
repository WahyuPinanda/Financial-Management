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
            data: (table === 'harvests' ? harvests : spks).slice(start, end + 1),
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
  assert.equal(calls.filter((call) => call.table === 'spks').length, 3);
});
