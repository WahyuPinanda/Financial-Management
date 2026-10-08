const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parse } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

function configuration(values) {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(values.SUPABASE_URL || ''))
    throw new Error('Use the Supabase project root URL.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.OWNER_EMAIL || ''))
    throw new Error('OWNER_EMAIL is required.');
  if (typeof values.OWNER_PASSWORD !== 'string' || values.OWNER_PASSWORD.length < 8)
    throw new Error('OWNER_PASSWORD must contain at least eight characters.');
  const key = values.SUPABASE_ADMIN_KEY || '';
  let legacyAdmin = false;
  try {
    legacyAdmin = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'service_role';
  } catch {}
  if (!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key) && !legacyAdmin)
    throw new Error('A server-only SUPABASE_ADMIN_KEY is required for one-time setup.');
  return { ...values, OWNER_EMAIL: values.OWNER_EMAIL.trim().toLowerCase() };
}

async function bootstrapOwner(values, factory = createClient) {
  const config = configuration(values);
  const client = factory(config.SUPABASE_URL, config.SUPABASE_ADMIN_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (url, options) =>
        fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }),
    },
  });
  // Never reset an existing owner's credentials, including after a lost create response.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !Array.isArray(data?.users)) throw new Error('Owner lookup failed.');
    if (data.users.some((user) => user.email?.toLowerCase() === config.OWNER_EMAIL))
      return { status: 'already_exists', passwordChanged: false };
    if (data.users.length < 100) break;
    if (page === 20) throw new Error('Owner lookup exceeded the setup limit.');
  }
  const { data, error } = await client.auth.admin.createUser({
    email: config.OWNER_EMAIL,
    password: config.OWNER_PASSWORD,
    email_confirm: true,
  });
  if (error || !data?.user?.id) throw new Error('Owner creation failed.');
  return { status: 'created', emailConfirmed: Boolean(data.user.email_confirmed_at) };
}

if (require.main === module) {
  const file = resolve(__dirname, '../../ops/bootstrap/.env');
  Promise.resolve()
    .then(() => bootstrapOwner({ ...parse(readFileSync(file)), ...process.env }))
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      // Errors from Auth providers can contain user details; do not log their payloads.
      console.error('Owner setup failed. Check local configuration and Supabase Auth settings.');
      process.exitCode = 1;
    });
}

module.exports = { bootstrapOwner };
