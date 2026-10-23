const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { database } = require('./helpers/database');

test('manual harvest expense weight preserves history and controls cash, retries, ownership and seven-day locking', async () => {
  const db = await database({ before: '202610230001' });
  const owner = randomUUID(),
    other = randomUUID();
  const save = async (fields, id = null, version = null, key = randomUUID()) =>
    (
      await db.query('select public.save_financial_record($1,$2::jsonb,$3,$4,$5) as data', [
        'harvest_expense',
        JSON.stringify(fields),
        key,
        id,
        version,
      ])
    ).rows[0].data;
  const snapshot = async () =>
    (await db.query('select public.finance_snapshot() as data')).rows[0].data;
  const tables = [
    'harvest_expenses',
    'finance_events',
    'finance_movements',
    'financial_audit',
    'finance_source_heads',
  ];
  const history = async () =>
    Promise.all(
      tables.map(
        async (table) =>
          (
            await db.query(
              `select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`,
            )
          ).rows,
      ),
    );
  try {
    await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
    const today = (
      await db.query("select (clock_timestamp() at time zone 'Asia/Makassar')::date::text as day")
    ).rows[0].day;
    await db.query('select public.finance_command($1,$2::jsonb,$3)', [
      'activate',
      JSON.stringify({
        expected_revision: 1,
        opening_date: today,
        openings: { cash: 5000000, bank: 0, savings: 0, investment: 0 },
      }),
      randomUUID(),
    ]);
    const harvest = (
      await db.query('select public.save_financial_record($1,$2::jsonb,$3) as data', [
        'harvest',
        JSON.stringify({ name: 'Manual weight test', harvest_date: today }),
        randomUUID(),
      ])
    ).rows[0].data;
    const fields = {
      harvest_id: harvest.id,
      first_weight: 10000,
      second_weight: 4000,
      wage_per_kg: 250,
      driver_cost: 450000,
      publish: true,
    };
    const legacy = await save(fields);
    assert.equal(Number(legacy.overall_weight), 6000);
    assert.equal(Number((await snapshot()).totalFunds), 3050000);
    await db.exec('reset role');
    const previousHistory = await history();
    const securityBefore = (
      await db.query(
        "select oid,proacl,proowner,prosecdef,proconfig from pg_proc where oid='public.save_financial_record_without_mfa(text,jsonb,uuid,uuid,integer)'::regprocedure",
      )
    ).rows;
    await db.exec(
      readFileSync(
        resolve(__dirname, '../supabase/migrations/202610230001_manual_harvest_expense_weight.sql'),
        'utf8',
      ),
    );
    assert.deepEqual(await history(), previousHistory);
    const securityAfter = (
      await db.query(
        "select oid,proacl,proowner,prosecdef,proconfig from pg_proc where oid='public.save_financial_record_without_mfa(text,jsonb,uuid,uuid,integer)'::regprocedure",
      )
    ).rows;
    assert.deepEqual(securityAfter, securityBefore);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
    const key = randomUUID(),
      draftFields = { ...fields, overall_weight: 5880, publish: false };
    const draft = await save(draftFields, null, null, key);
    assert.equal(Number(draft.overall_weight), 5880);
    assert.equal(Number(draft.labor_cost), 1470000);
    assert.equal(Number(draft.total_expense), 1920000);
    assert.equal((await save(draftFields, null, null, key)).id, draft.id);
    assert.equal(Number((await snapshot()).totalFunds), 3050000);
    await assert.rejects(
      save({ ...draftFields, overall_weight: 5700 }, null, null, key),
      (e) => e.code === 'P0001',
    );
    const published = await save(
      { ...draftFields, overall_weight: 5700, publish: true },
      draft.id,
      draft.version,
    );
    assert.equal(Number(published.total_expense), 1875000);
    assert.equal(Number((await snapshot()).totalFunds), 1175000);
    const revised = await save({ ...fields, overall_weight: 5880 }, legacy.id, legacy.version);
    assert.equal(revised.published_at, legacy.published_at);
    assert.equal(Number((await snapshot()).totalFunds), 1205000);
    const unchanged = await save({ ...fields, wage_per_kg: 250 }, legacy.id, revised.version);
    assert.equal(
      Number(unchanged.overall_weight),
      5880,
      'An older client must preserve manual weight on edit',
    );
    await assert.rejects(
      save({ ...fields, overall_weight: 5600 }, legacy.id, legacy.version),
      (e) => e.code === 'P0001',
    );
    for (const weight of [0, -1, 6000.01, 1.001, null, '5880']) {
      await assert.rejects(save({ ...draftFields, overall_weight: weight }), (e) =>
        ['22023', '23514'].includes(e.code),
      );
    }
    assert.equal(Number((await snapshot()).totalFunds), 1205000);
    const workspace = (
      await db.query('select public.workspace_snapshot(p_view=>$1,p_harvest_id=>$2) as data', [
        'pengeluaran',
        harvest.id,
      ])
    ).rows[0].data;
    assert.equal(
      Number(workspace.activeHarvest.expenses.find((e) => e.id === legacy.id).overall_weight),
      5880,
    );
    assert.equal(
      (await db.query('select public.finance_integrity() as data')).rows[0].data.ok,
      true,
    );
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    assert.equal((await db.query('select * from public.harvest_expenses')).rows.length, 0);
    await assert.rejects(
      save({ ...fields, overall_weight: 5600 }, legacy.id, unchanged.version),
      (e) => e.code === 'P0001',
    );
    await db.exec(`reset role; set request.jwt.claim.sub='${owner}';
      alter table public.harvest_expenses disable trigger guard_harvest_expense_write;
      update public.harvest_expenses set published_at=clock_timestamp()-interval '7 days' where id='${legacy.id}';
      alter table public.harvest_expenses enable trigger guard_harvest_expense_write;
      set role authenticated; set request.jwt.claim.sub='${owner}'`);
    const locked = (
      await db.query('select version from public.harvest_expenses where id=$1', [legacy.id])
    ).rows[0];
    await assert.rejects(
      save({ ...fields, overall_weight: 5600 }, legacy.id, locked.version),
      /terkunci/,
    );
    assert.equal(Number((await snapshot()).totalFunds), 1205000);
    await db.exec('reset role');
    const allowed = (
      await db.query(
        "select has_function_privilege('authenticated','public.save_financial_record_without_mfa(text,jsonb,uuid,uuid,integer)','execute') as access",
      )
    ).rows[0].access;
    assert.equal(allowed, false);
  } finally {
    await db.close();
  }
});
