const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const ownerA = '00000000-0000-0000-0000-000000000001';
const ownerB = '00000000-0000-0000-0000-000000000002';
test('expense PostgreSQL migration enforces financial calculation, ownership, and immutable 7-day window', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${ownerA}'), ('${ownerB}');`);
    const directory = resolve(__dirname, '../supabase/migrations');
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await db.exec(readFileSync(resolve(directory, name), 'utf8'));
    }
    const harvest = (
      await db.query(
        "insert into public.harvests(user_id,name,harvest_date) values ($1,'Panen A','2026-10-05') returning id",
        [ownerA],
      )
    ).rows[0];
    const otherHarvest = (
      await db.query(
        "insert into public.harvests(user_id,name,harvest_date) values ($1,'Panen B','2026-10-05') returning id",
        [ownerA],
      )
    ).rows[0];
    const insertExpense = async (owner = ownerA, publish = true, group = harvest.id) =>
      (
        await db.query(
          `insert into public.harvest_expenses
      (harvest_id,user_id,first_weight,second_weight,wage_per_kg,driver_cost,published_at)
      values ($1,$2,10000,4000,250,450000,$3) returning *`,
          [group, owner, publish ? '2000-01-01T00:00:00Z' : null],
        )
      ).rows[0];
    const expense = await insertExpense();
    const draft = await insertExpense(ownerA, false);
    await db.query(
      `insert into public.spks(harvest_id,user_id,company_name,delivery_date,bunch_count,first_weight,second_weight,deduction_kg,price_per_kg,published_at)
      values($1,$2,'PT Sawit','2026-10-05',500,10000,4000,120,3000,now()),
      ($1,$2,'PT Kedua','2026-10-05',100,5000,3000,0,3000,now())`,
      [harvest.id, ownerA],
    );
    const balance = async () =>
      Number(
        (
          await db.query(
            `select
      coalesce((select sum(total_income) from public.spks where harvest_id=$1 and published_at is not null),0)
      - coalesce((select sum(total_expense) from public.harvest_expenses where harvest_id=$1 and published_at is not null),0) as net`,
            [harvest.id],
          )
        ).rows[0].net,
      );

    await t.test(
      'generated values match example, drafts excluded, and incoming SPKs aggregate independently',
      async () => {
        assert.equal(Number(expense.overall_weight), 6000);
        assert.equal(Number(expense.labor_cost), 1500000);
        assert.equal(Number(expense.total_expense), 1950000);
        assert.ok(Math.abs(Date.now() - Date.parse(expense.published_at)) < 10000);
        assert.equal(await balance(), 21690000); // 17.64m + 6m - 1.95m; draft ignored.
        await assert.rejects(
          db.query('update public.harvest_expenses set total_expense=0 where id=$1', [expense.id]),
          /can only be updated to DEFAULT/,
        );
        await assert.rejects(
          db.query('update public.harvest_expenses set second_weight=10000 where id=$1', [
            expense.id,
          ]),
          /check constraint/,
        );
        await assert.rejects(
          db.query('update public.harvest_expenses set driver_cost=-1 where id=$1', [expense.id]),
          /check constraint/,
        );
      },
    );
    await t.test(
      'allowed edits recompute expenses and income without resetting publication',
      async () => {
        await db.exec(`set role authenticated; set request.jwt.claim.sub='${ownerA}';`);
        const result = (
          await db.query(
            'update public.harvest_expenses set wage_per_kg=300 where id=$1 returning *',
            [expense.id],
          )
        ).rows[0];
        assert.equal(Number(result.total_expense), 2250000);
        assert.equal(Date.parse(result.published_at), Date.parse(expense.published_at));
        assert.equal(await balance(), 21390000);
        await assert.rejects(
          db.query('update public.harvest_expenses set published_at=null where id=$1', [
            expense.id,
          ]),
          /Waktu publikasi/,
        );
        await assert.rejects(
          db.query('update public.harvest_expenses set harvest_id=$1 where id=$2', [
            otherHarvest.id,
            expense.id,
          ]),
          /Identitas/,
        );
        await assert.rejects(
          db.query("update public.harvest_expenses set created_at='2000-01-01' where id=$1", [
            expense.id,
          ]),
          /Identitas/,
        );
      },
    );
    await t.test(
      'another account cannot read or modify expenses or attach its costs to owner A',
      async () => {
        await db.exec(`set request.jwt.claim.sub='${ownerB}';`);
        assert.equal((await db.query('select * from public.harvest_expenses')).rows.length, 0);
        assert.equal(
          (
            await db.query(
              'update public.harvest_expenses set driver_cost=0 where id=$1 returning id',
              [expense.id],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(insertExpense(ownerA), /row-level security/);
        await assert.rejects(insertExpense(ownerB), /foreign key/);
      },
    );
    await t.test(
      'at 7 days edits and unpublishing fail; deletion cannot bypass the lock',
      async () => {
        await db.exec(`reset role; alter table public.harvest_expenses disable trigger guard_harvest_expense_write;
        update public.harvest_expenses set published_at=clock_timestamp()-interval '7 days' where id='${expense.id}';
        alter table public.harvest_expenses enable trigger guard_harvest_expense_write;
        set role authenticated; set request.jwt.claim.sub='${ownerA}';`);
        await assert.rejects(
          db.query('update public.harvest_expenses set driver_cost=0 where id=$1', [expense.id]),
          /Pengeluaran terkunci/,
        );
        await assert.rejects(
          db.query('update public.harvest_expenses set published_at=null where id=$1', [
            expense.id,
          ]),
          /Pengeluaran terkunci/,
        );
        await assert.rejects(
          db.query('delete from public.harvest_expenses where id=$1', [expense.id]),
          /permission denied/,
        );
      },
    );
    await t.test(
      'publishing draft uses server time and immediately reduces main income',
      async () => {
        const result = (
          await db.query(
            "update public.harvest_expenses set published_at='2000-01-01' where id=$1 returning published_at",
            [draft.id],
          )
        ).rows[0];
        assert.ok(Math.abs(Date.now() - Date.parse(result.published_at)) < 10000);
        assert.equal(await balance(), 19440000);
      },
    );
    await t.test('anonymous account cannot read financial expenses', async () => {
      await db.exec('reset role; set role anon;');
      await assert.rejects(db.query('select * from public.harvest_expenses'), /permission denied/);
    });
  } finally {
    await db.close();
  }
});
