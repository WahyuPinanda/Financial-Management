const { canEdit, EDIT_WINDOW_MS } = require('@sawit/shared');
const repository = require('../repositories/harvestRepository');
const { AppError } = require('../libs/errors');

function serializeSpk(row) {
  return {
    ...row,
    editable: canEdit(row.published_at),
    edit_deadline: row.published_at
      ? new Date(Date.parse(row.published_at) + EDIT_WINDOW_MS).toISOString()
      : null,
  };
}

async function listHarvests(database) {
  const rows = await repository.listHarvests(database);
  return rows.map((row) => ({
    ...row,
    spks: row.spks.map(serializeSpk).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

async function createHarvest(database, input, userId) {
  return repository.createHarvest(database, input, userId);
}

async function createSpk(database, harvestId, input, userId) {
  return serializeSpk(await repository.createSpk(database, harvestId, input, userId));
}

async function updateSpk(database, id, input) {
  const existing = await repository.findSpk(database, id);
  if (!canEdit(existing.published_at))
    throw new AppError(409, 'SPK terkunci: batas edit 7 hari telah berakhir.');
  return serializeSpk(await repository.updateSpk(database, id, input, existing.published_at));
}

module.exports = { listHarvests, createHarvest, createSpk, updateSpk };
