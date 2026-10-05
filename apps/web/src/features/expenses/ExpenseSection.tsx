import { LockKeyhole, Pencil, Plus, Receipt } from 'lucide-react';
import { summarize, type Harvest, type HarvestExpense } from '@sawit/shared';
import { dateTime, number, rupiah } from '../../lib/format';

export function ExpenseSection({
  harvest,
  onAdd,
  onEdit,
}: {
  harvest: Harvest;
  onAdd: () => void;
  onEdit: (expense: HarvestExpense) => void;
}) {
  const totals = summarize(harvest.spks, harvest.expenses);
  return (
    <section className="panel expense-panel">
      <div className="panel-heading">
        <div>
          <h2>Pengeluaran panen</h2>
          <p>{harvest.name} · Upah panen dan ongkos supir</p>
        </div>
        <button className="button secondary compact" onClick={onAdd}>
          <Plus size={16} />
          Tambah pengeluaran
        </button>
      </div>
      {harvest.expenses.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Catatan / publikasi</th>
                <th>1st Weight</th>
                <th>2nd Weight</th>
                <th>Overall Weight</th>
                <th>Upah / kg</th>
                <th>Total upah</th>
                <th>Ongkos supir</th>
                <th>Pengeluaran</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Aksi</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {harvest.expenses.map((expense, index) => (
                <tr key={expense.id}>
                  <td>
                    <strong>Pengeluaran #{index + 1}</strong>
                    <small>
                      {expense.published_at
                        ? dateTime(expense.published_at)
                        : 'Belum dipublikasikan'}
                    </small>
                  </td>
                  <td>{number(Number(expense.first_weight))} kg</td>
                  <td>{number(Number(expense.second_weight))} kg</td>
                  <td>{number(Number(expense.overall_weight))} kg</td>
                  <td>{rupiah(Number(expense.wage_per_kg))}</td>
                  <td>{rupiah(Number(expense.labor_cost))}</td>
                  <td>{rupiah(Number(expense.driver_cost))}</td>
                  <td className="expense-cell">
                    {rupiah(Number(expense.total_expense))}
                    {!expense.published_at && <small>Belum mengurangi pendapatan</small>}
                  </td>
                  <td>
                    <span
                      className={`badge ${!expense.published_at ? 'draft' : expense.editable ? 'published' : 'locked'}`}
                    >
                      {!expense.published_at ? (
                        'Draft'
                      ) : expense.editable ? (
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
                    {expense.editable ? (
                      <button
                        className="icon-button"
                        aria-label={`Ubah pengeluaran ${index + 1}`}
                        title={
                          expense.edit_deadline
                            ? `Batas edit ${dateTime(expense.edit_deadline)} WITA`
                            : 'Ubah draft pengeluaran'
                        }
                        onClick={() => onEdit(expense)}
                      >
                        <Pencil size={16} />
                      </button>
                    ) : (
                      <span
                        className="locked-icon"
                        title={
                          expense.edit_deadline
                            ? `Batas edit ${dateTime(expense.edit_deadline)} WITA`
                            : 'Terkunci'
                        }
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
      ) : (
        <div className="empty-state small">
          <Receipt size={29} />
          <h3>Belum ada pengeluaran</h3>
          <p>Catat upah panen dan ongkos supir untuk mengetahui pendapatan bersih.</p>
        </div>
      )}
      <div className="harvest-balance" aria-label="Ringkasan keuangan panen">
        <div>
          <span>Pendapatan utama</span>
          <strong>{rupiah(totals.income)}</strong>
          <small>{totals.count} SPK publikasi</small>
        </div>
        <div>
          <span>Total pengeluaran</span>
          <strong className="expense-cell">{rupiah(totals.expenses)}</strong>
          <small>{totals.expenseCount} catatan publikasi</small>
        </div>
        <div className={`balance-net ${totals.netIncome < 0 ? 'balance-negative' : ''}`}>
          <span>Pendapatan bersih</span>
          <strong>{rupiah(totals.netIncome)}</strong>
          <small>Pendapatan utama − pengeluaran</small>
        </div>
      </div>
      {totals.netIncome < 0 && (
        <p className="balance-note">
          Pengeluaran panen ini melebihi pendapatan utama yang sudah dipublikasikan.
        </p>
      )}
    </section>
  );
}
