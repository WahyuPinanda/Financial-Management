const { isConfigured } = require('../config/env');
const { createUserClient } = require('../config/supabase');
const { AppError } = require('../libs/errors');

async function checkAuth(req, res, next) {
  try {
    if (!isConfigured) throw new AppError(503, 'Konfigurasi Supabase belum diisi di server.');
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) {
      throw new AppError(401, 'Silakan login terlebih dahulu.');
    }
    const database = createUserClient(authorization);
    const { data, error } = await database.auth.getUser(authorization.slice(7));
    if (error || !data.user) throw new AppError(401, 'Sesi telah berakhir. Silakan login kembali.');
    req.database = database;
    req.user = data.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { checkAuth };
