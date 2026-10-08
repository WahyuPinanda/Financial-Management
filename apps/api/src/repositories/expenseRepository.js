const { AppError, throwDatabaseError } = require('../libs/errors');

const financial = require('./financialRepository');
async function createExpense(database, harvestId, input, userId, context) {
  return financial.save(database, 'harvest_expense', { ...input, harvest_id: harvestId }, context);
}

async function findExpense(database, id) {
  const { data, error } = await database
    .from('harvest_expenses')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new AppError(404, 'Pengeluaran tidak ditemukan.');
  return data;
}

async function updateExpense(database, id, input, publishedAt, context) {
  return financial.save(database, 'harvest_expense', input, context, id);
}

module.exports = { createExpense, findExpense, updateExpense };
