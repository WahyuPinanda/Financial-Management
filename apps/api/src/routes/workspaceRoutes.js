const router = require('express').Router();
const { z } = require('zod');
const { throwDatabaseError } = require('../libs/errors');
const schema = z
  .object({
    view: z
      .enum([
        'dashboard',
        'panen',
        'pengeluaran',
        'garden',
        'other',
        'savings',
        'investment',
        'savings_expense',
        'investment_expense',
        'other_income',
        'analisis',
      ])
      .default('dashboard'),
    month: z.union([z.literal('all'), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]).default('all'),
    year: z.coerce.number().int().min(1900).max(9999).optional(),
    period: z.enum(['month', 'year']).default('month'),
    search: z.string().max(160).default(''),
    harvest_id: z.string().uuid().optional(),
    harvest_after: z.string().uuid().optional(),
    spk_after: z.string().uuid().optional(),
    expense_after: z.string().uuid().optional(),
    allocation_expense_after: z.string().uuid().optional(),
    cash_after: z.string().uuid().optional(),
  })
  .strict();
router.get('/workspace', async (req, res, next) => {
  try {
    const input = schema.parse(req.query);
    input.year ??= Number(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
      }).format(new Date()),
    );
    const args = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [`p_${key}`, value]),
    );
    const { data, error } = await req.database.rpc('workspace_snapshot', args);
    if (error) throwDatabaseError(error);
    const { serializePublication } = require('../libs/publication');
    if (data.activeHarvest) {
      data.activeHarvest.spks = data.activeHarvest.spks.map(serializePublication);
      data.activeHarvest.expenses = data.activeHarvest.expenses.map(serializePublication);
    }
    data.allocationExpenses = data.allocationExpenses.map(serializePublication);
    data.cashExpenses = data.cashExpenses.map(serializePublication);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});
module.exports = router;
