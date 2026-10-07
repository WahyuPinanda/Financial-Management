const { Client } = require('pg');
const { spawn } = require('node:child_process');
const { promises: fs } = require('node:fs');
const { resolve, join, dirname, isAbsolute, relative } = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createClient } = require('@supabase/supabase-js');
const {
  keyFrom,
  encryptStream,
  decryptStream,
  readEncryptedJson,
  hashBuffer,
} = require('./crypto');
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
function connection(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('PostgreSQL URL required');
  if (
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) &&
    url.searchParams.get('sslmode') !== 'verify-full'
  )
    throw new Error('Remote database requires sslmode=verify-full (and a trusted PGSSLROOTCERT).');
  return url;
}
function pgEnvironment(value) {
  const url = connection(value);
  return {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') || 'disable',
    PGCONNECT_TIMEOUT: '15',
  };
}
function databaseClient(value, config) {
  const url = connection(value);
  if (url.searchParams.get('sslmode') === 'verify-full' && config.PGSSLROOTCERT)
    url.searchParams.set('sslrootcert', config.PGSSLROOTCERT);
  return new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 15000,
    statement_timeout: 300000,
  });
}
function childExit(child) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error('PostgreSQL utility exceeded 30 minutes.'));
    }, 1800000);
    timer.unref();
    child.once('error', (e) => {
      clearTimeout(timer);
      fail(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0
        ? ok()
        : fail(new Error('PostgreSQL utility failed; check extensions and server/tool versions.'));
    });
  });
}
async function fingerprint(db) {
  const tables = (
    await db.query(
      "select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by schemaname,tablename",
    )
  ).rows;
  const result = [];
  for (const t of tables) {
    const full = `${quote(t.schemaname)}.${quote(t.tablename)}`;
    const row = (
      await db.query(
        `select count(*)::text as count,coalesce(sum(hashtextextended(row_to_json(r)::text,0)::numeric),0)::text as hash1,coalesce(sum(hashtextextended(row_to_json(r)::text,1)::numeric),0)::text as hash2 from ${full} r`,
      )
    ).rows[0];
    result.push({ ...t, ...row });
  }
  return result;
}
async function integrity(db) {
  return (
    Number(
      (
        await db.query(
          'select count(*)::text as bad from public.finance_accounts a where balance<>coalesce((select sum(delta) from public.finance_movements where account_id=a.id),0)',
        )
      ).rows[0].bad,
    ) === 0
  );
}
async function permissions(db) {
  return (
    await db.query(`with objects as (
  select 'relation' kind,n.nspname as schema,c.relname name,coalesce(c.relacl,acldefault('r',c.relowner)) acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind in ('r','v','m','p')
  union all select 'function',n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',coalesce(p.proacl,acldefault('f',p.proowner)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth'))
  select kind,schema,name,case when a.grantee=0 then 'PUBLIC' else r.rolname end grantee,a.privilege_type,a.is_grantable
  from objects o cross join lateral aclexplode(o.acl) a left join pg_roles r on r.oid=a.grantee
  where a.grantee=0 or r.rolname in ('anon','authenticated') order by kind,schema,name,grantee,a.privilege_type`)
  ).rows;
}
function storageClient(config) {
  if (!config.STORAGE_ADMIN_KEY || !config.SUPABASE_URL)
    throw new Error(
      'Receipt backup needs SUPABASE_URL and STORAGE_ADMIN_KEY in the separate operations environment.',
    );
  return createClient(config.SUPABASE_URL, config.STORAGE_ADMIN_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30000) }),
    },
  });
}
async function backup(config = process.env) {
  connection(config.BACKUP_DATABASE_URL);
  const key = keyFrom(config.BACKUP_KEY_HEX);
  if (!isAbsolute(config.BACKUP_ROOT ?? ''))
    throw new Error('BACKUP_ROOT must be an explicit absolute private directory.');
  const root = resolve(config.BACKUP_ROOT);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const folder = join(
    root,
    new Date().toISOString().replaceAll(':', '-') + '-' + require('node:crypto').randomUUID(),
  );
  await fs.mkdir(folder, { mode: 0o700 });
  const db = databaseClient(config.BACKUP_DATABASE_URL, config);
  await db.connect();
  try {
    await db.query('begin isolation level repeatable read read only');
    const snapshot = (await db.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
    const manifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      postgres: (await db.query('show server_version')).rows[0].server_version,
      tables: await fingerprint(db),
      permissions: await permissions(db),
      integrity: await integrity(db),
      receipts: [],
      scope: ['public', 'auth'],
    };
    if (!manifest.integrity)
      throw new Error('Account balances differ from journal; backup failed verification.');
    let receiptCount = 0;
    const storeClient =
      config.SUPABASE_URL && config.STORAGE_ADMIN_KEY ? storageClient(config) : null;
    async function* receiptArchive() {
      await db.query(
        'declare receipt_cursor no scroll cursor for select id,object_path,sha256,bytes from public.finance_receipts where uploaded_at is not null order by id',
      );
      for (;;) {
        const rows = (await db.query('fetch forward 200 from receipt_cursor')).rows;
        if (!rows.length) break;
        for (const r of rows) {
          if (!storeClient) throw new Error('Receipt backup requires private Storage credentials');
          const { data, error } = await storeClient.storage
            .from('cash-flow-receipts')
            .download(r.object_path);
          if (error) throw new Error('Confirmed receipt unavailable');
          const buffer = Buffer.from(await data.arrayBuffer());
          if (buffer.length !== r.bytes || hashBuffer(buffer) !== r.sha256)
            throw new Error('Receipt integrity mismatch');
          const file = r.id + '.enc';
          await encryptStream(Readable.from([buffer]), join(folder, file), key);
          receiptCount++;
          yield Buffer.from(JSON.stringify({ ...r, file }) + '\n');
        }
      }
      await db.query('close receipt_cursor');
    }
    await encryptStream(Readable.from(receiptArchive()), join(folder, 'receipts.enc'), key);
    manifest.receiptCount = receiptCount;
    delete manifest.receipts;
    const child = spawn(
      config.PG_DUMP_BIN || 'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--schema=public',
        '--schema=auth',
        `--snapshot=${snapshot}`,
      ],
      {
        env: pgEnvironment(config.BACKUP_DATABASE_URL),
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    const exited = childExit(child);
    await Promise.all([encryptStream(child.stdout, join(folder, 'database.enc'), key), exited]);
    await db.query('commit');
    await encryptStream(
      Readable.from([Buffer.from(JSON.stringify(manifest))]),
      join(folder, 'manifest.enc'),
      key,
    );
    await fs.writeFile(
      join(folder, 'complete.json'),
      JSON.stringify({ format: 1, completedAt: new Date().toISOString() }),
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      JSON.stringify({
        event: 'backup_complete',
        receipts: receiptCount,
        tables: manifest.tables.length,
      }),
    );
    return folder;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}
async function restoreTest(folder, config = process.env) {
  const source = connection(config.BACKUP_DATABASE_URL),
    target = connection(config.RESTORE_TEST_DATABASE_URL);
  if (
    !/^[a-zA-Z][a-zA-Z0-9_]{0,49}_restore_test$/.test(
      decodeURIComponent(target.pathname.slice(1)),
    ) ||
    (source.hostname === target.hostname &&
      (source.port || '5432') === (target.port || '5432') &&
      source.pathname === target.pathname)
  )
    throw new Error('Restore tests require a separate database ending in _restore_test.');
  const key = keyFrom(config.BACKUP_KEY_HEX),
    root = resolve(config.BACKUP_ROOT),
    path = resolve(folder);
  if (
    !relative(root, path) ||
    relative(root, path).startsWith('..') ||
    isAbsolute(relative(root, path))
  )
    throw new Error('Backup must be a child of BACKUP_ROOT');
  await fs.access(join(path, 'complete.json'));
  const manifest = await readEncryptedJson(join(path, 'manifest.enc'), key);
  const db = databaseClient(config.RESTORE_TEST_DATABASE_URL, config);
  await db.connect();
  try {
    if (
      (await db.query("select 1 from pg_tables where schemaname in ('public','auth') limit 1")).rows
        .length
    )
      throw new Error(
        'Restore target must have no public/auth tables. No automatic DROP is performed.',
      );
    const targetVersion = (await db.query('show server_version')).rows[0].server_version;
    if (targetVersion.split('.')[0] !== manifest.postgres.split('.')[0])
      throw new Error('Restore target must use the same PostgreSQL major version.');
    // Authenticate the entire archive before allowing pg_restore to execute any SQL.
    await decryptStream(
      join(path, 'database.enc'),
      key,
      new Writable({
        write(chunk, encoding, done) {
          done();
        },
      }),
    );
    const child = spawn(
      config.PG_RESTORE_BIN || 'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        `--dbname=${decodeURIComponent(target.pathname.slice(1))}`,
      ],
      {
        env: pgEnvironment(config.RESTORE_TEST_DATABASE_URL),
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
      },
    );
    const exited = childExit(child);
    await Promise.all([decryptStream(join(path, 'database.enc'), key, child.stdin), exited]);
    const actual = await fingerprint(db);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables) || !(await integrity(db)))
      throw new Error('Restored rows or balances differ from backup');
    if (JSON.stringify(await permissions(db)) !== JSON.stringify(manifest.permissions))
      throw new Error('Restored application privileges differ from backup');
    // Validate encrypted Storage payloads without publishing them into any live bucket.
    let remainder = '',
      receiptCount = 0;
    async function verifyReceipt(r) {
      if (!/^[a-f0-9-]{36}\.enc$/.test(r.file) || r.bytes > 5242880 || r.bytes < 1)
        throw new Error('Invalid receipt metadata');
      const chunks = [];
      await decryptStream(
        join(path, r.file),
        key,
        new Writable({
          write(c, e, done) {
            chunks.push(c);
            done();
          },
        }),
      );
      const buffer = Buffer.concat(chunks);
      if (buffer.length !== r.bytes || hashBuffer(buffer) !== r.sha256)
        throw new Error('Restored evidence differs from manifest');
      receiptCount++;
    }
    await decryptStream(
      join(path, 'receipts.enc'),
      key,
      new Writable({
        write(chunk, encoding, done) {
          void (async () => {
            remainder += chunk.toString('utf8');
            let newline;
            while ((newline = remainder.indexOf('\n')) !== -1) {
              const line = remainder.slice(0, newline);
              remainder = remainder.slice(newline + 1);
              if (line) await verifyReceipt(JSON.parse(line));
            }
            if (remainder.length > 16384) throw new Error('Receipt manifest line exceeds limit');
          })().then(() => done(), done);
        },
      }),
    );
    if (remainder || receiptCount !== manifest.receiptCount)
      throw new Error('Incomplete receipt archive');

    await fs.writeFile(
      join(path, 'restore-tested.json'),
      JSON.stringify({
        testedAt: new Date().toISOString(),
        tables: actual.length,
        receipts: receiptCount,
      }),
      { mode: 0o600 },
    );
    await fs.writeFile(
      join(root, 'last-restore-success.json'),
      JSON.stringify({ testedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ event: 'restore_test_passed', tables: actual.length }));
    return true;
  } finally {
    await db.end();
  }
}
module.exports = {
  backup,
  restoreTest,
  fingerprint,
  integrity,
  permissions,
  connection,
  pgEnvironment,
};
if (require.main === module) {
  require('dotenv').config({ path: resolve(__dirname, '../../ops/.env') });
  const mode = process.argv[2];
  (mode === 'restore-test'
    ? restoreTest(process.argv[3])
    : mode === 'backup'
      ? backup()
      : Promise.reject(new Error('Use backup or restore-test <backup-folder>'))
  ).catch((e) => {
    console.error(
      JSON.stringify({
        event: 'operations_failed',
        reason:
          e.message.includes('requires') || e.message.includes('must')
            ? e.message
            : 'Backup/restore failed. Check operations configuration and isolated target.',
      }),
    );
    process.exitCode = 1;
  });
}
