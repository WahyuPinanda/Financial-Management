const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname, resolve, basename } = require('node:path');
const { Readable, Writable } = require('node:stream');
const {
  keyFrom,
  encryptStream,
  decryptStream,
  readEncryptedJson,
} = require('../scripts/ops/crypto');
const { connection, restoreTest } = require('../scripts/ops/backup');
const { validateEvidence } = require('../apps/api/src/services/evidenceService');
const { hash, runExport } = require('../apps/api/src/services/exportService');
const { financeCsvRows } = require('@sawit/shared');
test('encrypted backup restores exact data and refuses tampering or incorrect keys', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cash-backup-test-')),
    path = join(folder, 'data.enc'),
    key = keyFrom('ab'.repeat(32)),
    plain = Buffer.from('private financial data');
  try {
    await encryptStream(Readable.from([plain]), path, key);
    const chunks = [];
    await decryptStream(
      path,
      key,
      new Writable({
        write(c, e, d) {
          chunks.push(c);
          d();
        },
      }),
    );
    assert.deepEqual(Buffer.concat(chunks), plain);
    await encryptStream(Readable.from([]), join(folder, 'empty.enc'), key);
    await decryptStream(
      join(folder, 'empty.enc'),
      key,
      new Writable({
        write(c, e, d) {
          assert.fail('Empty archive emitted bytes');
          d();
        },
      }),
    );
    await encryptStream(
      Readable.from([Buffer.from('{"valid":true}')]),
      join(folder, 'manifest.enc'),
      key,
    );
    assert.deepEqual(await readEncryptedJson(join(folder, 'manifest.enc'), key), { valid: true });
    const bytes = await readFile(path);
    assert.equal(bytes.includes(plain), false);
    await assert.rejects(
      decryptStream(
        path,
        keyFrom('cd'.repeat(32)),
        new Writable({
          write(c, e, d) {
            d();
          },
        }),
      ),
    );
    bytes[21] ^= 1;
    await writeFile(path, bytes);
    await assert.rejects(
      decryptStream(
        path,
        key,
        new Writable({
          write(c, e, d) {
            d();
          },
        }),
      ),
    );
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith('cash-backup-test-'));
    await rm(folder, { recursive: true, force: true });
  }
});

test('export worker limits concurrent jobs and releases capacity after completion', async () => {
  const { runExport } = require('../apps/api/src/services/exportService');
  let calls = 0;
  const releases = [];
  const factory = () => ({
    rpc: async () => {
      calls++;
      return new Promise((resolve) => releases.push(() => resolve({ data: null, error: null })));
    },
  });
  const first = runExport('job-one', 'Bearer fixture', 'owner-one', factory);
  const second = runExport('job-two', 'Bearer fixture', 'owner-two', factory);
  await runExport('job-three', 'Bearer fixture', 'owner-three', factory);
  await runExport('job-one', 'Bearer fixture', 'owner-one', factory);
  assert.equal(calls, 2);
  releases.splice(0).forEach((release) => release());
  await Promise.all([first, second]);
  const next = runExport('job-three', 'Bearer fixture', 'owner-three', factory);
  assert.equal(calls, 3);
  releases.splice(0).forEach((release) => release());
  await next;
});
test('uptime monitor rejects stale or invalid backup metadata, and checks restore age', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cash-monitor-test-')),
    original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok' }) });
  const { probe } = require('../scripts/ops/monitor');
  const config = {
    MONITOR_API_URL: 'http://localhost/fixture',
    HEALTHCHECK_TOKEN: 'fixture',
    BACKUP_ROOT: folder,
  };
  try {
    await writeFile(join(folder, 'last-success.json'), JSON.stringify({ completedAt: 'invalid' }));
    await assert.rejects(probe(config), /36 hours/);
    await writeFile(
      join(folder, 'last-success.json'),
      JSON.stringify({ completedAt: new Date(Date.now() - 40 * 3600000).toISOString() }),
    );
    await assert.rejects(probe(config), /36 hours/);
    await writeFile(
      join(folder, 'last-success.json'),
      JSON.stringify({ completedAt: new Date().toISOString() }),
    );
    assert.deepEqual(await probe(config), { status: 'ok' });
    config.RESTORE_TEST_DATABASE_URL = 'configured-test';
    await writeFile(
      join(folder, 'last-restore-success.json'),
      JSON.stringify({ testedAt: new Date(Date.now() - 31 * 86400000).toISOString() }),
    );
    await assert.rejects(probe(config), /30 days/);
    await writeFile(
      join(folder, 'last-restore-success.json'),
      JSON.stringify({ testedAt: new Date().toISOString() }),
    );
    assert.deepEqual(await probe(config), { status: 'ok' });
  } finally {
    global.fetch = original;
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith('cash-monitor-test-'));
    await rm(folder, { recursive: true, force: true });
  }
});
test('remote backups require TLS verification and evidence is content verified', async () => {
  assert.throws(() => connection('postgres://u:p@remote.example/db'), /verify-full/);
  assert.doesNotThrow(() => connection('postgres://u:p@localhost/db'));
  await assert.rejects(
    restoreTest('unused', {
      BACKUP_DATABASE_URL: 'postgres://u:p@localhost/finance_restore_test',
      RESTORE_TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/finance_restore_test',
    }),
    /separate database/,
  );
  await assert.rejects(
    restoreTest('unused', {
      BACKUP_DATABASE_URL: 'postgres://u:p@localhost/original',
      RESTORE_TEST_DATABASE_URL:
        'postgres://u:p@localhost/' +
        encodeURIComponent('host=production dbname=finance_restore_test'),
    }),
    /separate database/,
  );
  const buffer = Buffer.from('%PDF-test');
  assert.equal(
    validateEvidence(buffer, {
      mime: 'application/pdf',
      bytes: buffer.length,
      sha256: hash(buffer),
    }),
    hash(buffer),
  );
  assert.throws(
    () =>
      validateEvidence(buffer, { mime: 'image/png', bytes: buffer.length, sha256: hash(buffer) }),
    /tidak sesuai/,
  );
  assert.throws(
    () => validateEvidence(buffer, { mime: 'application/pdf', bytes: 1, sha256: hash(buffer) }),
    /tidak sesuai/,
  );
});
test('batched export replays lost upload response safely and rejects mismatched existing parts', async () => {
  const rows = [
      {
        seq: '1',
        event_date: '2026-10-01',
        amount: '12.50',
        cashDelta: '-12.50',
        description: '=FORMULA',
      },
    ],
    buffer = Buffer.from(financeCsvRows(rows));
  assert.ok(buffer.toString().includes("'=FORMULA"));
  assert.ok(buffer.toString().includes('"-12,50"'));
  for (const mismatch of [false, true]) {
    let advanced = false,
      finished = false,
      paused = false,
      calls = 0;
    const factory = () => ({
      rpc: async (name, args) => {
        if (name === 'finance_claim_export') return { data: { cursor_seq: '0' } };
        if (name === 'finance_export_batch') return { data: calls++ ? [] : rows };
        if (name === 'finance_advance_export') {
          advanced = true;
          assert.equal(args.p_hash, hash(buffer));
          return { data: { cursor_seq: '1' } };
        }
        if (name === 'finance_finish_export') {
          finished = args.p_complete;
          paused = Boolean(args.p_error);
          return { data: null };
        }
        throw new Error(name);
      },
      storage: {
        from: () => ({
          upload: async () => ({ error: { message: 'Response lost' } }),
          download: async () => ({ data: new Blob([mismatch ? 'different' : buffer]) }),
        }),
      },
    });
    await runExport('job', 'Bearer fixture', 'user', factory);
    assert.equal(advanced, !mismatch);
    assert.equal(finished, !mismatch);
    assert.equal(paused, mismatch);
  }
});
