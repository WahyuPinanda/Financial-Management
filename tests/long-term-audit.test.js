const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { database } = require('./helpers/database');

test('large routine details stay paginated; future publications, competing submissions and rollback preserve cash', async (t) => {
  const db = await database(),
    owner = randomUUID(),
    other = randomUUID();
  try {
    await db.exec(`insert into auth.users values('${owner}'),('${other}');
      insert into public.transaction_templates(user_id,name,category,items,frequency,next_date,anchor_day)
      select '${owner}','Template '||i,'garden',(select jsonb_agg(jsonb_build_object('description',repeat('x',160),'amount',1)) from generate_series(1,50)),
      'monthly','2026-01-31',31 from generate_series(1,100) i;
      set role authenticated;set request.jwt.claim.sub='${owner}';`);
    const rpc = async (name, args) =>
      (
        await db.query(
          `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as data`,
          args,
        )
      ).rows[0].data;
    const save = (kind, fields, id = null, version = null) =>
      rpc('save_financial_record', [kind, fields, randomUUID(), id, version]);
    const command = (kind, fields, id = null, version = null, key = randomUUID()) =>
      rpc('productivity_command', [kind, fields, key, id, version]);
    const start = performance.now(),
      snapshot = await rpc('workspace_snapshot', []),
      bytes = Buffer.byteLength(JSON.stringify(snapshot));
    t.diagnostic(
      `100 templates × 50 lines: ${Math.round(performance.now() - start)} ms workspace, ${bytes} bytes`,
    );
    assert.equal(snapshot.productivity.templateCount, 100);
    assert.equal(snapshot.productivity.templates.length, 0);
    assert.equal(snapshot.productivity.reminderTemplates.length, 100);
    assert.equal(
      snapshot.productivity.reminderTemplates.some((t) => t.items !== undefined),
      false,
    );
    assert.ok(bytes < 350000);
    const seen = [],
      firstPage = await rpc('transaction_template_page', ['', null]);
    let page = firstPage;
    for (let n = 0; n < 5; n++) {
      assert.equal(page.rows.length, 20);
      seen.push(...page.rows.map((r) => r.id));
      if (page.hasNext) page = await rpc('transaction_template_page', ['', page.rows.at(-1).id]);
    }
    assert.equal(page.hasNext, false);
    assert.equal(new Set(seen).size, 100);
    assert.equal((await rpc('transaction_template_page', ['Template 100', null])).rows.length, 1);
    assert.equal((await rpc('transaction_template_page', ["%' OR true --", null])).rows.length, 0);
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await rpc('transaction_template_page', ['', null])).rows.length, 0);
    await db.exec(`set request.jwt.claim.sub='${owner}';`);
    const dates = (
      await db.query(
        "select (now() at time zone 'Asia/Makassar')::date::text as today,((now() at time zone 'Asia/Makassar')::date+1)::text as future",
      )
    ).rows[0];
    const h = await save('harvest', { name: 'Panen masa depan', harvest_date: dates.future });
    const cash = {
      expense_date: dates.future,
      items: [{ description: 'Bukan uang aktual', amount: 100 }],
      publish: false,
    };
    const draft = await save('other_income', cash);
    await assert.rejects(
      save('other_income', { ...cash, publish: true }, draft.id, draft.version),
      /masa depan/,
    );
    const spk = {
      harvest_id: h.id,
      company_name: 'Perusahaan',
      delivery_date: dates.future,
      bunch_count: 1,
      first_weight: 2,
      second_weight: 1,
      deduction_kg: 0,
      price_per_kg: 100,
      publish: true,
    };
    await assert.rejects(save('spk', spk), /masa depan/);
    await assert.rejects(
      save('harvest_expense', {
        harvest_id: h.id,
        first_weight: 2,
        second_weight: 1,
        wage_per_kg: 1,
        driver_cost: 0,
        publish: true,
      }),
      /masa depan/,
    );
    assert.equal(Number((await rpc('workspace_snapshot', [])).allTimeCash), 0);
    await save('spk', { ...spk, delivery_date: dates.today });
    const routine = firstPage.rows[0],
      use = {
        scheduled_date: routine.next_date,
        transaction: {
          expense_date: dates.today,
          items: [{ description: 'race-template', amount: 25 }],
          publish: true,
        },
      };
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => command('apply_template', use, routine.id, routine.version)),
    );
    assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from public.cash_expenses where items->0->>'description'='race-template'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(Number((await rpc('workspace_snapshot', [])).allTimeCash), 75);
    const f = await rpc('finance_snapshot', []);
    await rpc('finance_command', [
      'activate',
      {
        expected_revision: f.revision,
        opening_date: '2026-01-01',
        openings: { cash: 1000, bank: 0, savings: 0, investment: 0 },
      },
      randomUUID(),
    ]);
    const enabled = await rpc('finance_snapshot', []),
      reserve = enabled.accounts.find((a) => a.kind === 'savings'),
      source = enabled.accounts.find((a) => a.default_key === 'cash');
    const routine2 = firstPage.rows[1];
    const updated = await command(
      'template',
      {
        name: 'Belanja tabungan',
        category: 'savings_expense',
        items: [{ description: 'Pupuk', amount: 10 }],
        account_id: reserve.id,
        frequency: 'monthly',
        next_date: '2026-01-31',
        active: true,
      },
      routine2.id,
      routine2.version,
    );
    const use2 = {
        scheduled_date: updated.next_date,
        transaction: {
          expense_date: dates.today,
          account_id: reserve.id,
          items: updated.items,
          publish: true,
        },
      },
      key = randomUUID();
    await assert.rejects(
      command('apply_template', use2, updated.id, updated.version, key),
      /mencukupi/,
    );
    let current = (
      await db.query(
        'select version,next_date::text from public.transaction_templates where id=$1',
        [updated.id],
      )
    ).rows[0];
    assert.equal(current.version, updated.version);
    assert.equal(current.next_date, updated.next_date);
    assert.equal((await rpc('finance_snapshot', [])).availableCash, enabled.availableCash);
    await rpc('finance_command', [
      'transfer',
      {
        account_id: source.id,
        destination_id: reserve.id,
        amount: 10,
        date: dates.today,
        description: 'Dana belanja',
      },
      randomUUID(),
    ]);
    const spent = await command('apply_template', use2, updated.id, updated.version, key);
    const retry = await command('apply_template', use2, updated.id, updated.version, key);
    assert.equal(retry.id, spent.id);
    current = await rpc('finance_snapshot', []);
    assert.equal(Number(current.availableCash), 1065);
    assert.equal(Number(current.savingsBalance), 0);
    await db.exec(
      `reset role;insert into auth.mfa_factors values('${randomUUID()}','${owner}','verified');set role authenticated;`,
    );
    await assert.rejects(rpc('transaction_template_page', ['', null]), /dua langkah/);
    await assert.rejects(rpc('finance_snapshot', []), /dua langkah/);
    await assert.rejects(rpc('workspace_snapshot', []), /dua langkah/);
    await assert.rejects(rpc('finance_snapshot_without_mfa', []), /permission denied/);
    await assert.rejects(rpc('workspace_snapshot_without_mfa', []), /permission denied/);
  } finally {
    await db.close();
  }
});
