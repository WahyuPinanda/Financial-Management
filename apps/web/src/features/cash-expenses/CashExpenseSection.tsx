import { useState } from 'react';
import { Plus, Pencil, LockKeyhole, Receipt } from 'lucide-react';
import {
  canEdit,
  sumPublishedCashExpenses,
  type CashExpense,
  type CashExpenseCategory,
  type CashExpenseInput,
} from '@sawit/shared';
import { date, dateTime, rupiah } from '../../lib/format';
import { CashExpenseForm } from './CashExpenseForm';

export function CashExpenseSection({
  category,
  expenses,
  loading,
  preview,
  onSave,
}: {
  category: CashExpenseCategory;
  expenses: CashExpense[];
  loading: boolean;
  preview: boolean;
  onSave: (input: CashExpenseInput, id?: string) => Promise<void>;
}) {
  const [editor, setEditor] = useState<{ existing?: CashExpense } | null>(null);
  const rows = expenses.filter((expense) => expense.category === category);
  const title = category === 'garden' ? 'Pengeluaran kebun' : 'Pengeluaran lainnya';
  return (
    <>
      <section className="panel cash-expense-panel">
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            <p>
              {rows.length} catatan · Total publikasi {rupiah(sumPublishedCashExpenses(rows))}
            </p>
          </div>
          <button
            className="button primary compact"
            disabled={loading}
            onClick={() => setEditor({})}
          >
            <Plus size={17} /> Tambah pengeluaran
          </button>
        </div>
        {loading ? (
          <div className="empty-state" role="status">
            Memuat pengeluaran…
          </div>
        ) : rows.length ? (
          <div className="cash-expense-list">
            {rows.map((expense) => {
              const editable = expense.editable && canEdit(expense.published_at);
              return (
                <article className="cash-expense-card" key={expense.id}>
                  <header>
                    <div>
                      <strong>{date(expense.expense_date)}</strong>
                      <span
                        className={`badge ${expense.published_at ? (editable ? 'published' : 'locked') : 'draft'}`}
                      >
                        {expense.published_at ? (editable ? 'Publikasi' : 'Terkunci') : 'Draft'}
                      </span>
                    </div>
                    <button
                      className="button secondary compact"
                      disabled={!editable}
                      title={
                        expense.edit_deadline
                          ? `Batas edit ${dateTime(expense.edit_deadline)} WITA`
                          : 'Draft dapat diedit'
                      }
                      onClick={() => setEditor({ existing: expense })}
                    >
                      {editable ? <Pencil size={15} /> : <LockKeyhole size={15} />}
                      {editable ? 'Ubah' : 'Terkunci'}
                    </button>
                  </header>
                  <dl>
                    {expense.items.map((item, index) => (
                      <div key={index}>
                        <dt>{item.description}</dt>
                        <dd>{rupiah(item.amount)}</dd>
                      </div>
                    ))}
                  </dl>
                  <footer>
                    <span>Total pengeluaran</span>
                    <strong>{rupiah(expense.total_expense)}</strong>
                  </footer>
                  {expense.edit_deadline && (
                    <p className="cash-deadline">
                      {editable ? 'Dapat diedit sampai' : 'Terkunci sejak'}{' '}
                      {dateTime(expense.edit_deadline)} WITA
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <Receipt size={32} />
            <h3>Belum ada pengeluaran</h3>
            <p>Tambahkan biaya dan rincian untuk memperbarui cash utama.</p>
          </div>
        )}
      </section>
      {editor && (
        <CashExpenseForm
          category={category}
          existing={editor.existing}
          preview={preview}
          onClose={() => setEditor(null)}
          onSave={(input) => onSave(input, editor.existing?.id)}
        />
      )}
    </>
  );
}
