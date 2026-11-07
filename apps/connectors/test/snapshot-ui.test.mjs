import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const provider = { providerId: 'remote-token', displayName: 'Test service', category: 'custom', transport: 'http', requires: [], auth: { mode: 'token' } };
const catalogProvider = { ...provider, providerId: 'research-service', category: 'research' };
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
    export { DiscoveryPanel } from './connector-editor';
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
  const click = element => element?.getAttribute('role') === 'tab'
    ? env.React.act(async () => element.dispatchEvent(new env.dom.window.MouseEvent('mousedown', { bubbles: true, button: 0 })))
    : env.click(element);
  return { ...env, click, timers, tick, mount, state: () => state };
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

test('initial connection loading and failure stay distinct from first-use actions', async t => {
  const f = await fixture(t, true), pending = deferred();
  let currentSnapshot = pending.promise;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { operation } = JSON.parse(init.body);
    if (operation === 'snapshot') return currentSnapshot;
    if (operation === 'list') return response({ ok: true, result: [] });
    return response({ ok: true, records: [], running: [] });
  });
  await f.render(f.React.createElement(f.ui.ConnectorsPage, { locale: 'en', initialMode: 'manage' }));
  assert.match(document.querySelector('[role=status]').textContent, /Loading installed connections/);
  assert.equal(document.querySelector('.pero-ui-empty-state'), null);
  await f.React.act(async () => pending.resolve(response({ ok: false, code: 'MCP_HOST_UNAVAILABLE' })));
  assert.match(document.querySelector('[role=alert]').textContent, /Connection management is unavailable/);
  assert.equal(document.querySelector('.pero-ui-empty-state'), null);

  currentSnapshot = response({ ok: true, directory: [provider, catalogProvider], connections: [] });
  await f.click([...document.querySelectorAll('button')].find(node => node.textContent === 'Reload'));
  const firstUse = document.querySelector('.point-connectors-manage .pero-ui-empty-state');
  assert.match(firstUse.textContent, /No connections yet/);
  await f.click([...firstUse.querySelectorAll('button')].find(node => node.textContent === 'Browse service catalog'));
  assert.match(document.querySelector('.point-connectors-catalog').textContent, /Test service/);
  await f.click([...document.querySelectorAll('button')].find(node => node.textContent === 'Installed connections'));
  await f.click([...document.querySelector('.point-connectors-manage .pero-ui-empty-state').querySelectorAll('button')].find(node => node.textContent === 'Add custom MCP'));
  assert.ok(document.querySelector('#connector-import-json'));
  assert.equal(document.querySelector('dialog').open, true);
});

test('catalog and connection no-match recovery clears filters and restores retained entries', async t => {
  const f = await fixture(t, true);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { operation } = JSON.parse(init.body);
    if (operation === 'snapshot') return response({ ...snapshot('Test service'), directory: [provider, catalogProvider] });
    if (operation === 'list') return response(entries('initial'));
    return response({ ok: true, records: [], running: [] });
  });
  await f.render(f.React.createElement(f.ui.ConnectorsPage, { locale: 'en', initialMode: 'manage' }));
  await f.click([...document.querySelectorAll('button')].find(node => node.textContent === 'Paused 0'));
  for (const mode of ['manage', 'catalog']) {
    if (mode === 'catalog') await f.click([...document.querySelectorAll('button')].find(node => node.textContent === 'Service catalog'));
    const search = document.querySelector('input[type=search]');
    await f.React.act(async () => {
      Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'no-such-service');
      search.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
    });
    const empty = document.querySelector('.pero-ui-empty-state');
    assert.match(empty.textContent, mode === 'manage' ? /No matching connections/ : /No matching services/);
    await f.click([...empty.querySelectorAll('button')].find(node => node.textContent === 'Clear filters'));
    assert.equal(search.value, '');
    assert.equal(document.querySelector('.pero-ui-empty-state'), null);
    assert.match(document.querySelector(mode === 'manage' ? '.point-page-list' : '.point-connectors-grid').textContent, /Test service/);
  }
});

test('transport templates alone do not masquerade as catalog services', async t => {
  const f = await fixture(t, true);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { operation } = JSON.parse(init.body);
    if (operation === 'snapshot') return response({ ok: true, directory: [provider], connections: [] });
    if (operation === 'list') return response({ ok: true, result: [] });
    return response({ ok: true, records: [], running: [] });
  });
  await f.render(f.React.createElement(f.ui.ConnectorsPage, { locale: 'en' }));
  assert.match(document.querySelector('.pero-ui-empty-state').textContent, /No services available/);
  assert.equal(document.querySelector('.point-connectors-grid'), null);
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


test('credential deletion requires an explicit shared-impact confirmation and cancellation preserves it', async t => {
  const f = await fixture(t); let deletes = 0;
  await f.render(f.React.createElement(f.ui.ConnectorCredentials, { references: ['shared-token'], reference: 'shared-token', onReference() {},
    value: '', onValue() {}, onSave() {}, onDelete: () => deletes++, busy: false, locale: 'en' }));
  const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name);
  await f.click(button('Delete'));
  assert.equal(deletes, 0);
  assert.match(document.querySelector('dialog').textContent, /Every connection using this reference/);
  assert.match(document.querySelector('dialog').textContent, /shared-token/);
  await f.click(button('Cancel')); assert.equal(deletes, 0);
  await f.click(button('Delete')); await f.click(button('Delete credential'));
  assert.equal(deletes, 1);
});

test('installation discloses the actual draft tools and their effects before components are ready', async t => {
  const f = await fixture(t);
  await f.render(f.React.createElement(f.ui.DiscoveryPanel, {
    locale: 'en', provider: { ...provider, discovery: { executables: ['fixture'] }, defaultTools: ['read', 'write'], operations: [{ tool: 'read', effect: 'read' }, { tool: 'write', effect: 'write' }] },
    discovery: { state: 'done', command: [], matlabRoot: [] }, definition: { tools: ['write', 'unclassified'] }, busy: false, installing: false,
    onPick() {}, onRetry() {}, onManual() {}, onInstall() {}, onDocs() {}, onInstallServer() {}, onCancelInstall() {},
  }));
  const scope = document.querySelector('.point-connector-install-scope');
  assert.match(scope.textContent, /Write 1/); assert.match(scope.textContent, /Unclassified.*1/);
  assert.doesNotMatch(scope.textContent, /Read 1/);
  assert.equal(scope.querySelectorAll('code').length, 2);
});

test('custom MCPs is a view beside the service catalog', async t => {
  const f = await fixture(t, true);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { operation } = JSON.parse(init.body);
    return response(operation === 'snapshot' ? snapshot('catalog') : entries('catalog'));
  });
  await f.render(f.React.createElement(f.ui.ConnectorsPage, { locale: 'zh' }));
  const tab = [...document.querySelectorAll('[role=tab]')].find(node => node.textContent === '自定义 MCPs');
  assert.ok(tab);
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent.includes('自定义 MCP') && !node.textContent.includes('MCPs')), true);
});

test('state filter counts match results and unverified connections never appear ready', async t => {
  const f = await fixture(t, true);
  const connections = [['ready', 'verified', true], ['draft', 'needs-configuration', true], ['unchecked', 'not-verified', true], ['paused', 'needs-configuration', false]]
    .map(([id, state, enabled]) => ({ ...connection, connectionId: id, displayName: id, state, enabled }));
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { operation } = JSON.parse(init.body);
    if (operation === 'snapshot') return response({ ok: true, directory: [provider], connections });
    return response({ ok: true, result: [], records: [], running: [] });
  });
  await f.render(f.React.createElement(f.ui.ConnectorsPage, { locale: 'en', initialMode: 'manage' }));
  for (const [filter, ids] of [['Paused 1', ['paused']], ['Ready 1', ['ready']], ['Needs attention 3', ['draft', 'unchecked', 'paused']]]) {
    await f.click([...document.querySelectorAll('button')].find(node => node.textContent === filter));
    assert.deepEqual([...document.querySelectorAll('.point-connectors-row-title .point-connectors-link')].map(node => node.textContent), ids);
  }
});
