import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, FileClock, RefreshCw } from 'lucide-react';
import {
  financeCsvHeader,
  financeCsvRows,
  LatestRequest,
  type FinanceSnapshot,
} from '@sawit/shared';
import { request, mutationHeaders } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { errorMessage, today, dateTime, rupiah } from '../../lib/format';
type Job = {
  id: string;
  status: string;
  from_date: string;
  to_date: string;
  row_count: number;
  bytes: number;
  snapshot_time: string;
  expires_at: string;
  last_error: string | null;
  manifest: { openingCash: string; closingCash: string };
};
const statusNames: Record<string, string> = {
  queued: 'Dalam antrean',
  processing: 'Diproses',
  paused: 'Dijeda',
  completed: 'Siap diunduh',
  failed: 'Gagal',
};
export function ExportsPage({ finance, preview }: { finance?: FinanceSnapshot; preview: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [from, setFrom] = useState('1900-01-01'),
    [to, setTo] = useState(today()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const running = useRef(false),
    key = useRef(crypto.randomUUID());
  const latest = useRef(new LatestRequest());
  useEffect(() => {
    if (preview) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (running.current) {
        if (!abort.signal.aborted) timer = setTimeout(poll, 5000);
        return;
      }
      const op = latest.current.begin();
      try {
        const listed = await request<{ data: Job[] }>('/exports', {
          signal: AbortSignal.any([abort.signal, op.signal]),
        });
        if (abort.signal.aborted || !op.isCurrent()) return;
        setJobs(listed.data);
        for (const j of listed.data.filter(
          (j) =>
            ['queued', 'processing'].includes(j.status) && Date.parse(j.expires_at) > Date.now(),
        ))
          await request(`/exports/${j.id}`, { signal: abort.signal });
      } catch (e) {
        if (!abort.signal.aborted && op.isCurrent()) setError(errorMessage(e));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      abort.abort();
      latest.current.cancel();
      clearTimeout(timer);
    };
  }, [preview]);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (running.current) return;
    setError('');
    if (preview) {
      setNotice('Pratinjau ekspor memakai jurnal contoh. Login untuk mengekspor seluruh arsip.');
      return;
    }
    running.current = true;
    latest.current.cancel();
    setBusy(true);
    try {
      await request('/exports', {
        method: 'POST',
        headers: mutationHeaders(key.current),
        body: JSON.stringify({ from, to }),
      });
      key.current = crypto.randomUUID();
      const listed = await request<{ data: Job[] }>('/exports');
      setJobs(listed.data);
      setNotice('Ekspor masuk antrean. Anda dapat melanjutkannya setelah server dimulai ulang.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function download(j: Job) {
    if (running.current) return;
    running.current = true;
    latest.current.cancel();
    setBusy(true);
    setError('');
    try {
      if (!supabase) throw new Error('Koneksi belum disiapkan.');
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Login kembali untuk mengunduh.');
      const response = await fetch(
        `${import.meta.env.VITE_API_URL ?? ''}/api/exports/${j.id}/download`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: AbortSignal.timeout(300000),
        },
      );
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.message ?? 'Ekspor tidak dapat diunduh.',
        );
      const blob = await response.blob();
      if (blob.size !== Number(j.bytes) + new Blob([financeCsvHeader()]).size)
        throw new Error('Unduhan tidak lengkap. Coba kembali.');
      saveBlob(blob, `cash-flow-${j.from_date}-${j.to_date}.csv`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function resume(id: string) {
    if (running.current) return;
    running.current = true;
    latest.current.cancel();
    setBusy(true);
    setError('');
    try {
      await request(`/exports/${id}/resume`, { method: 'POST', body: '{}' });
      setJobs((v) =>
        v.map((j) => (j.id === id ? { ...j, status: 'queued', last_error: null } : j)),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel finance-panel">
      <div className="panel-heading">
        <div>
          <h2>Arsip seluruh periode</h2>
          <p>Jurnal diambil dari satu batas versi; perubahan berikutnya masuk ekspor baru.</p>
        </div>
        <FileClock size={24} />
      </div>
      <div className="finance-body">
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}
        <form className="export-form" onSubmit={create}>
          <label>
            Dari tanggal
            <input
              type="date"
              required
              min="1900-01-01"
              max={to}
              value={from}
              disabled={busy}
              onChange={(e) => {
                setFrom(e.target.value);
                key.current = crypto.randomUUID();
              }}
            />
          </label>
          <label>
            Sampai tanggal
            <input
              type="date"
              required
              min={from}
              max={today()}
              value={to}
              disabled={busy}
              onChange={(e) => {
                setTo(e.target.value);
                key.current = crypto.randomUUID();
              }}
            />
          </label>
          <button className="button primary" disabled={busy || !finance?.enabled}>
            <Download size={16} />
            Buat ekspor
          </button>
        </form>
        <p className="form-note">
          Bukti transaksi tersedia pada menu Rekening & transfer → Jurnal rekening → Bukti. CSV
          mencantumkan ID bukti. Ekspor diproses 200 entri per bagian, maksimal 500.000 entri / 100
          MB dan tersedia 7 hari. Pilih rentang lebih pendek untuk arsip besar.
        </p>
        {preview && (
          <button
            className="button secondary compact"
            onClick={() =>
              saveBlob(
                new Blob(
                  [
                    financeCsvHeader(),
                    financeCsvRows(
                      finance?.journal.filter((r) => r.event_date >= from && r.event_date <= to) ??
                        [],
                    ),
                  ],
                  { type: 'text/csv;charset=utf-8' },
                ),
                'cash-flow-contoh.csv',
              )
            }
          >
            Unduh contoh CSV
          </button>
        )}
        <div className="export-jobs">
          {jobs.map((j) => (
            <article className="cash-expense-card" key={j.id}>
              <header>
                <strong>
                  {j.from_date} — {j.to_date}
                </strong>
                <span className="badge published">{statusNames[j.status]}</span>
              </header>
              <p>
                {j.row_count} entri · {dateTime(j.snapshot_time)} WITA
              </p>
              <p>
                Cash awal {rupiah(j.manifest.openingCash)} · Cash akhir{' '}
                {rupiah(j.manifest.closingCash)}
              </p>
              {j.last_error && <p role="status">{j.last_error}</p>}
              <small>Tersedia hingga {dateTime(j.expires_at)} WITA</small>
              {j.status === 'completed' ? (
                <button
                  className="button secondary compact"
                  disabled={busy || Date.parse(j.expires_at) <= Date.now()}
                  onClick={() => void download(j)}
                >
                  <Download size={16} />
                  Unduh CSV
                </button>
              ) : (
                <button
                  className="button secondary compact"
                  disabled={busy || Date.parse(j.expires_at) <= Date.now()}
                  onClick={() => void resume(j.id)}
                >
                  <RefreshCw size={16} />
                  Lanjutkan
                </button>
              )}
            </article>
          ))}
        </div>
        {!jobs.length && !preview && (
          <p>Belum ada ekspor. Buat laporan untuk seluruh periode atau rentang pilihan.</p>
        )}
      </div>
    </section>
  );
}
