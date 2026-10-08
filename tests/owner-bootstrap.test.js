const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrapOwner } = require('../scripts/supabase/bootstrap-owner');
const values = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_ADMIN_KEY: 'sb_secret_' + 'x'.repeat(32),
  OWNER_EMAIL: 'owner@example.test',
  OWNER_PASSWORD: 'fixture-only-password',
};

test('one-time setup creates a confirmed Supabase user without returning credentials', async () => {
  let attributes;
  const result = await bootstrapOwner(values, (_url, _key, options) => {
    assert.equal(options.auth.persistSession, false);
    return {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [] } }),
          createUser: async (input) => {
            attributes = input;
            return { data: { user: { id: 'fixture', email_confirmed_at: 'now' } } };
          },
        },
      },
    };
  });
  assert.deepEqual(attributes, {
    email: values.OWNER_EMAIL,
    password: values.OWNER_PASSWORD,
    email_confirm: true,
  });
  assert.deepEqual(result, { status: 'created', emailConfirmed: true });
  assert.doesNotMatch(JSON.stringify(result), /password|secret|fixture-only/);
});

test('repeated setup finds existing users across pages and never resets a password', async () => {
  let pages = 0;
  const result = await bootstrapOwner(values, () => ({
    auth: {
      admin: {
        listUsers: async ({ page }) => {
          pages++;
          return {
            data: {
              users:
                page === 1
                  ? Array.from({ length: 100 }, () => ({ email: 'other@example.test' }))
                  : [{ email: values.OWNER_EMAIL.toUpperCase() }],
            },
          };
        },
        createUser: async () => {
          throw new Error('Must not create or reset existing owner');
        },
      },
    },
  }));
  assert.equal(pages, 2);
  assert.deepEqual(result, { status: 'already_exists', passwordChanged: false });
});

test('owner setup rejects public keys and unsafe destinations before sending credentials', async () => {
  const factory = () => {
    throw new Error('Unexpected network client');
  };
  for (const fields of [
    { SUPABASE_ADMIN_KEY: 'sb_publishable_' + 'x'.repeat(32) },
    { SUPABASE_URL: 'http://fixture.supabase.co' },
    { SUPABASE_URL: 'https://other.example.test' },
    { OWNER_PASSWORD: 'short' },
  ])
    await assert.rejects(bootstrapOwner({ ...values, ...fields }, factory));
});

test('provider failures do not leak credentials and never proceed after failed lookup', async () => {
  await assert.rejects(
    bootstrapOwner(values, () => ({
      auth: {
        admin: {
          listUsers: async () => ({ error: { message: values.OWNER_PASSWORD } }),
          createUser: async () => {
            throw new Error('Unexpected creation');
          },
        },
      },
    })),
    /^Error: Owner lookup failed\.$/,
  );
  await assert.rejects(
    bootstrapOwner(values, () => ({
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [] } }),
          createUser: async () => ({ error: { message: values.SUPABASE_ADMIN_KEY } }),
        },
      },
    })),
    /^Error: Owner creation failed\.$/,
  );
});
