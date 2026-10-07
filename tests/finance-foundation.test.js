const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { database } = require('./helpers/database');
test('historical activation, edited income, budgets, goals, immutable exports and restore remain consistent', async () => {
  const db = await database(),
    owner = randomUUID();
  try {
    await db.exec(
      `insert into auth.users values('${owner}');set role authenticated;set request.jwt.claim.sub='${owner}';`,
    );
    const rpc = async (name, params, casts) =>
      (
        await db.query(
          `select public.${name}(${casts.map((c, i) => '$' + (i + 1) + c).join(',')}) data`,
          params,
        )
      ).rows[0].data;
    const command = (kind, fields, key = randomUUID(), id = null, version = null) =>
      rpc(
        'finance_command',
        [kind, JSON.stringify(fields), key, id, version],
        ['', '::jsonb', '::uuid', '::uuid', '::int'],
      );
    const save = (kind, fields, id = null, version = null) =>
      rpc(
        'save_financial_record',
        [kind, JSON.stringify(fields), randomUUID(), id, version],
        ['', '::jsonb', '::uuid', '::uuid', '::int'],
      );
    const snapshot = (month = 'all') =>
      rpc('finance_snapshot', [month, 2026, 'month'], ['', '::int', '']);
    const fields = {
      expense_date: '2026-10-06',
      items: [{ description: 'Pendapatan kontrak', amount: 1000 }],
      publish: true,
    };
    let income = await save('other_income', fields);
    await save('savings', { ...fields, items: [{ description: 'Pupuk', amount: 200 }] });
    await save('savings_expense', {
      ...fields,
      items: [{ description: 'Belanja pupuk', amount: 50 }],
    });
    let before = await snapshot();
    assert.equal(before.enabled, false);
    assert.equal(Number(before.activationPreview.availableCash), 800);
    assert.equal(Number(before.activationPreview.totalFunds), 950);
    await save('garden', { ...fields, items: [{ description: 'Semprot', amount: 40 }] });
    await assert.rejects(
      command('activate', {
        expected_revision: before.revision,
        opening_date: '2026-01-01',
        openings: { cash: 100, bank: 0, savings: 0, investment: 0 },
      }),
      /berubah/,
    );
    before = await snapshot();
    const activation = {
      expected_revision: before.revision,
      opening_date: '2026-01-01',
      openings: { cash: 100, bank: 0, savings: 0, investment: 0 },
    };
    const activationKey = randomUUID();
    await command('activate', activation, activationKey);
    await command('activate', activation, activationKey);
    let s = await snapshot();
    assert.equal(Number(s.availableCash), 860);
    assert.equal(Number(s.totalFunds), 1010);
    assert.equal(Number(s.savingsBalance), 150);
    assert.equal(
      (await db.query('select version from public.cash_expenses where id=$1', [income.id])).rows[0]
        .version,
      1,
    );
    const cash = s.accounts.find((a) => a.kind === 'cash').id,
      savings = s.accounts.find((a) => a.kind === 'savings').id;
    income = await save(
      'other_income',
      { ...fields, items: [{ description: 'Pendapatan kontrak direvisi', amount: 1200 }] },
      income.id,
      income.version,
    );
    await save('garden', {
      ...fields,
      expense_date: '2026-09-06',
      items: [{ description: 'Bensin September', amount: 80 }],
    });
    const budget = await command('budget', { month: '2026-10', category: 'garden', amount: 60 });
    await assert.rejects(
      command('budget', { month: '2026-10', category: 'garden', amount: 60.001 }),
      /tidak valid/,
    );
    const goal = await command('goal', {
      account_id: savings,
      name: 'Persiapan pupuk',
      target: 1000,
      due_date: '2026-12-01',
    });
    await command(
      'goal',
      { account_id: savings, name: 'Persiapan pupuk baru', target: 1200, due_date: '2026-12-01' },
      randomUUID(),
      goal.id,
      goal.version,
    );
    await assert.rejects(
      command(
        'goal',
        { account_id: savings, name: 'Edit lama', target: 900, due_date: '2026-12-01' },
        randomUUID(),
        goal.id,
        goal.version,
      ),
      /berubah/,
    );
    s = await snapshot('2026-10');
    assert.equal(Number(s.periodIncome), 1200);
    assert.equal(Number(s.periodOutflow), 240);
    assert.equal(Number(s.availableCash), 980);
    assert.equal(Number(s.budgets[0].spent), 40);
    assert.equal(Number(s.goals[0].balance), 150);
    assert.equal(Number(s.analysis.find((p) => p.key === '2026-10').closingCash), 980);
    const year = (
      await rpc('finance_snapshot', ['all', 2026, 'year'], ['', '::int', ''])
    ).analysis.at(-1);
    assert.equal(Number(year.closingCash), 980);
    const currentMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Makassar',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    const allBudgets = (await snapshot()).budgets;
    assert.equal(
      currentMonth === '2026-10' ? Number(allBudgets[0].spent) : allBudgets.length,
      currentMonth === '2026-10' ? 40 : 0,
    );
    await command('correction', {
      account_id: cash,
      date: '2026-10-06',
      amount: -10,
      reason: 'Koreksi setelah pemeriksaan fisik',
      source_kind: 'cash',
      source_id: income.id,
    });
    assert.equal(Number((await snapshot()).availableCash), 970);
    await assert.rejects(
      command('correction', {
        account_id: savings,
        date: '2026-10-06',
        amount: -1000,
        reason: 'Dana tidak mencukupi',
      }),
      /mencukupi/,
    );
    // Two callers cannot spend the same remaining balance. Both must acquire the owner lock.
    const transfers = await Promise.allSettled(
      [1, 2].map(() =>
        command('transfer', {
          account_id: cash,
          destination_id: savings,
          date: '2026-10-06',
          amount: 600,
          description: 'Simpan dana',
        }),
      ),
    );
    assert.equal(transfers.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(Number((await snapshot()).availableCash), 370);
    const { decimalCents } = require('@sawit/shared');
    for (const period of (await snapshot()).analysis) {
      assert.equal(
        decimalCents(period.net),
        decimalCents(period.income) -
          decimalCents(period.expenses) +
          decimalCents(period.transferNet) +
          decimalCents(period.corrections),
      );
    }
    const exportKey = randomUUID();
    const job = await rpc(
      'finance_create_export',
      ['1900-01-01', '2026-10-08', exportKey],
      ['::date', '::date', '::uuid'],
    );
    assert.equal(
      (
        await rpc(
          'finance_create_export',
          ['1900-01-01', '2026-10-08', exportKey],
          ['::date', '::date', '::uuid'],
        )
      ).id,
      job.id,
    );
    const lease = randomUUID();
    const claim = await rpc('finance_claim_export', [job.id, lease], ['::uuid', '::uuid']);
    assert.equal(claim.status, 'processing');
    assert.equal(
      await rpc('finance_claim_export', [job.id, randomUUID()], ['::uuid', '::uuid']),
      null,
    );
    await save('other_income', {
      ...fields,
      items: [{ description: 'Pemasukan sesudah snapshot', amount: 100 }],
    });
    const batch = await rpc('finance_export_batch', [job.id, lease], ['::uuid', '::uuid']);
    assert.ok(batch.length > 0);
    assert.equal(
      batch.some((e) => e.description === 'Pemasukan sesudah snapshot'),
      false,
    );
    await assert.rejects(
      rpc('finance_finish_export', [job.id, lease, true], ['::uuid', '::uuid', '::boolean']),
      /belum lengkap/,
    );
    const args = [
      job.id,
      lease,
      '0',
      batch.at(-1).seq,
      batch.length,
      100,
      'a'.repeat(64),
      `${owner}/${job.id}/0.csv`,
    ];
    await assert.rejects(
      rpc(
        'finance_advance_export',
        [...args.slice(0, 4), 1, ...args.slice(5)],
        ['::uuid', '::uuid', '::bigint', '::bigint', '::int', '::int', '', ''],
      ),
      /melewatkan/,
    );
    await rpc('finance_advance_export', args, [
      '::uuid',
      '::uuid',
      '::bigint',
      '::bigint',
      '::int',
      '::int',
      '',
      '',
    ]);
    assert.deepEqual(await rpc('finance_export_batch', [job.id, lease], ['::uuid', '::uuid']), []);
    await rpc('finance_finish_export', [job.id, lease, true], ['::uuid', '::uuid', '::boolean']);
    assert.equal(
      (await db.query('select status from public.finance_export_jobs where id=$1', [job.id]))
        .rows[0].status,
      'completed',
    );
    const event = (await snapshot()).journal[0];
    const receiptFields = {
      source_kind: 'event',
      source_id: event.id,
      filename: 'bukti.pdf',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'b'.repeat(64),
      request_key: randomUUID(),
    };
    const receipt = await rpc(
      'finance_prepare_receipt',
      [JSON.stringify(receiptFields)],
      ['::jsonb'],
    );
    assert.equal(
      (await rpc('finance_prepare_receipt', [JSON.stringify(receiptFields)], ['::jsonb'])).id,
      receipt.id,
    );
    await assert.rejects(
      rpc(
        'finance_prepare_receipt',
        [JSON.stringify({ ...receiptFields, sha256: 'c'.repeat(64) })],
        ['::jsonb'],
      ),
      /telah dipakai/,
    );
    await assert.rejects(
      rpc('finance_confirm_receipt', [receipt.id, 'c'.repeat(64), 10], ['::uuid', '', '::int']),
      /tidak sesuai/,
    );
    await rpc('finance_confirm_receipt', [receipt.id, 'b'.repeat(64), 10], ['::uuid', '', '::int']);
    await db.exec('reset role');
    await assert.rejects(db.query('update public.finance_events set amount=0'), /permanen/);
    const { permissions } = require('../scripts/ops/backup');
    const security = await permissions(db);
    assert.equal(
      security.some(
        (p) =>
          p.name.startsWith('finance_post_event(') &&
          ['PUBLIC', 'anon', 'authenticated'].includes(p.grantee),
      ),
      false,
    );
    const expected = (
      await db.query('select id,balance::text from public.finance_accounts order by id')
    ).rows;
    // Real local database export/re-open catches schema, journal and persisted data loss.
    const archive = await db.dumpDataDir();
    const { PGlite } = require('@electric-sql/pglite');
    const restored = new PGlite({ loadDataDir: archive });
    try {
      assert.deepEqual(
        (await restored.query('select id,balance::text from public.finance_accounts order by id'))
          .rows,
        expected,
      );
      assert.deepEqual(await permissions(restored), security);
      assert.equal(
        (await restored.query('select count(*)::int n from public.finance_export_parts')).rows[0].n,
        1,
      );
    } finally {
      await restored.close();
    }
  } finally {
    await db.close();
  }
});
