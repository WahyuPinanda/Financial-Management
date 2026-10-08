const { randomUUID, createHash } = require('node:crypto');
const { financeCsvRows } = require('@sawit/shared');
const { createUserClient } = require('../config/supabase');
const active = new Set();
const MAX_ACTIVE_EXPORTS = 2;
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
async function runExport(id, authorization, userId, clientFactory = createUserClient) {
  const slot = `${userId}:${id}`;
  if (active.has(slot) || active.size >= MAX_ACTIVE_EXPORTS) return;
  active.add(slot);
  const lease = randomUUID();
  let claimed = false;
  try {
    let job = await rpc(clientFactory(authorization), 'finance_claim_export', {
      p_id: id,
      p_lease: lease,
    });
    if (!job) return;
    claimed = true;
    // Yield after a bounded batch; status polling resumes unfinished work after restart.
    for (let step = 0; step < 10; step++) {
      const client = clientFactory(authorization),
        rows = await rpc(client, 'finance_export_batch', { p_id: id, p_lease: lease });
      if (!rows.length) {
        await rpc(client, 'finance_finish_export', { p_id: id, p_lease: lease, p_complete: true });
        return;
      }
      const buffer = Buffer.from(financeCsvRows(rows), 'utf8'),
        checksum = hash(buffer),
        path = `${userId}/${id}/${job.cursor_seq}.csv`;
      const store = client.storage.from('cash-flow-exports');
      const uploaded = await store.upload(path, buffer, { contentType: 'text/csv', upsert: false });
      if (uploaded.error) {
        // A response can be lost after upload. Verify the same immutable part before replaying.
        const existing = await store.download(path);
        if (existing.error || hash(Buffer.from(await existing.data.arrayBuffer())) !== checksum)
          throw uploaded.error;
      }
      job = await rpc(client, 'finance_advance_export', {
        p_id: id,
        p_lease: lease,
        p_after: String(job.cursor_seq),
        p_end: rows.at(-1).seq,
        p_rows: rows.length,
        p_bytes: buffer.length,
        p_hash: checksum,
        p_path: path,
      });
    }
    await rpc(clientFactory(authorization), 'finance_finish_export', {
      p_id: id,
      p_lease: lease,
      p_complete: false,
    });
  } catch {
    if (claimed)
      await rpc(clientFactory(authorization), 'finance_finish_export', {
        p_id: id,
        p_lease: lease,
        p_complete: false,
        p_error: 'Ekspor dijeda. Periksa koneksi dan konfigurasi Storage, lalu lanjutkan.',
      }).catch(() => {});
    console.error(JSON.stringify({ event: 'export_paused' }));
  } finally {
    active.delete(slot);
  }
}
module.exports = { runExport, rpc, hash };
