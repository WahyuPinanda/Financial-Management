const { isConfigured } = require('../config/env');
const { createUserClient } = require('../config/supabase');
const { AppError } = require('../libs/errors');
const { needsMfa } = require('../libs/mfa');

async function checkAuth(req, res, next) {
  try {
    if (!isConfigured) throw new AppError(503, 'Konfigurasi Supabase belum diisi di server.');
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) {
      throw new AppError(401, 'Silakan login terlebih dahulu.');
    }
    const database = createUserClient(authorization);
    const { data, error } = await database.auth.getUser(authorization.slice(7));
    if (
      error &&
      (error.name === 'AuthRetryableFetchError' || error.status === 0 || error.status >= 500)
    ) {
      throw new AppError(503, 'Layanan autentikasi belum tersedia. Coba lagi beberapa saat.');
    }
    if (error || !data.user) throw new AppError(401, 'Sesi telah berakhir. Silakan login kembali.');
    if (needsMfa(data.user, authorization.slice(7)))
      throw new AppError(403, 'Verifikasi kode dua langkah terlebih dahulu.');
    req.database = database;
    req.user = data.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { checkAuth };
