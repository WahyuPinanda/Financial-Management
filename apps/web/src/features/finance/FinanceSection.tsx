import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Plus, Pencil, History, ChartPie, Wallet, Target } from 'lucide-react';
import {
  LatestRequest,
  sumDecimalMoney,
  type FinanceSnapshot,
  type FinanceGoal,
  type FinanceBudget,
  type FinanceEvent,
  type FinanceAudit,
} from '@sawit/shared';
import { date, dateTime, errorMessage, number, rupiah, today } from '../../lib/format';
import { FinanceForm, costNames, type FinanceEditor } from './FinanceForm';
import { EvidenceModal } from './EvidenceModal';
import { financeApi } from './api';
import { notifyWorkspaceUpdate } from '../../lib/workspaceUpdates';
const categoryNames = {
  ...costNames,
  savings: 'Alokasi Tabungan',
  investment: 'Alokasi Investasi',
  other_income: 'Pemasukan lainnya',
  income: 'Pendapatan panen',
  transfer: 'Transfer antar rekening',
  correction: 'Koreksi',
  opening: 'Saldo awal',
};
const kinds = { cash: 'Cash', bank: 'Bank', savings: 'Tabungan', investment: 'Investasi' };
export function FinanceSection({
  finance: f,
  view,
  preview,
  month,
  onRefresh,
  onMonthChange,
  months = [],
}: {
  finance?: FinanceSnapshot;
  view: string;
  preview: boolean;
  month: string;
  onRefresh: () => Promise<boolean>;
  onMonthChange: (month: string) => void;
  months?: string[];
}) {
  const [evidence, setEvidence] = useState<FinanceEvent | null>(null);
  const [editor, setEditor] = useState<FinanceEditor | null>(null),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [journalCursor, setJournalCursor] = useState<(string | undefined)[]>([undefined]),
    [auditCursor, setAuditCursor] = useState<(string | undefined)[]>([undefined]);
  const [history, setHistory] = useState<{ key: string; data: FinanceSnapshot } | null>(null),
    [busy, setBusy] = useState(false);
  const latest = useRef(new LatestRequest());
  const key = JSON.stringify([journalCursor.at(-1), auditCursor.at(-1), f?.revision, month]);
  useEffect(() => {
    if (!f || preview || (!journalCursor.at(-1) && !auditCursor.at(-1))) {
      latest.current.cancel();
      setBusy(false);
      return;
    }
    const op = latest.current.begin();
    setBusy(true);
    setError('');
    const params = new URLSearchParams({ month });
    if (journalCursor.at(-1)) params.set('before', journalCursor.at(-1)!);
    if (auditCursor.at(-1)) params.set('audit_before', auditCursor.at(-1)!);
    void financeApi
      .read(params, op.signal)
      .then((response) => {
        if (op.isCurrent()) setHistory({ key, data: response.data });
      })
      .catch((e) => {
        if (op.isCurrent()) setError(errorMessage(e));
      })
      .finally(() => {
        if (op.isCurrent()) setBusy(false);
      });
    return () => latest.current.cancel();
  }, [key, preview, month]);
  if (!f)
    return (
      <div className="panel empty-state" role="status">
        Memuat rekening dan jurnal…
      </div>
    );
  const pagePending =
    !preview && (journalCursor.length > 1 || auditCursor.length > 1) && history?.key !== key;
  const shown =
    history?.key === key
      ? history.data
      : pagePending
        ? { ...f, journal: [], audit: [], journalHasNext: false, auditHasNext: false }
        : f;
  const open = (kind: FinanceEditor['kind'], existing?: Record<string, unknown>) =>
    setEditor({
      kind,
      existing,
      month: month === 'all' ? today().slice(0, 7) : month,
      snapshot: f,
    });
  function changeMonth(value: string) {
    setJournalCursor([undefined]);
    setAuditCursor([undefined]);
    setHistory(null);
    onMonthChange(value);
  }
  async function save(fields: Record<string, unknown>, requestKey: string) {
    if (!editor) return;
    await financeApi.command(
      editor.kind,
      fields,
      requestKey,
      editor.existing?.id as string | undefined,
      editor.existing?.version as number | undefined,
    );
    setJournalCursor([undefined]);
    setAuditCursor([undefined]);
    notifyWorkspaceUpdate();
    if (editor.kind === 'budget') changeMonth(String(fields.month));
    const fresh = await onRefresh();
    setNotice(
      fresh
        ? 'Tersimpan. Saldo dan laporan sudah diperbarui.'
        : 'Tersimpan. Muat ulang untuk membaca saldo terbaru.',
    );
  }
  const form = editor && (
    <FinanceForm editor={editor} preview={preview} onClose={() => setEditor(null)} onSave={save} />
  );
  if (!f.enabled)
    return (
      <>
        <section className="panel finance-panel">
          <div className="panel-heading">
            <div>
              <h2>Mulai dengan rekening yang jelas.</h2>
              <p>Saldo awal, rekening Cash/Bank/Tabungan, dan transfer internal.</p>
            </div>
            <Wallet size={26} />
          </div>
          <div className="finance-body">
            <p>
              Aktivasi mengimpor publikasi lama dan mengganti alokasi menjadi transfer antar
              rekening. Anda dapat memeriksa proyeksi sebelum menyimpan.
            </p>
            <button className="button primary" onClick={() => open('activate')}>
              Periksa dan aktifkan rekening
            </button>
          </div>
        </section>
        {form}
      </>
    );
  const tableJournal = (rows: FinanceEvent[]) => (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Jurnal rekening">
      <table>
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Catatan</th>
            <th>Pergerakan rekening</th>
            <th>Pengaruh cash</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                {date(row.event_date)}
                <small>{dateTime(row.created_at)} WITA</small>
              </td>
              <td>
                {row.description}
                <small>
                  {row.kind === 'reversal'
                    ? 'Pembalikan edit'
                    : row.kind === 'opening'
                      ? 'Saldo awal'
                      : row.kind === 'correction'
                        ? 'Koreksi'
                        : (categoryNames[row.category as keyof typeof categoryNames] ??
                          row.category)}
                </small>
              </td>
              <td>
                {row.movements.map((m, i) => (
                  <div key={i}>
                    {m.account}
                    <small>{rupiah(m.delta)}</small>
                  </div>
                ))}
              </td>
              <td>{rupiah(row.cashDelta)}</td>
              <td>
                <button className="button secondary compact" onClick={() => setEvidence(row)}>
                  Bukti
                </button>
                {row.source_id && row.kind !== 'reversal' && (
                  <button
                    className="button secondary compact"
                    onClick={() =>
                      setEditor({
                        kind: 'correction',
                        snapshot: f,
                        source: {
                          id: row.source_id!,
                          kind: row.source_kind!,
                          account_id: row.account_id,
                        },
                      })
                    }
                  >
                    Catatan koreksi
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const pager = (type: 'journal' | 'audit') => {
    const cursor = type === 'journal' ? journalCursor : auditCursor;
    const set = type === 'journal' ? setJournalCursor : setAuditCursor;
    const rows = type === 'journal' ? shown.journal : shown.audit;
    const next = type === 'journal' ? shown.journalHasNext : shown.auditHasNext;
    return (
      <div className="records-pager">
        <span>Halaman {cursor.length} · maksimal 20 catatan</span>
        <div>
          <button
            className="button secondary compact"
            disabled={busy || cursor.length === 1}
            onClick={() => set((v) => v.slice(0, -1))}
          >
            Sebelumnya
          </button>
          <button
            className="button secondary compact"
            disabled={busy || !next || preview}
            onClick={() => set((v) => [...v, rows.at(-1)?.seq])}
          >
            Berikutnya
          </button>
        </div>
      </div>
    );
  };
  return (
    <>
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {view === 'rekening' && (
        <>
          <section className="panel finance-panel">
            <div className="panel-heading">
              <div>
                <h2>Rekening Anda</h2>
                <p>Transfer internal mempertahankan total dana.</p>
              </div>
              <div className="finance-actions">
                <button className="button secondary compact" onClick={() => open('account')}>
                  <Plus size={16} />
                  Tambah rekening
                </button>
                <button className="button primary compact" onClick={() => open('transfer')}>
                  <ArrowLeftRight size={16} />
                  Transfer
                </button>
              </div>
            </div>
            <div className="account-summary">
              <div>
                <span>Cash tersedia</span>
                <strong>{rupiah(f.availableCash)}</strong>
                <small>Cash dan Bank</small>
              </div>
              <div>
                <span>Total dana</span>
                <strong>{rupiah(f.totalFunds)}</strong>
                <small>Termasuk dana yang disisihkan</small>
              </div>
            </div>
            <div className="account-grid">
              {f.accounts.map((a) => (
                <article className="cash-expense-card" key={a.id}>
                  <header>
                    <strong>{a.name}</strong>
                    <span className="badge published">{kinds[a.kind]}</span>
                  </header>
                  <h3>{rupiah(a.balance)}</h3>
                  <small>
                    {a.kind === 'savings' || a.kind === 'investment'
                      ? 'Dana tersisih; belanja mengurangi rekening ini.'
                      : 'Dapat digunakan untuk transaksi harian.'}
                  </small>
                </article>
              ))}
            </div>
          </section>
          <section className="panel finance-panel">
            <div className="panel-heading">
              <div>
                <h2>Jurnal rekening</h2>
                <p>Perubahan dicatat berurutan; edit menghasilkan pembalikan.</p>
              </div>
              <label>
                Periode jurnal
                <select
                  aria-label="Periode jurnal rekening"
                  value={month}
                  onChange={(e) => changeMonth(e.target.value)}
                >
                  <option value="all">Semua periode</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {new Intl.DateTimeFormat('id-ID', {
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'Asia/Makassar',
                      }).format(new Date(`${m}-01T12:00:00Z`))}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {shown.journal.length ? (
              tableJournal(shown.journal)
            ) : (
              <div className="empty-state">Belum ada pergerakan rekening.</div>
            )}
            {pager('journal')}
          </section>
        </>
      )}
      {view === 'riwayat' && (
        <section className="panel finance-panel">
          <div className="panel-heading">
            <div>
              <h2>Riwayat perubahan permanen</h2>
              <p>Nilai sebelum dan sesudah perubahan tersimpan; catatan asli tidak dihapus.</p>
            </div>
            <History size={24} />
          </div>
          <div className="audit-list">
            {shown.audit.map((row) => (
              <AuditRow key={row.seq} row={row} finance={f} />
            ))}
          </div>
          {pager('audit')}
        </section>
      )}
      {view === 'anggaran' && (
        <>
          <ExpenseComposition finance={f} />
          <section className="panel finance-panel">
            <div className="panel-heading">
              <div>
                <h2>Anggaran bulanan</h2>
                <p>
                  {month === 'all' ? today().slice(0, 7) : month} · biaya aktual, tanpa transfer
                  internal.
                </p>
              </div>
              <label>
                Bulan
                <input
                  type="month"
                  value={month === 'all' ? today().slice(0, 7) : month}
                  onChange={(e) => changeMonth(e.target.value || 'all')}
                />
              </label>
              <button className="button primary compact" onClick={() => open('budget')}>
                <Plus size={16} />
                Atur anggaran
              </button>
            </div>
            <div className="goal-grid">
              {f.budgets.map((b) => (
                <BudgetCard
                  key={b.id}
                  budget={b}
                  onEdit={() => open('budget', b as unknown as Record<string, unknown>)}
                />
              ))}
              {!f.budgets.length && <p>Belum ada anggaran untuk bulan ini.</p>}
            </div>
          </section>
        </>
      )}
      {evidence && (
        <EvidenceModal event={evidence} preview={preview} onClose={() => setEvidence(null)} />
      )}
      {pagePending && <p role="status">Memuat halaman riwayat…</p>}
      {form}
    </>
  );
}
function AuditRow({ row, finance }: { row: FinanceAudit; finance: FinanceSnapshot }) {
  const labels: Record<string, string> = {
    date: 'Tanggal',
    description: 'Keterangan',
    reason: 'Alasan',
    destination_id: 'Rekening tujuan',
    kind: 'Jenis rekening',
    openings: 'Saldo awal',
    opening_date: 'Tanggal saldo awal',
    expected: 'Saldo jurnal',
    actual: 'Saldo aktual',
    difference: 'Selisih',
    note: 'Catatan',
    company_name: 'Perusahaan',
    delivery_date: 'Tanggal SPK',
    harvest_date: 'Tanggal panen',
    expense_date: 'Tanggal',
    bunch_count: 'Janjang',
    first_weight: '1st Weight',
    second_weight: '2nd Weight',
    deduction_kg: 'Potongan kg',
    price_per_kg: 'Harga / kg',
    total_income: 'Pendapatan',
    wage_per_kg: 'Upah / kg',
    driver_cost: 'Ongkos supir',
    total_expense: 'Total',
    name: 'Nama',
    target: 'Target dana',
    due_date: 'Tanggal target',
    amount: 'Nominal',
    month: 'Bulan',
    items: 'Rincian',
    account_id: 'Rekening',
    destination_account_id: 'Rekening tujuan',
    category: 'Kategori',
    next_date: 'Jadwal berikutnya',
    scheduled_date: 'Jadwal transaksi',
    frequency: 'Frekuensi',
    active: 'Status aktif',
    cash_expense_id: 'Catatan biaya kebun',
    harvest_id: 'Kelompok panen',
  };
  const value = (key: string, v: unknown) =>
    key === 'category'
      ? (categoryNames[v as keyof typeof categoryNames] ?? String(v))
      : key === 'frequency'
        ? v === 'monthly'
          ? 'Bulanan'
          : 'Mingguan'
        : key === 'active'
          ? v
            ? 'Aktif'
            : 'Dijeda'
          : ['account_id', 'destination_account_id', 'destination_id'].includes(key)
            ? (finance.accounts.find((a) => a.id === v)?.name ?? 'Rekening default')
            : key === 'items' && Array.isArray(v)
              ? v.map((i) => `${i.description}: ${rupiah(i.amount)}`).join(' · ')
              : String(v ?? '—');
  const display = (data: Record<string, unknown> | null) => (
    <dl>
      {Object.entries(
        data?.fields && typeof data.fields === 'object'
          ? (data.fields as Record<string, unknown>)
          : (data ?? {}),
      )
        .filter(([k]) => labels[k])
        .map(([k, v]) => (
          <div key={k}>
            <dt>{labels[k]}</dt>
            <dd>{value(k, v)}</dd>
          </div>
        ))}
    </dl>
  );
  return (
    <details className="audit-row">
      <summary>
        <strong>
          {row.action === 'UPDATE' ? 'Diubah' : row.action === 'INSERT' ? 'Dibuat' : row.action} ·{' '}
          {row.entity === 'transaction_templates'
            ? 'Template transaksi'
            : row.entity === 'harvest_cost_allocations'
              ? 'Alokasi biaya panen'
              : row.entity === 'productivity_command'
                ? 'Template / alokasi biaya'
                : row.entity === 'cash_expenses'
                  ? 'Catatan cash'
                  : row.entity === 'spks'
                    ? 'SPK'
                    : row.entity === 'finance_goals'
                      ? 'Target'
                      : row.entity === 'finance_budgets'
                        ? 'Anggaran'
                        : row.entity === 'finance_command'
                          ? 'Transaksi rekening'
                          : row.entity === 'harvest_expenses'
                            ? 'Pengeluaran panen'
                            : row.entity === 'finance_reconciliations'
                              ? 'Rekonsiliasi'
                              : row.entity === 'receipt'
                                ? 'Bukti transaksi'
                                : row.entity}
        </strong>
        <small>{dateTime(row.created_at)} WITA</small>
      </summary>
      {row.reason && <p>{row.reason}</p>}
      <div className="audit-diff">
        <div>
          <h3>Sebelum</h3>
          {row.before_data ? display(row.before_data) : <p>Belum ada catatan.</p>}
        </div>
        <div>
          <h3>Sesudah</h3>
          {display(row.after_data)}
        </div>
      </div>
    </details>
  );
}
function BudgetCard({ budget: b, onEdit }: { budget: FinanceBudget; onEdit: () => void }) {
  return (
    <article className="cash-expense-card">
      <header>
        <strong>{costNames[b.category]}</strong>
        <button className="button secondary compact" onClick={onEdit}>
          <Pencil size={15} />
          Ubah
        </button>
      </header>
      <h3>
        {rupiah(b.spent)} <small>dari {rupiah(b.amount)}</small>
      </h3>
      <progress
        max={100}
        value={Math.min(100, Math.max(0, b.percent))}
        aria-label={`Penggunaan anggaran ${costNames[b.category]}`}
      />
      <p className={b.percent > 100 ? 'growth-down' : ''}>
        {number(b.percent)}% digunakan · {b.percent > 100 ? 'Melebihi anggaran' : 'Sisa'}{' '}
        {rupiah(b.percent > 100 ? String(b.remaining).replace(/^-/, '') : b.remaining)}
      </p>
    </article>
  );
}
export function ExpenseComposition({ finance: f }: { finance: FinanceSnapshot }) {
  const totalMoney = sumDecimalMoney(f.costs.map((r) => r.amount));
  const total = Number(totalMoney);
  let angle = 0;
  const colors = ['#497749', '#8da86d', '#d1aa65', '#6c9990', '#b58f83'];
  const sectors = f.costs.map((r, i) => {
    const percent = total ? (Math.max(0, Number(r.amount)) / total) * 100 : 0;
    const start = angle;
    angle += percent;
    return {
      ...r,
      percent,
      color: colors[i % colors.length],
      segment: `${colors[i % colors.length]} ${start}% ${angle}%`,
    };
  });
  return (
    <section className="panel finance-panel">
      <div className="panel-heading">
        <div>
          <h2>Komposisi pengeluaran</h2>
          <p>Biaya dari semua rekening. Transfer alokasi tidak dihitung sebagai belanja.</p>
        </div>
        <ChartPie size={24} />
      </div>
      <div className="composition-layout">
        <div
          className="composition-chart"
          role="img"
          aria-label={`Total pengeluaran ${rupiah(totalMoney)}`}
          style={{
            background: total
              ? `conic-gradient(${sectors.map((r) => r.segment).join(',')})`
              : '#e5ece0',
          }}
        >
          <div>
            <small>Total biaya</small>
            <strong>{rupiah(totalMoney)}</strong>
          </div>
        </div>
        <div className="composition-legend">
          {sectors.map((r) => (
            <div key={r.category}>
              <span style={{ background: r.color }} />
              <strong>{costNames[r.category] ?? r.category}</strong>
              <span>{rupiah(r.amount)}</span>
              <small>{number(r.percent, 1)}%</small>
            </div>
          ))}
          {!total && <p>Belum ada pengeluaran yang dipublikasikan.</p>}
        </div>
      </div>
    </section>
  );
}
export function FundingTargets({
  finance: f,
  kind,
  preview,
  onRefresh,
}: {
  finance?: FinanceSnapshot;
  kind: 'savings' | 'investment';
  preview: boolean;
  onRefresh: () => Promise<boolean>;
}) {
  const [editor, setEditor] = useState<FinanceEditor | null>(null),
    [notice, setNotice] = useState('');
  if (!f?.enabled) return null;
  const goals = f.goals.filter((g) => g.kind === kind);
  async function save(fields: Record<string, unknown>, key: string) {
    if (!editor) return;
    await financeApi.command(
      'goal',
      fields,
      key,
      editor.existing?.id as string | undefined,
      editor.existing?.version as number | undefined,
    );
    notifyWorkspaceUpdate();
    const fresh = await onRefresh();
    setNotice(
      fresh ? 'Target diperbarui.' : 'Target tersimpan. Muat ulang untuk membaca data terbaru.',
    );
  }
  return (
    <>
      <section className="panel finance-panel">
        <div className="panel-heading">
          <div>
            <h2>Rencana {kind === 'savings' ? 'Tabungan' : 'Investasi'}</h2>
            <p>Dana tersisa berasal dari rekening setelah belanja dan transfer.</p>
          </div>
          <button
            className="button secondary compact"
            onClick={() => setEditor({ kind: 'goal', goalKind: kind, snapshot: f })}
          >
            <Target size={16} />
            Tambah target
          </button>
        </div>
        {notice && (
          <p className="analysis-note" role="status">
            {notice}
          </p>
        )}
        <div className="goal-grid">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onEdit={() =>
                setEditor({
                  kind: 'goal',
                  goalKind: kind,
                  existing: g as unknown as Record<string, unknown>,
                  snapshot: f,
                })
              }
            />
          ))}
          {!goals.length && <p>Atur target nilai dan tanggal untuk rekening dana Anda.</p>}
        </div>
      </section>
      {editor && (
        <FinanceForm
          editor={editor}
          preview={preview}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </>
  );
}
function GoalCard({ goal: g, onEdit }: { goal: FinanceGoal; onEdit: () => void }) {
  return (
    <article className="cash-expense-card">
      <header>
        <strong>{g.name}</strong>
        <button className="button secondary compact" onClick={onEdit}>
          <Pencil size={15} />
          Ubah
        </button>
      </header>
      <p>
        {g.accountName} · Target {date(g.due_date)}
      </p>
      <h3>
        {rupiah(g.balance)} <small>dari {rupiah(g.target)}</small>
      </h3>
      <progress
        max={100}
        value={Math.min(100, Math.max(0, g.progress))}
        aria-label={`Kemajuan target ${g.name}`}
      />
      <p>
        {number(g.progress)}% tercapai · Kekurangan {rupiah(g.remaining)}
      </p>
      <p>Dana dibelanjakan: {rupiah(g.spent)}</p>
    </article>
  );
}
