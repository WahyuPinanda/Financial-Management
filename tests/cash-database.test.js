const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';

test('cash expense database calculates line items, enforces ownership and locks publications', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public, auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${owner}'),('${other}');`);
    const directory = resolve(__dirname, '../supabase/migrations');
    for (const file of readdirSync(directory)
      .filter((file) => file.endsWith('.sql'))
      .sort())
      await db.exec(readFileSync(resolve(directory, file), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const insert = async (items, published = true, category = 'garden', userId = owner) =>
      (
        await db.query(
          'insert into public.cash_expenses(user_id,category,expense_date,items,published_at) values($1,$2,$3,$4::jsonb,$5) returning *',
          [userId, category, '2026-10-06', JSON.stringify(items), published ? '2000-01-01' : null],
        )
      ).rows[0];
    const row = await insert([
      { description: 'Semprot', amount: 300000 },
      { description: 'Bensin', amount: 100000 },
    ]);
    assert.equal(Number(row.total_expense), 400000);
    assert.ok(Math.abs(Date.now() - Date.parse(row.published_at)) < 10000);
    const changed = (
      await db.query('update public.cash_expenses set items=$1::jsonb where id=$2 returning *', [
        JSON.stringify([{ description: 'Pruning', amount: 200000.25 }]),
        row.id,
      ])
    ).rows[0];
    assert.equal(Number(changed.total_expense), 200000.25);
    assert.equal(Date.parse(changed.published_at), Date.parse(row.published_at));
    for (const items of [
      [],
      [{ description: '', amount: 1 }],
      [{ description: 'A', amount: -1 }],
      [{ description: 'A', amount: 0.001 }],
      [{ description: 'A', amount: 0 }],
      [{ description: 'A', amount: 1, extra: true }],
    ])
      await assert.rejects(insert(items));
    await assert.rejects(
      db.query('update public.cash_expenses set total_expense=0 where id=$1', [row.id]),
      /can only be updated/,
    );
    await assert.rejects(
      db.query('update public.cash_expenses set published_at=null where id=$1', [row.id]),
      /Waktu publikasi/,
    );
    await assert.rejects(
      db.query("update public.cash_expenses set category='other' where id=$1", [row.id]),
      /Identitas/,
    );
    const draft = await insert([{ description: 'Bensin', amount: 100 }], false);
    const total = async () =>
      Number(
        (
          await db.query(
            'select sum(total_expense) as total from public.cash_expenses where published_at is not null',
          )
        ).rows[0].total,
      );
    assert.equal(await total(), 200000.25);
    await db.query("update public.cash_expenses set published_at='2000-01-01' where id=$1", [
      draft.id,
    ]);
    assert.equal(await total(), 200100.25);
    const otherExpense = await insert(
      [
        { description: 'Perbaikan alat', amount: 50.1 },
        { description: 'Administrasi', amount: 0.2 },
      ],
      true,
      'other',
    );
    assert.equal(Number(otherExpense.total_expense), 50.3);
    assert.equal(await total(), 200150.55);
    await assert.rejects(
      db.query('update public.cash_expenses set published_at=null where id=$1', [otherExpense.id]),
      /Waktu publikasi/,
    );
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select * from public.cash_expenses')).rows.length, 0);
    assert.equal(
      (
        await db.query('update public.cash_expenses set items=$1::jsonb where id=$2 returning id', [
          JSON.stringify([{ description: 'A', amount: 1 }]),
          row.id,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(insert([{ description: 'A', amount: 1 }]), /row-level security/);
    await db.exec(`reset role; alter table public.cash_expenses disable trigger guard_cash_expense_write;
      update public.cash_expenses set published_at=clock_timestamp()-interval '7 days' where id in ('${row.id}', '${otherExpense.id}');
      alter table public.cash_expenses enable trigger guard_cash_expense_write;
      set role authenticated; set request.jwt.claim.sub='${owner}';`);
    await assert.rejects(
      db.query('update public.cash_expenses set expense_date=$1 where id=$2', [
        '2026-10-07',
        row.id,
      ]),
      /Pengeluaran terkunci/,
    );
    await assert.rejects(
      db.query('delete from public.cash_expenses where id=$1', [row.id]),
      /permission denied/,
    );
    await assert.rejects(
      db.query('update public.cash_expenses set expense_date=$1 where id=$2', [
        '2026-10-07',
        otherExpense.id,
      ]),
      /Pengeluaran terkunci/,
    );
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.cash_expenses'), /permission denied/);
  } finally {
    await db.close();
  }
});
