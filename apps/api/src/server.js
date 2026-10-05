const app = require('./app');
const { env, isConfigured } = require('./config/env');

const server = app.listen(env.PORT, () => {
  console.log(`API: http://localhost:${env.PORT}`);
  if (!isConfigured)
    console.log('Supabase belum dikonfigurasi. Salin apps/api/.env.example ke .env.');
});
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
