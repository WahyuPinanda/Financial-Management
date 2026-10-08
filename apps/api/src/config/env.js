const { resolve } = require('node:path');
const { z } = require('zod');
require('dotenv').config({ path: resolve(__dirname, '../../.env') });

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SERVE_WEB: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  HEALTHCHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  HEALTHCHECK_TOKEN: z.string().min(32).optional(),
});
const env = schema.parse(process.env);
const isConfigured = Boolean(
  env.SUPABASE_URL &&
  env.SUPABASE_ANON_KEY &&
  !env.SUPABASE_URL.includes('YOUR_PROJECT') &&
  !env.SUPABASE_ANON_KEY.includes('YOUR_'),
);

module.exports = { env, isConfigured };
