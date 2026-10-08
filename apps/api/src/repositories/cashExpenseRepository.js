const { AppError, throwDatabaseError } = require('../libs/errors');

async function list(database) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await database
      .from('cash_expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 499);
    if (error) throwDatabaseError(error);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}
async function find(database, id, category) {
  const { data, error } = await database
    .from('cash_expenses')
    .select('*')
    .eq('id', id)
    .eq('category', category)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new AppError(404, 'Pengeluaran tidak ditemukan.');
  return data;
}
async function save(database, category, input, userId, existing, context) {
  return require('./financialRepository').save(
    database,
    category,
    input,
    context,
    existing?.id ?? null,
  );
}
module.exports = { list, find, save };
