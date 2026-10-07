const app = require('./app');
const { env, isConfigured } = require('./config/env');
const { startHealthScheduler } = require('./services/healthScheduler');
const { token } = require('./services/databaseHealthService');
let stopHealthCheck = () => {};

const server = app.listen(env.PORT, () => {
  console.log(`API: http://localhost:${env.PORT}`);
  if (isConfigured && env.HEALTHCHECK_ENABLED) {
    stopHealthCheck = startHealthScheduler({
      url: `http://127.0.0.1:${env.PORT}/api/health/database`,
      token,
    });
  }
  if (!isConfigured)
    console.log('Supabase belum dikonfigurasi. Salin apps/api/.env.example ke .env.');
});
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopHealthCheck();
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10000);
  deadline.unref();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
