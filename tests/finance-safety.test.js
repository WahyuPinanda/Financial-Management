const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { performance } = require('node:perf_hooks');
const { PGlite } = require('@electric-sql/pglite');
const { LatestRequest } = require('@sawit/shared');
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';

test('only the latest read can publish data; navigation and unmount cancel older reads', () => {
  const latest = new LatestRequest();
  const first = latest.begin();
  const second = latest.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  let visible = '';
  if (second.isCurrent()) visible = 'new balance';
  if (first.isCurrent()) visible = 'old balance';
  assert.equal(visible, 'new balance');
  latest.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});

test('atomic writes, allocations, exact totals and bounded snapshots survive large histories', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
      insert into auth.users values('${owner}'),('${other}');`);
    const directory = resolve(__dirname, '../supabase/migrations');
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await db.exec(readFileSync(resolve(directory, name), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const save = async (kind, fields, key = randomUUID(), id = null, version = null) =>
      (
        await db.query(
          'select public.save_financial_record($1,$2::jsonb,$3::uuid,$4::uuid,$5::integer) as data',
          [kind, JSON.stringify(fields), key, id, version],
        )
      ).rows[0].data;
    const snapshot = async (view = 'savings', after = null, period = 'month') =>
      (
        await db.query(
          'select public.workspace_snapshot(p_view:=$1,p_cash_after:=$2::uuid,p_period:=$3,p_year:=2026) as data',
          [view, after, period],
        )
      ).rows[0].data;
    const fields = {
      expense_date: '2026-10-06',
      items: [{ description: 'Pupuk', amount: 1000 }],
      publish: true,
    };
    const key = randomUUID();
    let savings;
    await t.test(
      'retry keys cannot double-subtract cash or be reused for different data',
      async () => {
        savings = await save('savings', fields, key);
        const replay = await save('savings', fields, key);
        assert.equal(replay.id, savings.id);
        assert.equal((await snapshot()).totals.netIncome, '-1000.00');
        await assert.rejects(
          save('savings', { ...fields, items: [{ description: 'A', amount: 2000 }] }, key),
          /Kunci permintaan/,
        );
        await assert.rejects(
          db.query("update public.financial_requests set response='{}'"),
          /permission denied/,
        );
      },
    );
    await t.test(
      'competing edits require the original version and preserve the publication window',
      async () => {
        const edit = { ...fields, items: [{ description: 'Pupuk', amount: 1500 }] };
        const changed = await save('savings', edit, randomUUID(), savings.id, savings.version);
        assert.equal(changed.version, 2);
        assert.equal(Date.parse(changed.published_at), Date.parse(savings.published_at));
        await assert.rejects(
          save(
            'savings',
            { ...edit, items: [{ description: 'Pupuk', amount: 2000 }] },
            randomUUID(),
            savings.id,
            1,
          ),
          /Data sudah berubah/,
        );
        assert.equal((await snapshot()).totals.netIncome, '-1500.00');
        savings = changed;
      },
    );
    let investment;
    await t.test(
      'all financial kinds reconcile with analysis and drafts are excluded',
      async () => {
        investment = await save('investment', {
          ...fields,
          items: [{ description: 'Replanting', amount: 500 }],
        });
        await save('savings', { ...fields, publish: false });
        const harvest = await save('harvest', { name: 'Panen', harvest_date: '2026-10-06' });
        const spk = await save('spk', {
          harvest_id: harvest.id,
          company_name: 'PT Sawit',
          delivery_date: '2026-10-06',
          bunch_count: 100,
          first_weight: 100,
          second_weight: 10,
          deduction_kg: 0,
          price_per_kg: 100,
          publish: true,
        });
        const expense = await save('harvest_expense', {
          harvest_id: harvest.id,
          first_weight: 100,
          second_weight: 10,
          wage_per_kg: 1,
          driver_cost: 10,
          publish: true,
        });
        let result = await snapshot();
        assert.equal(result.totals.income, '9000.00');
        assert.equal(result.totals.expenses, '2100.00');
        assert.equal(result.totals.netIncome, '6900.00');
        const october = result.analysis.find((row) => row.key === '2026-10');
        assert.equal(october.savingsAllocations, '1500.00');
        assert.equal(october.investmentAllocations, '500.00');
        assert.equal(october.closingCash, result.allTimeCash);
        assert.equal((await snapshot('savings', null, 'year')).analysis.at(-1).net, '6900.00');
        await save(
          'spk',
          {
            company_name: 'PT Sawit',
            delivery_date: '2026-10-06',
            bunch_count: 100,
            first_weight: 100,
            second_weight: 10,
            deduction_kg: 0,
            price_per_kg: 200,
            publish: true,
          },
          randomUUID(),
          spk.id,
          spk.version,
        );
        await assert.rejects(
          save(
            'harvest_expense',
            {
              first_weight: 100,
              second_weight: 10,
              wage_per_kg: 2,
              driver_cost: 10,
              publish: true,
            },
            randomUUID(),
            expense.id,
            99,
          ),
          /Data sudah berubah/,
        );
        result = await snapshot();
        assert.equal(result.totals.netIncome, '15900.00');
        assert.equal(
          result.analysis.find((row) => row.key === '2026-10').closingCash,
          result.allTimeCash,
        );
      },
    );
    await t.test(
      'another owner cannot edit allocations, read totals or forge cached transactions',
      async () => {
        await db.exec(`set request.jwt.claim.sub='${other}';`);
        assert.equal((await snapshot()).allTimeCash, '0');
        await assert.rejects(
          save('investment', fields, randomUUID(), investment.id, investment.version),
          /Data sudah berubah/,
        );
        assert.equal((await db.query('select * from public.financial_requests')).rows.length, 0);
        await db.exec(`set request.jwt.claim.sub='${owner}';`);
      },
    );
    await t.test(
      'allocation edit and date changes are rejected at the seven-day boundary',
      async () => {
        await db.exec(`reset role; alter table public.cash_expenses disable trigger guard_cash_expense_write;
        update public.cash_expenses set published_at=clock_timestamp()-interval '7 days' where id='${investment.id}';
        alter table public.cash_expenses enable trigger guard_cash_expense_write;
        set role authenticated; set request.jwt.claim.sub='${owner}';`);
        const version = (
          await db.query('select version from public.cash_expenses where id=$1', [investment.id])
        ).rows[0].version;
        await assert.rejects(
          save(
            'investment',
            { ...fields, expense_date: '2026-10-07' },
            randomUUID(),
            investment.id,
            version,
          ),
          /Pengeluaran terkunci/,
        );
      },
    );
    await t.test(
      '50000 extra rows keep balances exact, transport bounded, and cursor pages stable after edits',
      async () => {
        await db.exec(`reset role;
        insert into public.cash_expenses(user_id,category,expense_date,items,published_at)
        select '${owner}','savings','2026-10-06','[{"description":"Historical allocation","amount":0.01}]'::jsonb,now() from generate_series(1,50000);
        set role authenticated; set request.jwt.claim.sub='${owner}';`);
        const started = performance.now();
        const first = await snapshot();
        t.diagnostic(
          `50000-row snapshot: ${Math.round(performance.now() - started)} ms, ${Buffer.byteLength(JSON.stringify(first))} bytes`,
        );
        assert.equal(first.cashExpenses.length, 20);
        assert.equal(first.pages.cash.count, 50002);
        assert.equal(first.pages.cash.hasNext, true);
        assert.equal(first.totals.netIncome, '15400.00');
        assert.equal(
          first.analysis.find((row) => row.key === '2026-10').closingCash,
          first.allTimeCash,
        );
        assert.ok(Buffer.byteLength(JSON.stringify(first)) < 100000);
        const cursor = first.cashExpenses.at(-1).id;
        const row = first.cashExpenses[0];
        await save(
          'savings',
          { ...fields, items: [{ description: 'Changed allocation', amount: 0.02 }] },
          randomUUID(),
          row.id,
          row.version,
        );
        const second = await snapshot('savings', cursor);
        assert.equal(second.cashExpenses.length, 20);
        assert.equal(second.totals.netIncome, '15399.99');
        assert.equal(
          second.cashExpenses.some((row) =>
            first.cashExpenses.some((before) => row.id === before.id),
          ),
          false,
        );
        await db.exec(`reset role; insert into public.cash_expenses(user_id,category,expense_date,items,published_at)
        select '${other}','other','2026-10-06','[{"description":"Large","amount":999999999999.99}]'::jsonb,now() from generate_series(1,1000);
        set role authenticated; set request.jwt.claim.sub='${other}';`);
        assert.equal((await snapshot('other')).allTimeCash, '-999999999999990.00');
      },
    );
    await t.test(
      'SQL analysis handles year boundaries, changed dates and full SPK totals beyond one page',
      async () => {
        const isolated = '00000000-0000-0000-0000-000000000004';
        await db.exec(
          `reset role; insert into auth.users values('${isolated}'); set role authenticated; set request.jwt.claim.sub='${isolated}';`,
        );
        await save('savings', {
          ...fields,
          expense_date: '2025-12-31',
          items: [{ description: 'December', amount: 100 }],
        });
        const january = await save('investment', {
          ...fields,
          expense_date: '2026-01-01',
          items: [{ description: 'January', amount: 50 }],
        });
        let result = await snapshot('investment');
        let jan = result.analysis.find((row) => row.key === '2026-01');
        assert.equal(jan.previousNet, '-100.00');
        assert.equal(jan.growthPercent, 50);
        assert.equal(jan.openingCash, '-100.00');
        assert.equal(jan.closingCash, '-150.00');
        await save(
          'investment',
          {
            ...fields,
            expense_date: '2026-02-01',
            items: [{ description: 'February', amount: 50 }],
          },
          randomUUID(),
          january.id,
          january.version,
        );
        result = await snapshot('investment');
        jan = result.analysis.find((row) => row.key === '2026-01');
        assert.equal(jan.net, '0');
        assert.equal(jan.closingCash, '-100.00');
        assert.equal(result.analysis.find((row) => row.key === '2026-02').closingCash, '-150.00');
        const annual = (await snapshot('investment', null, 'year')).analysis.at(-1);
        assert.equal(annual.net, '-50.00');
        assert.equal(annual.closingCash, '-150.00');
        const harvest = await save('harvest', { name: 'Large group', harvest_date: '2026-10-06' });
        for (let i = 0; i < 25; i++)
          await save('spk', {
            harvest_id: harvest.id,
            company_name: 'Company',
            delivery_date: '2026-10-06',
            bunch_count: 1,
            first_weight: 10,
            second_weight: 0,
            deduction_kg: 0,
            price_per_kg: 10,
            publish: true,
          });
        result = await snapshot('panen');
        assert.equal(result.activeHarvest.spks.length, 20);
        assert.equal(result.pages.spk.count, 25);
        assert.equal(result.activeTotals.income, '2500.00');
        assert.equal(result.allTimeCash, '2350.00');
        assert.equal(
          result.analysis.find((row) => row.key === '2026-10').closingCash,
          result.allTimeCash,
        );
        await db.exec('reset role; set role anon;');
        assert.equal(
          (await db.query('select public.database_healthcheck() as data')).rows[0].data.ok,
          true,
        );
        await assert.rejects(db.query('select public.workspace_snapshot()'), /permission denied/);
      },
    );
  } finally {
    await db.close();
  }
});
