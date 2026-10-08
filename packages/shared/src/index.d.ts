import type { ZodType } from 'zod';
export class LatestRequest {
  begin(): { signal: AbortSignal; isCurrent(): boolean };
  cancel(): void;
}

export type Money = number | string;
export function sumDecimalMoney(values: Money[]): string;
export function decimalCents(value: Money): bigint;
export function decimalMoney(value: bigint): string;
export function financeCsvHeader(): string;
export function financeCsvRows(rows: object[]): string;
export function createHarvestExpenseCsv(
  harvest: Pick<Harvest, 'name' | 'harvest_date' | 'expenses'>,
): string;
export type CashExpenseCategory =
  | 'garden'
  | 'other'
  | 'savings'
  | 'investment'
  | 'savings_expense'
  | 'investment_expense'
  | 'other_income';
export interface FinancialTotals extends Omit<
  ReturnType<typeof summarize>,
  'income' | 'expenses' | 'netIncome'
> {
  income: Money;
  expenses: Money;
  netIncome: Money;
}
export type PageKind = 'harvest' | 'spk' | 'expense' | 'cash' | 'allocationExpense';
export interface WorkspaceSnapshot {
  productivity?: ProductivitySnapshot;
  finance?: FinanceSnapshot;
  server_time: string;
  page_size: number;
  totals: FinancialTotals;
  allTimeCash: Money;
  harvestIncome: Money;
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
  categoryTotals: Record<CashExpenseCategory | 'harvest', Money>;
  allocationExpenses: CashExpense[];
  allocationExpenseTotal: Money;
  pages: Record<PageKind, { hasNext: boolean; count: number }>;
  analysis: CashFlowPeriod[];
  hasEvents: boolean;
}
export interface CashFlowPeriod {
  transferNet?: Money;
  corrections?: Money;
  key: string;
  income: Money;
  expenses: Money;
  harvestExpenses: Money;
  otherIncome: Money;
  gardenExpenses: Money;
  otherExpenses: Money;
  savingsAllocations: Money;
  investmentAllocations: Money;
  savingsExpenses: Money;
  investmentExpenses: Money;
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
  account_id?: string;
  destination_account_id?: string;
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
  account_id?: string;
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
  account_id?: string;
  first_weight: number;
  second_weight: number;
  wage_per_kg: number;
  driver_cost: number;
  publish: boolean;
}
export interface FinanceAccount {
  id: string;
  name: string;
  kind: 'cash' | 'bank' | 'savings' | 'investment';
  default_key: string | null;
  balance: Money;
  version: number;
}
export interface FinanceGoal {
  id: string;
  account_id: string;
  name: string;
  target: Money;
  due_date: string;
  balance: Money;
  remaining: Money;
  progress: number;
  spent: Money;
  accountName: string;
  kind: string;
  version: number;
}
export interface FinanceBudget {
  id: string;
  month: string;
  category: string;
  amount: Money;
  spent: Money;
  remaining: Money;
  percent: number;
  version: number;
}
export interface FinanceEvent {
  id: string;
  seq: string;
  event_date: string;
  kind: string;
  category: string;
  description: string;
  amount: Money;
  cashDelta: Money;
  account_id: string;
  destination_id: string | null;
  source_kind: string | null;
  source_id: string | null;
  created_at: string;
  movements: { account: string; delta: Money }[];
}
export interface FinanceAudit {
  seq: string;
  entity: string;
  record_id: string;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}
export interface FinanceReconciliation {
  id: string;
  accountName: string;
  as_of: string;
  expected: Money;
  actual: Money;
  difference: Money;
  note: string;
}
export interface FinanceSnapshot {
  enabled: boolean;
  revision: number;
  activationPreview: {
    availableCash: Money;
    totalFunds: Money;
    savings: Money;
    investment: Money;
    openingDate: string;
  };
  availableCash: Money;
  totalFunds: Money;
  savingsBalance: Money;
  investmentBalance: Money;
  periodIncome: Money;
  periodOutflow: Money;
  periodCashFlow: Money;
  accounts: FinanceAccount[];
  goals: FinanceGoal[];
  budgets: FinanceBudget[];
  costs: { category: string; amount: Money }[];
  journal: FinanceEvent[];
  journalHasNext: boolean;
  audit: FinanceAudit[];
  auditHasNext: boolean;
  reconciliations: FinanceReconciliation[];
  analysis: CashFlowPeriod[];
}
export interface TransactionTemplate {
  id: string;
  name: string;
  category: CashExpenseCategory;
  items: { description: string; amount: number }[];
  account_id: string | null;
  destination_account_id: string | null;
  frequency: 'weekly' | 'monthly';
  next_date: string;
  active: boolean;
  version: number;
}
export interface HarvestProfit {
  id: string;
  name: string;
  harvest_date: string;
  income: Money;
  netWeight: Money;
  harvestCost: Money;
  gardenCost: Money;
  totalCost: Money;
  profit: Money;
  costPerKg: Money | null;
  marginPercent: number | null;
}
export function calculateHarvestProfit(harvest: Harvest, gardenCost?: Money): HarvestProfit;
export interface ProductivitySnapshot {
  templateCount?: number;
  reminderTemplates?: Pick<TransactionTemplate, 'id' | 'name' | 'active' | 'next_date'>[];
  templates: TransactionTemplate[];
  reminderBudgets: Pick<FinanceBudget, 'id' | 'category' | 'amount' | 'spent'>[];
  profits: HarvestProfit[];
}
export interface FinanceReminder {
  id: string;
  severity: string;
  title: string;
  detail: string;
  amount?: Money;
  route: string;
}
export function financeReminders(
  input: {
    budgets?: ProductivitySnapshot['reminderBudgets'];
    goals?: FinanceGoal[];
    templates?: Pick<TransactionTemplate, 'id' | 'name' | 'active' | 'next_date'>[];
  },
  today: string,
): FinanceReminder[];
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
