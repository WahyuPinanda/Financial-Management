import { canEdit, EDIT_WINDOW_MS, sumCashItems, type CashExpense } from '@sawit/shared';
export function previewCashExpenses(): CashExpense[] {
  return [
    {
      category: 'other_income' as const,
      expense_date: '2026-10-07',
      items: [{ description: 'Pendapatan tambahan', amount: 1250000 }],
      age: 1,
    },
    {
      category: 'savings_expense' as const,
      expense_date: '2026-10-05',
      items: [{ description: 'Pembelian pupuk', amount: 250000 }],
      age: 1,
    },
    {
      category: 'investment_expense' as const,
      expense_date: '2026-10-05',
      items: [{ description: 'Persiapan replanting', amount: 400000 }],
      age: 20,
    },
    {
      category: 'investment' as const,
      expense_date: '2026-10-05',
      items: [{ description: 'Replanting', amount: 2000000 }],
      age: 1,
    },
    {
      category: 'savings' as const,
      expense_date: '2026-10-05',
      items: [{ description: 'Tabungan beli pupuk', amount: 1000000 }],
      age: 1,
    },
    {
      category: 'other' as const,
      expense_date: '2026-10-05',
      items: [
        { description: 'Perbaikan alat', amount: 200000 },
        { description: 'Administrasi', amount: 50000 },
      ],
      age: 1,
    },
    {
      category: 'garden' as const,
      expense_date: '2026-10-05',
      items: [
        { description: 'Ongkos Semprot', amount: 350000 },
        { description: 'Bensin', amount: 150000 },
      ],
      age: 1,
    },
    {
      category: 'garden' as const,
      expense_date: '2026-09-07',
      items: [
        { description: 'Ongkos pemupukan', amount: 900000 },
        { description: 'Bensin', amount: 100000 },
      ],
      age: 20,
    },
  ].map(({ age, ...row }, index) => {
    const published_at = new Date(Date.now() - age * 86400000).toISOString();
    return {
      ...row,
      id: `cash-preview-${index}`,
      total_expense: sumCashItems(row.items),
      version: 1,
      published_at,
      created_at: published_at,
      updated_at: published_at,
      editable: canEdit(published_at),
      edit_deadline: new Date(Date.parse(published_at) + EDIT_WINDOW_MS).toISOString(),
    };
  });
}
