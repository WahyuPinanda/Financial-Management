import { useState, useRef, type FormEvent } from 'react';
import {
  calculateExpense,
  expenseSchema,
  type ExpenseInput,
  type HarvestExpense,
  type FinanceAccount,
} from '@sawit/shared';
import { Info, Send } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { AccountPicker } from '../finance/AccountPicker';
import { dateTime, errorMessage, number, rupiah, today } from '../../lib/format';

export function ExpenseForm({
  existing,
  harvestName,
  harvestDate,
  onSave,
  onClose,
  preview = false,
  accounts = [],
}: {
  existing?: HarvestExpense;
  harvestName: string;
  harvestDate?: string;
  onSave: (input: ExpenseInput, requestKey: string) => Promise<void>;
  onClose: () => void;
  preview?: boolean;
  accounts?: FinanceAccount[];
}) {
  const [values, setValues] = useState({
    first_weight: existing?.first_weight?.toString() ?? '',
    second_weight: existing?.second_weight?.toString() ?? '',
    wage_per_kg: existing?.wage_per_kg?.toString() ?? '',
    driver_cost: existing?.driver_cost?.toString() ?? '',
  });
  const [accountId, setAccountId] = useState(
    existing?.account_id ?? accounts.find((a) => a.default_key === 'cash')?.id ?? '',
  );
  const [publish, setPublish] = useState(Boolean(existing?.published_at));
  const requestKey = useRef(crypto.randomUUID()).current;
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const numeric = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === '' ? NaN : Number(value)]),
  ) as Record<keyof typeof values, number>;
  const calculation = calculateExpense(numeric);
  const fields = [
    {
      name: 'first_weight',
      label: '1st Weight',
      unit: 'kg',
      min: '0.01',
      max: '1000000',
      hint: 'Kendaraan + muatan',
    },
    {
      name: 'second_weight',
      label: '2nd Weight',
      unit: 'kg',
      min: '0',
      max: '1000000',
      hint: 'Kendaraan tanpa muatan',
    },
    {
      name: 'wage_per_kg',
      label: 'Upah panen per kg',
      unit: 'Rp / kg',
      min: '0',
      max: '1000000',
      hint: 'Isi 0 jika tanpa upah',
    },
    {
      name: 'driver_cost',
      label: 'Ongkos supir',
      unit: 'Rp',
      min: '0',
      max: '1000000000000',
      hint: 'Total ongkos, bukan tarif per kg',
    },
  ] as const;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    if (publish && harvestDate && harvestDate > today()) {
      setError('Pengeluaran untuk panen di masa depan hanya dapat disimpan sebagai draft.');
      return;
    }
    const result = expenseSchema.safeParse({
      ...numeric,
      publish,
      ...(accountId ? { account_id: accountId } : {}),
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    if (preview) {
      setError('Ini pratinjau. Hubungkan Supabase dan login untuk menyimpan pengeluaran.');
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

  return (
    <Modal
      title={existing ? 'Ubah pengeluaran' : 'Tambah pengeluaran panen'}
      subtitle={harvestName}
      onClose={onClose}
      busy={busy}
    >
      <form className="modal-form" onSubmit={submit}>
        {!!accounts.length && (
          <AccountPicker
            accounts={accounts}
            kinds={['cash', 'bank']}
            value={accountId}
            onChange={setAccountId}
            label="Dibayar dari rekening"
            disabled={busy}
          />
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid">
          {fields.slice(0, 2).map((field, index) => (
            <label key={field.name}>
              {field.label}
              <div className="unit-input">
                <input
                  autoFocus={index === 0}
                  type="number"
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step="0.01"
                  required
                  placeholder="0"
                  value={values[field.name]}
                  onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  disabled={busy}
                />
                <span>{field.unit}</span>
              </div>
              <small>{field.hint}</small>
            </label>
          ))}
          <label className="full-width">
            Total Overall Weight
            <div className="unit-input calculated-input">
              <input
                readOnly
                value={number(calculation.overall_weight)}
                aria-describedby="overall-weight-hint"
              />
              <span>kg</span>
            </div>
            <small id="overall-weight-hint">Dihitung otomatis: 1st Weight − 2nd Weight</small>
          </label>
          {fields.slice(2).map((field) => (
            <label key={field.name}>
              {field.label}
              <div className="unit-input">
                <input
                  type="number"
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step="0.01"
                  required
                  placeholder="0"
                  value={values[field.name]}
                  onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  disabled={busy}
                />
                <span>{field.unit}</span>
              </div>
              <small>{field.hint}</small>
            </label>
          ))}
        </div>
        <div className="calculation expense-calculation">
          <div>
            <span>Total upah panen</span>
            <strong>{rupiah(calculation.labor_cost)}</strong>
          </div>
          <div>
            <span>Ongkos supir</span>
            <strong>{rupiah(numeric.driver_cost || 0)}</strong>
          </div>
          <div className="calculation-total">
            <span>Total pengeluaran</span>
            <strong>{rupiah(calculation.total_expense)}</strong>
          </div>
          <small>
            Berat keseluruhan × upah/kg + ongkos supir. Setelah publikasi, jumlah ini mengurangi
            pendapatan bersih panen.
          </small>
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
              <strong>Publikasikan pengeluaran</strong>
              <small>Draft belum mengurangi pendapatan. Publikasi memulai batas edit 7 hari.</small>
            </span>
          </label>
        )}
        <p className="form-note">
          <Info size={16} />
          <span>
            {existing?.edit_deadline
              ? `Dapat diubah sampai ${dateTime(existing.edit_deadline)} WITA. Waktu publikasi tetap.`
              : 'Dapat diedit selama 7 × 24 jam sejak publikasi. Setelah batas ini, catatan terkunci otomatis.'}
          </span>
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Batal
          </button>
          <button className="button primary" disabled={busy}>
            <Send size={15} />
            {busy
              ? 'Menyimpan…'
              : publish
                ? existing?.published_at
                  ? 'Simpan perubahan'
                  : 'Publikasikan pengeluaran'
                : 'Simpan draft'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
