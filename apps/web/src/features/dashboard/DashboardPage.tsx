import { DashboardStats } from './components/DashboardStats';
import { SpkTable } from '../harvests/SpkTable';
import { exportCsv } from '../harvests/utils/exportCsv';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Download,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Sprout,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  summarize,
  type Harvest,
  type HarvestInput,
  type Spk,
  type SpkInput,
  type ExpenseInput,
  type HarvestExpense,
  type CashExpenseInput,
  type CashExpenseCategory,
  type PageKind,
} from '@sawit/shared';
import { Brand } from '../../components/Brand';
import { useAuth } from '../auth/AuthProvider';
import { HarvestForm } from '../harvests/HarvestForm';
import { SpkForm } from '../harvests/SpkForm';
import { ExpenseForm } from '../expenses/ExpenseForm';
import { ExpenseSection } from '../expenses/ExpenseSection';
import { useWorkspace } from '../workspace/useWorkspace';
import { firstPages, type PageCursors } from '../workspace/types';
import { Pager } from '../../components/Pager';
import { ApiError } from '../../lib/api';
import { harvestApi } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { date, number, rupiah, today } from '../../lib/format';
import { cashExpenseApi } from '../cash-expenses/api';
import { CashExpenseSection } from '../cash-expenses/CashExpenseSection';
import { CashFlowAnalysis } from '../analytics/CashFlowAnalysis';

export function DashboardPage({ preview = false }: { preview?: boolean }) {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname.replace(/^\/preview/, '') || '/dashboard';
  const records = path === '/panen';
  const expensePage = path === '/pengeluaran';
  const gardenPage = path === '/pengeluaran-kebun';
  const otherPage = path === '/pengeluaran-lainnya';
  const analysisPage = path === '/analisis';
  const savingsPage = path === '/tabungan';
  const investmentPage = path === '/future-investment-goals';
  const cashCategory: CashExpenseCategory = investmentPage
    ? 'investment'
    : savingsPage
      ? 'savings'
      : otherPage
        ? 'other'
        : 'garden';
  const cashPage = gardenPage || otherPage || savingsPage || investmentPage;
  const allocationExpenseCategory: CashExpenseCategory = savingsPage
    ? 'savings_expense'
    : 'investment_expense';
  const overview =
    !records &&
    !expensePage &&
    !gardenPage &&
    !otherPage &&
    !analysisPage &&
    !savingsPage &&
    !investmentPage;
  const pageTitle = investmentPage
    ? 'Future Investment Goals'
    : savingsPage
      ? 'Tabungan'
      : analysisPage
        ? 'Analisis keuangan'
        : otherPage
          ? 'Pengeluaran lainnya'
          : gardenPage
            ? 'Pengeluaran kebun'
            : expensePage
              ? 'Pengeluaran panen'
              : records
                ? 'Pendapatan panen'
                : 'Dashboard';
  const pageLink = (route: string) =>
    preview ? `/preview${route === '/dashboard' ? '' : route}` : route;
  const [month, setMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeId, setActiveId] = useState('');
  const [cursors, setCursors] = useState<PageCursors>(firstPages);
  const [analysisYear, setAnalysisYear] = useState(Number(today().slice(0, 4)));
  const [analysisPeriod, setAnalysisPeriod] = useState<'month' | 'year'>('month');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editor, setEditor] = useState<{ harvest: Harvest; spk?: Spk } | null>(null);
  const [expenseEditor, setExpenseEditor] = useState<{
    harvest: Harvest;
    expense?: HarvestExpense;
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search);
      setCursors(firstPages());
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setCursors(firstPages());
  }, [path]);
  const {
    data,
    loading: reading,
    error,
    refresh: load,
  } = useWorkspace(
    {
      view: cashPage ? cashCategory : path.slice(1),
      month,
      search: appliedSearch,
      year: analysisYear,
      period: analysisPeriod,
      harvest_id: activeId || undefined,
      harvest_after: cursors.harvest.at(-1),
      spk_after: cursors.spk.at(-1),
      expense_after: cursors.expense.at(-1),
      cash_after: cursors.cash.at(-1),
      allocation_expense_after: cursors.allocationExpense.at(-1),
    },
    preview,
  );
  const loading = reading || !data;
  const totals = data?.totals ?? summarize([]);
  const activeTotals = data?.activeTotals ?? summarize([]);
  const harvests = data?.harvests ?? [];
  const activeHarvest = data?.activeHarvest ?? undefined;
  const visible =
    activeHarvest && !harvests.some((harvest) => harvest.id === activeHarvest.id)
      ? [activeHarvest, ...harvests]
      : harvests;
  const filteredCashExpenses = data?.cashExpenses ?? [];
  const months = data?.months ?? [];
  const chart = [...(data?.chart ?? [])].reverse();
  const maxIncome = Math.max(1, ...chart.map((harvest) => Number(harvest.total)));
  const draftCount = data?.draftCount ?? 0;
  function turnPage(kind: PageKind, next: boolean) {
    const rows =
      kind === 'harvest'
        ? harvests
        : kind === 'spk'
          ? activeHarvest?.spks
          : kind === 'expense'
            ? activeHarvest?.expenses
            : kind === 'allocationExpense'
              ? data?.allocationExpenses
              : filteredCashExpenses;
    const last = rows?.at(-1)?.id;
    setCursors((previous) => ({
      ...previous,
      [kind]: next && last ? [...previous[kind], last] : previous[kind].slice(0, -1),
    }));
  }
  function pager(kind: PageKind) {
    return (
      <Pager
        count={data?.pages[kind].count ?? 0}
        page={cursors[kind].length}
        hasNext={data?.pages[kind].hasNext ?? false}
        disabled={loading}
        onPrevious={() => turnPage(kind, false)}
        onNext={() => turnPage(kind, true)}
      />
    );
  }
  async function persist<T>(operation: Promise<T>): Promise<T> {
    try {
      const result = await operation;
      const channel = new BroadcastChannel('cash-flow-updates');
      channel.postMessage('refresh');
      channel.close();
      const fresh = await load();
      setNotice(
        fresh
          ? 'Tersimpan. Cash utama dan analisis sudah diperbarui dari database.'
          : 'Data tersimpan, tetapi ringkasan belum dapat dimuat. Klik Coba lagi untuk membaca saldo terbaru.',
      );
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await load();
      throw error;
    }
  }
  const name = session?.user.email?.split('@')[0] ?? 'Pemilik kebun';

  async function createHarvest(input: HarvestInput, key: string) {
    const result = await persist(harvestApi.create(input, key));
    setMonth('all');
    setSearch('');
    setCursors(firstPages());
    setActiveId(result.data.id);
  }
  async function saveSpk(input: SpkInput, key: string) {
    if (!editor) return;
    await persist(
      editor.spk
        ? harvestApi.updateSpk(editor.spk.id, input, editor.spk.version, key)
        : harvestApi.createSpk(editor.harvest.id, input, key),
    );
  }
  async function saveAllocationExpense(
    input: CashExpenseInput,
    id: string | undefined,
    version: number | undefined,
    key: string,
  ) {
    await persist(cashExpenseApi.save(allocationExpenseCategory, input, key, id, version));
  }

  async function logout() {
    if (!supabase || loggingOut) return;
    setLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice('Belum berhasil keluar. Silakan coba lagi.');
      setLoggingOut(false);
      return;
    }
    navigate('/login', { replace: true });
  }

  async function saveExpense(input: ExpenseInput, key: string) {
    if (!expenseEditor) return;
    await persist(
      expenseEditor.expense
        ? harvestApi.updateExpense(
            expenseEditor.expense.id,
            input,
            expenseEditor.expense.version,
            key,
          )
        : harvestApi.createExpense(expenseEditor.harvest.id, input, key),
    );
  }
  async function saveCashExpense(
    input: CashExpenseInput,
    id: string | undefined,
    version: number | undefined,
    key: string,
  ) {
    await persist(cashExpenseApi.save(cashCategory, input, key, id, version));
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Brand light />
        <span className="sidebar-caption">RUANG KERJA</span>
        <nav aria-label="Navigasi utama">
          <Link className={overview ? 'nav-link active' : 'nav-link'} to={pageLink('/dashboard')}>
            <LayoutDashboard size={19} />
            Dashboard
          </Link>
          {
            <Link className={records ? 'nav-link active' : 'nav-link'} to={pageLink('/panen')}>
              <ClipboardList size={19} />
              Pendapatan panen
            </Link>
          }
          {
            <Link
              className={expensePage ? 'nav-link active' : 'nav-link'}
              to={pageLink('/pengeluaran')}
            >
              <Receipt size={19} />
              Pengeluaran panen
            </Link>
          }
          <Link
            className={gardenPage ? 'nav-link active' : 'nav-link'}
            to={pageLink('/pengeluaran-kebun')}
          >
            <Sprout size={19} />
            Pengeluaran kebun
          </Link>
          <Link
            className={otherPage ? 'nav-link active' : 'nav-link'}
            to={pageLink('/pengeluaran-lainnya')}
          >
            <Receipt size={19} />
            Pengeluaran lainnya
          </Link>
          <Link
            className={analysisPage ? 'nav-link active' : 'nav-link'}
            to={pageLink('/analisis')}
          >
            <TrendingUp size={19} />
            Analisis keuangan
          </Link>
          <Link className={savingsPage ? 'nav-link active' : 'nav-link'} to={pageLink('/tabungan')}>
            <Sprout size={19} />
            Tabungan
          </Link>
          <Link
            className={investmentPage ? 'nav-link active' : 'nav-link'}
            to={pageLink('/future-investment-goals')}
          >
            <TrendingUp size={19} />
            Future Investment Goals
          </Link>
        </nav>
        <div className="sidebar-tip">
          <Sprout size={27} />
          <strong>
            Panen tercatat,
            <br />
            rencana lebih matang.
          </strong>
          <p>Mulai dari satu SPK untuk memahami hasil kebun Anda.</p>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">{name.charAt(0).toUpperCase()}</span>
          <div>
            <strong>{preview ? 'Akun pratinjau' : name}</strong>
            <small>Pemilik kebun</small>
          </div>
          {!preview && (
            <button aria-label="Keluar" title="Keluar" onClick={logout} disabled={loggingOut}>
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Ruang kerja <ChevronRight size={14} />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className="status-dot" />
            {preview ? 'Mode pratinjau' : 'Kebun pribadi'}
            <span className="topbar-avatar">{name.charAt(0).toUpperCase()}</span>
          </div>
        </header>
        <main className="dashboard-main">
          {preview && (
            <div className="preview-banner">
              <Leaf size={17} />
              <span>
                <strong>Pratinjau dashboard</strong> · Data contoh, tidak tersimpan. Login
                diperlukan untuk data kebun Anda.
              </span>
              <Link to="/login">
                Kembali ke login <ArrowUpRight size={15} />
              </Link>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">KEUANGAN KEBUN ANDA</span>
              <h1>
                {!overview ? pageTitle : 'Ringkasan kebun'}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {investmentPage
                  ? 'Alokasikan cash untuk tujuan investasi mendatang, seperti replanting.'
                  : savingsPage
                    ? 'Sisihkan cash untuk kebutuhan mendatang, seperti pembelian pupuk.'
                    : analysisPage
                      ? 'Lihat perubahan cash flow bulanan dan tahunan dalam persentase.'
                      : otherPage
                        ? 'Catat kebutuhan lainnya dengan keterangan dan jumlah Rupiah.'
                        : gardenPage
                          ? 'Catat semprot, bensin, dan biaya perawatan kebun lainnya.'
                          : expensePage
                            ? 'Catat biaya panen untuk menghitung pendapatan bersih.'
                            : records
                              ? 'Semua catatan SPK dalam satu tempat.'
                              : 'Hasil panen yang tercatat, keputusan yang lebih tepat.'}
              </p>
            </div>
            {records && (
              <button
                className="button primary"
                onClick={() =>
                  preview
                    ? setNotice('Pratinjau memakai data contoh. Login untuk membuat panen baru.')
                    : setCreateOpen(true)
                }
                disabled={loading}
              >
                <Plus size={18} />
                Buat panen baru
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button className="text-button" onClick={() => void load()}>
                <RefreshCw size={15} />
                Coba lagi
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Tutup pemberitahuan"
                onClick={() => setNotice('')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {!analysisPage && (
            <>
              <div className="section-bar">
                <div className="section-title">
                  <span className="status-dot" />
                  <strong>
                    {overview
                      ? 'Ikhtisar cash flow'
                      : records
                        ? 'Ikhtisar panen'
                        : 'Ikhtisar periode'}
                  </strong>
                  <span>Hanya catatan yang dipublikasikan</span>
                </div>
                <label className="period-filter">
                  <CalendarDays size={16} />
                  <select
                    aria-label="Filter bulan panen"
                    value={month}
                    onChange={(e) => {
                      setMonth(e.target.value);
                      setActiveId('');
                    }}
                  >
                    <option value="all">Semua periode</option>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {new Intl.DateTimeFormat('id-ID', {
                          month: 'long',
                          year: 'numeric',
                        }).format(new Date(`${m}-01T12:00:00`))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <DashboardStats
                totals={totals}
                categoryTotals={data?.categoryTotals}
                view={
                  overview
                    ? 'dashboard'
                    : records
                      ? 'harvest'
                      : expensePage
                        ? 'harvestExpense'
                        : cashCategory
                }
                loading={loading}
                harvestCount={data?.harvestCount ?? 0}
                draftCount={draftCount}
              />
            </>
          )}
          {overview && (
            <section className="overview-grid">
              <article className="panel chart-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Pendapatan per panen</h2>
                    <p>Perbandingan hingga 6 panen terakhir</p>
                  </div>
                  <span className="chart-legend">
                    <i />
                    Pendapatan
                  </span>
                </div>
                {pager('harvest')}
                {loading ? (
                  <div className="chart-empty">Memuat ringkasan…</div>
                ) : chart.length ? (
                  <div className="bar-chart">
                    <div className="chart-axis">
                      <span>{rupiah(maxIncome)}</span>
                      <span>{rupiah(maxIncome / 2)}</span>
                      <span>Rp 0</span>
                    </div>
                    <div className="chart-plot">
                      {chart.map((h) => (
                        <button
                          className="chart-column"
                          key={h.id}
                          title={`${h.name}: ${rupiah(h.total)}`}
                          onClick={() => {
                            setActiveId(h.id);
                            setSearch('');
                            navigate(pageLink('/panen'));
                          }}
                          aria-label={`Lihat ${h.name}, pendapatan ${rupiah(h.total)}`}
                        >
                          <div className="bar-track">
                            <div
                              className={`chart-bar ${h.id === activeHarvest?.id ? 'selected' : ''}`}
                              style={{
                                height: `${Number(h.total) > 0 ? Math.max(2, (Number(h.total) / maxIncome) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <span>
                            {new Intl.DateTimeFormat('id-ID', {
                              day: 'numeric',
                              month: 'short',
                            }).format(new Date(`${h.harvest_date}T12:00:00`))}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="chart-empty">
                    <Sprout size={32} />
                    <p>Grafik akan muncul setelah SPK pertama dipublikasikan.</p>
                  </div>
                )}
              </article>
              <article className="panel insight-panel">
                <div className="insight-icon">
                  <Leaf size={22} />
                </div>
                <span className="eyebrow">CATATAN PANEN</span>
                <h2>
                  Kenali hasil
                  <br />
                  setiap perjalanan.
                </h2>
                <p>
                  {totals.count ? (
                    <>
                      Rata-rata harga dibayar{' '}
                      <strong>
                        {rupiah(totals.net ? Number(totals.income) / totals.net : 0)}/kg
                      </strong>{' '}
                      dari {totals.count} SPK dalam periode ini.
                    </>
                  ) : (
                    'Catat timbangan dan harga harian. Cash Flow menghitung pendapatan Anda secara otomatis.'
                  )}
                </p>
                <div className="insight-divider" />
                <div className="insight-lock">
                  <LockKeyhole size={18} />
                  <span>
                    SPK terkunci setelah 7 hari
                    <br />
                    <small>Perhitungan tersimpan konsisten.</small>
                  </span>
                </div>
              </article>
            </section>
          )}
          {(overview || analysisPage) && (
            <CashFlowAnalysis
              rows={data?.analysis ?? []}
              years={data?.years ?? [analysisYear]}
              year={analysisYear}
              period={analysisPeriod}
              setYear={setAnalysisYear}
              setPeriod={setAnalysisPeriod}
              hasEvents={data?.hasEvents ?? false}
              loading={loading}
              compact={overview}
            />
          )}
          {(records || expensePage) && (
            <section className="panel harvest-panel">
              <div className="panel-heading">
                <div>
                  <h2>Catatan panen</h2>
                  <p>Pilih kelompok panen untuk melihat rincian SPK.</p>
                </div>
                <button
                  className="button secondary compact"
                  disabled={!activeHarvest?.spks.length || loading}
                  onClick={() => exportCsv(activeHarvest ? [activeHarvest] : [])}
                >
                  <Download size={16} />
                  Ekspor SPK halaman ini
                </button>
              </div>
              <div className="table-toolbar">
                <label className="search-input">
                  <Search size={17} />
                  <input
                    placeholder="Cari panen atau perusahaan…"
                    aria-label="Cari panen atau perusahaan"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  className="harvest-select"
                  aria-label="Pilih kelompok panen"
                  value={activeHarvest?.id ?? ''}
                  onChange={(e) => {
                    setActiveId(e.target.value);
                    setCursors((current) => ({
                      ...current,
                      spk: [undefined],
                      expense: [undefined],
                    }));
                  }}
                >
                  {!visible.length && <option value="">Belum ada panen</option>}
                  {visible.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} · {date(h.harvest_date)}
                    </option>
                  ))}
                </select>
              </div>
              {loading ? (
                <div className="empty-state" role="status">
                  <RefreshCw size={26} />
                  <h3>Memuat catatan panen…</h3>
                </div>
              ) : activeHarvest ? (
                <>
                  <div className="harvest-summary">
                    <div>
                      <span className="harvest-icon">
                        <ClipboardList size={21} />
                      </span>
                      <div>
                        <h3>{activeHarvest.name}</h3>
                        <p>
                          {date(activeHarvest.harvest_date)} <span>·</span>{' '}
                          {data?.pages.spk.count ?? 0} SPK
                        </p>
                      </div>
                    </div>
                    {records && (
                      <button
                        className="button secondary compact"
                        onClick={() => setEditor({ harvest: activeHarvest })}
                      >
                        <Plus size={16} />
                        Tambah SPK
                      </button>
                    )}
                  </div>
                  {!expensePage &&
                    (activeHarvest.spks.length ? (
                      <SpkTable
                        spks={activeHarvest.spks}
                        onEdit={(spk) => setEditor({ harvest: activeHarvest, spk })}
                      />
                    ) : (
                      <div className="empty-state small">
                        <ClipboardList size={29} />
                        <h3>Belum ada SPK di panen ini</h3>
                        <p>Tambahkan SPK pertama untuk mulai menghitung pendapatan.</p>
                      </div>
                    ))}
                  {records && pager('spk')}
                  <div className="harvest-total">
                    <div>
                      <span>PENDAPATAN UTAMA PANEN INI</span>
                      <p>
                        {activeTotals.count} SPK publikasi · {number(activeTotals.net)} kg bersih ·
                        potongan {number(activeTotals.deductionPercent)}%
                      </p>
                    </div>
                    <strong>{rupiah(activeTotals.income)}</strong>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Sprout size={38} />
                  <h3>
                    {harvests.length
                      ? 'Tidak ada panen yang cocok'
                      : 'Mulai catat hasil kebun Anda'}
                  </h3>
                  <p>
                    {harvests.length
                      ? 'Coba ganti periode atau kata pencarian.'
                      : 'Buat kelompok panen, kemudian isi SPK dari perusahaan.'}
                  </p>
                  {!harvests.length && !error && (
                    <button className="button primary" onClick={() => setCreateOpen(true)}>
                      <Plus size={16} />
                      Buat panen pertama
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
          {expensePage && !loading && activeHarvest && (
            <>
              <ExpenseSection
                harvest={activeHarvest}
                totals={activeTotals}
                onAdd={() => setExpenseEditor({ harvest: activeHarvest })}
                onEdit={(expense) => setExpenseEditor({ harvest: activeHarvest, expense })}
              />
              {pager('expense')}
            </>
          )}
          {cashPage && (
            <>
              <CashExpenseSection
                key={cashCategory}
                category={cashCategory}
                expenses={filteredCashExpenses}
                loading={loading}
                preview={preview}
                onSave={saveCashExpense}
                total={data?.categoryTotal ?? 0}
                count={data?.pages.cash.count ?? 0}
              />
              {pager('cash')}
              {(savingsPage || investmentPage) && (
                <>
                  <CashExpenseSection
                    key={`${cashCategory}_expense`}
                    category={allocationExpenseCategory}
                    expenses={data?.allocationExpenses ?? []}
                    loading={loading}
                    preview={preview}
                    onSave={saveAllocationExpense}
                    total={data?.allocationExpenseTotal ?? 0}
                    count={data?.pages.allocationExpense.count ?? 0}
                  />
                  {pager('allocationExpense')}
                </>
              )}
            </>
          )}
          <footer className="dashboard-footer">
            <Brand />
            <span>Setiap hasil, tercatat dengan baik.</span>
            <span>
              <ShieldCheck size={14} />
              Data pribadi Anda
            </span>
          </footer>
        </main>
      </div>
      {createOpen && <HarvestForm onSave={createHarvest} onClose={() => setCreateOpen(false)} />}
      {editor && (
        <SpkForm
          existing={editor.spk}
          harvestName={editor.harvest.name}
          onSave={saveSpk}
          onClose={() => setEditor(null)}
          preview={preview}
        />
      )}
      {expenseEditor && (
        <ExpenseForm
          existing={expenseEditor.expense}
          harvestName={expenseEditor.harvest.name}
          onSave={saveExpense}
          onClose={() => setExpenseEditor(null)}
          preview={preview}
        />
      )}
    </div>
  );
}
