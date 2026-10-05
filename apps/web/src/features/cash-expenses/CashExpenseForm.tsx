import { useState, useRef, type FormEvent } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import {
  cashExpenseSchema,
  sumCashItems,
  type CashExpense,
  type CashExpenseInput,
  type CashExpenseCategory,
} from '@sawit/shared';
import { cashCategories } from './categories';
import { Modal } from '../../components/Modal';
import { dateTime, errorMessage, rupiah } from '../../lib/format';

export function CashExpenseForm({
  category,
  existing,
  preview,
  onClose,
  onSave,
}: {
  category: CashExpenseCategory;
  existing?: CashExpense;
  preview: boolean;
  onClose: () => void;
  onSave: (input: CashExpenseInput, requestKey: string) => Promise<void>;
}) {
  const [expenseDate, setExpenseDate] = useState(
    existing?.expense_date ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
  );
  const [items, setItems] = useState(() =>
    existing
      ? existing.items.map((item) => ({ ...item, amount: String(item.amount) }))
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
  const { title, allocation } = cashCategories[category];
  return (
    <Modal
      title={`${existing ? 'Ubah' : 'Tambah'} ${title}`}
      subtitle={
        allocation
          ? 'Alokasi dana untuk kebutuhan mendatang'
          : 'Rincian biaya yang mengurangi cash utama'
      }
      onClose={onClose}
      busy={busy}
    >
      <form className="modal-form" onSubmit={submit}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <label>
          {allocation ? 'Tanggal alokasi' : 'Tanggal pengeluaran'}
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
        <div className="cash-lines">
          {items.map((item, index) => (
            <div className="cash-line" key={index}>
              <label>
                Keterangan {index + 1}
                <input
                  autoFocus={index === 0}
                  required
                  maxLength={160}
                  placeholder="Contoh: Ongkos pemupukan"
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
          {cashCategories[category].allocation
            ? 'Tambah rincian alokasi'
            : 'Tambah field pengeluaran'}
        </button>
        <div className="calculation">
          <div className="calculation-total">
            <span>{allocation ? 'Total alokasi' : 'Total pengeluaran'}</span>
            <strong>{rupiah(total)}</strong>
          </div>
          <small>Setelah publikasi, total ini otomatis mengurangi cash utama.</small>
        </div>
        {!existing?.published_at && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={publish}
              onChange={(event) => setPublish(event.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>
                {allocation
                  ? 'Publikasikan alokasi'
                  : allocation
                    ? 'Publikasikan alokasi'
                    : 'Publikasikan pengeluaran'}
              </strong>
              <small>Draft belum mengurangi cash utama.</small>
            </span>
          </label>
        )}
        <p className="form-note">
          <Info size={16} />
          <span>
            {existing?.edit_deadline
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
              : publish
                ? existing?.published_at
                  ? 'Simpan perubahan'
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
