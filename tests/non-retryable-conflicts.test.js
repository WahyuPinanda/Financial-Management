const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { database } = require('./helpers/database');

test('business conflicts abort without retryable SQLSTATE and preserve cash and MFA boundaries', async () => {
  const db = await database();
  const owner = randomUUID();
  try {
    const retryable = await db.query(
      `select proname from pg_proc where pronamespace='public'::regnamespace
       and prokind='f' and prosrc ~* 'errcode[[:space:]]*=[[:space:]]*''40001'''`,
    );
    assert.equal(retryable.rows.length, 0);
    const privateRoutines = await db.query(
      `select oid::regprocedure::text as signature from pg_proc
       where pronamespace='public'::regnamespace and proname like '%without_mfa'
       and (has_function_privilege('authenticated',oid,'execute')
         or has_function_privilege('anon',oid,'execute'))`,
    );
    assert.equal(privateRoutines.rows.length, 0);
    await db.query('insert into auth.users values ($1)', [owner]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
    await db.query('select public.finance_command($1,$2::jsonb,$3)', [
      'activate',
      JSON.stringify({
        expected_revision: 1,
        opening_date: '2026-01-01',
        openings: { cash: 0, bank: 0, savings: 0, investment: 0 },
      }),
      randomUUID(),
    ]);
    const save = async (kind, fields, key = randomUUID(), id = null, version = null) =>
      (
        await db.query('select public.save_financial_record($1,$2::jsonb,$3,$4,$5) as data', [
          kind,
          JSON.stringify(fields),
          key,
          id,
          version,
        ])
      ).rows[0].data;
    const fields = {
      expense_date: '2026-01-01',
      items: [{ description: 'Income conflict regression', amount: 100 }],
      publish: true,
    };
    const key = randomUUID();
    const first = await save('other_income', fields, key);
    const revised = await save(
      'other_income',
      { ...fields, items: [{ description: 'Revised', amount: 150 }] },
      randomUUID(),
      first.id,
      first.version,
    );
    assert.equal(Number(revised.total_expense), 150);
    await assert.rejects(
      save('other_income', fields, randomUUID(), first.id, first.version),
      (error) => error.code === 'P0001' && /Data sudah berubah/.test(error.message),
    );
    await assert.rejects(
      save('other_income', { ...fields, items: [{ description: 'Different', amount: 200 }] }, key),
      (error) => error.code === 'P0001' && /Kunci permintaan/.test(error.message),
    );
    const snapshot = (await db.query('select public.finance_snapshot() as data')).rows[0].data;
    assert.equal(Number(snapshot.availableCash), 150);
  } finally {
    await db.close();
  }
});
