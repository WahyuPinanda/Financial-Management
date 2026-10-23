const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { database } = require('./helpers/database');

test('compressed ledger aggregates preserve complete snapshots, pagination, ownership and MFA', async () => {
  const migration = '202610230002_bounded_finance_aggregation.sql';
  const db = await database({ before: migration });
  const owner = randomUUID(),
    other = randomUUID();
  const command = async (kind, fields) =>
    (
      await db.query('select public.finance_command($1,$2::jsonb,$3) data', [
        kind,
        JSON.stringify(fields),
        randomUUID(),
      ])
    ).rows[0].data;
  const save = async (fields, id = null, version = null, kind = 'other_income') =>
    (
      await db.query('select public.save_financial_record($1,$2::jsonb,$3,$4,$5) data', [
        kind,
        JSON.stringify(fields),
        randomUUID(),
        id,
        version,
      ])
    ).rows[0].data;
  try {
    await db.query('insert into auth.users values($1),($2)', [owner, other]);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}'`);
    await command('activate', {
      expected_revision: 1,
      opening_date: '2025-12-01',
      openings: { cash: 10000, bank: 1000, savings: 500, investment: 500 },
    });
    const accounts = (await db.query('select public.finance_snapshot() data')).rows[0].data
      .accounts;
    const account = (key) => accounts.find((a) => a.default_key === key).id;
    for (let i = 0; i < 25; i++) {
      const fields = {
        expense_date: i % 2 ? '2025-12-20' : '2026-01-10',
        items: [{ description: `Income ${i}`, amount: 100.25 + i }],
        publish: true,
        account_id: account('cash'),
      };
      const row = await save(fields);
      if (i % 3 === 0)
        await save(
          { ...fields, items: [{ description: `Edited ${i}`, amount: 75.12 + i }] },
          row.id,
          row.version,
        );
    }
    for (const [from, to, amount] of [
      ['cash', 'bank', 100],
      ['bank', 'cash', 25],
      ['cash', 'savings', 50],
      ['savings', 'cash', 40],
    ])
      await command('transfer', {
        account_id: account(from),
        destination_id: account(to),
        date: '2026-01-10',
        amount,
        description: 'Transfer equivalence',
      });
    for (const amount of [10.01, -2.02])
      await command('correction', {
        account_id: account('cash'),
        date: '2026-01-10',
        amount,
        reason: 'Verify signed cash totals',
      });
    await command('budget', { month: '2026-01', category: 'garden', amount: 100 });
    await command('goal', {
      account_id: account('savings'),
      name: 'Goal equivalence',
      target: 1000,
      due_date: '2026-12-31',
    });
    const samples = [];
    async function snapshots(routine = 'finance_snapshot') {
      const values = [];
      for (const month of ['all', '2025-12', '2026-01', '1900-01'])
        for (const period of ['month', 'year']) {
          const data = (
            await db.query(`select public.${routine}($1,2026,$2) data`, [month, period])
          ).rows[0].data;
          values.push(data);
          if (data.journalHasNext)
            values.push(
              (
                await db.query(`select public.${routine}($1,2026,$2,$3::bigint) data`, [
                  month,
                  period,
                  data.journal.at(-1).seq,
                ])
              ).rows[0].data,
            );
        }
      return values;
    }
    samples.push(...(await snapshots()));
    const permissions = (
      await db.query(
        "select oid,proowner,proacl,prosecdef,proconfig from pg_proc where proname in('finance_snapshot_without_mfa','workspace_snapshot_without_mfa','productivity_snapshot') order by oid",
      )
    ).rows;
    await db.exec('reset role');
    await db.exec(readFileSync(resolve(__dirname, '../supabase/migrations', migration), 'utf8'));
    assert.deepEqual(
      (
        await db.query(
          "select oid,proowner,proacl,prosecdef,proconfig from pg_proc where proname in('finance_snapshot_without_mfa','workspace_snapshot_without_mfa','productivity_snapshot') order by oid",
        )
      ).rows,
      permissions,
    );
    await db.exec('set role authenticated');
    assert.deepEqual(await snapshots(), samples);
    await db.exec('reset role');
    const reference = (
      await db.query(
        "select pg_get_functiondef('public.finance_snapshot_without_mfa(text,integer,text,bigint,bigint)'::regprocedure) definition",
      )
    ).rows[0].definition;
    await db.exec(
      reference.replace(
        'public.finance_snapshot_without_mfa(',
        'public.finance_snapshot_reference(',
      ),
    );
    await db.exec(
      readFileSync(
        resolve(
          __dirname,
          '../supabase/migrations/202610230003_transactional_finance_daily_totals.sql',
        ),
        'utf8',
      ),
    );
    await db.exec('set role authenticated');
    assert.deepEqual(
      await snapshots(),
      samples,
      'Backfill must preserve all values and cursor pages',
    );
    for (const kind of [
      'garden',
      'other',
      'savings',
      'investment',
      'savings_expense',
      'investment_expense',
      'other_income',
    ]) {
      const fields = {
        expense_date: '2026-01-10',
        items: [{ description: `New ${kind}`, amount: 10.25 }],
        publish: true,
        account_id: account(
          kind === 'savings_expense'
            ? 'savings'
            : kind === 'investment_expense'
              ? 'investment'
              : 'cash',
        ),
      };
      const row = await save(fields, null, null, kind);
      await save(
        { ...fields, items: [{ description: `Edited ${kind}`, amount: 8.12 }] },
        row.id,
        row.version,
        kind,
      );
      assert.deepEqual(
        await snapshots(),
        await snapshots('finance_snapshot_reference'),
        `${kind} reversal and replacement must remain exact`,
      );
    }
    for (const [from, to] of [
      ['cash', 'bank'],
      ['bank', 'cash'],
      ['cash', 'savings'],
      ['savings', 'cash'],
    ]) {
      await command('transfer', {
        account_id: account(from),
        destination_id: account(to),
        date: '2026-01-10',
        amount: 1.23,
        description: 'Cached transfer',
      });
      assert.deepEqual(await snapshots(), await snapshots('finance_snapshot_reference'));
    }
    const beforeFailure = await snapshots();
    await assert.rejects(
      command('transfer', {
        account_id: account('cash'),
        destination_id: account('bank'),
        date: '2026-01-10',
        amount: 1e12,
        description: 'Overdraft rollback',
      }),
      /Saldo/,
    );
    assert.deepEqual(
      await snapshots(),
      beforeFailure,
      'Rejected writes must roll back the cache too',
    );
    await assert.rejects(
      db.query('select * from public.finance_daily_totals'),
      /permission denied/,
    );
    await assert.rejects(db.query('delete from public.finance_daily_totals'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    const isolated = (await db.query('select public.finance_snapshot() data')).rows[0].data;
    assert.equal(isolated.accounts.length, 0);
    assert.equal(isolated.journal.length, 0);
    await db.exec(
      `reset role;insert into auth.mfa_factors values('${randomUUID()}','${owner}','verified');set role authenticated;set request.jwt.claim.sub='${owner}'`,
    );
    await assert.rejects(
      db.query('select public.finance_snapshot()'),
      (error) => error.code === '42501',
    );
    await assert.rejects(
      db.query('select public.finance_snapshot_without_mfa()'),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
