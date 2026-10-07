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
