import { useEffect, useRef, useState } from 'react';
import { Plus, Repeat2, Pencil } from 'lucide-react';
import { LatestRequest, sumDecimalMoney } from '@sawit/shared';
import type {
  CashExpenseInput,
  CashExpenseCategory,
  FinanceAccount,
  TransactionTemplate,
} from '@sawit/shared';
import { CashExpenseForm } from '../cash-expenses/CashExpenseForm';
import { cashCategories } from '../cash-expenses/categories';
import { date, errorMessage, rupiah, today } from '../../lib/format';
import { productivityApi } from './api';
import { notifyWorkspaceUpdate } from '../../lib/workspaceUpdates';
import { Pager } from '../../components/Pager';
export function TemplatesPage({
  templates,
  accounts,
  preview,
  onRefresh,
  workspaceRevision,
}: {
  templates: TransactionTemplate[];
  accounts: FinanceAccount[];
  preview: boolean;
  onRefresh: () => Promise<boolean>;
  workspaceRevision?: number;
}) {
  const [editor, setEditor] = useState<{ existing?: TransactionTemplate } | null>(null),
    [using, setUsing] = useState<TransactionTemplate | null>(null);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''),
    [appliedSearch, setAppliedSearch] = useState(''),
    [revision, setRevision] = useState(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState<{
    key: string;
    rows: TransactionTemplate[];
    hasNext: boolean;
    total: number;
  } | null>(null);
  const [reading, setReading] = useState(!preview),
    [readError, setReadError] = useState('');
  const latest = useRef(new LatestRequest());
  const queryKey = JSON.stringify([appliedSearch, cursors.at(-1), revision, workspaceRevision]);
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
    setReadError('');
    const params = new URLSearchParams({ search: appliedSearch });
    if (cursors.at(-1)) params.set('before', cursors.at(-1)!);
    void productivityApi
      .templates(params, op.signal)
      .then((response) => {
        if (op.isCurrent()) setPage({ key: queryKey, ...response.data });
      })
      .catch((e) => {
        if (op.isCurrent()) setReadError(errorMessage(e));
      })
      .finally(() => {
        if (op.isCurrent()) setReading(false);
      });
    return () => latest.current.cancel();
  }, [queryKey, preview]);
  const shown = preview
    ? templates.filter((t) => t.name.toLowerCase().includes(appliedSearch.toLowerCase()))
    : page?.key === queryKey
      ? page.rows
      : [];
  const total = preview ? templates.length : (page?.total ?? 0);
  async function refresh() {
    notifyWorkspaceUpdate();
    const fresh = await onRefresh();
    setCursors([undefined]);
    setRevision((v) => v + 1);
    setNotice(
      fresh
        ? 'Tersimpan. Jadwal dan saldo sudah diperbarui.'
        : 'Tersimpan. Muat ulang untuk melihat ringkasan terbaru.',
    );
  }
  return (
    <section className="panel finance-panel">
      <div className="panel-heading">
        <div>
          <h2>Template transaksi rutin</h2>
          <p>Isi ulang lebih cepat. Jadwal tidak mempublikasikan transaksi otomatis.</p>
        </div>
        <button
          className="button primary compact"
          onClick={() => setEditor({})}
          disabled={reading || Boolean(readError) || total >= 100}
        >
          <Plus size={16} />
          Tambah template
        </button>
      </div>
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <label className="template-search">
        Cari template
        <input
          maxLength={120}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nama template…"
        />
      </label>
      {readError && (
        <div className="alert error" role="alert">
          {readError}
          <button className="text-button" onClick={() => setRevision((v) => v + 1)}>
            Coba lagi
          </button>
        </div>
      )}
      {reading && <p role="status">Memuat template…</p>}
      <div className="template-list">
        {shown.map((t) => (
          <article className="cash-expense-card" key={t.id}>
            <header>
              <div>
                <strong>{t.name}</strong>
                <span className={`badge ${t.active ? 'published' : 'draft'}`}>
                  {t.active ? 'Aktif' : 'Dijeda'}
                </span>
              </div>
              <Repeat2 size={19} />
            </header>
            <p>
              {cashCategories[t.category].title} ·{' '}
              {t.frequency === 'monthly' ? 'Bulanan' : 'Mingguan'}
            </p>
            <p>
              Jadwal berikutnya: <strong>{date(t.next_date)}</strong>
            </p>
            <strong>{rupiah(sumDecimalMoney(t.items.map((i) => i.amount)))}</strong>
            <div className="finance-actions">
              <button
                className="button secondary compact"
                onClick={() => setEditor({ existing: t })}
              >
                <Pencil size={15} />
                Ubah template
              </button>
              <button
                className="button primary compact"
                disabled={!t.active || t.next_date > today()}
                onClick={() => setUsing(t)}
              >
                Tinjau transaksi
              </button>
            </div>
          </article>
        ))}
      </div>
      {!reading && !readError && !shown.length && (
        <div className="empty-state">
          Belum ada template. Tambahkan biaya atau pemasukan yang sering dicatat.
        </div>
      )}
      {!preview && (
        <Pager
          count={total}
          page={cursors.length}
          hasNext={page?.key === queryKey && page.hasNext}
          disabled={reading || Boolean(readError)}
          onPrevious={() => setCursors((c) => c.slice(0, -1))}
          onNext={() => setCursors((c) => [...c, shown.at(-1)?.id])}
        />
      )}
      {editor && (
        <TemplateEditor
          existing={editor.existing}
          accounts={accounts}
          preview={preview}
          onClose={() => setEditor(null)}
          onSave={async (fields, key) => {
            await productivityApi.command(
              'template',
              fields,
              key,
              editor.existing?.id,
              editor.existing?.version,
            );
            await refresh();
          }}
        />
      )}
      {using && (
        <CashExpenseForm
          category={using.category}
          preview={preview}
          accounts={accounts}
          initial={{
            items: using.items,
            ...(using.account_id ? { account_id: using.account_id } : {}),
            ...(using.destination_account_id
              ? { destination_account_id: using.destination_account_id }
              : {}),
          }}
          extraFields={
            <div className="notice">
              Dari template {using.name}, jadwal {date(using.next_date)}. Periksa nominal, tanggal,
              dan rekening. Jika disimpan sebagai draft, lanjutkan publikasi di menu transaksi
              terkait.
            </div>
          }
          onClose={() => setUsing(null)}
          onSave={async (input, key) => {
            await productivityApi.command(
              'apply_template',
              { scheduled_date: using.next_date, transaction: input },
              key,
              using.id,
              using.version,
            );
            await refresh();
          }}
        />
      )}
    </section>
  );
}
function TemplateEditor({
  existing,
  accounts,
  preview,
  onClose,
  onSave,
}: {
  existing?: TransactionTemplate;
  accounts: FinanceAccount[];
  preview: boolean;
  onClose: () => void;
  onSave: (fields: Record<string, unknown>, key: string) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? ''),
    [category, setCategory] = useState<CashExpenseCategory>(existing?.category ?? 'garden');
  const [nextDate, setNextDate] = useState(existing?.next_date ?? today()),
    [frequency, setFrequency] = useState(existing?.frequency ?? 'monthly'),
    [active, setActive] = useState(existing?.active ?? true);
  return (
    <CashExpenseForm
      key={category}
      category={category}
      mode="template"
      accounts={accounts}
      preview={preview}
      onClose={onClose}
      initial={{
        items: existing?.category === category ? existing.items : [{ description: '', amount: 0 }],
        ...(existing?.category === category && existing.account_id
          ? { account_id: existing.account_id }
          : {}),
        ...(existing?.category === category && existing.destination_account_id
          ? { destination_account_id: existing.destination_account_id }
          : {}),
      }}
      extraFields={
        <>
          <label>
            Nama template
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Kategori
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CashExpenseCategory)}
            >
              {Object.entries(cashCategories).map(([v, c]) => (
                <option key={v} value={v}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Frekuensi
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as 'monthly' | 'weekly')}
              >
                <option value="monthly">Bulanan</option>
                <option value="weekly">Mingguan</option>
              </select>
            </label>
            <label>
              Jadwal berikutnya
              <input
                type="date"
                min="1900-01-01"
                max="9999-11-30"
                required
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Template aktif
          </label>
        </>
      }
      onSave={async (input: CashExpenseInput, key) => {
        try {
          await onSave(
            {
              name,
              category,
              frequency,
              next_date: nextDate,
              active,
              items: input.items,
              ...(input.account_id ? { account_id: input.account_id } : {}),
              ...(input.destination_account_id
                ? { destination_account_id: input.destination_account_id }
                : {}),
            },
            key,
          );
        } catch (e) {
          throw new Error(errorMessage(e));
        }
      }}
    />
  );
}
