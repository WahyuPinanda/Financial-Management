const { AppError, throwDatabaseError } = require('../libs/errors');

async function readPages(database, table, column, ascending) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await database
      .from(table)
      .select('*')
      .order(column, { ascending })
      .order('id', { ascending })
      .range(offset, offset + pageSize - 1);
    if (error) throwDatabaseError(error);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function listHarvests(database) {
  // Paginate both resources: Supabase's row cap must not silently truncate totals.
  const [harvests, spks] = await Promise.all([
    readPages(database, 'harvests', 'harvest_date', false),
    readPages(database, 'spks', 'created_at', true),
  ]);
  const groups = new Map(harvests.map((harvest) => [harvest.id, { ...harvest, spks: [] }]));
  for (const spk of spks) groups.get(spk.harvest_id)?.spks.push(spk);
  return [...groups.values()];
}

async function createHarvest(database, input, userId) {
  const { data, error } = await database
    .from('harvests')
    .insert({ ...input, user_id: userId })
    .select()
    .single();
  if (error) throwDatabaseError(error);
  return { ...data, spks: [] };
}

async function findSpk(database, id) {
  const { data, error } = await database.from('spks').select('*').eq('id', id).maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new AppError(404, 'SPK tidak ditemukan.');
  return data;
}

async function createSpk(database, harvestId, input, userId) {
  const { publish, ...fields } = input;
  const { data, error } = await database
    .from('spks')
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

async function updateSpk(database, id, input, publishedAt) {
  const { publish, ...fields } = input;
  const { data, error } = await database
    .from('spks')
    .update({ ...fields, published_at: publishedAt || (publish ? new Date().toISOString() : null) })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new AppError(404, 'SPK tidak ditemukan.');
  return data;
}

module.exports = { listHarvests, createHarvest, findSpk, createSpk, updateSpk };
