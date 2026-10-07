import type { CashExpenseCategory } from '@sawit/shared';
export const cashCategories: Record<
  CashExpenseCategory,
  { title: string; defaults: string[]; allocation: boolean; income?: boolean }
> = {
  other_income: { title: 'Pemasukan Lainnya', defaults: [''], allocation: false, income: true },
  garden: { title: 'Pengeluaran kebun', defaults: ['Ongkos Semprot', 'Bensin'], allocation: false },
  other: { title: 'Pengeluaran lainnya', defaults: ['', ''], allocation: false },
  savings: { title: 'Tabungan', defaults: [''], allocation: true },
  investment: { title: 'Future Investment Goals', defaults: [''], allocation: true },
  savings_expense: { title: 'Pengeluaran Tabungan', defaults: [''], allocation: false },
  investment_expense: {
    title: 'Pengeluaran Future Investment Goals',
    defaults: [''],
    allocation: false,
  },
};
