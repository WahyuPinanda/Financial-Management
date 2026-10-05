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
async function save(database, category, input, userId, existing) {
  const { publish, ...fields } = input;
  const published_at = existing?.published_at || (publish ? new Date().toISOString() : null);
  const query = existing
    ? database
        .from('cash_expenses')
        .update({ ...fields, published_at })
        .eq('id', existing.id)
        .eq('category', category)
    : database.from('cash_expenses').insert({ ...fields, published_at, category, user_id: userId });
  const { data, error } = await query.select().maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new AppError(404, 'Pengeluaran tidak ditemukan.');
  return data;
}
module.exports = { list, find, save };
