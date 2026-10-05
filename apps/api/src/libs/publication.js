const { canEdit, EDIT_WINDOW_MS } = require('@sawit/shared');

function serializePublication(row) {
  return {
    ...row,
    editable: canEdit(row.published_at),
    edit_deadline: row.published_at
      ? new Date(Date.parse(row.published_at) + EDIT_WINDOW_MS).toISOString()
      : null,
  };
}

module.exports = { serializePublication };
