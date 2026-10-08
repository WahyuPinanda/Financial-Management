const router = require('express').Router();
const { z } = require('zod');
const { writeContext } = require('../libs/writeContext');
const { AppError, throwDatabaseError } = require('../libs/errors');
const uuid = z.string().uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      v >= '1900-01-01' &&
      v <= '9999-12-31' &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const amount = z
  .number()
  .finite()
  .min(0)
  .max(1e12)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001);
const positive = amount.refine((v) => v > 0);
const schemas = {
  activate: z
    .object({
      expected_revision: z.number().int().min(1),
      opening_date: date,
      openings: z
        .object({ cash: amount, bank: amount, savings: amount, investment: amount })
        .strict(),
    })
    .strict(),
  account: z
    .object({
      name: z.string().trim().min(1).max(80),
      kind: z.enum(['cash', 'bank', 'savings', 'investment']),
      amount,
      date,
    })
    .strict(),
  transfer: z
    .object({
      account_id: uuid,
      destination_id: uuid,
      date,
      amount: positive,
      description: z.string().trim().min(1).max(160),
    })
    .strict(),
  correction: z
    .object({
      account_id: uuid,
      date,
      amount: z
        .number()
        .finite()
        .min(-1e12)
        .max(1e12)
        .refine((v) => v !== 0 && Math.abs(v * 100 - Math.round(v * 100)) < 0.0001),
      reason: z.string().trim().min(10).max(500),
      source_kind: z.enum(['spk', 'harvest_expense', 'cash']).optional(),
      source_id: uuid.optional(),
    })
    .strict()
    .refine((v) => Boolean(v.source_kind) === Boolean(v.source_id)),
  goal: z
    .object({
      account_id: uuid,
      name: z.string().trim().min(1).max(120),
      target: positive,
      due_date: date,
    })
    .strict(),
  budget: z
    .object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .refine((v) => v >= '1900-01'),
      category: z.enum(['harvest', 'garden', 'other', 'savings_expense', 'investment_expense']),
      amount: positive,
    })
    .strict(),
};
const query = z
  .object({
    month: z.union([z.literal('all'), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]).default('all'),
    year: z.coerce.number().int().min(1900).max(9999).optional(),
    period: z.enum(['month', 'year']).default('month'),
    before: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    audit_before: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
  })
  .strict();
router.get('/finance/integrity', async (req, res, next) => {
  try {
    const { data, error } = await req.database.rpc('finance_integrity');
    if (error) throwDatabaseError(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
router.get('/finance', async (req, res, next) => {
  try {
    const input = query.parse(req.query);
    input.year ??= Number(
      new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'Asia/Makassar' }).format(
        new Date(),
      ),
    );
    const { data, error } = await req.database.rpc(
      'finance_snapshot',
      Object.fromEntries(Object.entries(input).map(([key, value]) => [`p_${key}`, value])),
    );
    if (error) throwDatabaseError(error);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});
async function command(req, res, next) {
  try {
    const kind = z.enum(Object.keys(schemas)).parse(req.params.kind);
    const id = req.params.id ? uuid.parse(req.params.id) : null;
    if (id && !['goal', 'budget'].includes(kind))
      throw new AppError(400, 'Jenis catatan ini tidak dapat diedit.');
    const fields = schemas[kind].parse(req.body);
    const context = writeContext(req, Boolean(id));
    const { data, error } = await req.database.rpc('finance_command', {
      p_kind: kind,
      p_fields: fields,
      p_request_key: context.requestKey,
      p_id: id,
      p_version: context.version,
    });
    if (error) throwDatabaseError(error);
    res.status(id ? 200 : 201).json({ data });
  } catch (error) {
    next(error);
  }
}
router.post('/finance/:kind', command);
router.patch('/finance/:kind/:id', command);
module.exports = router;
