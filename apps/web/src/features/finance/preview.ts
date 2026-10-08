import {
  analyzeCashFlow,
  summarize,
  sumPublishedCashExpenses,
  type CashExpense,
  type FinanceSnapshot,
  type Harvest,
} from '@sawit/shared';
import type { WorkspaceQuery } from '../workspace/types';
import { today } from '../../lib/format';
const ids = {
  cash: '00000000-0000-4000-8000-000000000021',
  bank: '00000000-0000-4000-8000-000000000022',
  savings: '00000000-0000-4000-8000-000000000023',
  investment: '00000000-0000-4000-8000-000000000024',
};
export function previewFinance(
  harvests: Harvest[],
  cash: CashExpense[],
  query: WorkspaceQuery,
): FinanceSnapshot {
  const all = summarize(
    harvests.flatMap((h) => h.spks),
    harvests.flatMap((h) => h.expenses),
  );
  const total = (category: string, month = 'all') =>
    sumPublishedCashExpenses(
      cash.filter(
        (c) => c.category === category && (month === 'all' || c.expense_date.startsWith(month)),
      ),
    );
  const available =
    all.netIncome +
    total('other_income') -
    total('garden') -
    total('other') -
    total('savings') -
    total('investment');
  const saved = total('savings') - total('savings_expense'),
    invested = total('investment') - total('investment_expense');
  const accounts = [
    {
      id: ids.cash,
      name: 'Cash utama',
      kind: 'cash' as const,
      default_key: 'cash',
      balance: available,
      version: 1,
    },
    {
      id: ids.bank,
      name: 'Bank',
      kind: 'bank' as const,
      default_key: 'bank',
      balance: 0,
      version: 1,
    },
    {
      id: ids.savings,
      name: 'Tabungan',
      kind: 'savings' as const,
      default_key: 'savings',
      balance: saved,
      version: 1,
    },
    {
      id: ids.investment,
      name: 'Target Investasi',
      kind: 'investment' as const,
      default_key: 'investment',
      balance: invested,
      version: 1,
    },
  ];
  const base = analyzeCashFlow(harvests, cash, {
    period: query.period,
    year: query.year,
    asOf: today(),
  });
  const analysis = analyzeCashFlow(
    harvests,
    cash.filter((c) => !['savings_expense', 'investment_expense'].includes(c.category)),
    { period: query.period, year: query.year, asOf: today() },
  ).map((row, i) => ({
    ...row,
    savingsExpenses: base[i].savingsExpenses,
    investmentExpenses: base[i].investmentExpenses,
    transferNet: 0,
    corrections: 0,
  }));
  const categories = ['harvest', 'garden', 'other', 'savings_expense', 'investment_expense'];
  const cost = (category: string, month: string) =>
    category === 'harvest'
      ? summarize(
          [],
          harvests
            .filter((h) => month === 'all' || h.harvest_date.startsWith(month))
            .flatMap((h) => h.expenses),
        ).expenses
      : total(category, month);
  const month = query.month === 'all' ? today().slice(0, 7) : query.month;
  const currentIncome =
    summarize(
      harvests
        .flatMap((h) => h.spks)
        .filter((s) => query.month === 'all' || s.delivery_date.startsWith(query.month)),
    ).income + total('other_income', query.month);
  const currentOut =
    cost('harvest', query.month) +
    cost('garden', query.month) +
    cost('other', query.month) +
    total('savings', query.month) +
    total('investment', query.month);
  const eventRows = cash
    .filter((c) => c.published_at)
    .map((c, i) => {
      const allocation = ['savings', 'investment'].includes(c.category),
        reserved =
          c.category === 'savings_expense'
            ? 'savings'
            : c.category === 'investment_expense'
              ? 'investment'
              : null,
        income = c.category === 'other_income';
      const account = reserved ? accounts.find((a) => a.kind === reserved)! : accounts[0];
      return {
        id: c.id,
        seq: String(i + 1),
        event_date: c.expense_date,
        kind: 'source',
        category: c.category,
        description: c.items.map((x) => x.description).join(' · '),
        amount: c.total_expense,
        cashDelta: income ? c.total_expense : reserved ? 0 : -c.total_expense,
        account_id: account.id,
        destination_id: allocation ? accounts.find((a) => a.kind === c.category)!.id : null,
        source_kind: 'cash',
        source_id: c.id,
        created_at: c.created_at,
        movements: allocation
          ? [
              { account: account.name, delta: -c.total_expense },
              {
                account: accounts.find((a) => a.kind === c.category)!.name,
                delta: c.total_expense,
              },
            ]
          : [{ account: account.name, delta: income ? c.total_expense : -c.total_expense }],
      };
    })
    .reverse();
  return {
    enabled: true,
    revision: 1,
    activationPreview: {
      availableCash: available,
      totalFunds: available + saved + invested,
      savings: saved,
      investment: invested,
      openingDate: '2026-01-01',
    },
    availableCash: available,
    totalFunds: available + saved + invested,
    savingsBalance: saved,
    investmentBalance: invested,
    periodIncome: currentIncome,
    periodOutflow: currentOut,
    periodCashFlow: currentIncome - currentOut,
    accounts,
    analysis,
    goals: [
      {
        id: 'preview-goal-1',
        account_id: ids.savings,
        name: 'Pupuk musim berikutnya',
        target: 2000000,
        due_date: '2026-12-31',
        balance: saved,
        remaining: Math.max(0, 2000000 - saved),
        progress: (saved / 2000000) * 100,
        spent: total('savings_expense'),
        accountName: 'Tabungan',
        kind: 'savings',
        version: 1,
      },
      {
        id: 'preview-goal-2',
        account_id: ids.investment,
        name: 'Persiapan replanting',
        target: 5000000,
        due_date: '2027-06-30',
        balance: invested,
        remaining: Math.max(0, 5000000 - invested),
        progress: (invested / 5000000) * 100,
        spent: total('investment_expense'),
        accountName: 'Target Investasi',
        kind: 'investment',
        version: 1,
      },
    ],
    costs: categories.map((category) => ({ category, amount: cost(category, query.month) })),
    budgets: [
      ['harvest', 2000000],
      ['garden', 1000000],
      ['other', 500000],
    ].map(([category, amount], i) => {
      const spent = cost(String(category), month);
      return {
        id: `preview-budget-${i}`,
        month: `${month}-01`,
        category: String(category),
        amount: Number(amount),
        spent,
        remaining: Number(amount) - spent,
        percent: (spent / Number(amount)) * 100,
        version: 1,
      };
    }),
    journal: eventRows.filter(
      (row) => query.month === 'all' || row.event_date.startsWith(query.month),
    ),
    journalHasNext: false,
    audit: cash
      .slice(0, 5)
      .map((c, i) => ({
        seq: String(i + 1),
        entity: 'cash_expenses',
        record_id: c.id,
        action: 'INSERT',
        before_data: null,
        after_data: {
          expense_date: c.expense_date,
          items: c.items,
          total_expense: c.total_expense,
        },
        reason: null,
        created_at: c.created_at,
      }))
      .reverse(),
    auditHasNext: false,
    reconciliations: [],
  };
}
