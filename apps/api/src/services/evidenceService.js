const { createHash } = require('node:crypto');
const { AppError } = require('../libs/errors');
function validateEvidence(buffer, receipt) {
  const signature =
    receipt.mime === 'image/png'
      ? Buffer.from('89504e470d0a1a0a', 'hex')
      : receipt.mime === 'image/jpeg'
        ? Buffer.from('ffd8ff', 'hex')
        : Buffer.from('%PDF-');
  const checksum = createHash('sha256').update(buffer).digest('hex');
  if (
    buffer.length !== receipt.bytes ||
    buffer.length > 5242880 ||
    checksum !== receipt.sha256 ||
    !buffer.subarray(0, signature.length).equals(signature)
  ) {
    throw new AppError(400, 'Isi bukti tidak sesuai ukuran, format, atau checksum.');
  }
  return checksum;
}
module.exports = { validateEvidence };
