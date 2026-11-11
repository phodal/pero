// Production React component in JSDOM. Behavioral evidence, not browser/visual acceptance.
import assert from 'node:assert/strict';
import { appSdkAliases } from '../../scripts/build/app-sdk.mjs';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '../..'), output = await mkdtemp(join(tmpdir(), 'fisher-state-'));
const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="root"></div></body></html>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'sessionStorage', 'localStorage', 'location']) Object.defineProperty(globalThis, name, { configurable: true, value: typeof dom.window[name] === 'function' && name === 'getComputedStyle' ? dom.window[name].bind(dom.window) : dom.window[name] });
// React/SDK scheduling creates Node MessagePorts outside JSDOM's lifecycle.
// Track only this disposable test's channels so cleanup can close them.
const NativeMessageChannel = globalThis.MessageChannel, channels = [];
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const spec = { id: 'spec-1', python_version: '3.11 fixture', metric: 'fixture', unit: 'cm^2', reported: 19.1434, comparison: { mode: 'absolute', tolerance: .00005 }, command: [], scope: 'One statistic' };
const csv = await readFile(resolve(root, 'apps/paper-agent/backend/paper_agent/fisher_table1.csv'), 'utf8');
const data = { sha256: 'reviewed-input', location: 'Table I', rows: csv.trim().split('\n').slice(1).map(line => { const [species, row, length] = line.split(','); return { species, row: Number(row), length_cm: Number(length) }; }) };
let items = [], failStatus = false, runMode = 'success', count = 0;
const requests = [];
const api = { post: async (_path, body) => {
  requests.push(body);
  if (body.action === 'status') { if (failStatus) throw Error('Status unavailable'); return structuredClone({ case: 'fixture', scope: spec.scope, items, preview: spec, data }); }
  if (body.action === 'freeze') { const item = { itemId: `item-${items.length+1}`, spec: { ...spec, comparison: body.comparison }, attempts: [] }; items.push(item); return item; }
  if (body.action === 'run') {
    if (runMode === 'not-received') throw Error('Request did not reach server');
    const row = items.find(i => i.itemId === body.itemId);
    const existing = row.attempts.find(a => a.execution.request_id === body.requestId); if (existing) return existing;
    const a = { attemptId: `attempt-${++count}`, execution: { status: runMode === 'environment' ? 'environment_failed' : 'completed', request_id: body.requestId }, report: runMode === 'lost' ? null : { result_verdict: runMode === 'environment' ? 'INCONCLUSIVE' : 'REPRODUCED', actual: 19.1434, difference: 0 }, independent: runMode === 'environment' ? null : { numeric_recomputation: 'PASS' }, annotation: runMode === 'environment' ? null : { resultAnnotationId: 'saved' } };
    row.attempts.push(a); if (runMode === 'lost') throw Error('Response lost'); return structuredClone(a);
  }
  if (body.action === 'logs') return { text: 'Actual fixture log' };
  throw Error('Unexpected action');
} };
try {
  await build({ stdin: { contents: `import React,{act} from 'react';import{createRoot}from'react-dom/client';import{AppSdkProvider}from'@pero/app-sdk';import{FisherReproduction}from'${root}/apps/paper-agent/ui-src/fisher-reproduction';export{act};export function mount(api){const root=createRoot(document.getElementById('root'));root.render(<AppSdkProvider host={{info:{locale:'en',active:true}}}><FisherReproduction api={api} annotation={{id:'annotation'}} onSource={()=>{}}/></AppSdkProvider>);return root;}`, loader: 'tsx', resolveDir: root }, outfile: join(output, 'component.mjs'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { react: resolve(root, 'apps/paper-agent/node_modules/react'), 'react-dom': resolve(root, 'apps/paper-agent/node_modules/react-dom'), ...appSdkAliases(root) } });
  const { act, mount } = await import(pathToFileURL(join(output, 'component.mjs')));
  let mounted;
  const render = async () => { await act(async () => { mounted = mount(api); }); };
  const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
  const click = async name => { const b = button(name); assert.ok(b, `Missing ${name}`); assert.equal(b.disabled, false, `Disabled ${name}`); await act(async () => { b.click(); }); };
  const check = async () => { await act(async () => { document.querySelector('[role="checkbox"]').click(); }); };
  const text = () => document.body.textContent;
  await render();
  await act(async () => { [...document.querySelectorAll('summary')].find(e => e.textContent.includes('Review input observations')).click(); });
  assert.equal(document.querySelectorAll('tbody tr').length, 100);
  assert.equal(document.querySelectorAll('tbody tr')[31].textContent, 'setosa325.4');
  assert.match(text(), /OCR 6.4 is incorrect/);
  assert.equal(button('Freeze protocol').disabled, true);
  await check();
  await act(async () => { button('Freeze protocol').click(); button('Freeze protocol').click(); });
  assert.equal(items.length, 1); // Rapid repeated confirmation freezes once.
  assert.equal(requests.filter(r => r.action === 'run').length, 0);
  await act(async () => { button('Confirm and run fixed arithmetic').click(); button('Confirm and run fixed arithmetic').click(); });
  assert.equal(count, 1); // Rapid repeated clicks dispatch once.
  assert.match(text(), /Single-result verdict: REPRODUCED/); assert.match(text(), /Independent numerical check: PASS/);
  assert.match(text(), /Whole paper: NOT_ASSESSED/);
  await click('Read attempt logs'); assert.match(text(), /Actual fixture log/);
  failStatus = true; await click('Refresh status');
  assert.match(text(), /retained records may not be current/); assert.match(text(), /Single-result verdict: REPRODUCED/);
  failStatus = false; runMode = 'lost'; await click('Confirm and run a new attempt');
  assert.equal(button('Confirm and run a new attempt').disabled, true);
  await act(async () => mounted.unmount()); await render();
  // Remount restores the frozen-result stage, not the input-review editor.
  assert.ok(button('Create new protocol (retain earlier versions)'));
  assert.equal(button('Confirm and run a new attempt').disabled, true);
  assert.equal(button('Recover original request'), undefined); // Recorded but unfinished must not replay.
  assert.equal(count, 2);
  items[0].attempts[1].report = { result_verdict: 'INCONCLUSIVE' };
  items[0].attempts[1].annotation = null;
  await click('Refresh status'); assert.equal(button('Confirm and run a new attempt').disabled, false);
  assert.match(text(), /handoff workflow is incomplete/);
  runMode = 'not-received'; await click('Confirm and run a new attempt');
  await click('Refresh status');
  assert.ok(button('Recover original request'));
  const pendingRequest = requests.filter(r => r.action === 'run').at(-1);
  runMode = 'success'; await click('Recover original request');
  assert.deepEqual(requests.filter(r => r.action === 'run').at(-1), pendingRequest);
  assert.equal(count, 3);
  runMode = 'environment'; await click('Confirm and run a new attempt');
  assert.match(text(), /Execution status: environment_failed/);
  assert.match(text(), /Restore the frozen environment/);
  assert.doesNotMatch(text(), /result annotation has not been confirmed saved/);
  assert.equal(button('Confirm and run a new attempt').disabled, false);
  assert.match(text(), /Independent numerical check: Not checked/);
  const uniqueRuns = requests.filter(r => r.action === 'run');
  assert.equal(new Set(uniqueRuns.map(r => r.requestId)).size, 4);
  assert.equal(uniqueRuns.length, 5);
  await act(async () => mounted.unmount());
  console.log('PASS: all 100 input observations and scan correction, explicit freeze/run, no auto-run, retained failure, unknown receipt survives remount, no replay of unfinished attempt, missing annotation warning, same-ID recovery, environment failure unlock, immutable attempts. JSDOM only; no visual acceptance.');
} finally {
  dom.window.close();
  for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
  globalThis.MessageChannel = NativeMessageChannel;
  await rm(output, { recursive: true, force: true });
}

