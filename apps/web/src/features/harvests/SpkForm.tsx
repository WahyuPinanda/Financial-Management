import { useState, useRef, type FormEvent } from 'react';
import {
  calculateSpk,
  spkSchema,
  type Spk,
  type SpkInput,
  type FinanceAccount,
} from '@sawit/shared';
import { AccountPicker } from '../finance/AccountPicker';
import { Info, Send } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { dateTime, errorMessage, number, rupiah, today } from '../../lib/format';

export function SpkForm({
  existing,
  harvestName,
  onSave,
  onClose,
  preview = false,
  accounts = [],
}: {
  existing?: Spk;
  harvestName: string;
  onSave: (input: SpkInput, requestKey: string) => Promise<void>;
  onClose: () => void;
  preview?: boolean;
  accounts?: FinanceAccount[];
}) {
  const [company, setCompany] = useState(existing?.company_name ?? '');
  const [accountId, setAccountId] = useState(
    existing?.account_id ?? accounts.find((a) => a.default_key === 'cash')?.id ?? '',
  );
  const [deliveryDate, setDeliveryDate] = useState(existing?.delivery_date ?? today());
  const [values, setValues] = useState({
    bunch_count: existing?.bunch_count?.toString() ?? '',
    first_weight: existing?.first_weight?.toString() ?? '',
    second_weight: existing?.second_weight?.toString() ?? '',
    deduction_kg: existing?.deduction_kg?.toString() ?? '',
    price_per_kg: existing?.price_per_kg?.toString() ?? '',
  });
  const [publish, setPublish] = useState(Boolean(existing?.published_at));
  const requestKey = useRef(crypto.randomUUID()).current;
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const numeric = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === '' ? NaN : Number(value)]),
  ) as Record<keyof typeof values, number>;
  const calculation = calculateSpk({
    first_weight: numeric.first_weight || 0,
    second_weight: numeric.second_weight || 0,
    deduction_kg: numeric.deduction_kg || 0,
    price_per_kg: numeric.price_per_kg || 0,
  });
  const fields = [
    { name: 'bunch_count', label: 'Jumlah janjang', unit: 'janjang', step: '1', min: '1' },
    { name: 'price_per_kg', label: 'Harga hari ini', unit: 'Rp / kg', step: '0.01', min: '0.01' },
    {
      name: 'first_weight',
      label: '1st Weight',
      unit: 'kg',
      step: '0.01',
      min: '0.01',
      hint: 'Kendaraan + muatan',
    },
    {
      name: 'second_weight',
      label: '2nd Weight',
      unit: 'kg',
      step: '0.01',
      min: '0',
      hint: 'Kendaraan tanpa muatan',
    },
    {
      name: 'deduction_kg',
      label: 'Potongan',
      unit: 'kg',
      step: '0.01',
      min: '0',
      hint: 'Isi 0 jika tanpa potongan',
    },
  ] as const;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    if (publish && deliveryDate > today()) {
      setError('Tanggal SPK di masa depan hanya dapat disimpan sebagai draft.');
      return;
    }
    const result = spkSchema.safeParse({
      company_name: company,
      delivery_date: deliveryDate,
      ...numeric,
      publish,
      ...(accountId ? { account_id: accountId } : {}),
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    if (preview) {
      setError('Ini pratinjau. Hubungkan Supabase dan login untuk menyimpan data.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await onSave(result.data, requestKey);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? 'Ubah SPK' : 'Tambah SPK'}
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
            label="Pendapatan masuk ke"
            disabled={busy}
          />
        )}
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        <div className="form-grid">
          <label className="full-width">
            Nama perusahaan
            <input
              autoFocus
              placeholder="Contoh: PT. Sawit Sejahtera"
              required
              maxLength={160}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="full-width">
            Tanggal SPK
            <input
              type="date"
              required
              min="1900-01-01"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              disabled={busy}
            />
          </label>
          {fields.map((field) => (
            <label key={field.name}>
              {field.label}
              <div className="unit-input">
                <input
                  type="number"
                  inputMode={field.name === 'bunch_count' ? 'numeric' : 'decimal'}
                  placeholder="0"
                  min={field.min}
                  max={field.name === 'bunch_count' ? '1000000000' : '1000000'}
                  step={field.step}
                  required
                  value={values[field.name]}
                  onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  disabled={busy}
                />
                <span>{field.unit}</span>
              </div>
              {'hint' in field && <small>{field.hint}</small>}
            </label>
          ))}
          <div className="deduction-preview">
            <span>Potongan otomatis</span>
            <strong>
              {number(calculation.deduction_percent)}
              <small>%</small>
            </strong>
            <span>dari berat muatan</span>
          </div>
        </div>
        <div className="calculation">
          <div>
            <span>Berat muatan</span>
            <strong>{number(calculation.gross_weight)} kg</strong>
          </div>
          <div>
            <span>Berat bersih dibayar</span>
            <strong>{number(calculation.net_weight)} kg</strong>
          </div>
          <div className="calculation-total">
            <span>Total pendapatan</span>
            <strong>{rupiah(calculation.total_income)}</strong>
          </div>
          <small>Berat bersih × harga per kg. Nilai akhir dihitung ulang oleh database.</small>
        </div>
        {!existing?.published_at && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Publikasikan SPK</strong>
              <small>
                Jika tidak dipilih, SPK disimpan sebagai draft dan belum masuk total pendapatan.
              </small>
            </span>
          </label>
        )}
        <p className="form-note">
          <Info size={16} />
          <span>
            {existing?.edit_deadline
              ? `Dapat diubah sampai ${dateTime(existing.edit_deadline)} WITA. Waktu publikasi tetap.`
              : 'SPK yang dipublikasikan dapat diubah selama 7 × 24 jam, lalu terkunci otomatis.'}
          </span>
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button className="button primary" disabled={busy}>
            <Send size={15} />
            {busy
              ? 'Menyimpan…'
              : publish
                ? existing?.published_at
                  ? 'Simpan perubahan'
                  : 'Publikasikan SPK'
                : 'Simpan draft'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
