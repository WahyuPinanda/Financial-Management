const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const ownerA = '00000000-0000-0000-0000-000000000001';
const ownerB = '00000000-0000-0000-0000-000000000002';

test('PostgreSQL migration: calculation, ownership RLS, publication integrity, and 7-day lock', async (t) => {
  const db = new PGlite();
  try {
    // Supabase-provided roles/Auth are stubbed; application SQL runs unmodified.
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${ownerA}'), ('${ownerB}');
    `);
    await db.exec(
      readFileSync(
        resolve(__dirname, '../supabase/migrations/202610050001_initial_harvest.sql'),
        'utf8',
      ),
    );
    const [
      {
        rows: [harvest],
      },
    ] = await db.exec(`insert into public.harvests(user_id,name,harvest_date)
      values ('${ownerA}', 'Panen A', '2026-10-05') returning id;`);
    const insertSpk = async (owner = ownerA, publish = true) =>
      (
        await db.query(
          `insert into public.spks
      (harvest_id,user_id,company_name,delivery_date,bunch_count,first_weight,second_weight,deduction_kg,price_per_kg,published_at)
      values ($1,$2,'PT Sawit','2026-10-05',500,10000,4000,120,3000,$3) returning *`,
          [harvest.id, owner, publish ? '2000-01-01T00:00:00Z' : null],
        )
      ).rows[0];
    const spk = await insertSpk();
    await t.test('generated NUMERIC values and server-controlled publication time', async () => {
      assert.equal(Number(spk.gross_weight), 6000);
      assert.equal(Number(spk.net_weight), 5880);
      assert.equal(Number(spk.deduction_percent), 2);
      assert.equal(Number(spk.total_income), 17640000);
      assert.ok(Math.abs(Date.now() - Date.parse(spk.published_at)) < 10000);
      await assert.rejects(
        db.query('update public.spks set published_at = null where id=$1', [spk.id]),
        /Waktu publikasi/,
      );
      await assert.rejects(
        db.query("update public.spks set created_at='2000-01-01' where id=$1", [spk.id]),
        /Identitas/,
      );
    });
    await t.test('owner may edit own recent SPK and generated revenue recalculates', async () => {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ownerA}';`);
      const result = await db.query(
        'update public.spks set deduction_kg=180 where id=$1 returning total_income',
        [spk.id],
      );
      assert.equal(Number(result.rows[0].total_income), 17460000);
    });
    await t.test(
      'another account cannot read, change, or insert into owner A harvest',
      async () => {
        await db.exec(`set request.jwt.claim.sub = '${ownerB}';`);
        assert.equal((await db.query('select * from public.harvests')).rows.length, 0);
        assert.equal((await db.query('select * from public.spks')).rows.length, 0);
        assert.equal(
          (
            await db.query('update public.spks set deduction_kg=0 where id=$1 returning id', [
              spk.id,
            ])
          ).rows.length,
          0,
        );
        await assert.rejects(insertSpk(ownerB), /foreign key/);
        await assert.rejects(insertSpk(ownerA), /row-level security/);
      },
    );
    await t.test(
      'expired SPK cannot be changed, unpublished, or deleted even through direct SQL',
      async () => {
        await db.exec(`reset role;
        alter table public.spks disable trigger guard_spk_write;
        update public.spks set published_at=clock_timestamp()-interval '7 days' where id='${spk.id}';
        alter table public.spks enable trigger guard_spk_write;
        set role authenticated; set request.jwt.claim.sub='${ownerA}';`);
        await assert.rejects(
          db.query('update public.spks set deduction_kg=0 where id=$1', [spk.id]),
          /SPK terkunci/,
        );
        await assert.rejects(
          db.query('update public.spks set published_at=null where id=$1', [spk.id]),
          /SPK terkunci/,
        );
        await assert.rejects(
          db.query('delete from public.spks where id=$1', [spk.id]),
          /permission denied/,
        );
        await assert.rejects(
          db.query("update public.harvests set name='Lain' where id=$1", [harvest.id]),
          /permission denied/,
        );
      },
    );
    await t.test(
      'drafts may be edited and publish starts a new server-timed 7-day window',
      async () => {
        await db.exec('reset role;');
        const draft = await insertSpk(ownerA, false);
        await db.exec(`set role authenticated; set request.jwt.claim.sub='${ownerA}';`);
        await db.query('update public.spks set price_per_kg=3100 where id=$1', [draft.id]);
        const result = await db.query(
          "update public.spks set published_at='2000-01-01' where id=$1 returning published_at",
          [draft.id],
        );
        assert.ok(Math.abs(Date.now() - Date.parse(result.rows[0].published_at)) < 10000);
      },
    );
  } finally {
    await db.close();
  }
});
