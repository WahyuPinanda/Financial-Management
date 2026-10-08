import { useState } from 'react';
import { Plus, Pencil, LockKeyhole, Receipt } from 'lucide-react';
import {
  canEdit,
  type CashExpense,
  type CashExpenseCategory,
  type CashExpenseInput,
  type Money,
  type FinanceAccount,
} from '@sawit/shared';
import { date, dateTime, rupiah } from '../../lib/format';
import { cashCategories } from './categories';
import { CashExpenseForm } from './CashExpenseForm';

export function CashExpenseSection({
  category,
  expenses,
  loading,
  preview,
  onSave,
  total,
  count,
  accounts = [],
}: {
  category: CashExpenseCategory;
  expenses: CashExpense[];
  loading: boolean;
  preview: boolean;
  onSave: (
    input: CashExpenseInput,
    id: string | undefined,
    version: number | undefined,
    requestKey: string,
  ) => Promise<void>;
  total: Money;
  count: number;
  accounts?: FinanceAccount[];
}) {
  const [editor, setEditor] = useState<{ existing?: CashExpense } | null>(null);
  const rows = expenses.filter((expense) => expense.category === category);
  const { title, allocation, income } = cashCategories[category];
  const additional = category === 'savings_expense' || category === 'investment_expense';
  return (
    <>
      <section className="panel cash-expense-panel">
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            <p>
              {count} catatan · Total publikasi {rupiah(total)}
            </p>
            {additional && (
              <p>
                {accounts.length
                  ? 'Belanja mengurangi rekening dana, tanpa memotong cash utama lagi.'
                  : 'Publikasi pengeluaran ini juga mengurangi cash utama.'}{' '}
                Dapat diedit selama 7 × 24 jam sejak publikasi.
              </p>
            )}
          </div>
          <button
            className="button primary compact"
            disabled={loading}
            onClick={() => setEditor({})}
          >
            <Plus size={17} />{' '}
            {income
              ? 'Tambah pemasukan'
              : allocation
                ? 'Tambah alokasi'
                : additional
                  ? `Tambah ${title}`
                  : 'Tambah pengeluaran'}
          </button>
        </div>
        {loading ? (
          <div className="empty-state" role="status">
            Memuat {income ? 'pemasukan' : 'pengeluaran'}…
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
                    <span>
                      {income
                        ? 'Total pemasukan'
                        : allocation
                          ? 'Total alokasi'
                          : 'Total pengeluaran'}
                    </span>
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
            <h3>
              {income
                ? 'Belum ada pemasukan'
                : allocation
                  ? 'Belum ada alokasi'
                  : 'Belum ada pengeluaran'}
            </h3>
            <p>
              {income
                ? 'Tambahkan pemasukan dan rincian untuk menambah cash utama.'
                : 'Tambahkan biaya dan rincian untuk memperbarui cash utama.'}
            </p>
          </div>
        )}
      </section>
      {editor && (
        <CashExpenseForm
          category={category}
          accounts={accounts}
          existing={editor.existing}
          preview={preview}
          onClose={() => setEditor(null)}
          onSave={(input, requestKey) =>
            onSave(input, editor.existing?.id, editor.existing?.version, requestKey)
          }
        />
      )}
    </>
  );
}
