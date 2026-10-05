const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');

function createUserClient(authorization) {
  // A request-scoped client preserves ownership through the user's JWT and RLS.
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

module.exports = { createUserClient };
