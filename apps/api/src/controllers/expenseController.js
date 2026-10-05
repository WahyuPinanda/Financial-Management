const { z } = require('zod');
const { expenseSchema } = require('@sawit/shared');
const expenseService = require('../services/expenseService');
const { writeContext } = require('../libs/writeContext');

const uuid = z.string().uuid('ID tidak valid.');

async function createExpense(req, res, next) {
  try {
    const harvestId = uuid.parse(req.params.harvestId);
    const input = expenseSchema.parse(req.body);
    const data = await expenseService.createExpense(
      req.database,
      harvestId,
      input,
      req.user.id,
      writeContext(req),
    );
    return res.status(201).json({ status: true, data });
  } catch (error) {
    return next(error);
  }
}

async function updateExpense(req, res, next) {
  try {
    const expenseId = uuid.parse(req.params.expenseId);
    const input = expenseSchema.parse(req.body);
    const data = await expenseService.updateExpense(
      req.database,
      expenseId,
      input,
      writeContext(req, true),
    );
    return res.json({ status: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { createExpense, updateExpense };
