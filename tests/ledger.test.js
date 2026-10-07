const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { database } = require('./helpers/database');
const owner = '00000000-0000-0000-0000-000000000011';
const other = '00000000-0000-0000-0000-000000000012';
test('account ledger preserves money during transfers, versions edits, audits and reconciles', async () => {
  const db = await database();
  try {
    await db.exec(
      `insert into auth.users values('${owner}'),('${other}'); set role authenticated; set request.jwt.claim.sub='${owner}';`,
    );
    const command = async (kind, fields, key = randomUUID(), id = null, version = null) =>
      (
        await db.query(
          'select public.finance_command($1,$2::jsonb,$3::uuid,$4::uuid,$5::integer) as data',
          [kind, JSON.stringify(fields), key, id, version],
        )
      ).rows[0].data;
    const save = async (kind, fields, key = randomUUID(), id = null, version = null) =>
      (
        await db.query(
          'select public.save_financial_record($1,$2::jsonb,$3::uuid,$4::uuid,$5::integer) as data',
          [kind, JSON.stringify(fields), key, id, version],
        )
      ).rows[0].data;
    await command('activate', {
      expected_revision: 1,
      opening_date: '2026-01-01',
      openings: { cash: 10000, bank: 0, savings: 0, investment: 0 },
    });
    const accounts = () =>
      db.query(
        'select id,default_key,balance::text from public.finance_accounts order by default_key',
      );
    let rows = (await accounts()).rows;
    const cash = rows.find((a) => a.default_key === 'cash').id;
    const bank = rows.find((a) => a.default_key === 'bank').id;
    const savings = rows.find((a) => a.default_key === 'savings').id;
    const fields = {
      expense_date: '2026-10-06',
      items: [{ description: 'Pupuk', amount: 1000 }],
      publish: true,
    };
    const allocation = await save('savings', fields);
    const expense = await save('savings_expense', {
      ...fields,
      items: [{ description: 'Beli pupuk', amount: 250 }],
    });
    rows = (await accounts()).rows;
    assert.equal(rows.find((a) => a.id === cash).balance, '9000.00');
    assert.equal(rows.find((a) => a.id === savings).balance, '750.00');
    const key = randomUUID();
    const transfer = {
      account_id: cash,
      destination_id: bank,
      date: '2026-10-06',
      amount: 500,
      description: 'Transfer bank',
    };
    const first = await command('transfer', transfer, key);
    assert.equal((await command('transfer', transfer, key)).id, first.id);
    assert.equal((await accounts()).rows.find((a) => a.id === cash).balance, '8500.00');
    await save(
      'savings_expense',
      { ...fields, items: [{ description: 'Beli pupuk', amount: 300 }] },
      randomUUID(),
      expense.id,
      expense.version,
    );
    assert.equal((await accounts()).rows.find((a) => a.id === savings).balance, '700.00');
    await assert.rejects(
      save(
        'savings',
        { ...fields, items: [{ description: 'Kurangi alokasi terpakai', amount: 200 }] },
        randomUUID(),
        allocation.id,
        allocation.version,
      ),
      /negatif/,
    );
    assert.equal((await accounts()).rows.find((a) => a.id === savings).balance, '700.00');
    await assert.rejects(
      save('investment', {
        ...fields,
        items: [{ description: 'Alokasi melebihi cash', amount: 20000 }],
      }),
      /mencukupi/,
    );
    await assert.rejects(
      save(
        'savings_expense',
        { ...fields, items: [{ description: 'Beli pupuk', amount: 350 }] },
        randomUUID(),
        expense.id,
        expense.version,
      ),
      /Data sudah berubah/,
    );
    assert.equal(
      (await db.query('select sum(balance)::text as total from public.finance_accounts')).rows[0]
        .total,
      '9700.00',
    );
    const audit = (
      await db.query(
        "select before_data,after_data from public.financial_audit where entity='cash_expenses' and action='UPDATE' order by seq desc limit 1",
      )
    ).rows[0];
    assert.equal(Number(audit.before_data.total_expense), 250);
    assert.equal(Number(audit.after_data.total_expense), 300);
    const reconciled = await command('reconcile', {
      account_id: cash,
      date: '2026-10-06',
      amount: 8499,
      note: 'Saldo fisik',
    });
    assert.equal(reconciled.difference, '-1.00');
    await assert.rejects(
      db.query('update public.finance_events set amount=0'),
      /permission denied/,
    );
    await assert.rejects(db.query('delete from public.financial_audit'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await accounts()).rows.length, 0);
    await assert.rejects(
      command('activate', {
        expected_revision: 1,
        opening_date: '2026-01-01',
        openings: { cash: 0, bank: 0, savings: 0, investment: 0 },
      }).then(() => command('transfer', transfer)),
      /Rekening tidak ditemukan/,
    );
  } finally {
    await db.close();
  }
});
