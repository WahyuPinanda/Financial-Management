import { TrendingUp, TrendingDown, CalendarDays } from 'lucide-react';
import type { CashFlowPeriod } from '@sawit/shared';
import { number, rupiah } from '../../lib/format';

function periodLabel(key: string) {
  return key.length === 4
    ? key
    : new Intl.DateTimeFormat('id-ID', { month: 'short', year: 'numeric' }).format(
        new Date(`${key}-01T12:00:00`),
      );
}
function percentage(value: number | null) {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${number(value, 2)}%`;
}

export function GrowthChart({ rows }: { rows: CashFlowPeriod[] }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.growthPercent ?? 0)));
  return (
    <div
      className="growth-scroll"
      role="region"
      aria-label="Grafik persentase pertumbuhan cash flow"
      tabIndex={0}
    >
      <div className="growth-chart">
        <div className="growth-axis">
          <span>+{number(max, 1)}%</span>
          <span>0%</span>
          <span>−{number(max, 1)}%</span>
        </div>
        <div className="growth-columns">
          {rows.map((row) => (
            <div
              className="growth-column"
              key={row.key}
              title={`${periodLabel(row.key)}: ${percentage(row.growthPercent)}, cash flow ${rupiah(row.net)}`}
            >
              <div className="growth-track">
                <div
                  className={`growth-bar ${(row.growthPercent ?? 0) < 0 ? 'negative' : 'positive'}`}
                  style={{ height: `${(Math.abs(row.growthPercent ?? 0) / max) * 45}%` }}
                />
                <span className={`growth-value ${(row.growthPercent ?? 0) < 0 ? 'negative' : ''}`}>
                  {percentage(row.growthPercent)}
                </span>
              </div>
              <span className="growth-label">
                {row.key.length === 4 ? row.key : periodLabel(row.key).split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CashFlowAnalysis({
  rows,
  years,
  year,
  period,
  setYear,
  setPeriod,
  hasEvents,
  loading,
  compact = false,
}: {
  rows: CashFlowPeriod[];
  years: number[];
  year: number;
  period: 'month' | 'year';
  setYear: (year: number) => void;
  setPeriod: (period: 'month' | 'year') => void;
  hasEvents: boolean;
  loading: boolean;
  compact?: boolean;
}) {
  const last = rows[rows.length - 1];
  return (
    <section className={`panel cash-analysis ${compact ? 'compact-analysis' : ''}`}>
      <div className="panel-heading">
        <div>
          <h2>Pertumbuhan cash flow</h2>
          <p>
            {period === 'month'
              ? `Perubahan bersih bulanan · ${year}`
              : `Perubahan bersih tahunan · hingga ${year}`}
          </p>
        </div>
        <div className="analysis-controls">
          <div className="period-toggle" role="group" aria-label="Periode analisis">
            <button
              className={period === 'month' ? 'selected' : ''}
              aria-pressed={period === 'month'}
              onClick={() => setPeriod('month')}
            >
              Bulanan
            </button>
            <button
              className={period === 'year' ? 'selected' : ''}
              aria-pressed={period === 'year'}
              onClick={() => setPeriod('year')}
            >
              Tahunan
            </button>
          </div>
          <label className="period-filter">
            <CalendarDays size={16} />
            <select
              aria-label="Tahun analisis"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {years.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {loading ? (
        <div className="chart-empty" role="status">
          Memuat analisis…
        </div>
      ) : !hasEvents ? (
        <div className="chart-empty">
          <TrendingUp size={30} />
          <p>Publikasikan pendapatan atau pengeluaran pertama untuk melihat cash flow.</p>
        </div>
      ) : (
        <>
          <div className="analysis-summary">
            <div>
              <span>Cash flow {last ? periodLabel(last.key) : ''}</span>
              <strong>{rupiah(last?.net ?? 0)}</strong>
            </div>
            <div>
              <span>Saldo cash akhir periode</span>
              <strong>{rupiah(last?.closingCash ?? 0)}</strong>
            </div>
            <div>
              <span>Pertumbuhan periode terakhir</span>
              <strong className={(last?.growthPercent ?? 0) < 0 ? 'growth-down' : 'growth-up'}>
                {(last?.growthPercent ?? 0) < 0 ? (
                  <TrendingDown size={18} />
                ) : (
                  <TrendingUp size={18} />
                )}
                {percentage(last?.growthPercent ?? null)}
              </strong>
            </div>
          </div>
          <GrowthChart rows={rows} />
          <p className="analysis-note">
            Pertumbuhan = (cash flow bersih periode ini − periode sebelumnya) ÷ nilai absolut
            periode sebelumnya × 100%. Cash flow bersih = pendapatan − seluruh pengeluaran dan
            alokasi. “—” berarti periode sebelumnya nol. Periode berjalan belum lengkap.
          </p>
          {!compact && (
            <div className="table-scroll">
              <table className="analysis-table">
                <caption className="sr-only">
                  Rincian cash flow dan pertumbuhan {period === 'month' ? 'bulanan' : 'tahunan'}
                </caption>
                <thead>
                  <tr>
                    <th>Periode</th>
                    <th>Pendapatan</th>
                    <th>Panen</th>
                    <th>Kebun</th>
                    <th>Lainnya</th>
                    <th>Tabungan</th>
                    <th>Future Investment Goals</th>
                    <th>Pengeluaran Tabungan</th>
                    <th>Pengeluaran Future Investment Goals</th>
                    <th>Pengeluaran & alokasi</th>
                    <th>Cash flow bersih</th>
                    <th>Saldo akhir</th>
                    <th>Pertumbuhan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {periodLabel(row.key)}
                        {row.partial && <small>Periode berjalan</small>}
                      </td>
                      <td>{rupiah(row.income)}</td>
                      <td>{rupiah(row.harvestExpenses)}</td>
                      <td>{rupiah(row.gardenExpenses)}</td>
                      <td>{rupiah(row.otherExpenses)}</td>
                      <td>{rupiah(row.savingsAllocations)}</td>
                      <td>{rupiah(row.investmentAllocations)}</td>
                      <td>{rupiah(row.savingsExpenses)}</td>
                      <td>{rupiah(row.investmentExpenses)}</td>
                      <td>{rupiah(row.expenses)}</td>
                      <td>{rupiah(row.net)}</td>
                      <td>{rupiah(row.closingCash)}</td>
                      <td className={(row.growthPercent ?? 0) < 0 ? 'growth-down' : 'growth-up'}>
                        {percentage(row.growthPercent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
