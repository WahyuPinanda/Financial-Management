import { useState, useRef, type FormEvent, type ReactNode } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import {
  cashExpenseSchema,
  sumCashItems,
  type CashExpense,
  type CashExpenseInput,
  type CashExpenseCategory,
  type FinanceAccount,
} from '@sawit/shared';
import { cashCategories } from './categories';
import { Modal } from '../../components/Modal';
import { AccountPicker } from '../finance/AccountPicker';
import { dateTime, errorMessage, rupiah } from '../../lib/format';

export function CashExpenseForm({
  category,
  existing,
  preview,
  onClose,
  onSave,
  accounts = [],
  initial,
  mode = 'transaction',
  extraFields,
}: {
  category: CashExpenseCategory;
  existing?: CashExpense;
  preview: boolean;
  onClose: () => void;
  onSave: (input: CashExpenseInput, requestKey: string) => Promise<void>;
  accounts?: FinanceAccount[];
  initial?: Partial<CashExpenseInput>;
  mode?: 'transaction' | 'template';
  extraFields?: ReactNode;
}) {
  const sourceKind =
    category === 'savings_expense'
      ? 'savings'
      : category === 'investment_expense'
        ? 'investment'
        : 'cash';
  const [accountId, setAccountId] = useState(
    existing?.account_id ??
      initial?.account_id ??
      accounts.find((a) => a.default_key === sourceKind)?.id ??
      '',
  );
  const [destinationId, setDestinationId] = useState(
    existing?.destination_account_id ??
      initial?.destination_account_id ??
      accounts.find((a) => a.default_key === category)?.id ??
      '',
  );
  const [expenseDate, setExpenseDate] = useState(
    existing?.expense_date ??
      initial?.expense_date ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
  );
  const [items, setItems] = useState(() =>
    existing || initial?.items
      ? (existing?.items ?? initial!.items!).map((item) => ({
          ...item,
          amount: String(item.amount),
        }))
      : cashCategories[category].defaults.map((description) => ({
          description,
          amount: '',
        })),
  );
  const [publish, setPublish] = useState(Boolean(existing?.published_at));
  const requestKey = useRef(crypto.randomUUID()).current;
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const total = sumCashItems(items.map((item) => ({ ...item, amount: Number(item.amount) || 0 })));
  function change(index: number, key: 'description' | 'amount', value: string) {
    setItems((current) =>
      current.map((item, row) => (row === index ? { ...item, [key]: value } : item)),
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    const result = cashExpenseSchema.safeParse({
      expense_date: expenseDate,
      items: items.map((item) => ({ ...item, amount: Number(item.amount) })),
      publish,
      ...(accountId ? { account_id: accountId } : {}),
      ...(['savings', 'investment'].includes(category) && destinationId
        ? { destination_account_id: destinationId }
        : {}),
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    if (preview) {
      setError('Ini pratinjau. Login untuk menyimpan catatan Anda.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await onSave(result.data, requestKey);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const { title, allocation, income } = cashCategories[category];
  return (
    <Modal
      title={
        mode === 'template'
          ? 'Atur template transaksi rutin'
          : `${existing ? 'Ubah' : 'Tambah'} ${title}`
      }
      subtitle={
        mode === 'template'
          ? 'Template mengisi formulir, tanpa membuat transaksi otomatis.'
          : income
            ? 'Rincian pemasukan yang menambah cash utama'
            : allocation
              ? 'Alokasi dana untuk kebutuhan mendatang'
              : accounts.length && sourceKind !== 'cash'
                ? 'Belanja dari rekening dana yang disisihkan'
                : 'Rincian biaya yang mengurangi cash utama'
      }
      onClose={onClose}
      busy={busy}
    >
      <form className="modal-form" onSubmit={submit}>
        <fieldset className="template-fields" disabled={busy}>
          {extraFields}
        </fieldset>
        {!!accounts.length && (
          <>
            <AccountPicker
              accounts={accounts}
              kinds={sourceKind === 'cash' ? ['cash', 'bank'] : [sourceKind]}
              value={accountId}
              onChange={setAccountId}
              label={income ? 'Pemasukan masuk ke' : 'Rekening asal'}
              disabled={busy}
            />
            {allocation && (
              <AccountPicker
                accounts={accounts}
                kinds={[category as 'savings' | 'investment']}
                value={destinationId}
                onChange={setDestinationId}
                label="Rekening dana tujuan"
                disabled={busy}
              />
            )}
          </>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {mode !== 'template' && (
          <label>
            {income ? 'Tanggal pemasukan' : allocation ? 'Tanggal alokasi' : 'Tanggal pengeluaran'}
            <input
              type="date"
              required
              min="1900-01-01"
              max="9999-12-31"
              value={expenseDate}
              onChange={(event) => setExpenseDate(event.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <div className="cash-lines">
          {items.map((item, index) => (
            <div className="cash-line" key={index}>
              <label>
                Keterangan {index + 1}
                <input
                  autoFocus={index === 0}
                  required
                  maxLength={160}
                  placeholder={income ? 'Contoh: Pendapatan tambahan' : 'Contoh: Ongkos pemupukan'}
                  value={item.description}
                  onChange={(event) => change(index, 'description', event.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                Jumlah {index + 1} (Rp)
                <input
                  type="number"
                  inputMode="decimal"
                  required
                  min="0"
                  max="1000000000000"
                  step="0.01"
                  placeholder="0"
                  value={item.amount}
                  onChange={(event) => change(index, 'amount', event.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Hapus rincian ${index + 1}`}
                disabled={busy || items.length === 1}
                onClick={() => setItems((current) => current.filter((_, row) => row !== index))}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="button secondary compact"
          disabled={busy || items.length >= 50}
          onClick={() => setItems((current) => [...current, { description: '', amount: '' }])}
        >
          <Plus size={16} />{' '}
          {income
            ? 'Tambah rincian pemasukan'
            : cashCategories[category].allocation
              ? 'Tambah rincian alokasi'
              : 'Tambah field pengeluaran'}
        </button>
        <div className="calculation">
          <div className="calculation-total">
            <span>
              {income ? 'Total pemasukan' : allocation ? 'Total alokasi' : 'Total pengeluaran'}
            </span>
            <strong>{rupiah(total)}</strong>
          </div>
          <small>
            {mode === 'template'
              ? 'Menyimpan template tidak mengubah saldo. Setiap transaksi tetap perlu ditinjau.'
              : accounts.length && allocation
                ? 'Dana dipindahkan ke rekening tujuan tanpa mengurangi total uang.'
                : accounts.length && sourceKind !== 'cash'
                  ? 'Belanja mengurangi saldo rekening dana; cash utama tidak dipotong lagi.'
                  : `Setelah publikasi, total ini otomatis ${income ? 'menambah' : 'mengurangi'} cash utama.`}
          </small>
        </div>
        {mode !== 'template' && !existing?.published_at && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={publish}
              onChange={(event) => setPublish(event.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>
                {income
                  ? 'Publikasikan pemasukan'
                  : allocation
                    ? 'Publikasikan alokasi'
                    : 'Publikasikan pengeluaran'}
              </strong>
              <small>Draft belum {income ? 'menambah' : 'mengurangi'} cash utama.</small>
            </span>
          </label>
        )}
        <p className="form-note">
          <Info size={16} />
          <span>
            {mode === 'template'
              ? 'Template dapat diubah kapan saja. Catatan yang dibuat tetap mengikuti batas edit tujuh hari sejak publikasi.'
              : existing?.edit_deadline
                ? `Batas edit ${dateTime(existing.edit_deadline)} WITA. Waktu publikasi tetap.`
                : 'Dapat diedit selama 7 × 24 jam sejak publikasi, lalu terkunci otomatis.'}
          </span>
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Batal
          </button>
          <button className="button primary" disabled={busy}>
            {busy
              ? 'Menyimpan…'
              : mode === 'template'
                ? 'Simpan template'
                : publish
                  ? existing?.published_at
                    ? 'Simpan perubahan'
                    : income
                      ? 'Publikasikan pemasukan'
                      : allocation
                        ? 'Publikasikan alokasi'
                        : 'Publikasikan pengeluaran'
                  : 'Simpan draft'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
