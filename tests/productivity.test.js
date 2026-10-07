const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { financeReminders, calculateHarvestProfit } = require('@sawit/shared');
const { database } = require('./helpers/database');
const { needsMfa } = require('../apps/api/src/libs/mfa');
const owner = '00000000-0000-0000-0000-000000000001',
  other = '00000000-0000-0000-0000-000000000002';

test('reminders use exact 80 percent thresholds, current dates and unpaid targets', () => {
  const rows = financeReminders(
    {
      budgets: [
        {
          id: 'below',
          category: 'garden',
          amount: '1000000000000000.00',
          spent: '799999999999999.99',
        },
        { id: 'edge', category: 'other', amount: '100.00', spent: '80.00' },
        { id: 'over', category: 'harvest', amount: '100.00', spent: '100.01' },
      ],
      goals: [
        {
          id: 'due',
          name: 'Pupuk',
          target: '100.00',
          balance: '20.00',
          due_date: '2026-10-08',
          kind: 'savings',
        },
        { id: 'done', target: 100, balance: 100, due_date: '2026-10-01' },
        { id: 'far', target: 100, balance: 0, due_date: '2026-11-01' },
      ],
      templates: [
        { id: 'routine', name: 'Bensin', active: true, next_date: '2026-10-07' },
        { id: 'paused', active: false, next_date: '2026-10-07' },
        { id: 'future', active: true, next_date: '2026-10-09' },
      ],
    },
    '2026-10-08',
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['budget:over', 'budget:edge', 'goal:due', 'template:routine'],
  );
  assert.equal(rows[0].amount, '0.01');
  assert.equal(rows[2].amount, '80.00');
});
test('harvest profit excludes drafts and allocations do not become a second cash expense', () => {
  const result = calculateHarvestProfit(
    {
      id: 'h',
      name: 'Panen',
      harvest_date: '2026-10-08',
      spks: [
        { published_at: 'now', total_income: 18000000, net_weight: 6000 },
        { published_at: null, total_income: 1e9, net_weight: 1e6 },
      ],
      expenses: [
        { published_at: 'now', total_expense: 2000000 },
        { published_at: null, total_expense: 3e6 },
      ],
    },
    '1000000.00',
  );
  assert.equal(result.profit, '15000000.00');
  assert.equal(result.totalCost, '3000000.00');
  assert.equal(result.costPerKg, '500.00');
  const empty = calculateHarvestProfit({ id: 'h', spks: [], expenses: [] });
  assert.equal(empty.costPerKg, null);
  assert.equal(empty.marginPercent, null);
});
test('verified MFA factors require a verified AAL2 token, including malformed claims', () => {
  const token = (aal) =>
    `header.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.signature`;
  assert.equal(needsMfa({ factors: [{ status: 'verified' }] }, token('aal1')), true);
  assert.equal(needsMfa({ factors: [{ status: 'verified' }] }, token('aal2')), false);
  assert.equal(needsMfa({ factors: [{ status: 'verified' }] }, 'malformed'), true);
  assert.equal(needsMfa({ factors: [{ status: 'unverified' }] }, token('aal1')), false);
});

test('MFA protects RPC and table access; routine occurrences and cost allocations are atomic and owned', async () => {
  const db = await database();
  try {
    await db.exec(
      `insert into auth.users values('${owner}'),('${other}');set role authenticated;set request.jwt.claim.sub='${owner}';`,
    );
    const save = async (kind, fields, id = null, version = null) =>
      (
        await db.query('select public.save_financial_record($1,$2,$3,$4,$5) as data', [
          kind,
          fields,
          randomUUID(),
          id,
          version,
        ])
      ).rows[0].data;
    const command = async (kind, fields, id = null, version = null, key = randomUUID()) =>
      (
        await db.query('select public.productivity_command($1,$2,$3,$4,$5) as data', [
          kind,
          fields,
          key,
          id,
          version,
        ])
      ).rows[0].data;
    const h = await save('harvest', { name: 'Panen A', harvest_date: '2026-01-31' }),
      h2 = await save('harvest', { name: 'Panen B', harvest_date: '2026-01-31' });
    await save('spk', {
      harvest_id: h.id,
      company_name: 'Perusahaan',
      delivery_date: '2026-01-31',
      bunch_count: 10,
      first_weight: 7000,
      second_weight: 1000,
      deduction_kg: 0,
      price_per_kg: 3000,
      publish: true,
    });
    await save('harvest_expense', {
      harvest_id: h.id,
      first_weight: 7000,
      second_weight: 1000,
      wage_per_kg: 250,
      driver_cost: 500000,
      publish: true,
    });
    const c = await save('garden', {
      expense_date: '2026-01-31',
      items: [{ description: 'Pupuk', amount: 1000000 }],
      publish: true,
    });
    const allocation = await command('allocate_cost', {
      harvest_id: h.id,
      cash_expense_id: c.id,
      amount: 700000,
      reason: 'Alokasi pemupukan panen A',
    });
    await assert.rejects(
      command('allocate_cost', {
        harvest_id: h2.id,
        cash_expense_id: c.id,
        amount: 400000,
        reason: 'Alokasi pemupukan panen B',
      }),
      /melebihi/,
    );
    await command('allocate_cost', {
      harvest_id: h2.id,
      cash_expense_id: c.id,
      amount: 300000,
      reason: 'Alokasi pemupukan panen B',
    });
    await assert.rejects(
      save(
        'garden',
        {
          expense_date: '2026-01-31',
          items: [{ description: 'Pupuk', amount: 999999 }],
          publish: true,
        },
        c.id,
        c.version,
      ),
      /Kurangi alokasi/,
    );
    const snapshot = (
      await db.query('select public.workspace_snapshot(p_harvest_id:=$1) as data', [h.id])
    ).rows[0].data;
    const profit = snapshot.productivity.profits.find((p) => p.id === h.id);
    assert.equal(profit.profit, '15300000.00');
    assert.equal(profit.costPerKg, '450.00');
    assert.equal(Number(snapshot.allTimeCash), 15000000);
    await command(
      'allocate_cost',
      {
        harvest_id: h.id,
        cash_expense_id: c.id,
        amount: 600000,
        reason: 'Koreksi pembagian biaya A',
      },
      allocation.id,
      allocation.version,
    );
    await assert.rejects(
      command(
        'allocate_cost',
        {
          harvest_id: h.id,
          cash_expense_id: c.id,
          amount: 500000,
          reason: 'Perubahan bersamaan lama',
        },
        allocation.id,
        allocation.version,
      ),
      /sudah berubah/,
    );
    const template = await command('template', {
      name: 'Bensin bulanan',
      category: 'other',
      items: [{ description: 'Bensin', amount: 100 }],
      frequency: 'monthly',
      next_date: '2026-01-31',
      active: true,
    });
    const use = {
      scheduled_date: '2026-01-31',
      transaction: {
        expense_date: '2026-01-31',
        items: [{ description: 'Bensin ditinjau', amount: 125 }],
        publish: false,
      },
    };
    const key = randomUUID(),
      draft = await command('apply_template', use, template.id, template.version, key);
    const retry = await command('apply_template', use, template.id, template.version, key);
    assert.equal(retry.id, draft.id);
    assert.equal(draft.published_at, null);
    await assert.rejects(
      command('apply_template', use, template.id, template.version),
      /sudah berubah/,
    );
    let t = (
      await db.query(
        'select id,version,next_date::text from public.transaction_templates where id=$1',
        [template.id],
      )
    ).rows[0];
    assert.equal(t.next_date, '2026-02-28');
    await command(
      'apply_template',
      { scheduled_date: t.next_date, transaction: { ...use.transaction, publish: true } },
      t.id,
      t.version,
    );
    t = (
      await db.query(
        'select id,version,next_date::text from public.transaction_templates where id=$1',
        [template.id],
      )
    ).rows[0];
    assert.equal(t.next_date, '2026-03-31');
    assert.equal(
      (await db.query('select count(*)::int as n from public.template_occurrences')).rows[0].n,
      2,
    );
    const options = (await db.query('select public.garden_cost_options($1) as data', [h.id]))
      .rows[0].data;
    assert.equal(options.rows[0].available, '700000.00');
    assert.equal(options.rows[0].allocated, '600000.00');
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal(
      (await db.query('select count(*)::int as n from public.transaction_templates')).rows[0].n,
      0,
    );
    await assert.rejects(
      command('apply_template', use, template.id, template.version),
      /sudah berubah/,
    );
    await assert.rejects(
      command('allocate_cost', {
        harvest_id: h.id,
        cash_expense_id: c.id,
        amount: 1,
        reason: 'Tidak boleh menulis silang',
      }),
      /tidak tersedia/,
    );
    await db.exec(
      `reset role;insert into auth.mfa_factors values('${randomUUID()}','${owner}','verified');set role authenticated;set request.jwt.claim.sub='${owner}';set request.jwt.claims='{"aal":"aal1"}';`,
    );
    for (const sql of [
      'select public.workspace_snapshot()',
      'select public.finance_snapshot()',
      'select public.finance_integrity()',
      'select public.productivity_snapshot()',
    ])
      await assert.rejects(db.query(sql), /dua langkah/);
    assert.equal(
      (await db.query('select count(*)::int as n from public.cash_expenses')).rows[0].n,
      0,
    );
    await assert.rejects(save('other', use.transaction), /dua langkah/);
    const privateAllowed = (
      await db.query(
        "select has_function_privilege('authenticated','public.save_financial_record_without_mfa(text,jsonb,uuid,uuid,integer)','execute') as allowed",
      )
    ).rows[0].allowed;
    assert.equal(privateAllowed, false);
    await db.exec(`set request.jwt.claims='{"aal":"aal2"}';`);
    assert.equal((await db.query('select public.finance_access_allowed() as ok')).rows[0].ok, true);
    assert.ok(
      (await db.query('select public.workspace_snapshot() as data')).rows[0].data.productivity,
    );
    await db.exec(
      `reset role;alter table public.cash_expenses disable trigger guard_cash_expense_write;update public.cash_expenses set published_at=now()-interval '8 days' where id='${c.id}';alter table public.cash_expenses enable trigger guard_cash_expense_write;set role authenticated;`,
    );
    await assert.rejects(
      command(
        'allocate_cost',
        { harvest_id: h.id, cash_expense_id: c.id, amount: 0, reason: 'Tidak dapat ubah terkunci' },
        allocation.id,
        2,
      ),
      /terkunci/,
    );
  } finally {
    await db.close();
  }
});
