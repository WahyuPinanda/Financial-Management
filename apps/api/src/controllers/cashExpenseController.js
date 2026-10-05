const { z } = require('zod');
const { cashExpenseSchema } = require('@sawit/shared');
const service = require('../services/cashExpenseService');
const categorySchema = z.enum(['garden', 'other']);

async function list(req, res, next) {
  try {
    res.json({ data: await service.list(req.database), server_time: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
}
async function save(req, res, next) {
  try {
    const category = categorySchema.parse(req.params.category);
    const id = req.params.id ? z.string().uuid('ID tidak valid.').parse(req.params.id) : undefined;
    const input = cashExpenseSchema.parse(req.body);
    const data = await service.save(req.database, category, input, req.user.id, id);
    res.status(id ? 200 : 201).json({ status: true, data });
  } catch (error) {
    next(error);
  }
}
module.exports = { list, save };
