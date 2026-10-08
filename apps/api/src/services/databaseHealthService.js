const { randomBytes, timingSafeEqual } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { env, isConfigured } = require('../config/env');
const token = env.HEALTHCHECK_TOKEN || randomBytes(32).toString('hex');

function authorized(value) {
  const input = Buffer.from(value || '');
  const expected = Buffer.from(token);
  return input.length === expected.length && timingSafeEqual(input, expected);
}
async function probeDatabase() {
  if (!isConfigured) throw new Error('Database belum dikonfigurasi.');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .rpc('database_healthcheck')
    .abortSignal(AbortSignal.timeout(10000));
  if (error || data?.ok !== true) throw new Error('Database health check gagal.');
  return data;
}
module.exports = { token, authorized, probeDatabase };
