const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { env, isConfigured } = require('./config/env');
const { errorHandler } = require('./libs/errors');
const harvestRoutes = require('./routes/harvestRoutes');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN }));
app.use(express.json({ limit: '32kb' }));
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
app.use('/api', harvestRoutes);
app.use((req, res) =>
  res.status(404).json({ status: false, message: 'Endpoint tidak ditemukan.' }),
);
app.use(errorHandler);

module.exports = app;
