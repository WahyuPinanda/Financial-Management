const { canEdit } = require('@sawit/shared');
const repository = require('../repositories/harvestRepository');
const { AppError } = require('../libs/errors');
const { serializePublication } = require('../libs/publication');

async function listHarvests(database) {
  const rows = await repository.listHarvests(database);
  return rows.map((row) => ({
    ...row,
    spks: row.spks
      .map(serializePublication)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    expenses: row.expenses
      .map(serializePublication)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

async function createHarvest(database, input, userId, context) {
  return repository.createHarvest(database, input, userId, context);
}

async function createSpk(database, harvestId, input, userId, context) {
  return serializePublication(
    await repository.createSpk(database, harvestId, input, userId, context),
  );
}

async function updateSpk(database, id, input, context) {
  const existing = await repository.findSpk(database, id);
  if (!canEdit(existing.published_at))
    throw new AppError(409, 'SPK terkunci: batas edit 7 hari telah berakhir.');
  return serializePublication(
    await repository.updateSpk(database, id, input, existing.published_at, context),
  );
}

module.exports = { listHarvests, createHarvest, createSpk, updateSpk };
