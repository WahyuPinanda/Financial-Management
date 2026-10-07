const { ZodError } = require('zod');

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function throwDatabaseError(error) {
  if (error.code === '23505')
    throw new AppError(409, 'Catatan sudah tersedia. Muat ulang sebelum menyimpan.');
  if (error.code === '40001')
    throw new AppError(409, error.message || 'Data telah berubah. Muat ulang sebelum mengedit.');
  if (error.code === '22023') throw new AppError(400, 'Parameter transaksi tidak valid.');
  if (error.code === 'P0001') throw new AppError(409, error.message || 'SPK tidak dapat diubah.');
  if (error.code === '23503') throw new AppError(404, 'Panen tidak ditemukan.');
  if (error.code === '23514' || error.code === '22003')
    throw new AppError(400, 'Data transaksi tidak valid.');
  if (error.code === '42501') throw new AppError(403, 'Anda tidak memiliki akses ke data ini.');
  console.error('Database request failed:', error.code || 'unknown');
  throw new AppError(503, 'Database belum tersedia. Periksa konfigurasi Supabase dan migrasi.');
}

function errorHandler(error, req, res, next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      status: false,
      message: error.issues[0]?.message || 'Data tidak valid.',
      errors: error.flatten(),
    });
  }
  if (error instanceof AppError)
    return res.status(error.status).json({ status: false, message: error.message });
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ status: false, message: 'JSON tidak valid.' });
  if (error.type === 'entity.too.large')
    return res.status(413).json({ status: false, message: 'Data terlalu besar.' });
  console.error('Unhandled API error:', error instanceof Error ? error.name : 'unknown');
  return res
    .status(500)
    .json({ status: false, message: 'Terjadi kesalahan server. Silakan coba lagi.' });
}

module.exports = { AppError, throwDatabaseError, errorHandler };
