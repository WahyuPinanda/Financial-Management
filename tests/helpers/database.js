const { PGlite } = require('@electric-sql/pglite');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create table auth.mfa_factors(id uuid primary key, user_id uuid references auth.users(id), status text);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const name of readdirSync(resolve(__dirname, '../../supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    try {
      await db.exec(readFileSync(resolve(__dirname, '../../supabase/migrations', name), 'utf8'));
    } catch (error) {
      await db.close();
      throw new Error(`${name}: ${error.message}`);
    }
  }
  return db;
}
module.exports = { database };
