const router = require('express').Router();
const { z } = require('zod');
const { cashExpenseSchema, sumCashItems } = require('@sawit/shared');
const { writeContext } = require('../libs/writeContext');
const { AppError, throwDatabaseError } = require('../libs/errors');
const uuid = z.string().uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      v >= '1900-01-01' &&
      v <= '9999-11-30' &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const categories = z.enum([
  'garden',
  'other',
  'other_income',
  'savings',
  'investment',
  'savings_expense',
  'investment_expense',
]);
const schemas = {
  template: z
    .object({
      name: z.string().trim().min(1).max(120),
      category: categories,
      items: cashExpenseSchema.innerType().shape.items,
      account_id: uuid.optional(),
      destination_account_id: uuid.optional(),
      frequency: z.enum(['weekly', 'monthly']),
      next_date: date,
      active: z.boolean(),
    })
    .strict()
    .refine(
      (v) => sumCashItems(v.items) > 0 && sumCashItems(v.items) <= 1e12,
      'Total template tidak valid.',
    ),
  apply_template: z.object({ scheduled_date: date, transaction: cashExpenseSchema }).strict(),
  allocate_cost: z
    .object({
      harvest_id: uuid,
      cash_expense_id: uuid,
      amount: z
        .number()
        .finite()
        .min(0)
        .max(1e12)
        .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001),
      reason: z.string().trim().min(10).max(500),
    })
    .strict(),
};
router.get('/garden-cost-options', async (req, res, next) => {
  try {
    const input = z
      .object({
        harvest_id: uuid,
        search: z.string().max(120).default(''),
        before: uuid.optional(),
      })
      .strict()
      .parse(req.query);
    const { data, error } = await req.database.rpc('garden_cost_options', {
      p_harvest_id: input.harvest_id,
      p_search: input.search,
      p_before: input.before ?? null,
    });
    if (error) throwDatabaseError(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
async function command(req, res, next) {
  try {
    const kind = z.enum(Object.keys(schemas)).parse(req.params.kind);
    const id = req.params.id ? uuid.parse(req.params.id) : null;
    if (kind === 'apply_template' && !id)
      throw new AppError(400, 'Pilih template terlebih dahulu.');
    const context = writeContext(req, Boolean(id));
    const fields = schemas[kind].parse(req.body);
    const { data, error } = await req.database.rpc('productivity_command', {
      p_kind: kind,
      p_fields: fields,
      p_request_key: context.requestKey,
      p_id: id,
      p_version: context.version,
    });
    if (error) throwDatabaseError(error);
    res.status(id ? 200 : 201).json({ data });
  } catch (e) {
    next(e);
  }
}
router.post('/productivity/:kind', command);
router.patch('/productivity/:kind/:id', command);
module.exports = router;
