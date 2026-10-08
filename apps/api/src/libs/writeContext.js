const { z } = require('zod');
const { AppError } = require('./errors');
function writeContext(req, editing = false) {
  const requestKey = z
    .string()
    .uuid('Idempotency-Key wajib berupa UUID.')
    .parse(req.get('Idempotency-Key'));
  const version = editing ? Number(req.get('If-Match')) : null;
  if (editing && (!Number.isSafeInteger(version) || version < 1))
    throw new AppError(428, 'Versi data wajib diisi. Muat ulang catatan.');
  return { requestKey, version };
}
module.exports = { writeContext };
