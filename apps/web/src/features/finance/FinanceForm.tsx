import { useRef, useState, type FormEvent } from 'react';
import type { FinanceSnapshot } from '@sawit/shared';
import { Modal } from '../../components/Modal';
import { date, errorMessage, rupiah, today } from '../../lib/format';
import { AccountPicker } from './AccountPicker';
import type { FinanceCommand } from './api';
export type FinanceEditor = {
  kind: FinanceCommand;
  goalKind?: 'savings' | 'investment';
  month?: string;
  existing?: Record<string, unknown>;
  source?: { id: string; kind: string; account_id: string };
  snapshot: FinanceSnapshot;
};
const titles: Record<FinanceCommand, string> = {
  activate: 'Aktifkan rekening',
  account: 'Tambah rekening',
  transfer: 'Transfer antar rekening',
  correction: 'Catatan koreksi',
  goal: 'Atur target dana',
  budget: 'Atur anggaran bulanan',
};
export const costNames: Record<string, string> = {
  harvest: 'Pengeluaran panen',
  garden: 'Pengeluaran kebun',
  other: 'Pengeluaran lainnya',
  savings_expense: 'Belanja Tabungan',
  investment_expense: 'Belanja Investasi',
};
export function FinanceForm({
  editor,
  preview,
  onClose,
  onSave,
}: {
  editor: FinanceEditor;
  preview: boolean;
  onClose: () => void;
  onSave: (fields: Record<string, unknown>, key: string) => Promise<void>;
}) {
  const { kind, existing, snapshot: f } = editor;
  const eligibleAccounts =
    kind === 'goal' && !existing
      ? f.accounts.filter((a) => !f.goals.some((g) => g.account_id === a.id))
      : f.accounts;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    name: String(existing?.name ?? ''),
    kind: 'bank',
    amount: String(existing?.amount ?? ''),
    date: today(),
    description: '',
    reason: '',
    account_id: String(
      existing?.account_id ??
        editor.source?.account_id ??
        eligibleAccounts.find(
          (a) =>
            kind !== 'goal' ||
            (editor.goalKind
              ? a.kind === editor.goalKind
              : ['savings', 'investment'].includes(a.kind)),
        )?.id ??
        '',
    ),
    destination_id: '',
    direction: 'add',
    target: String(existing?.target ?? ''),
    due_date: String(existing?.due_date ?? ''),
    month: String(existing?.month ?? editor.month ?? today()).slice(0, 7),
    category: String(
      existing?.category ??
        Object.keys(costNames).find((c) => !f.budgets.some((b) => b.category === c)) ??
        'harvest',
    ),
    opening_date: f.activationPreview.openingDate,
    cash: '0',
    bank: '0',
    savings: '0',
    investment: '0',
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submitting = useRef(false),
    key = useRef(crypto.randomUUID()).current;
  const change = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const input = (name: string, label: string, type = 'text', required = true) => (
    <label key={name}>
      {label}
      <input
        autoFocus={name === 'name'}
        type={type}
        value={values[name] ?? ''}
        onChange={(e) => change(name, e.target.value)}
        required={required}
        disabled={busy || (name === 'month' && Boolean(existing))}
        min={type === 'number' ? '0' : undefined}
        step={type === 'number' ? '0.01' : undefined}
        max={
          type === 'number'
            ? '1000000000000'
            : type === 'date' && name !== 'due_date'
              ? today()
              : undefined
        }
        maxLength={name === 'name' ? (kind === 'account' ? 80 : 120) : 160}
      />
    </label>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError('');
    if (preview) {
      setError('Ini pratinjau. Login untuk menyimpan perubahan.');
      return;
    }
    let fields: Record<string, unknown>;
    if (kind === 'activate')
      fields = {
        expected_revision: f.revision,
        opening_date: values.opening_date,
        openings: Object.fromEntries(
          ['cash', 'bank', 'savings', 'investment'].map((k) => [k, Number(values[k])]),
        ),
      };
    else if (kind === 'account')
      fields = {
        name: values.name,
        kind: values.kind,
        amount: Number(values.amount),
        date: values.date,
      };
    else if (kind === 'transfer')
      fields = {
        account_id: values.account_id,
        destination_id: values.destination_id,
        amount: Number(values.amount),
        date: values.date,
        description: values.description,
      };
    else if (kind === 'correction')
      fields = {
        account_id: values.account_id,
        date: values.date,
        amount: Number(values.amount) * (values.direction === 'subtract' ? -1 : 1),
        reason: values.reason,
        ...(editor.source ? { source_id: editor.source.id, source_kind: editor.source.kind } : {}),
      };
    else if (kind === 'goal')
      fields = {
        account_id: values.account_id,
        name: values.name,
        target: Number(values.target),
        due_date: values.due_date,
      };
    else fields = { month: values.month, category: values.category, amount: Number(values.amount) };
    submitting.current = true;
    setBusy(true);
    try {
      await onSave(fields, key);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title={`${existing ? 'Ubah · ' : ''}${titles[kind]}`} onClose={onClose} busy={busy}>
      <form className="modal-form" onSubmit={submit}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {kind === 'activate' ? (
          <>
            <div className="notice">
              Alokasi menjadi transfer internal. Belanja Tabungan/Investasi mengurangi rekening
              dana, bukan cash utama untuk kedua kalinya. Catatan lama dipertahankan dan diimpor ke
              jurnal.
            </div>
            <div className="calculation">
              <span>Proyeksi cash sebelum tambahan saldo awal</span>
              <strong>{rupiah(f.activationPreview.availableCash)}</strong>
              <span>Total dana setelah konversi</span>
              <strong>{rupiah(f.activationPreview.totalFunds)}</strong>
              <small>
                Saldo awal adalah uang sebelum catatan pertama, bukan saldo saat ini. Transaksi
                paling awal: {date(f.activationPreview.openingDate)}.
              </small>
            </div>
            {input('opening_date', 'Tanggal saldo awal', 'date')}
            <div className="form-grid">
              {input('cash', 'Saldo awal Cash (Rp)', 'number')}
              {input('bank', 'Saldo awal Bank (Rp)', 'number')}
              {input('savings', 'Saldo awal Tabungan (Rp)', 'number')}
              {input('investment', 'Saldo awal Investasi (Rp)', 'number')}
            </div>
            <label className="checkbox-label">
              <input type="checkbox" required disabled={busy} />
              <span>
                Saya sudah memeriksa proyeksi dan saldo awal sebelum mengaktifkan rekening.
              </span>
            </label>
          </>
        ) : (
          <>
            {['account', 'goal'].includes(kind) &&
              input('name', kind === 'goal' ? 'Nama target' : 'Nama rekening')}
            {kind === 'account' && (
              <label>
                Jenis rekening
                <select
                  value={values.kind}
                  onChange={(e) => change('kind', e.target.value)}
                  disabled={busy}
                >
                  {[
                    ['cash', 'Cash'],
                    ['bank', 'Bank'],
                    ['savings', 'Tabungan'],
                    ['investment', 'Investasi'],
                  ].map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!['account', 'budget'].includes(kind) && (
              <AccountPicker
                accounts={eligibleAccounts}
                kinds={
                  kind === 'goal'
                    ? editor.goalKind
                      ? [editor.goalKind]
                      : ['savings', 'investment']
                    : ['cash', 'bank', 'savings', 'investment']
                }
                value={values.account_id}
                onChange={(v) => change('account_id', v)}
                disabled={busy || Boolean(existing)}
                label={kind === 'transfer' ? 'Rekening asal' : 'Rekening'}
              />
            )}
            {kind === 'transfer' && (
              <>
                <AccountPicker
                  accounts={f.accounts}
                  kinds={['cash', 'bank', 'savings', 'investment']}
                  value={values.destination_id}
                  onChange={(v) => change('destination_id', v)}
                  disabled={busy}
                  label="Rekening tujuan"
                />
                {input('description', 'Keterangan transfer')}
              </>
            )}
            {kind === 'goal' ? (
              <>
                {input('target', 'Target dana (Rp)', 'number')}
                {input('due_date', 'Tanggal target', 'date')}
                <p className="form-note">
                  Satu target per rekening dana. Gunakan rekening terpisah untuk tujuan berbeda.
                  Jika pilihan rekening kosong, tambahkan rekening dana di menu Rekening & transfer.
                </p>
              </>
            ) : (
              <>
                {kind === 'budget' ? (
                  <>
                    {input('month', 'Bulan anggaran', 'month')}
                    <label>
                      Kategori
                      <select
                        value={values.category}
                        onChange={(e) => change('category', e.target.value)}
                        disabled={busy || Boolean(existing)}
                      >
                        {Object.entries(costNames).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  input('date', 'Tanggal', 'date')
                )}
                {input(
                  'amount',
                  kind === 'account' ? 'Saldo awal rekening (Rp)' : 'Jumlah (Rp)',
                  'number',
                )}
                {kind === 'correction' && (
                  <>
                    <label>
                      Arah koreksi
                      <select
                        value={values.direction}
                        onChange={(e) => change('direction', e.target.value)}
                        disabled={busy}
                      >
                        <option value="add">Tambah saldo rekening</option>
                        <option value="subtract">Kurangi saldo rekening</option>
                      </select>
                    </label>
                    <label>
                      Alasan koreksi
                      <textarea
                        required
                        minLength={10}
                        maxLength={500}
                        value={values.reason}
                        onChange={(e) => change('reason', e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <p className="form-note">
                      Koreksi dicatat terpisah. Data asli dan batas tujuh hari tetap dipertahankan.
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Batal
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Menyimpan…' : kind === 'activate' ? 'Aktifkan dan impor' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
