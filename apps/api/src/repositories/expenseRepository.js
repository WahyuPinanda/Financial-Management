const { AppError, throwDatabaseError } = require('../libs/errors');

async function createExpense(database, harvestId, input, userId) {
  const { publish, ...fields } = input;
  const { data, error } = await database
    .from('harvest_expenses')
    .insert({
      ...fields,
      harvest_id: harvestId,
      user_id: userId,
      published_at: publish ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) throwDatabaseError(error);
  return data;
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

async function updateExpense(database, id, input, publishedAt) {
  const { publish, ...fields } = input;
  const { data, error } = await database
    .from('harvest_expenses')
    .update({ ...fields, published_at: publishedAt || (publish ? new Date().toISOString() : null) })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new AppError(404, 'Pengeluaran tidak ditemukan.');
  return data;
}

module.exports = { createExpense, findExpense, updateExpense };
