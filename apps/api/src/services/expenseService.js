const { canEdit } = require('@sawit/shared');
const repository = require('../repositories/expenseRepository');
const { AppError } = require('../libs/errors');
const { serializePublication } = require('../libs/publication');

async function createExpense(database, harvestId, input, userId) {
  return serializePublication(await repository.createExpense(database, harvestId, input, userId));
}

async function updateExpense(database, id, input) {
  const existing = await repository.findExpense(database, id);
  if (!canEdit(existing.published_at)) {
    throw new AppError(409, 'Pengeluaran terkunci: batas edit 7 hari telah berakhir.');
  }
  return serializePublication(
    await repository.updateExpense(database, id, input, existing.published_at),
  );
}

module.exports = { createExpense, updateExpense };
