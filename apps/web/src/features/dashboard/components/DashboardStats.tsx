import { ArrowDownRight, ArrowUpRight, Receipt, Sprout, Wallet, Weight } from 'lucide-react';
import type { summarize } from '@sawit/shared';
import { number, rupiah } from '../../../lib/format';

export function DashboardStats({
  totals,
  loading,
  harvestCount,
  draftCount,
}: {
  totals: ReturnType<typeof summarize>;
  loading: boolean;
  harvestCount: number;
  draftCount: number;
}) {
  return (
    <section className="stats-grid stats-grid-financial" aria-label="Statistik keuangan panen">
      <article className="stat-card income-card">
        <div className="stat-label">
          Pendapatan bersih
          <span className="stat-icon">
            <Wallet size={19} />
          </span>
        </div>
        <strong className="stat-value">{loading ? '…' : rupiah(totals.netIncome)}</strong>
        <div className="stat-foot">
          <span className="income-pill">
            <ArrowUpRight size={13} />
            {totals.count} SPK
          </span>
          <span>setelah pengeluaran</span>
        </div>
      </article>
      <article className="stat-card">
        <div className="stat-label">
          Pendapatan utama
          <span className="stat-icon">
            <Wallet size={19} />
          </span>
        </div>
        <strong className="stat-value">{loading ? '…' : rupiah(totals.income)}</strong>
        <div className="stat-foot">
          {totals.count} SPK dari {harvestCount} panen
        </div>
      </article>
      <article className="stat-card">
        <div className="stat-label">
          Total pengeluaran
          <span className="stat-icon amber">
            <Receipt size={19} />
          </span>
        </div>
        <strong className="stat-value">{loading ? '…' : rupiah(totals.expenses)}</strong>
        <div className="stat-foot">{totals.expenseCount} catatan panen dan pengeluaran cash</div>
      </article>
      <article className="stat-card">
        <div className="stat-label">
          Berat bersih
          <span className="stat-icon">
            <Weight size={19} />
          </span>
        </div>
        <strong className="stat-value">
          {loading ? '…' : number(totals.net)}
          <small>kg</small>
        </strong>
        <div className="stat-foot">Berat yang dibayarkan perusahaan</div>
      </article>
      <article className="stat-card">
        <div className="stat-label">
          Total potongan
          <span className="stat-icon amber">
            <ArrowDownRight size={19} />
          </span>
        </div>
        <strong className="stat-value">
          {loading ? '…' : number(totals.deduction)}
          <small>kg</small>
        </strong>
        <div className="stat-foot">
          <span className="deduction-pill">{number(totals.deductionPercent)}%</span>
          <span>dari berat muatan</span>
        </div>
      </article>
      <article className="stat-card">
        <div className="stat-label">
          Jumlah janjang
          <span className="stat-icon">
            <Sprout size={19} />
          </span>
        </div>
        <strong className="stat-value">
          {loading ? '…' : number(totals.bunches, 0)}
          <small>janjang</small>
        </strong>
        <div className="stat-foot">
          {draftCount ? `${draftCount} SPK masih dalam draft` : 'Tercatat dalam SPK publikasi'}
        </div>
      </article>
    </section>
  );
}
