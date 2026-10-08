import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LatestRequest, type FinanceEvent } from '@sawit/shared';
import { Modal } from '../../components/Modal';
import { request, mutationHeaders } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { errorMessage, dateTime } from '../../lib/format';
type Receipt = { id: string; filename: string; uploaded_at: string; source_version: number | null };
export function EvidenceModal({
  event,
  preview,
  onClose,
}: {
  event: FinanceEvent;
  preview: boolean;
  onClose: () => void;
}) {
  const source =
    event.kind === 'source' || event.kind === 'reversal'
      ? { source_kind: event.source_kind ?? 'event', source_id: event.source_id ?? event.id }
      : { source_kind: 'event', source_id: event.id };
  const [files, setFiles] = useState<Receipt[]>([]),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const running = useRef(false),
    uploadKey = useRef(crypto.randomUUID());
  const latest = useRef(new LatestRequest());
  async function load(signal?: AbortSignal) {
    if (preview) return;
    const op = latest.current.begin();
    try {
      const result = await request<{ data: Receipt[] }>(
        `/receipts?${new URLSearchParams(source)}`,
        {
          signal: signal ? AbortSignal.any([signal, op.signal]) : op.signal,
        },
      );
      if (op.isCurrent()) setFiles(result.data);
    } catch (error) {
      if (op.isCurrent()) throw error;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(errorMessage(e));
    });
    return () => {
      controller.abort();
      latest.current.cancel();
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (running.current) return;
    if (preview) {
      setError('Login untuk melampirkan bukti transaksi.');
      return;
    }
    if (!file || !supabase) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (file.size > 5242880 || file.size === 0)
        throw new Error('Bukti harus berukuran 1 byte hingga 5 MB.');
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const prepared = await request<{
        data: { id: string; object_path: string };
        upload: { token: string; signedUrl: string };
      }>('/receipts', {
        method: 'POST',
        headers: mutationHeaders(uploadKey.current),
        body: JSON.stringify({
          ...source,
          filename: file.name,
          mime: file.type,
          bytes: file.size,
          sha256: hash,
        }),
      });
      const body = new FormData();
      body.append('cacheControl', '0');
      body.append('', file);
      let uploadError: unknown;
      try {
        const uploaded = await fetch(prepared.upload.signedUrl, {
          method: 'PUT',
          headers: { 'x-upsert': 'false' },
          body,
          signal: AbortSignal.timeout(60000),
        });
        if (!uploaded.ok)
          uploadError = new Error('Unggahan belum berhasil. Coba kembali dengan file yang sama.');
      } catch {
        uploadError = new Error(
          'Status unggahan belum dapat dipastikan. Coba kembali dengan file yang sama.',
        );
      }
      // Confirmation also recovers an original upload whose response was lost.
      try {
        await request(`/receipts/${prepared.data.id}/confirm`, { method: 'POST', body: '{}' });
      } catch (error) {
        throw uploadError ?? error;
      }
      await load();
      setFile(null);
      uploadKey.current = crypto.randomUUID();
      setNotice('Bukti terverifikasi dan tersimpan secara privat.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function open(id: string) {
    setError('');
    try {
      const result = await request<{ data: { url: string } }>(`/receipts/${id}/open`);
      const a = document.createElement('a');
      a.href = result.data.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal title="Bukti transaksi" onClose={onClose} busy={busy}>
      <form className="modal-form" onSubmit={submit}>
        <p>{event.description}</p>
        <p className="form-note">
          PDF/JPG/PNG, maksimal 5 MB dan 20 bukti per catatan. Bukti tersimpan bersama versi catatan
          ketika dilampirkan.
        </p>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="alert success">
            {notice}
          </div>
        )}
        <label>
          Pilih bukti
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            required
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              uploadKey.current = crypto.randomUUID();
            }}
          />
        </label>
        <ul className="evidence-list">
          {files.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="button secondary compact"
                onClick={() => void open(r.id)}
                disabled={busy}
              >
                {r.filename}
              </button>
              <small>
                {dateTime(r.uploaded_at)} · Versi {r.source_version ?? 'jurnal'}
              </small>
            </li>
          ))}
        </ul>
        {!files.length && <p className="form-note">Belum ada bukti terlampir.</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Tutup
          </button>
          <button className="button primary" disabled={busy || !file}>
            {busy ? 'Memverifikasi…' : 'Lampirkan bukti'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
