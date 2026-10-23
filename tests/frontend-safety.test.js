const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const React = require('react');

function loadFrontend(path, mocks = {}, globals = {}) {
  const source = readFileSync(resolve(__dirname, '../apps/web/src', path), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  const dependency = (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name));
  new Function('require', 'exports', ...Object.keys(globals), outputText)(
    dependency,
    exports,
    ...Object.values(globals),
  );
  return exports;
}

test('workspace renders do not repeat reads; background refresh is bounded, hidden tabs pause and navigation cancels stale data', async () => {
  const slots = [],
    effects = [],
    calls = [],
    listeners = new Map(),
    timers = new Map();
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  function memo(factory, deps) {
    const n = cursor++;
    if (!slots[n] || !same(slots[n].deps, deps)) slots[n] = { value: factory(), deps };
    return slots[n].value;
  }
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const window = {
    ...document,
    setInterval: (fn, ms) => {
      timers.set(ms, fn);
      return ms;
    },
  };
  const { useWorkspace } = loadFrontend(
    'features/workspace/useWorkspace.ts',
    {
      react: {
        useState: (initial) => {
          const n = cursor++;
          if (!slots[n])
            slots[n] = {
              value: initial,
              set: (value) => {
                slots[n].value = typeof value === 'function' ? value(slots[n].value) : value;
              },
            };
          return [slots[n].value, slots[n].set];
        },
        useRef: (initial) => {
          const n = cursor++;
          return slots[n] ?? (slots[n] = { current: initial });
        },
        useMemo: memo,
        useCallback: (fn, deps) => memo(() => fn, deps),
        useEffect: (fn, deps) => {
          const n = cursor++;
          if (!slots[n] || !same(slots[n].deps, deps)) {
            const old = slots[n];
            slots[n] = { deps };
            effects.push(() => {
              old?.cleanup?.();
              slots[n].cleanup = fn();
            });
          }
        },
      },
      '../../lib/api': {
        request: (route, options) =>
          new Promise((resolve) => calls.push({ route, signal: options.signal, resolve })),
      },
      '../../lib/format': { errorMessage: (error) => error.message },
      '../../lib/workspaceUpdates': { workspaceChannel: () => null, workspaceTabId: 'self' },
      './previewWorkspace': { previewWorkspace: () => null },
    },
    { window, document, clearInterval: (id) => timers.delete(id) },
  );
  const render = (query) => {
    cursor = 0;
    const result = useWorkspace(query, false);
    while (effects.length) effects.shift()();
    return result;
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  render({ view: 'dashboard' });
  for (let i = 0; i < 20; i++) render({ view: 'dashboard' });
  listeners.get('focus')();
  listeners.get('visibilitychange')();
  assert.equal(calls.length, 1, 'Renders and simultaneous focus events must not overlap requests');
  calls[0].resolve({ data: { marker: 'first' } });
  await flush();
  assert.equal(render({ view: 'dashboard' }).data.marker, 'first');
  assert.deepEqual([...timers.keys()], [60000]);
  document.visibilityState = 'hidden';
  timers.get(60000)();
  assert.equal(calls.length, 1);
  document.visibilityState = 'visible';
  timers.get(60000)();
  assert.equal(calls.length, 2);
  assert.equal(render({ view: 'other_income' }).data, null);
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(calls.length, 3);
  calls[1].resolve({ data: { marker: 'stale' } });
  await flush();
  assert.equal(render({ view: 'other_income' }).data, null);
  calls[2].resolve({ data: { marker: 'current' } });
  await flush();
  assert.equal(render({ view: 'other_income' }).data.marker, 'current');
  for (const slot of slots) slot?.cleanup?.();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});

function exportPollingHarness(requester) {
  let effect,
    now = 0,
    sequence = 0;
  const timers = new Map(),
    listeners = new Map(),
    calls = [],
    updates = [],
    errors = [];
  const document = { visibilityState: 'visible' };
  const navigator = { onLine: true };
  const events = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const api = {
    ApiError: class extends Error {
      constructor(status) {
        super(`HTTP ${status}`);
        this.status = status;
      }
    },
    request: async (route, options) => {
      calls.push({ route, signal: options.signal });
      return requester(route, options, calls.length, api.ApiError);
    },
  };
  const { useExportPolling } = loadFrontend(
    'features/finance/useExportPolling.ts',
    {
      react: {
        useEffect: (callback) => {
          effect = callback;
        },
      },
      '../../lib/api': api,
      '../../lib/format': { errorMessage: (error) => error.message },
    },
    {
      document: Object.assign(document, events),
      navigator,
      window: events,
      Date: { now: () => now, parse: Date.parse },
      setTimeout: (fn, delay) => {
        const id = ++sequence;
        timers.set(id, { fn, at: now + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const running = { current: false };
  useExportPolling({
    preview: false,
    revision: 0,
    running,
    latest: { current: new (require('@sawit/shared').LatestRequest)() },
    onJobs: (jobs) => updates.push(jobs),
    onError: (error) => errors.push(error),
  });
  const cleanup = effect();
  return {
    calls,
    timers,
    updates,
    errors,
    document,
    navigator,
    running,
    cleanup,
    flush,
    event: (name) => listeners.get(name)?.(),
    tick: async (ms) => {
      const end = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

test('export polling stops when idle, completed, paused or expired and coalesces focus events', async () => {
  for (const jobs of [
    [],
    [{ id: 'done', status: 'completed', expires_at: '2099-01-01' }],
    [{ id: 'paused', status: 'paused', expires_at: '2099-01-01' }],
    [{ id: 'expired', status: 'processing', expires_at: '1969-01-01' }],
  ]) {
    const h = exportPollingHarness(async () => ({ data: jobs }));
    await h.flush();
    await h.tick(60000);
    assert.equal(h.calls.length, 1);
    h.event('focus');
    h.event('visibilitychange');
    h.event('online');
    await h.tick(0);
    assert.equal(h.calls.length, 2);
    h.cleanup();
    assert.equal(h.timers.size, 0);
  }
});

test('export polling bounds worker wakeups, rotates the queue and stops after completion', async () => {
  let completed = false;
  const jobs = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    status: 'queued',
    expires_at: '2099-01-01',
  }));
  const h = exportPollingHarness(async (route) => ({
    data:
      route === '/exports'
        ? jobs.map((j) => ({ ...j, status: completed ? 'completed' : j.status }))
        : {},
  }));
  await h.flush();
  assert.deepEqual(
    h.calls.map((c) => c.route),
    ['/exports', '/exports/0', '/exports/1'],
  );
  await h.tick(5000);
  assert.deepEqual(
    h.calls.slice(-3).map((c) => c.route),
    ['/exports', '/exports/2', '/exports/3'],
  );
  completed = true;
  await h.tick(5000);
  const count = h.calls.length;
  await h.tick(60000);
  assert.equal(h.calls.length, count);
  h.cleanup();
});

test('export polling backs off failures, respects rate limits and stops unauthorized retries', async () => {
  for (const status of [401, 403, 429, 503]) {
    const h = exportPollingHarness(async (_route, _options, _count, ApiError) => {
      throw new ApiError(status);
    });
    await h.flush();
    if (status === 401 || status === 403) {
      await h.tick(120000);
      assert.equal(h.calls.length, 1);
    }
    if (status === 429) {
      h.event('focus');
      await h.tick(59999);
      assert.equal(h.calls.length, 1);
      await h.tick(1);
      assert.equal(h.calls.length, 2);
    }
    if (status === 503) {
      await h.tick(4999);
      assert.equal(h.calls.length, 1);
      await h.tick(1);
      assert.equal(h.calls.length, 2);
      h.event('focus');
      await h.tick(9999);
      assert.equal(h.calls.length, 2);
      await h.tick(1);
      assert.equal(h.calls.length, 3);
    }
    h.cleanup();
  }
});

test('export polling cancels hidden reads, discards stale responses and resumes after a quick return', async () => {
  let resolveRead;
  const h = exportPollingHarness(
    async () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  h.document.visibilityState = 'hidden';
  h.event('visibilitychange');
  assert.equal(h.calls[0].signal.aborted, true);
  h.document.visibilityState = 'visible';
  h.event('focus');
  resolveRead({ data: [{ id: 'old', status: 'completed', expires_at: '2099-01-01' }] });
  await h.flush();
  assert.equal(h.updates.length, 0);
  await h.tick(5000);
  assert.equal(h.calls.length, 2);
  h.cleanup();
  resolveRead({ data: [] });
  await h.flush();
  assert.equal(h.updates.length, 0);
  assert.equal(h.timers.size, 0);
});

test('export polling makes no background calls offline or while a mutation owns the reader', async () => {
  const h = exportPollingHarness(async () => ({ data: [] }));
  await h.flush();
  h.navigator.onLine = false;
  h.event('offline');
  h.event('focus');
  await h.tick(60000);
  assert.equal(h.calls.length, 1);
  h.navigator.onLine = true;
  h.running.current = true;
  h.event('online');
  await h.tick(0);
  assert.equal(h.calls.length, 1);
  h.running.current = false;
  h.event('focus');
  await h.tick(0);
  assert.equal(h.calls.length, 2);
  h.cleanup();
});

function renderSecurityPage({
  factors = [],
  enrollment = null,
  removing = null,
  busy = false,
  loaded = true,
  preview = false,
} = {}) {
  const { renderToStaticMarkup } = require('react-dom/server');
  const states = [factors, enrollment, removing, busy, '', '', loaded];
  let index = 0;
  const { SecurityPage } = loadFrontend('features/auth/SecurityPage.tsx', {
    react: {
      ...React,
      useState: () => [states[index++], () => {}],
      useRef: (value) => ({ current: value }),
      useEffect: () => {},
    },
    '../../lib/supabase': { supabase: {} },
    '../../lib/format': { errorMessage: (error) => error.message },
    './MfaGate': {
      MfaCode: ({ factorId, label }) =>
        React.createElement('form', { 'aria-label': factorId }, label),
    },
  });
  return renderToStaticMarkup(React.createElement(SecurityPage, { preview }));
}

test('account security keeps loading and preview enrollment disabled and lists verified devices safely', () => {
  assert.match(renderSecurityPage({ loaded: false }), /disabled=""[^>]*>Tambah Authenticator/);
  assert.match(renderSecurityPage({ preview: true }), /disabled=""[^>]*>Tambah Authenticator/);
  const factors = [
    { id: 'first', status: 'verified', friendly_name: '<phone>' },
    { id: 'second', status: 'verified', friendly_name: 'Backup' },
    { id: 'pending', status: 'unverified', friendly_name: 'Pending device' },
  ];
  const html = renderSecurityPage({ factors });
  assert.match(html, /MFA aktif/);
  assert.match(html, /&lt;phone&gt;/);
  assert.match(html, /Backup/);
  assert.doesNotMatch(html, /Pending device/);
  assert.match(html, /disabled=""[^>]*>Tambah Authenticator/);
  assert.equal((html.match(/Hapus Authenticator/g) || []).length, 2);
  assert.match(html, /Pemulihan akses/);
});

test('account security enrollment hides manual keys and removal still requires device verification', () => {
  const factors = [{ id: 'phone', status: 'verified', friendly_name: 'Phone' }];
  const html = renderSecurityPage({
    factors,
    enrollment: { id: 'new-phone', qr: '<svg/>', secret: 'DUMMYKEYFORLAYOUT' },
  });
  assert.match(
    html,
    /<details><summary>Tampilkan kunci manual<\/summary><code>DUMMYKEYFORLAYOUT<\/code><\/details>/,
  );
  assert.match(html, /aria-label="new-phone">Aktifkan MFA/);
  assert.match(html, /disabled=""[^>]*>Hapus Authenticator/);
  assert.doesNotMatch(html, /Tambah Authenticator/);
  const removal = renderSecurityPage({ factors, removing: 'phone' });
  assert.match(removal, /terakhir akan menonaktifkan login dua langkah/);
  assert.match(removal, /aria-label="phone">Verifikasi dan hapus/);
  assert.doesNotMatch(removal, /Tambah Authenticator/);
});

test('expense form requires independent manual weight, keeps it while scale readings change and restores saved values', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  let index = 0;
  const states = [];
  const react = {
    ...React,
    useState: (initial) => {
      const n = index++;
      if (!(n in states)) states[n] = initial;
      return [
        states[n],
        (value) => {
          states[n] = value;
        },
      ];
    },
    useRef: (value) => ({ current: value }),
  };
  const { ExpenseForm } = loadFrontend(
    'features/expenses/ExpenseForm.tsx',
    {
      react,
      '../../components/Modal': {
        Modal: ({ children }) => React.createElement('section', null, children),
      },
      '../finance/AccountPicker': { AccountPicker: () => null },
      '../../lib/format': {
        dateTime: (value) => value,
        errorMessage: (e) => e.message,
        rupiah: (value) => `Rp ${value}`,
        today: () => '2026-10-23',
      },
    },
    { crypto: { randomUUID: () => 'fixture-request' } },
  );
  const props = { harvestName: 'Manual weight form', onClose: () => {}, onSave: async () => {} };
  const render = (existing) => {
    index = 0;
    return renderToStaticMarkup(React.createElement(ExpenseForm, { ...props, existing }));
  };
  const empty = render();
  assert.equal(states[0].overall_weight, '');
  assert.match(
    empty,
    /min="0.01"[^>]+required=""[^>]+aria-describedby="overall-weight-hint"[^>]+value=""/,
  );
  assert.doesNotMatch(empty, /readonly|Dihitung otomatis/);
  states[0] = {
    first_weight: '10000',
    second_weight: '4000',
    overall_weight: '5880',
    wage_per_kg: '250',
    driver_cost: '450000',
  };
  assert.match(render(), /Rp 1920000/);
  states[0] = { ...states[0], first_weight: '12000' };
  assert.match(render(), /Rp 1920000/);
  states.length = 0;
  assert.match(
    render({
      first_weight: 10000,
      second_weight: 4000,
      overall_weight: 5700,
      wage_per_kg: 250,
      driver_cost: 450000,
    }),
    /value="5700"/,
  );
});

test('MFA gate stays closed while checking and discards results after unmount', async () => {
  let effect, resolveLevel;
  const changes = [];
  const react = {
    ...React,
    useState: (value) => [
      value,
      (next) => {
        if (next && typeof next === 'object') changes.push(next);
      },
    ],
    useRef: (value) => ({ current: value }),
    useEffect: (callback) => {
      effect = callback;
    },
  };
  const supabase = {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: () =>
          new Promise((resolve) => {
            resolveLevel = resolve;
          }),
        listFactors: async () => ({
          data: {
            all: [{ id: 'factor', status: 'verified' }],
            totp: [{ id: 'factor', status: 'verified' }],
          },
          error: null,
        }),
      },
    },
  };
  const { MfaGate } = loadFrontend('features/auth/MfaGate.tsx', {
    react,
    '../../lib/supabase': { supabase },
    './AuthProvider': {
      useAuth: () => ({ session: { access_token: 'token', user: { id: 'owner' } } }),
    },
  });
  const rendered = MfaGate({ children: 'private financial data' });
  assert.notEqual(rendered, 'private financial data');
  const cleanup = effect();
  cleanup();
  resolveLevel({ data: { currentLevel: 'aal1' }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(changes, []);
  MfaGate({ children: 'private financial data' });
  effect();
  resolveLevel({ data: { currentLevel: 'aal1' }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(changes, [
    {
      token: 'token',
      userId: 'owner',
      factorId: 'factor',
      factors: [{ id: 'factor', name: 'Authenticator 1' }],
    },
  ]);
});

test('mobile navigation hides inactive groups and exposes expansion controls', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const mobile of [true, false]) {
    const { SidebarGroup } = loadFrontend(
      'features/dashboard/components/SidebarGroup.tsx',
      {},
      { window: { matchMedia: () => ({ matches: mobile }) } },
    );
    const html = renderToStaticMarkup(
      React.createElement(
        SidebarGroup,
        { label: 'TRANSAKSI HARIAN', active: false },
        React.createElement('a', { href: '/panen' }, 'Pendapatan panen'),
      ),
    );
    assert.match(html, /aria-expanded="false"/);
    if (mobile) assert.match(html, /class="nav-group-content"[^>]+hidden=""/);
    else assert.doesNotMatch(html, /class="nav-group-content"[^>]+hidden=""/);
  }
});

test('token refresh keeps same-user forms mounted and hidden until assurance passes; account switches clear them', () => {
  const states = [{ token: 'old', userId: 'owner', factorId: null, factors: [] }, false, '', 0];
  let index = 0;
  let session = { access_token: 'new', user: { id: 'owner' } };
  const react = {
    ...React,
    useState: () => {
      const n = index++;
      return [
        states[n],
        (value) => {
          states[n] = value;
        },
      ];
    },
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
  };
  const { MfaGate } = loadFrontend('features/auth/MfaGate.tsx', {
    react,
    '../../lib/supabase': { supabase: {} },
    './AuthProvider': { useAuth: () => ({ session }) },
  });
  const form = React.createElement('input', { defaultValue: 'unsaved amount' });
  const render = () => {
    index = 0;
    return MfaGate({ children: form }).props.children[0];
  };
  const pending = render();
  assert.equal(pending.props.children, form);
  assert.equal(pending.props.hidden, true);
  states[0] = { ...states[0], token: 'new' };
  const ready = render();
  assert.equal(ready.key, pending.key);
  assert.equal(ready.props.children, form);
  assert.equal(ready.props.hidden, false);
  states[2] = 'temporary failure';
  assert.equal(render().props.hidden, true);
  session = { access_token: 'different', user: { id: 'other' } };
  assert.equal(render().props.children, null);
});

test('history never displays the previous month under a new month while a page is loading', async () => {
  const states = [null, null, '', '', [undefined, '50'], [undefined], null, false];
  let index = 0,
    effect,
    resolveRead;
  const reference = { current: new (require('@sawit/shared').LatestRequest)() };
  const react = {
    ...React,
    useState: () => {
      const n = index++;
      return [
        states[n],
        (value) => {
          states[n] = typeof value === 'function' ? value(states[n]) : value;
        },
      ];
    },
    useRef: () => reference,
    useEffect: (callback) => {
      effect = callback;
    },
  };
  const format = loadFrontend('lib/format.ts');
  const { FinanceSection } = loadFrontend('features/finance/FinanceSection.tsx', {
    react,
    '../../lib/format': format,
    './FinanceForm': { FinanceForm: () => null, costNames: {} },
    './EvidenceModal': { EvidenceModal: () => null },
    './api': {
      financeApi: {
        read: () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      },
    },
    '../../lib/workspaceUpdates': { notifyWorkspaceUpdate: () => {} },
  });
  const finance = {
    enabled: true,
    revision: 1,
    accounts: [],
    journal: [],
    audit: [],
    goals: [],
    budgets: [],
    costs: [],
  };
  const props = {
    finance,
    view: 'riwayat',
    preview: false,
    onRefresh: async () => true,
    onMonthChange: () => {},
  };
  const render = (month) => {
    index = 0;
    return FinanceSection({ ...props, month });
  };
  render('2026-10');
  const cleanup = effect();
  resolveRead({
    data: {
      ...finance,
      audit: [
        {
          seq: '1',
          action: 'INSERT',
          entity: 'cash_expenses',
          reason: 'HISTORY-OCT',
          created_at: '2026-10-01T00:00:00Z',
          before_data: null,
          after_data: { amount: 100 },
        },
      ],
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const { renderToStaticMarkup } = require('react-dom/server');
  assert.match(renderToStaticMarkup(render('2026-10')), /HISTORY-OCT/);
  const september = renderToStaticMarkup(render('2026-09'));
  assert.doesNotMatch(september, /HISTORY-OCT/);
  assert.match(september, /Memuat halaman/);
  cleanup();
});

test('new auth events win over a delayed initial session and unmount cancels callbacks', async () => {
  let initial;
  let listener;
  let effect;
  let unsubscribe = false;
  const sessions = [];
  const react = {
    ...React,
    useState: (value) => [
      value,
      (next) => {
        if (typeof next !== 'boolean') sessions.push(next);
      },
    ],
    useEffect: (callback) => {
      effect = callback;
    },
  };
  const supabase = {
    auth: {
      onAuthStateChange: (callback) => {
        listener = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                unsubscribe = true;
              },
            },
          },
        };
      },
      getSession: () =>
        new Promise((resolveSession) => {
          initial = resolveSession;
        }),
    },
  };
  const { AuthProvider } = loadFrontend('features/auth/AuthProvider.tsx', {
    react,
    '../../lib/supabase': { supabase },
  });
  AuthProvider({ children: null });
  const cleanup = effect();
  const latest = { user: { id: 'new-session' } };
  listener('SIGNED_IN', latest);
  initial({ data: { session: { user: { id: 'stale-session' } } } });
  await Promise.resolve();
  assert.deepEqual(sessions, [latest]);
  listener('SIGNED_OUT', null);
  assert.deepEqual(sessions, [latest, null]);
  cleanup();
  listener('SIGNED_IN', latest);
  assert.deepEqual(sessions, [latest, null]);
  assert.equal(unsubscribe, true);
});

test('blocked cross-tab storage never turns a successful write into a failure', () => {
  const { notifyWorkspaceUpdate, workspaceChannel } = loadFrontend(
    'lib/workspaceUpdates.ts',
    {},
    {
      crypto: { randomUUID: () => 'test-tab' },
      BroadcastChannel: class {
        constructor() {
          throw new Error('SecurityError');
        }
      },
    },
  );
  assert.equal(workspaceChannel(), null);
  assert.doesNotThrow(notifyWorkspaceUpdate);
});

test('notifications identify the originating tab so it does not cancel its own balance refresh', () => {
  let message;
  let closed = false;
  const { notifyWorkspaceUpdate, workspaceTabId } = loadFrontend(
    'lib/workspaceUpdates.ts',
    {},
    {
      crypto: { randomUUID: () => 'test-tab' },
      BroadcastChannel: class {
        postMessage(value) {
          message = value;
        }
        close() {
          closed = true;
        }
      },
    },
  );
  notifyWorkspaceUpdate();
  assert.deepEqual(message, { type: 'refresh', source: workspaceTabId });
  assert.equal(closed, true);
});

test('Cash tersedia stays exact and cumulative when period totals change', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const { summarize } = require('@sawit/shared');
  const format = loadFrontend('lib/format.ts');
  const { DashboardStats } = loadFrontend('features/dashboard/components/DashboardStats.tsx', {
    '../../../lib/format': format,
  });
  for (const periodCash of ['100.00', '-50.00']) {
    const html = renderToStaticMarkup(
      React.createElement(DashboardStats, {
        totals: { ...summarize([]), netIncome: periodCash },
        allTimeCash: '1000000000001666.01',
        view: 'dashboard',
        loading: false,
        harvestCount: 0,
        draftCount: 0,
      }),
    );
    const cashCard = html.slice(0, html.indexOf('</article>'));
    assert.ok(cashCard.includes('1.000.000.000.001.666,01'));
    assert.ok(cashCard.includes('Saldo seluruh periode'));
  }
});

test('preview journal matches its selected month while account balances remain cumulative', () => {
  const format = loadFrontend('lib/format.ts');
  const { previewFinance } = loadFrontend('features/finance/preview.ts', {
    '../../lib/format': format,
  });
  const { previewHarvests } = loadFrontend('features/dashboard/preview.ts');
  const { previewCashExpenses } = loadFrontend('features/cash-expenses/preview.ts');
  const query = { month: 'all', year: 2026, period: 'month' };
  const all = previewFinance(previewHarvests(), previewCashExpenses(), query);
  const months = [...new Set(all.journal.map((row) => row.event_date.slice(0, 7)))];
  for (const month of months) {
    const selected = previewFinance(previewHarvests(), previewCashExpenses(), { ...query, month });
    assert.ok(selected.journal.length > 0);
    assert.ok(selected.journal.every((row) => row.event_date.startsWith(month)));
    assert.equal(selected.availableCash, all.availableCash);
    assert.equal(selected.totalFunds, all.totalFunds);
  }
});

test('browser Auth and Storage calls time out, preserve caller cancellation and receive a fresh deadline', async () => {
  const { boundedFetch } = loadFrontend('lib/boundedFetch.ts', {}, { Request, AbortSignal });
  const received = [];
  const fetcher = async (_input, options) => {
    received.push(options);
    return new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
    });
  };
  // The timer keeps the test process alive; AbortSignal.timeout is unref'd by Node.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const timed = boundedFetch(10, fetcher);
    await assert.rejects(
      timed('https://fixture.invalid/auth/v1/user', { headers: { 'X-Fixture': 'preserved' } }),
      { name: 'TimeoutError' },
    );
    const caller = new AbortController();
    const operation = timed(
      new Request('https://fixture.invalid/storage/v1/object', { signal: caller.signal }),
    );
    assert.equal(received[1].signal.aborted, false);
    caller.abort();
    await assert.rejects(operation, { name: 'AbortError' });
    assert.deepEqual(received[0].headers, { 'X-Fixture': 'preserved' });
    assert.notEqual(received[0].signal, received[1].signal);
  } finally {
    clearTimeout(keepAlive);
  }
});
