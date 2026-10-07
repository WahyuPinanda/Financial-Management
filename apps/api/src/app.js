const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { env, isConfigured } = require('./config/env');
const { errorHandler } = require('./libs/errors');
const harvestRoutes = require('./routes/harvestRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const cashExpenseRoutes = require('./routes/cashExpenseRoutes');
const workspaceRoutes = require('./routes/workspaceRoutes');
const financeRoutes = require('./routes/financeRoutes');
const archiveRoutes = require('./routes/archiveRoutes');
const productivityRoutes = require('./routes/productivityRoutes');
const { checkAuth } = require('./middlewares/authMiddleware');
const databaseHealth = require('./services/databaseHealthService');
const monitoring = require('./services/monitoringService');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.use(helmet());
app.use(monitoring.monitoring);
app.use(cors({ origin: env.WEB_ORIGIN }));
app.use(express.json({ limit: '64kb' }));
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { status: false, message: 'Terlalu banyak permintaan. Coba lagi dalam satu menit.' },
  }),
);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/api/health', (req, res) => res.json({ status: 'ok', configured: isConfigured }));
app.get('/api/health/metrics', (req, res) => {
  if (!databaseHealth.authorized(req.get('X-Healthcheck-Token')))
    return res.status(401).json({ status: 'unauthorized' });
  res.json({ status: 'ok', data: monitoring.snapshot() });
});
app.get('/api/health/database', async (req, res) => {
  if (!databaseHealth.authorized(req.get('X-Healthcheck-Token'))) {
    return res.status(401).json({ status: 'unauthorized' });
  }
  try {
    const database = await databaseHealth.probeDatabase();
    res.json({ status: 'ok', database });
  } catch {
    res.status(503).json({ status: 'unhealthy' });
  }
});
app.use(
  '/api',
  checkAuth,
  harvestRoutes,
  expenseRoutes,
  cashExpenseRoutes,
  workspaceRoutes,
  financeRoutes,
  archiveRoutes,
  productivityRoutes,
);
app.use((req, res) =>
  res.status(404).json({ status: false, message: 'Endpoint tidak ditemukan.' }),
);
app.use(errorHandler);

module.exports = app;
