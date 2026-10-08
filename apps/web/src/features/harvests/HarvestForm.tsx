import { useState, useRef, type FormEvent } from 'react';
import { harvestSchema, type HarvestInput } from '@sawit/shared';
import { Modal } from '../../components/Modal';
import { errorMessage, today } from '../../lib/format';

export function HarvestForm({
  onSave,
  onClose,
}: {
  onSave: (value: HarvestInput, requestKey: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [harvestDate, setHarvestDate] = useState(today());
  const requestKey = useRef(crypto.randomUUID()).current;
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    const result = harvestSchema.safeParse({ name, harvest_date: harvestDate });
    if (!result.success) {
      setError(result.error.issues[0].message);
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
      title="Buat kelompok panen"
      subtitle="Gabungkan beberapa SPK dalam satu waktu panen."
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} className="modal-form">
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        <label>
          Nama panen
          <input
            autoFocus
            required
            maxLength={120}
            placeholder="Contoh: Panen kebun A — Oktober"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Tanggal panen
          <input
            type="date"
            required
            min="1900-01-01"
            value={harvestDate}
            onChange={(e) => setHarvestDate(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Buat panen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
