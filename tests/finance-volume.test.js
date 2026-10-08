const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { database } = require('./helpers/database');

test('100000 active journal events keep cash exact and interactive responses bounded', async (t) => {
  const db = await database(),
    owner = randomUUID();
  try {
    await db.exec(
      `insert into auth.users values('${owner}');set role authenticated;set request.jwt.claim.sub='${owner}';`,
    );
    const f = (await db.query('select public.finance_snapshot() data')).rows[0].data;
    await db.query('select public.finance_command($1,$2,$3) data', [
      'activate',
      {
        expected_revision: f.revision,
        opening_date: '2020-01-01',
        openings: { cash: 0, bank: 0, savings: 0, investment: 0 },
      },
      randomUUID(),
    ]);
    const account = (
      await db.query("select id from public.finance_accounts where default_key='cash'")
    ).rows[0].id;
    await db.exec(`reset role;
      insert into public.finance_events(user_id,event_date,kind,flow_type,category,description,amount,account_id,metadata)
      select '${owner}',(now() at time zone 'Asia/Makassar')::date-(i%2000),'source','income','other_income','Arsip pemasukan',1.23,'${account}',jsonb_build_object('note',repeat('x',300)) from generate_series(1,100000) i;
      insert into public.finance_movements(event_id,user_id,account_id,delta) select id,user_id,account_id,amount from public.finance_events where user_id='${owner}';
      update public.finance_accounts set balance=(select sum(delta) from public.finance_movements where account_id='${account}') where id='${account}';
      set role authenticated;`);
    const start = performance.now(),
      snapshot = (await db.query('select public.workspace_snapshot() data')).rows[0].data;
    const ms = Math.round(performance.now() - start),
      bytes = Buffer.byteLength(JSON.stringify(snapshot));
    t.diagnostic(`100000 active journal: ${ms} ms snapshot, ${bytes} bytes; PGlite test runtime`);
    assert.equal(snapshot.allTimeCash, '123000.00');
    assert.equal(snapshot.finance.totalFunds, '123000.00');
    assert.equal(snapshot.finance.journal.length, 20);
    assert.equal(snapshot.finance.journalHasNext, true);
    assert.ok(bytes < 100000);
    assert.equal(
      snapshot.finance.journal.some((row) => row.metadata !== undefined),
      false,
    );
    const next = (
      await db.query('select public.finance_snapshot(p_before:=$1::bigint) data', [
        snapshot.finance.journal.at(-1).seq,
      ])
    ).rows[0].data;
    assert.equal(next.journal.length, 20);
    assert.equal(
      next.journal.some((row) =>
        snapshot.finance.journal.some((previous) => previous.id === row.id),
      ),
      false,
    );
    const month = (
      await db.query("select to_char(now() at time zone 'Asia/Makassar','YYYY-MM') as period_month")
    ).rows[0].period_month;
    const filtered = (await db.query('select public.finance_snapshot(p_month:=$1) data', [month]))
      .rows[0].data;
    assert.ok(filtered.journal.length > 0);
    assert.ok(filtered.journal.every((row) => row.event_date.startsWith(month)));
    const filteredNext = (
      await db.query('select public.finance_snapshot(p_month:=$1,p_before:=$2::bigint) data', [
        month,
        filtered.journal.at(-1).seq,
      ])
    ).rows[0].data;
    assert.ok(filteredNext.journal.every((row) => row.event_date.startsWith(month)));
    assert.equal(
      filteredNext.journal.some((row) =>
        filtered.journal.some((previous) => previous.id === row.id),
      ),
      false,
    );
    assert.equal(
      (await db.query("select public.finance_snapshot(p_month:='1900-01') data")).rows[0].data
        .journal.length,
      0,
    );
    assert.equal((await db.query('select public.finance_integrity() data')).rows[0].data.ok, true);
  } finally {
    await db.close();
  }
});
test('active account journal imports 5000 records exactly and exports sequential bounded batches', async (t) => {
  const db = await database(),
    owner = randomUUID();
  try {
    await db.exec(`insert into auth.users values('${owner}');insert into public.cash_expenses(user_id,category,expense_date,items,published_at)
    select '${owner}','other_income','2026-09-01','[{"description":"Arsip pemasukan","amount":999999999999.99}]'::jsonb,now() from generate_series(1,5000);
    set role authenticated;set request.jwt.claim.sub='${owner}';`);
    const rpc = async (name, values, types) =>
      (
        await db.query(
          `select public.${name}(${types.map((type, i) => '$' + (i + 1) + type).join(',')}) data`,
          values,
        )
      ).rows[0].data;
    const initial = (await db.query('select public.finance_snapshot() data')).rows[0].data;
    await rpc(
      'finance_command',
      [
        'activate',
        JSON.stringify({
          expected_revision: initial.revision,
          opening_date: '2026-01-01',
          openings: { cash: 0, bank: 0, savings: 0, investment: 0 },
        }),
        randomUUID(),
      ],
      ['', '::jsonb', '::uuid'],
    );
    const started = performance.now(),
      snapshot = (await db.query('select public.workspace_snapshot(p_year:=2026) data')).rows[0]
        .data;
    t.diagnostic(
      `5000 active ledger records: ${Math.round(performance.now() - started)} ms, ${Buffer.byteLength(JSON.stringify(snapshot))} bytes`,
    );
    assert.equal(snapshot.allTimeCash, '4999999999999950.00');
    assert.equal(snapshot.finance.periodIncome, snapshot.allTimeCash);
    assert.equal(snapshot.finance.totalFunds, snapshot.allTimeCash);
    assert.equal(snapshot.finance.journal.length, 20);
    assert.equal(snapshot.finance.journalHasNext, true);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 100000);
    assert.equal(
      snapshot.finance.analysis.find((p) => p.key === '2026-09').closingCash,
      snapshot.allTimeCash,
    );
    const next = (
      await db.query('select public.finance_snapshot(p_before:=$1::bigint) data', [
        snapshot.finance.journal.at(-1).seq,
      ])
    ).rows[0].data;
    assert.equal(next.journal.length, 20);
    assert.equal(
      next.journal.some((e) => snapshot.finance.journal.some((p) => p.id === e.id)),
      false,
    );
    const job = await rpc(
        'finance_create_export',
        ['1900-01-01', '2026-10-08', randomUUID()],
        ['::date', '::date', '::uuid'],
      ),
      lease = randomUUID();
    await rpc('finance_claim_export', [job.id, lease], ['::uuid', '::uuid']);
    let cursor = '0',
      count = 0;
    for (let part = 0; part < 25; part++) {
      const rows = await rpc('finance_export_batch', [job.id, lease], ['::uuid', '::uuid']);
      assert.equal(rows.length, 200);
      assert.ok(BigInt(rows[0].seq) > BigInt(cursor));
      const result = await rpc(
        'finance_advance_export',
        [
          job.id,
          lease,
          cursor,
          rows.at(-1).seq,
          rows.length,
          100,
          'a'.repeat(64),
          `${owner}/${job.id}/${cursor}.csv`,
        ],
        ['::uuid', '::uuid', '::bigint', '::bigint', '::int', '::int', '', ''],
      );
      cursor = result.cursor_seq;
      count += rows.length;
    }
    assert.equal(count, 5000);
    assert.deepEqual(await rpc('finance_export_batch', [job.id, lease], ['::uuid', '::uuid']), []);
    await rpc('finance_finish_export', [job.id, lease, true], ['::uuid', '::uuid', '::boolean']);
    assert.equal(
      (
        await db.query('select row_count::text as n from public.finance_export_jobs where id=$1', [
          job.id,
        ])
      ).rows[0].n,
      '5000',
    );
  } finally {
    await db.close();
  }
});
