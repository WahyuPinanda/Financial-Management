import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LatestRequest, decimalCents, type HarvestProfit } from '@sawit/shared';
import { Calculator } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { date, errorMessage, number, rupiah } from '../../lib/format';
import { notifyWorkspaceUpdate } from '../../lib/workspaceUpdates';
import { productivityApi, type GardenCostOption } from './api';
export function HarvestProfitPanel({
  rows,
  preview,
  onRefresh,
}: {
  rows: HarvestProfit[];
  preview: boolean;
  onRefresh: () => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<HarvestProfit | null>(null),
    [notice, setNotice] = useState('');
  return (
    <section className="panel finance-panel profit-panel">
      <div className="panel-heading">
        <div>
          <h2>Keuntungan per panen</h2>
          <p>
            Pendapatan SPK − biaya panen − alokasi biaya kebun. Seluruh catatan publikasi dalam
            kelompok panen.
          </p>
        </div>
        <Calculator size={24} />
      </div>
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Panen</th>
                <th>Pendapatan</th>
                <th>Biaya panen</th>
                <th>Biaya kebun dialokasikan</th>
                <th>Keuntungan</th>
                <th>Biaya / kg bersih</th>
                <th>Margin</th>
                <th>Alokasi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    <small>{date(r.harvest_date)}</small>
                  </td>
                  <td>{rupiah(r.income)}</td>
                  <td>{rupiah(r.harvestCost)}</td>
                  <td>{rupiah(r.gardenCost)}</td>
                  <td className={decimalCents(r.profit) < 0n ? 'growth-down' : ''}>
                    {rupiah(r.profit)}
                  </td>
                  <td>
                    {r.costPerKg === null ? '—' : rupiah(r.costPerKg)}
                    <small>{number(Number(r.netWeight))} kg bersih</small>
                  </td>
                  <td>{r.marginPercent === null ? '—' : `${number(r.marginPercent)}%`}</td>
                  <td>
                    <button className="button secondary compact" onClick={() => setSelected(r)}>
                      Atur biaya kebun
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">Belum ada panen untuk dianalisis dalam filter ini.</div>
      )}
      <p className="analysis-note">
        Biaya kebun yang belum dialokasikan belum masuk keuntungan panen. Biaya lainnya, transfer,
        dan koreksi saldo tidak termasuk perhitungan ini. Alokasi hanya membagi biaya yang sudah
        tercatat, tanpa mengurangi cash lagi.
      </p>
      {selected && (
        <AllocationForm
          harvest={selected}
          preview={preview}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            notifyWorkspaceUpdate();
            const fresh = await onRefresh();
            setNotice(
              fresh
                ? 'Alokasi dan analisis panen sudah diperbarui.'
                : 'Alokasi tersimpan. Muat ulang untuk melihat analisis terbaru.',
            );
          }}
        />
      )}
    </section>
  );
}
function AllocationForm({
  harvest,
  preview,
  onClose,
  onSaved,
}: {
  harvest: HarvestProfit;
  preview: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [search, setSearch] = useState(''),
    [appliedSearch, setAppliedSearch] = useState(''),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [data, setData] = useState<{ rows: GardenCostOption[]; hasNext: boolean } | null>(null),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState('');
  const latest = useRef(new LatestRequest()),
    working = useRef(false),
    key = useRef(crypto.randomUUID()).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search);
      setCursors([undefined]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (preview) return;
    const op = latest.current.begin();
    setReading(true);
    setData(null);
    setSelected('');
    setError('');
    const params = new URLSearchParams({ harvest_id: harvest.id, search: appliedSearch });
    const cursor = cursors.at(-1);
    if (cursor) params.set('before', cursor);
    void productivityApi
      .gardenCosts(params, op.signal)
      .then((r) => {
        if (op.isCurrent()) setData(r.data);
      })
      .catch((e) => {
        if (op.isCurrent()) setError(errorMessage(e));
      })
      .finally(() => {
        if (op.isCurrent()) setReading(false);
      });
    return () => latest.current.cancel();
  }, [harvest.id, appliedSearch, cursors, preview]);
  const cost = data?.rows.find((c) => c.id === selected);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (working.current || !cost || !cost.editable) return;
    setError('');
    const value = Number(amount);
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1e12 ||
      Math.abs(value * 100 - Math.round(value * 100)) >= 0.0001 ||
      decimalCents(value) > decimalCents(cost.available)
    ) {
      setError('Nominal harus valid dan tidak melebihi biaya yang tersedia.');
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      await productivityApi.command(
        'allocate_cost',
        { harvest_id: harvest.id, cash_expense_id: cost.id, amount: value, reason },
        key,
        cost.allocationId ?? undefined,
        cost.version ?? undefined,
      );
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title={`Alokasi biaya · ${harvest.name}`} onClose={onClose} busy={busy}>
      <form className="modal-form" onSubmit={submit}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {preview ? (
          <div className="notice">
            Login untuk membagi biaya kebun yang dipublikasikan ke panen. Cash tidak dipotong
            kembali.
          </div>
        ) : (
          <>
            <label>
              Cari biaya kebun
              <input
                placeholder="Semprot, pupuk, bensin…"
                value={search}
                maxLength={120}
                onChange={(e) => setSearch(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Biaya kebun
              <select
                required
                value={selected}
                disabled={busy || reading}
                onChange={(e) => {
                  setSelected(e.target.value);
                  const c = data?.rows.find((c) => c.id === e.target.value);
                  setAmount(String(c?.allocated ?? ''));
                }}
              >
                <option value="">{reading ? 'Memuat biaya…' : 'Pilih biaya kebun'}</option>
                {data?.rows.map((c) => (
                  <option value={c.id} key={c.id}>
                    {date(c.date)} · {c.items.map((i) => i.description).join(', ')} ·{' '}
                    {rupiah(c.amount)}
                    {!c.editable ? ' · Terkunci' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="finance-actions">
              <button
                type="button"
                className="button secondary compact"
                disabled={busy || reading || cursors.length === 1}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                Sebelumnya
              </button>
              <span>Halaman {cursors.length}</span>
              <button
                type="button"
                className="button secondary compact"
                disabled={busy || reading || !data?.hasNext}
                onClick={() => setCursors((c) => [...c, data?.rows.at(-1)?.id])}
              >
                Berikutnya
              </button>
            </div>
            {!reading && !data?.rows.length && (
              <p>Belum ada biaya yang cocok. Publikasikan biaya kebun terlebih dahulu.</p>
            )}
            {cost && (
              <div className="calculation">
                <span>Biaya tersedia untuk panen ini (termasuk alokasi saat ini)</span>
                <strong>{rupiah(cost.available)}</strong>
                {!cost.editable && (
                  <small>Alokasi terkunci setelah tujuh hari sejak publikasi biaya.</small>
                )}
              </div>
            )}
            <label>
              Jumlah alokasi (Rp)
              <input
                type="number"
                step="0.01"
                min="0"
                max="1000000000000"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy || !cost?.editable}
              />
              <small>Isi 0 untuk mengosongkan alokasi saat ini.</small>
            </label>
            <label>
              Catatan alokasi / perubahan
              <textarea
                required
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            className="button primary"
            disabled={preview || busy || reading || !cost?.editable}
          >
            {busy ? 'Menyimpan…' : 'Simpan alokasi'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
