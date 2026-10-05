const { canEdit } = require('@sawit/shared');
const repository = require('../repositories/cashExpenseRepository');
const { serializePublication } = require('../libs/publication');
const { AppError } = require('../libs/errors');

async function list(database) {
  return (await repository.list(database)).map(serializePublication);
}
async function save(database, category, input, userId, id) {
  const existing = id ? await repository.find(database, id, category) : undefined;
  if (existing && !canEdit(existing.published_at)) {
    throw new AppError(409, 'Pengeluaran terkunci: batas edit 7 hari telah berakhir.');
  }
  return serializePublication(await repository.save(database, category, input, userId, existing));
}
module.exports = { list, save };
