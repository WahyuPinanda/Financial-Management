import type { CashExpenseCategory } from '@sawit/shared';
export const cashCategories: Record<
  CashExpenseCategory,
  { title: string; defaults: string[]; allocation: boolean }
> = {
  garden: { title: 'Pengeluaran kebun', defaults: ['Ongkos Semprot', 'Bensin'], allocation: false },
  other: { title: 'Pengeluaran lainnya', defaults: ['', ''], allocation: false },
  savings: { title: 'Tabungan', defaults: [''], allocation: true },
  investment: { title: 'Future Investment Goals', defaults: [''], allocation: true },
};
