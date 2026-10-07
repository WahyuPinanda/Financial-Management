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
    './AuthProvider': { useAuth: () => ({ session: { access_token: 'token' } }) },
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
    { token: 'token', factorId: 'factor', factors: [{ id: 'factor', name: 'Authenticator 1' }] },
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
