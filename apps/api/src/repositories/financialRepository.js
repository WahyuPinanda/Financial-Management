const { throwDatabaseError } = require('../libs/errors');
async function save(database, kind, fields, context, id = null) {
  const { data, error } = await database.rpc('save_financial_record', {
    p_kind: kind,
    p_fields: fields,
    p_request_key: context.requestKey,
    p_id: id,
    p_version: context.version,
  });
  if (error) throwDatabaseError(error);
  return data;
}
module.exports = { save };
