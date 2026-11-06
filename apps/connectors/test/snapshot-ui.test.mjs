import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const provider = { providerId: 'remote-token', displayName: 'Test service', category: 'custom', transport: 'http', requires: [], auth: { mode: 'token' } };
const connection = { connectionId: 'test-service', providerId: provider.providerId, displayName: 'Test service', accountLabel: '', origin: 'user',
  state: 'connected', reason: '', primary: 'configure', secondary: [], lifecycle: [], attempt: null, revision: '1', sealed: false,
  docsUrl: '', code: '', nextStep: '', enabled: true, badges: [], tools: { usable: [], blocked: [], needsApproval: [] }, transport: 'http' };
const snapshot = name => ({ ok: true, directory: [{ ...provider, displayName: name }], connections: [connection] });
const entries = name => ({ ok: true, result: [{ connectorId: connection.connectionId, definition: { transport: 'http', url: `https://${name}.example.test/mcp`, tools: [] }, source: 'user' }] });
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };

async function fixture(t, withPage = false) {
  let pageExport = '';
  if (withPage) {
    // Bundle the real catalog's image imports before loading it in the DOM runtime.
    const temporary = await mkdtemp(resolve(tmpdir(), 'pero-connectors-page-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const outfile = resolve(temporary, 'page.mjs');
    await build({ entryPoints: [resolve(import.meta.dirname, '../ui-src/connectors-page.tsx')], outfile, bundle: true, jsx: 'automatic',
      format: 'esm', platform: 'node', loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' },
      external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@pero/app-sdk', '@pero/app-sdk/*'] });
    pageExport = `export { ConnectorsPage } from ${JSON.stringify(outfile)};`;
  }
  const env = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    export { useConnectorsSnapshot } from './use-connectors-snapshot';
    export { ConnectorCredentials, ConnectorToolAccess } from './connector-detail-sections';
    ${pageExport}` });
  env.dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  env.dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false; this.dispatchEvent(new env.dom.window.Event('close'));
  };
  const timers = new Map(); let timerId = 0;
  t.mock.method(env.dom.window, 'setTimeout', callback => { const id = ++timerId; timers.set(id, callback); return id; });
  t.mock.method(env.dom.window, 'clearTimeout', id => timers.delete(id));
  const tick = () => env.React.act(async () => {
    const scheduled = [...timers.values()]; timers.clear();
    for (const callback of scheduled) callback();
  });
  let state;
  function Probe({ locale }) { state = env.ui.useConnectorsSnapshot(locale); return env.React.createElement('p', null, state.error); }
  const mount = locale => env.render(env.React.createElement(Probe, { locale }));
  return { ...env, timers, tick, mount, state: () => state };
}

test('unmounting during either snapshot request phase prevents later polling', async t => {
  for (const phase of ['snapshot', 'list']) await t.test(phase, async t => {
    const f = await fixture(t), pending = deferred(), operations = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const { operation } = JSON.parse(init.body); operations.push(operation);
      return operation === phase ? pending.promise : response(snapshot('initial'));
    });
    await f.mount('en');
    await f.render(null);
    await f.React.act(async () => pending.resolve(response(phase === 'snapshot' ? snapshot('late') : entries('late'))));
    await f.tick();
    assert.deepEqual(operations, phase === 'snapshot' ? ['snapshot'] : ['snapshot', 'list']);
    assert.equal(f.timers.size, 0);
  });
});

test('changing locale replaces pending snapshot and list lifetimes without accepting stale data or polls', async t => {
  for (const phase of ['snapshot', 'list']) await t.test(phase, async t => {
    const f = await fixture(t), old = deferred(), operations = [];
    let oldRequest = true, polling = false;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const { operation } = JSON.parse(init.body); operations.push(operation);
      if (oldRequest && operation === phase) { oldRequest = false; return old.promise; }
      if (polling) return response({ ok: false, code: 'MCP_HOST_UNAVAILABLE' });
      return response(operation === 'snapshot' ? snapshot('current') : entries('current'));
    });
    await f.mount('zh');
    await f.mount('en');
    assert.equal(f.state().directory[0].displayName, 'current');
    assert.equal(f.state().entries[0].definition.url, 'https://current.example.test/mcp');
    const currentOperations = operations.length;
    await f.React.act(async () => old.resolve(response(phase === 'snapshot' ? snapshot('stale') : entries('stale'))));
    assert.equal(operations.length, currentOperations);
    assert.equal(f.state().directory[0].displayName, 'current');
    assert.equal(f.state().entries[0].definition.url, 'https://current.example.test/mcp');
    assert.equal(f.state().refreshing, false);
    assert.equal(f.timers.size, 1);
    polling = true;
    await f.tick();
    assert.match(f.state().error, /Connection management is unavailable/);
    assert.doesNotMatch(f.state().error, /连接管理/);
    assert.equal(f.timers.size, 0);
  });
});

test('ordinary polling keeps the actual open configuration input and unsaved draft through success and failure', async t => {
  const f = await fixture(t, true);
  let pendingSnapshot = null, generation = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { operation } = JSON.parse(init.body);
    if (operation === 'snapshot') return pendingSnapshot?.promise ?? response(snapshot('initial'));
    if (operation === 'list') return response(entries(`saved-${generation}`));
    return response({ ok: true, records: [], running: [] });
  });
  await f.render(f.React.createElement(f.ui.ConnectorsPage, { locale: 'en', initialMode: 'manage' }));
  const detail = [...document.querySelectorAll('button')].find(node => node.textContent === 'Details');
  assert.ok(detail); await f.click(detail);
  const input = document.querySelector('input#endpoint');
  assert.ok(input);
  await f.React.act(async () => {
    Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'https://unsaved.example.test/mcp');
    input.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  });
  for (const fail of [false, true]) {
    pendingSnapshot = deferred();
    await f.tick();
    assert.equal(document.querySelector('input#endpoint'), input);
    assert.equal(input.value, 'https://unsaved.example.test/mcp');
    generation++;
    await f.React.act(async () => pendingSnapshot.resolve(response(fail ? { ok: false, code: 'MCP_HOST_UNAVAILABLE' } : snapshot('updated'))));
    assert.equal(document.querySelector('input#endpoint'), input);
    assert.equal(input.value, 'https://unsaved.example.test/mcp');
  }
  assert.match(document.body.textContent, /Connection management is unavailable/);
  assert.ok(document.querySelector('[data-state="connected"]'));
});

test('tool access stays controlled and credential Enter waits for input composition to finish', async t => {
  const f = await fixture(t), changes = [];
  let saves = 0;
  function Tools() {
    const [selection, setSelection] = f.React.useState(new Set());
    return f.React.createElement(f.ui.ConnectorToolAccess, { view: { ...connection, tools: { usable: ['read'], blocked: [], needsApproval: [] } },
      scopeEffects: [], locale: 'en', selection, disabled: false, onToggle: (tool, checked) => {
        changes.push([tool, checked]); setSelection(new Set(checked ? [tool] : []));
      } });
  }
  await f.render(f.React.createElement(Tools));
  const checkbox = document.querySelector('[role=checkbox]');
  await f.click(checkbox.closest('label'));
  assert.equal(checkbox.getAttribute('aria-checked'), 'true');
  assert.deepEqual(changes, [['read', true]]);
  await f.render(f.React.createElement(f.ui.ConnectorCredentials, { references: ['token'], reference: 'token', onReference() {},
    value: 'secret', onValue() {}, onSave: () => saves++, onDelete() {}, busy: false, locale: 'en' }));
  const secret = document.querySelector('input[type=password]');
  for (const options of [{ isComposing: true }, { keyCode: 229 }, {}]) {
    await f.React.act(async () => secret.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })));
  }
  assert.equal(saves, 1);
});
