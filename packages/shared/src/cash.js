const { z } = require('zod');

const toCents = (value) => {
  const scaled = Number(value) * 100;
  return BigInt(Number.isFinite(scaled) ? Math.round(scaled) : 0);
};
function sumCashItems(items) {
  return Number(items.reduce((sum, item) => sum + toCents(item.amount), 0n)) / 100;
}
const cashExpenseSchema = z
  .object({
    expense_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const timestamp = Date.parse(value);
        return (
          value >= '1900-01-01' &&
          value <= '9999-12-31' &&
          Number.isFinite(timestamp) &&
          new Date(timestamp).toISOString().slice(0, 10) === value
        );
      }, 'Tanggal catatan tidak valid.'),
    items: z
      .array(
        z
          .object({
            description: z.string().trim().min(1, 'Keterangan wajib diisi.').max(160),
            amount: z
              .number()
              .finite()
              .min(0)
              .max(1e12)
              .refine(
                (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001,
                'Maksimal 2 angka desimal.',
              ),
          })
          .strict(),
      )
      .min(1)
      .max(50, 'Maksimal 50 rincian per catatan.'),
    publish: z.boolean(),
  })
  .strict()
  .refine(
    (value) => sumCashItems(value.items) > 0 && sumCashItems(value.items) <= 1e12,
    'Total nominal harus lebih dari 0 dan maksimal Rp1 triliun.',
  );

function sumPublishedCashExpenses(expenses) {
  return (
    Number(
      expenses
        .filter((expense) => expense.published_at)
        .reduce((sum, expense) => sum + toCents(expense.total_expense), 0n),
    ) / 100
  );
}

function applyCashExpenses(totals, expenses) {
  const outgoing = expenses.filter((row) => row.category !== 'other_income');
  const incoming = toCents(
    sumPublishedCashExpenses(expenses.filter((row) => row.category === 'other_income')),
  );
  const extra = toCents(sumPublishedCashExpenses(outgoing));
  return {
    ...totals,
    income: Number(toCents(totals.income) + incoming) / 100,
    expenses: Number(toCents(totals.expenses) + extra) / 100,
    netIncome: Number(toCents(totals.netIncome) + incoming - extra) / 100,
    expenseCount: totals.expenseCount + outgoing.filter((expense) => expense.published_at).length,
  };
}

module.exports = { cashExpenseSchema, sumCashItems, sumPublishedCashExpenses, applyCashExpenses };
