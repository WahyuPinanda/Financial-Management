import { DashboardStats } from './components/DashboardStats';
import { SpkTable } from '../harvests/SpkTable';
import { exportCsv } from '../harvests/utils/exportCsv';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type CashExpense,
  type CashExpenseInput,
  applyCashExpenses,
} from '@sawit/shared';
import { Brand } from '../../components/Brand';
import { useAuth } from '../auth/AuthProvider';
import { HarvestForm } from '../harvests/HarvestForm';
import { SpkForm } from '../harvests/SpkForm';
import { ExpenseForm } from '../expenses/ExpenseForm';
import { ExpenseSection } from '../expenses/ExpenseSection';
import { harvestApi } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { date, errorMessage, number, rupiah } from '../../lib/format';
import { previewHarvests } from './preview';
import { cashExpenseApi } from '../cash-expenses/api';
import { CashExpenseSection } from '../cash-expenses/CashExpenseSection';
import { previewCashExpenses } from '../cash-expenses/preview';

export function DashboardPage({ preview = false }: { preview?: boolean }) {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname.replace(/^\/preview/, '') || '/dashboard';
  const records = path === '/panen';
  const expensePage = path === '/pengeluaran';
  const gardenPage = path === '/pengeluaran-kebun';
  const otherPage = path === '/pengeluaran-lainnya';
  const overview = !records && !expensePage && !gardenPage && !otherPage;
  const pageTitle = otherPage
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
  const [cashExpenses, setCashExpenses] = useState<CashExpense[]>(() =>
    preview ? previewCashExpenses() : [],
  );
  const [harvests, setHarvests] = useState<Harvest[]>(() => (preview ? previewHarvests() : []));
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [month, setMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editor, setEditor] = useState<{ harvest: Harvest; spk?: Spk } | null>(null);
  const [expenseEditor, setExpenseEditor] = useState<{
    harvest: Harvest;
    expense?: HarvestExpense;
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(async () => {
    if (preview) return;
    setLoading(true);
    setError('');
    try {
      const [result, cashResult] = await Promise.all([harvestApi.list(), cashExpenseApi.list()]);
      setHarvests(result.data);
      setCashExpenses(cashResult.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [preview]);
  useEffect(() => {
    void load();
  }, [load]);
  // Refresh edit availability when a tab is revisited; the DB is always authoritative.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [load]);

  const months = [
    ...new Set([
      ...harvests.map((h) => h.harvest_date.slice(0, 7)),
      ...cashExpenses.map((expense) => expense.expense_date.slice(0, 7)),
    ]),
  ]
    .sort()
    .reverse();
  const filtered = useMemo(
    () => harvests.filter((h) => month === 'all' || h.harvest_date.startsWith(month)),
    [harvests, month],
  );
  const visible = filtered.filter((h) =>
    `${h.name} ${h.spks.map((s) => s.company_name).join(' ')}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const allSpks = filtered.flatMap((h) => h.spks);
  const harvestTotals = summarize(
    allSpks,
    filtered.flatMap((h) => h.expenses),
  );
  const filteredCashExpenses = cashExpenses.filter(
    (expense) => month === 'all' || expense.expense_date.startsWith(month),
  );
  const totals = applyCashExpenses(harvestTotals, filteredCashExpenses);
  const activeHarvest = visible.find((h) => h.id === activeId) ?? visible[0];
  const activeTotals = summarize(activeHarvest?.spks ?? []);
  const chart = [...filtered]
    .reverse()
    .slice(-6)
    .map((h) => ({ ...h, total: summarize(h.spks).income }));
  const maxIncome = Math.max(1, ...chart.map((h) => h.total));
  const draftCount = allSpks.filter((s) => !s.published_at).length;
  const name = session?.user.email?.split('@')[0] ?? 'Pemilik kebun';

  async function createHarvest(input: HarvestInput) {
    const result = await harvestApi.create(input);
    setHarvests((old) => [result.data, ...old]);
    setMonth('all');
    setSearch('');
    setActiveId(result.data.id);
    setNotice('Kelompok panen dibuat. Tambahkan SPK untuk mencatat pendapatan.');
  }
  async function saveSpk(input: SpkInput) {
    if (!editor) return;
    const result = editor.spk
      ? await harvestApi.updateSpk(editor.spk.id, input)
      : await harvestApi.createSpk(editor.harvest.id, input);
    setHarvests((old) =>
      old.map((h) =>
        h.id !== editor.harvest.id
          ? h
          : {
              ...h,
              spks: editor.spk
                ? h.spks.map((s) => (s.id === editor.spk!.id ? result.data : s))
                : [...h.spks, result.data],
            },
      ),
    );
    setNotice(
      input.publish
        ? 'SPK berhasil disimpan dan total pendapatan diperbarui.'
        : 'Draft SPK berhasil disimpan.',
    );
  }
  async function logout() {
    if (!supabase || loggingOut) return;
    setLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setError('Belum berhasil keluar. Silakan coba lagi.');
      setLoggingOut(false);
      return;
    }
    navigate('/login', { replace: true });
  }

  async function saveExpense(input: ExpenseInput) {
    if (!expenseEditor) return;
    const result = expenseEditor.expense
      ? await harvestApi.updateExpense(expenseEditor.expense.id, input)
      : await harvestApi.createExpense(expenseEditor.harvest.id, input);
    setHarvests((old) =>
      old.map((harvest) =>
        harvest.id !== expenseEditor.harvest.id
          ? harvest
          : {
              ...harvest,
              expenses: expenseEditor.expense
                ? harvest.expenses.map((expense) =>
                    expense.id === expenseEditor.expense!.id ? result.data : expense,
                  )
                : [...harvest.expenses, result.data],
            },
      ),
    );
    setNotice(
      result.data.published_at
        ? 'Pengeluaran disimpan. Pendapatan bersih diperbarui otomatis.'
        : 'Draft pengeluaran disimpan. Pendapatan belum dikurangi.',
    );
  }

  async function saveCashExpense(input: CashExpenseInput, id?: string) {
    const result = await cashExpenseApi.save(otherPage ? 'other' : 'garden', input, id);
    setCashExpenses((current) =>
      id
        ? current.map((expense) => (expense.id === id ? result.data : expense))
        : [result.data, ...current],
    );
    setNotice(
      result.data.published_at
        ? 'Pengeluaran disimpan. Cash utama diperbarui otomatis.'
        : 'Draft tersimpan. Cash utama belum dikurangi.',
    );
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
                {otherPage
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
          <div className="section-bar">
            <div className="section-title">
              <span className="status-dot" />
              <strong>Ikhtisar pendapatan</strong>
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
                    {new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(
                      new Date(`${m}-01T12:00:00`),
                    )}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <DashboardStats
            totals={totals}
            loading={loading}
            harvestCount={filtered.length}
            draftCount={draftCount}
          />
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
                                height: `${h.total > 0 ? Math.max(2, (h.total / maxIncome) * 100) : 0}%`,
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
                      <strong>{rupiah(totals.net ? totals.income / totals.net : 0)}/kg</strong> dari{' '}
                      {totals.count} SPK dalam periode ini.
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
          {(records || expensePage) && (
            <section className="panel harvest-panel">
              <div className="panel-heading">
                <div>
                  <h2>Catatan panen</h2>
                  <p>Pilih kelompok panen untuk melihat rincian SPK.</p>
                </div>
                <button
                  className="button secondary compact"
                  disabled={!visible.length || loading}
                  onClick={() => exportCsv(visible)}
                >
                  <Download size={16} />
                  Ekspor CSV
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
                  onChange={(e) => setActiveId(e.target.value)}
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
                          {activeHarvest.spks.length} SPK
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
            <ExpenseSection
              harvest={activeHarvest}
              onAdd={() => setExpenseEditor({ harvest: activeHarvest })}
              onEdit={(expense) => setExpenseEditor({ harvest: activeHarvest, expense })}
            />
          )}
          {gardenPage && (
            <CashExpenseSection
              category="garden"
              expenses={filteredCashExpenses}
              loading={loading}
              preview={preview}
              onSave={saveCashExpense}
            />
          )}
          {otherPage && (
            <CashExpenseSection
              category="other"
              expenses={filteredCashExpenses}
              loading={loading}
              preview={preview}
              onSave={saveCashExpense}
            />
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
