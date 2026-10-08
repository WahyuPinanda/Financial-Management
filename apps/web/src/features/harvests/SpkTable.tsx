import { LockKeyhole, Pencil } from 'lucide-react';
import type { Spk } from '@sawit/shared';
import { date, dateTime, number, rupiah } from '../../lib/format';

export function SpkTable({ spks, onEdit }: { spks: Spk[]; onEdit: (spk: Spk) => void }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Perusahaan / tanggal</th>
            <th>Janjang</th>
            <th>Berat muatan</th>
            <th>Potongan</th>
            <th>Harga / kg</th>
            <th>Pendapatan</th>
            <th>Status</th>
            <th>
              <span className="sr-only">Aksi</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {spks.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.company_name}</strong>
                <small>{date(s.delivery_date)}</small>
              </td>
              <td>{number(s.bunch_count, 0)}</td>
              <td>
                {number(Number(s.gross_weight))} kg
                <small>Bersih {number(Number(s.net_weight))} kg</small>
              </td>
              <td>
                {number(Number(s.deduction_kg))} kg
                <small>{number(Number(s.deduction_percent))}%</small>
              </td>
              <td>{rupiah(Number(s.price_per_kg))}</td>
              <td className="income-cell">
                {rupiah(Number(s.total_income))}
                {!s.published_at && <small>Belum masuk total</small>}
              </td>
              <td>
                <span
                  className={`badge ${!s.published_at ? 'draft' : s.editable ? 'published' : 'locked'}`}
                >
                  {!s.published_at ? (
                    'Draft'
                  ) : s.editable ? (
                    'Publikasi'
                  ) : (
                    <>
                      <LockKeyhole size={11} />
                      Terkunci
                    </>
                  )}
                </span>
              </td>
              <td>
                {s.editable ? (
                  <button
                    className="icon-button"
                    aria-label={`Ubah SPK ${s.company_name}`}
                    title={
                      s.edit_deadline
                        ? `Dapat diubah sampai ${dateTime(s.edit_deadline)} WITA`
                        : 'Ubah draft SPK'
                    }
                    onClick={() => onEdit(s)}
                  >
                    <Pencil size={16} />
                  </button>
                ) : (
                  <span
                    className="locked-icon"
                    title={`Batas edit ${s.edit_deadline ? dateTime(s.edit_deadline) : ''} WITA`}
                  >
                    <LockKeyhole size={16} />
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
