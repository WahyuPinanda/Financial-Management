import {
  analyzeCashFlow,
  applyCashExpenses,
  cashFlowEvents,
  summarize,
  sumPublishedCashExpenses,
  type WorkspaceSnapshot,
} from '@sawit/shared';
import { previewHarvests } from '../dashboard/preview';
import { previewCashExpenses } from '../cash-expenses/preview';
import { today } from '../../lib/format';
import type { WorkspaceQuery } from './types';
export function previewWorkspace(query: WorkspaceQuery): WorkspaceSnapshot {
  const all = previewHarvests();
  const cash = previewCashExpenses();
  const matches = (day: string) => query.month === 'all' || day.startsWith(query.month);
  const filtered = all.filter(
    (harvest) =>
      (matches(harvest.harvest_date) || harvest.spks.some((spk) => matches(spk.delivery_date))) &&
      `${harvest.name} ${harvest.spks.map((spk) => spk.company_name).join(' ')}`
        .toLowerCase()
        .includes(query.search.toLowerCase()),
  );
  const active = filtered.find((harvest) => harvest.id === query.harvest_id) ?? filtered[0] ?? null;
  const rows = cash.filter(
    (expense) => matches(expense.expense_date) && expense.category === query.view,
  );
  const extraCategory =
    query.view === 'savings'
      ? 'savings_expense'
      : query.view === 'investment'
        ? 'investment_expense'
        : null;
  const extraRows = cash.filter(
    (expense) => matches(expense.expense_date) && expense.category === extraCategory,
  );
  const events = cashFlowEvents(all, cash);
  return {
    harvestIncome: summarize(
      all.flatMap((harvest) => harvest.spks).filter((spk) => matches(spk.delivery_date)),
    ).income,
    server_time: new Date().toISOString(),
    page_size: 20,
    totals: applyCashExpenses(
      summarize(
        all.flatMap((harvest) => harvest.spks).filter((spk) => matches(spk.delivery_date)),
        all
          .filter((harvest) => matches(harvest.harvest_date))
          .flatMap((harvest) => harvest.expenses),
      ),
      cash.filter((expense) => matches(expense.expense_date)),
    ),
    allTimeCash: applyCashExpenses(
      summarize(
        all.flatMap((harvest) => harvest.spks),
        all.flatMap((harvest) => harvest.expenses),
      ),
      cash,
    ).netIncome,
    harvestCount: filtered.length,
    draftCount: all
      .flatMap((harvest) => harvest.spks)
      .filter((spk) => !spk.published_at && matches(spk.delivery_date)).length,
    months: [
      ...new Set([
        ...all.map((harvest) => harvest.harvest_date.slice(0, 7)),
        ...cash.map((expense) => expense.expense_date.slice(0, 7)),
      ]),
    ]
      .sort()
      .reverse(),
    years: [
      ...new Set([
        Number(today().slice(0, 4)),
        ...events.map((event) => Number(event.date.slice(0, 4))),
      ]),
    ].sort((a, b) => b - a),
    chart: filtered.slice(0, 6).map((harvest) => ({
      id: harvest.id,
      name: harvest.name,
      harvest_date: harvest.harvest_date,
      total: summarize(harvest.spks.filter((spk) => matches(spk.delivery_date))).income,
    })),
    harvests: filtered,
    activeHarvest: active,
    activeTotals: summarize(active?.spks ?? [], active?.expenses ?? []),
    cashExpenses: rows,
    categoryTotals: {
      harvest: summarize(
        [],
        all
          .filter((harvest) => matches(harvest.harvest_date))
          .flatMap((harvest) => harvest.expenses),
      ).expenses,
      ...(Object.fromEntries(
        [
          'garden',
          'other',
          'savings',
          'investment',
          'savings_expense',
          'investment_expense',
          'other_income',
        ].map((category) => [
          category,
          sumPublishedCashExpenses(
            cash.filter(
              (expense) => matches(expense.expense_date) && expense.category === category,
            ),
          ),
        ]),
      ) as Record<import('@sawit/shared').CashExpenseCategory, number>),
    },
    allocationExpenses: extraRows,
    allocationExpenseTotal: sumPublishedCashExpenses(extraRows),
    categoryTotal: sumPublishedCashExpenses(rows),
    pages: {
      harvest: { count: filtered.length, hasNext: false },
      spk: { count: active?.spks.length ?? 0, hasNext: false },
      expense: { count: active?.expenses.length ?? 0, hasNext: false },
      allocationExpense: { count: extraRows.length, hasNext: false },
      cash: { count: rows.length, hasNext: false },
    },
    analysis: analyzeCashFlow(all, cash, { period: query.period, year: query.year, asOf: today() }),
    hasEvents: events.length > 0,
  };
}
