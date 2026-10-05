import type { ZodType } from 'zod';
export class LatestRequest {
  begin(): { signal: AbortSignal; isCurrent(): boolean };
  cancel(): void;
}

export type Money = number | string;
export type CashExpenseCategory = 'garden' | 'other' | 'savings' | 'investment';
export interface FinancialTotals extends Omit<
  ReturnType<typeof summarize>,
  'income' | 'expenses' | 'netIncome'
> {
  income: Money;
  expenses: Money;
  netIncome: Money;
}
export type PageKind = 'harvest' | 'spk' | 'expense' | 'cash';
export interface WorkspaceSnapshot {
  server_time: string;
  page_size: number;
  totals: FinancialTotals;
  allTimeCash: Money;
  harvestCount: number;
  draftCount: number;
  months: string[];
  years: number[];
  chart: { id: string; name: string; harvest_date: string; total: Money }[];
  harvests: Harvest[];
  activeHarvest: Harvest | null;
  activeTotals: FinancialTotals;
  cashExpenses: CashExpense[];
  categoryTotal: Money;
  pages: Record<PageKind, { hasNext: boolean; count: number }>;
  analysis: CashFlowPeriod[];
  hasEvents: boolean;
}
export interface CashFlowPeriod {
  key: string;
  income: Money;
  expenses: Money;
  harvestExpenses: Money;
  gardenExpenses: Money;
  otherExpenses: Money;
  savingsAllocations: Money;
  investmentAllocations: Money;
  net: Money;
  previousNet: Money;
  openingCash: Money;
  closingCash: Money;
  growthPercent: number | null;
  partial: boolean;
}
export function growthPercent(current: number, previous: number): number | null;
export function cashFlowEvents(
  harvests: Harvest[],
  expenses: CashExpense[],
): { date: string; type: 'income' | 'harvest' | CashExpenseCategory; amount: number }[];
export function analyzeCashFlow(
  harvests: Harvest[],
  expenses: CashExpense[],
  options: { period: 'month' | 'year'; year: number; asOf?: string },
): CashFlowPeriod[];
export interface CashExpenseInput {
  expense_date: string;
  items: { description: string; amount: number }[];
  publish: boolean;
}
export interface CashExpense extends Omit<CashExpenseInput, 'publish'> {
  version: number;
  id: string;
  category: CashExpenseCategory;
  total_expense: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  editable: boolean;
  edit_deadline: string | null;
}
export const cashExpenseSchema: ZodType<CashExpenseInput>;
export function sumCashItems(items: CashExpenseInput['items']): number;
export function sumPublishedCashExpenses(expenses: CashExpense[]): number;
export function applyCashExpenses(
  totals: ReturnType<typeof summarize>,
  expenses: CashExpense[],
): ReturnType<typeof summarize>;

export interface HarvestInput {
  name: string;
  harvest_date: string;
}
export interface SpkInput {
  company_name: string;
  delivery_date: string;
  bunch_count: number;
  first_weight: number;
  second_weight: number;
  deduction_kg: number;
  price_per_kg: number;
  publish: boolean;
}
export interface Spk extends Omit<SpkInput, 'publish'> {
  version: number;
  id: string;
  harvest_id: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  gross_weight: number;
  net_weight: number;
  deduction_percent: number;
  total_income: number;
  editable: boolean;
  edit_deadline: string | null;
}
export interface Harvest extends HarvestInput {
  id: string;
  created_at: string;
  spks: Spk[];
  expenses: HarvestExpense[];
}
export interface ExpenseInput {
  first_weight: number;
  second_weight: number;
  wage_per_kg: number;
  driver_cost: number;
  publish: boolean;
}
export interface HarvestExpense extends Omit<ExpenseInput, 'publish'> {
  version: number;
  id: string;
  harvest_id: string;
  overall_weight: number;
  labor_cost: number;
  total_expense: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  editable: boolean;
  edit_deadline: string | null;
}
export const EDIT_WINDOW_MS: number;
export const harvestSchema: ZodType<HarvestInput>;
export const spkSchema: ZodType<SpkInput>;
export const expenseSchema: ZodType<ExpenseInput>;
export function calculateExpense(value: Omit<ExpenseInput, 'publish'>): {
  overall_weight: number;
  labor_cost: number;
  total_expense: number;
};
export function calculateSpk(
  value: Pick<SpkInput, 'first_weight' | 'second_weight' | 'deduction_kg' | 'price_per_kg'>,
): { gross_weight: number; net_weight: number; deduction_percent: number; total_income: number };
export function canEdit(publishedAt: string | null, now?: number): boolean;
export function summarize(
  spks: Spk[],
  expenses?: HarvestExpense[],
): {
  income: number;
  net: number;
  gross: number;
  deduction: number;
  bunches: number;
  count: number;
  deductionPercent: number;
  expenses: number;
  netIncome: number;
  expenseCount: number;
};
