import {
  ArrowDownRight,
  Receipt,
  Sprout,
  Wallet,
  Weight,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { CashExpenseCategory, FinancialTotals, Money, WorkspaceSnapshot } from '@sawit/shared';
import { number, rupiah } from '../../../lib/format';

type SummaryView = 'dashboard' | 'harvest' | 'harvestExpense' | CashExpenseCategory;
type Card = {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  unit?: string;
  primary?: boolean;
};
export function DashboardStats({
  totals,
  categoryTotals,
  view,
  loading,
  harvestCount,
  draftCount,
}: {
  totals: FinancialTotals;
  categoryTotals?: WorkspaceSnapshot['categoryTotals'];
  view: SummaryView;
  loading: boolean;
  harvestCount: number;
  draftCount: number;
}) {
  const money = (
    label: string,
    value: Money,
    note: string,
    icon: LucideIcon = Receipt,
    primary = false,
  ): Card => ({ label, value: rupiah(value), note, icon, primary });
  const category = (key: CashExpenseCategory | 'harvest') => categoryTotals?.[key] ?? 0;
  let cards: Card[];
  if (view === 'dashboard')
    cards = [
      money('Cash tersedia', totals.netIncome, 'Setelah pengeluaran dan alokasi', Wallet, true),
      money(
        'Pendapatan utama',
        totals.income,
        `${totals.count} SPK dari ${harvestCount} panen`,
        Wallet,
      ),
      money(
        'Pengeluaran dan alokasi',
        totals.expenses,
        `${totals.expenseCount} catatan biaya dan alokasi cash`,
      ),
      money('Pengeluaran lainnya', category('other'), 'Pengeluaran lainnya yang dipublikasikan'),
      money('Tabungan', category('savings'), 'Total alokasi tabungan yang dipublikasikan', Sprout),
      money(
        'Future Investment Goals',
        category('investment'),
        'Total alokasi investasi yang dipublikasikan',
        TrendingUp,
      ),
    ];
  else if (view === 'harvest')
    cards = [
      {
        label: 'Berat bersih',
        value: number(totals.net),
        unit: 'kg',
        note: 'Berat yang dibayarkan perusahaan',
        icon: Weight,
      },
      {
        label: 'Total potongan',
        value: number(totals.deduction),
        unit: 'kg',
        note: `${number(totals.deductionPercent)}% dari berat muatan`,
        icon: ArrowDownRight,
      },
      {
        label: 'Jumlah janjang',
        value: number(totals.bunches, 0),
        unit: 'janjang',
        note: draftCount ? `${draftCount} SPK masih dalam draft` : 'Tercatat dalam SPK publikasi',
        icon: Sprout,
      },
    ];
  else {
    const key = view === 'harvestExpense' ? 'harvest' : view;
    const labels = {
      harvest: 'Total pengeluaran panen',
      garden: 'Total pengeluaran kebun',
      other: 'Total pengeluaran lainnya',
      savings: 'Total Tabungan',
      investment: 'Total Future Investment Goals',
      savings_expense: 'Total pengeluaran Tabungan',
      investment_expense: 'Total pengeluaran Future Investment Goals',
    };
    cards = [
      money(
        labels[key],
        category(key),
        key === 'savings' || key === 'investment'
          ? 'Alokasi yang dipublikasikan dalam periode ini'
          : 'Pengeluaran yang dipublikasikan dalam periode ini',
      ),
    ];
  }
  return (
    <section
      className={`stats-grid stats-grid-financial ${cards.length === 1 ? 'stats-grid-single' : ''}`}
      aria-label="Ringkasan menu"
    >
      {cards.map(({ label, value, note, icon: Icon, unit, primary }) => (
        <article
          key={label}
          className={`stat-card ${unit ? '' : 'money-card'} ${primary ? 'income-card' : ''}`}
        >
          <div className="stat-label">
            {label}
            <span className="stat-icon">
              <Icon size={19} />
            </span>
          </div>
          <strong className="stat-value">
            {loading ? '…' : value}
            {unit && <small>{unit}</small>}
          </strong>
          <div className="stat-foot">{note}</div>
        </article>
      ))}
    </section>
  );
}
