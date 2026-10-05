const { z } = require('zod');

const EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid.')
  .refine(
    (value) =>
      value >= '1900-01-01' &&
      value <= '9999-12-31' &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    'Tanggal tidak valid.',
  );
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000_000, 'Nilai maksimal Rp1.000.000.000.000.')
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001,
    'Maksimal 2 angka desimal.',
  );
const decimal = money.refine((value) => value <= 1_000_000, 'Nilai maksimal 1.000.000.');
const cents = (amount) => BigInt(Math.round(Number.isFinite(amount) ? amount * 100 : 0));
const sumMoney = (records, key) =>
  records.reduce((total, record) => total + cents(Number(record[key])), 0n);

const harvestSchema = z
  .object({
    name: z.string().trim().min(1, 'Nama panen wajib diisi.').max(120),
    harvest_date: dateSchema,
  })
  .strict();

const spkSchema = z
  .object({
    company_name: z.string().trim().min(1, 'Nama perusahaan wajib diisi.').max(160),
    delivery_date: dateSchema,
    bunch_count: z.number().int().min(1, 'Jumlah janjang minimal 1.').max(1_000_000_000),
    first_weight: decimal.refine((value) => value > 0, '1st Weight harus lebih dari 0.'),
    second_weight: decimal,
    deduction_kg: decimal,
    price_per_kg: decimal.refine((value) => value > 0, 'Harga/kg harus lebih dari 0.'),
    publish: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.second_weight >= value.first_weight) {
      context.addIssue({
        code: 'custom',
        path: ['second_weight'],
        message: '2nd Weight harus lebih kecil dari 1st Weight.',
      });
    }
    if (value.deduction_kg > value.first_weight - value.second_weight + 0.000001) {
      context.addIssue({
        code: 'custom',
        path: ['deduction_kg'],
        message: 'Potongan tidak boleh melebihi berat muatan.',
      });
    }
  });

/** UI preview only; authoritative values are generated with PostgreSQL NUMERIC. */
function calculateSpk(value) {
  const first = cents(value.first_weight);
  const second = cents(value.second_weight);
  const deduction = cents(value.deduction_kg);
  const gross = first > second ? first - second : 0n;
  const net = gross > deduction ? gross - deduction : 0n;
  const price = cents(value.price_per_kg);
  // Integer arithmetic matches PostgreSQL rounding and avoids floating-point ties.
  return {
    gross_weight: Number(gross) / 100,
    net_weight: Number(net) / 100,
    deduction_percent: gross > 0n ? Number((deduction * 10000n + gross / 2n) / gross) / 100 : 0,
    total_income: Number((net * price + 50n) / 100n) / 100,
  };
}

const expenseSchema = z
  .object({
    first_weight: decimal.refine((value) => value > 0, '1st Weight harus lebih dari 0.'),
    second_weight: decimal,
    wage_per_kg: decimal,
    driver_cost: money,
    publish: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.second_weight >= value.first_weight) {
      context.addIssue({
        code: 'custom',
        path: ['second_weight'],
        message: '2nd Weight harus lebih kecil dari 1st Weight.',
      });
    }
  });

function calculateExpense(value) {
  const difference = cents(value.first_weight) - cents(value.second_weight);
  const weight = difference > 0n ? difference : 0n;
  const labor = (weight * cents(value.wage_per_kg) + 50n) / 100n;
  return {
    overall_weight: Number(weight) / 100,
    labor_cost: Number(labor) / 100,
    total_expense: Number(labor + cents(value.driver_cost)) / 100,
  };
}

function canEdit(publishedAt, now = Date.now()) {
  return publishedAt === null || now < Date.parse(publishedAt) + EDIT_WINDOW_MS;
}

function summarize(spks, expenses = []) {
  const published = spks.filter((spk) => spk.published_at);
  const publishedExpenses = expenses.filter((expense) => expense.published_at);
  const incomeCents = sumMoney(published, 'total_income');
  const expenseCents = sumMoney(publishedExpenses, 'total_expense');
  const totals = published.reduce(
    (sum, spk) => ({
      income: sum.income + Number(spk.total_income),
      net: sum.net + Number(spk.net_weight),
      gross: sum.gross + Number(spk.gross_weight),
      deduction: sum.deduction + Number(spk.deduction_kg),
      bunches: sum.bunches + spk.bunch_count,
    }),
    { income: 0, net: 0, gross: 0, deduction: 0, bunches: 0 },
  );
  return {
    ...totals,
    income: Number(incomeCents) / 100,
    expenses: Number(expenseCents) / 100,
    netIncome: Number(incomeCents - expenseCents) / 100,
    expenseCount: publishedExpenses.length,
    count: published.length,
    deductionPercent: totals.gross ? (totals.deduction / totals.gross) * 100 : 0,
  };
}

module.exports = {
  ...require('./latestRequest'),
  ...require('./cash'),
  ...require('./analytics'),
  EDIT_WINDOW_MS,
  harvestSchema,
  spkSchema,
  expenseSchema,
  calculateSpk,
  calculateExpense,
  canEdit,
  summarize,
};
