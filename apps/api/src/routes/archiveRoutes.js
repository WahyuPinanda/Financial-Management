const router = require('express').Router();
const { z } = require('zod');
const { once } = require('node:events');
const { writeContext } = require('../libs/writeContext');
const { AppError, throwDatabaseError } = require('../libs/errors');
const { runExport, hash } = require('../services/exportService');
const { validateEvidence } = require('../services/evidenceService');
const { financeCsvHeader } = require('@sawit/shared');
const uuid = z.string().uuid();
const source = z.object({
  source_kind: z.enum(['spk', 'harvest_expense', 'cash', 'event']),
  source_id: uuid,
});
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      v >= '1900-01-01' &&
      v <= '9999-12-31' &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
async function checked(promise) {
  const { data, error } = await promise;
  if (error) throwDatabaseError(error);
  return data;
}
const receiptFields =
  'id,source_kind,source_id,source_version,filename,mime,bytes,sha256,object_path,uploaded_at,created_at';
async function receipt(req) {
  const row = await checked(
    req.database
      .from('finance_receipts')
      .select(receiptFields)
      .eq('id', uuid.parse(req.params.id))
      .eq('user_id', req.user.id)
      .maybeSingle(),
  );
  if (!row) throw new AppError(404, 'Bukti tidak ditemukan.');
  return row;
}
router.get('/receipts', async (req, res, next) => {
  try {
    const s = source.strict().parse(req.query);
    const data = await checked(
      req.database
        .from('finance_receipts')
        .select(receiptFields)
        .eq('user_id', req.user.id)
        .eq('source_kind', s.source_kind)
        .eq('source_id', s.source_id)
        .not('uploaded_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20),
    );
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
router.post('/receipts', async (req, res, next) => {
  try {
    const fields = source
      .extend({
        filename: z.string().trim().min(1).max(120),
        mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
        bytes: z.number().int().min(1).max(5242880),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    const context = writeContext(req, false);
    const data = await checked(
      req.database.rpc('finance_prepare_receipt', {
        p_fields: { ...fields, request_key: context.requestKey },
      }),
    );
    const upload = await checked(
      req.database.storage.from('cash-flow-receipts').createSignedUploadUrl(data.object_path),
    );
    res.status(201).json({ data, upload: { signedUrl: upload.signedUrl, token: upload.token } });
  } catch (e) {
    next(e);
  }
});
router.post('/receipts/:id/confirm', async (req, res, next) => {
  try {
    const row = await receipt(req);
    const file = await checked(
      req.database.storage.from('cash-flow-receipts').download(row.object_path),
    );
    const checksum = validateEvidence(Buffer.from(await file.arrayBuffer()), row);
    const data = await checked(
      req.database.rpc('finance_confirm_receipt', {
        p_id: row.id,
        p_sha256: checksum,
        p_bytes: row.bytes,
      }),
    );
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
router.get('/receipts/:id/open', async (req, res, next) => {
  try {
    const row = await receipt(req);
    if (!row.uploaded_at) throw new AppError(409, 'Bukti belum terverifikasi.');
    const data = await checked(
      req.database.storage
        .from('cash-flow-receipts')
        .createSignedUrl(row.object_path, 300, { download: row.filename }),
    );
    res.json({ data: { url: data.signedUrl } });
  } catch (e) {
    next(e);
  }
});
const jobFields =
  'id,from_date,to_date,status,snapshot_time,expires_at,row_count,part_count,bytes,last_error,manifest';
const wake = (req, id) =>
  setImmediate(() => {
    void runExport(id, req.get('Authorization'), req.user.id);
  });
router.get('/exports', async (req, res, next) => {
  try {
    const data = await checked(
      req.database
        .from('finance_export_jobs')
        .select(jobFields)
        .eq('user_id', req.user.id)
        .order('snapshot_time', { ascending: false })
        .limit(20),
    );
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
router.post('/exports', async (req, res, next) => {
  try {
    const fields = z
      .object({ from: date, to: date })
      .strict()
      .refine((v) => v.from <= v.to)
      .parse(req.body);
    const context = writeContext(req, false);
    const row = await checked(
      req.database.rpc('finance_create_export', {
        p_from: fields.from,
        p_to: fields.to,
        p_request_key: context.requestKey,
      }),
    );
    wake(req, row.id);
    res.status(202).json({ data: row });
  } catch (e) {
    next(e);
  }
});
router.get('/exports/:id', async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const data = await checked(
      req.database
        .from('finance_export_jobs')
        .select(jobFields)
        .eq('id', id)
        .eq('user_id', req.user.id)
        .maybeSingle(),
    );
    if (!data) throw new AppError(404, 'Ekspor tidak ditemukan.');
    if (['queued', 'processing'].includes(data.status)) wake(req, id);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
router.post('/exports/:id/resume', async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const row = await checked(
      req.database
        .from('finance_export_jobs')
        .select('id,expires_at')
        .eq('id', id)
        .eq('user_id', req.user.id)
        .maybeSingle(),
    );
    if (!row) throw new AppError(404, 'Ekspor tidak ditemukan.');
    if (Date.parse(row.expires_at) <= Date.now())
      throw new AppError(410, 'Ekspor kedaluwarsa. Buat ekspor baru.');
    wake(req, id);
    res.status(202).json({ data: { id } });
  } catch (e) {
    next(e);
  }
});
router.get('/exports/:id/download', async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const job = await checked(
      req.database
        .from('finance_export_jobs')
        .select(jobFields)
        .eq('id', id)
        .eq('user_id', req.user.id)
        .maybeSingle(),
    );
    if (!job) throw new AppError(404, 'Ekspor tidak ditemukan.');
    if (job.status !== 'completed') throw new AppError(409, 'Ekspor belum selesai.');
    if (Date.parse(job.expires_at) <= Date.now()) throw new AppError(410, 'Ekspor kedaluwarsa.');
    // Each request client has a deadline. Long downloads need a fresh client per bounded part.
    const { createUserClient } = require('../config/supabase');
    res.type('text/csv; charset=utf-8');
    res.set(
      'Content-Disposition',
      `attachment; filename="cash-flow-${job.from_date}-${job.to_date}.csv"`,
    );
    const write = async (buffer) => {
      if (res.destroyed) throw new Error('Client disconnected');
      if (!res.write(buffer)) await once(res, 'drain', { signal: AbortSignal.timeout(20000) });
    };
    await write(Buffer.from(financeCsvHeader()));
    let part = 0;
    while (part < job.part_count) {
      const client = createUserClient(req.get('Authorization'));
      const rows = await checked(
        client
          .from('finance_export_parts')
          .select('part,path,sha256,bytes')
          .eq('job_id', id)
          .eq('user_id', req.user.id)
          .gte('part', part)
          .order('part')
          .limit(20),
      );
      if (!rows.length) throw new Error('Missing export part');
      // At most four bounded parts (8 MB) are held while streaming in sequence.
      for (let offset = 0; offset < rows.length; offset += 4) {
        const group = rows.slice(offset, offset + 4);
        const buffers = await Promise.all(
          group.map(async (row) => {
            const store = createUserClient(req.get('Authorization')).storage.from(
              'cash-flow-exports',
            );
            const blob = await checked(store.download(row.path));
            const buffer = Buffer.from(await blob.arrayBuffer());
            if (buffer.length !== row.bytes || hash(buffer) !== row.sha256)
              throw new Error('Export checksum mismatch');
            return buffer;
          }),
        );
        for (let i = 0; i < group.length; i++) {
          if (group[i].part !== part) throw new Error('Export part gap');
          await write(buffers[i]);
          part++;
        }
      }
    }
    res.end();
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      console.error(JSON.stringify({ event: 'export_download_failed' }));
    } else next(e);
  }
});
module.exports = router;
