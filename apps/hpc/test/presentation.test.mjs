import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const benchmark = { id: 'pi-midpoint-v1', name: 'Pi', version: '1', description: 'Pi quadrature', available: true, specDigest: 'current', parameters: {}, criteria: {}, environment: {} };
const run = { id: 'current-run', benchmarkId: benchmark.id, benchmarkName: benchmark.name, specDigest: benchmark.specDigest, status: 'completed', operation: null, createdAt: '2026-11-03T00:00:00Z', verification: null, artifacts: [], logs: '' };

test('method summary separates execution from verification and keeps earlier specifications in history', async t => {
  const { React, dom, ui, render, click } = await createUiRuntime(t, {
    resolveDir: resolve(import.meta.dirname, '../ui-src'),
    contents: `export { default as Hpc } from './index'; export { MethodSpec } from './method'; export { AppApiProvider } from '@pero/app-sdk'; export { messages } from './messages';`,
  });
  const h = React.createElement;
  const selectTab = async label => React.act(async () => {
    [...document.querySelectorAll('[role=tab]')].find(el => el.textContent === label)
      .dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  });
  const translate = key => ui.messages[key].en;
  for (const [status, verification, expected] of [
    ['completed', null, 'pending'], ['completed', { status: 'pass' }, 'pass'],
    ['completed', { status: 'fail' }, 'fail'], ['completed', { status: 'incomplete' }, 'incomplete'],
    ['running', null, 'running'], ['failed', null, 'failed'],
    ['cancelled', null, 'cancelled'], ['interrupted', null, 'interrupted'],
  ]) {
    await render(h(ui.MethodSpec, { benchmark, latestRun: { ...run, status, verification }, t: translate, onOpen() {} }));
    assert.equal(document.querySelector('.latest-run .status').textContent, translate(expected));
    assert.ok(document.querySelector(`.latest-run .status-${expected}`));
  }
  await render(null);
  const old = { ...run, id: 'old-run', specDigest: 'previous', verification: { status: 'pass', metrics: {}, thresholds: {}, errors: [] } };
  let runs = [old, run];
  let reframeAvailable = true;
  const fetch = async url => new Response(JSON.stringify(String(url).endsWith('/api/state')
    ? { benchmarks: [benchmark], runs, runtime: { reframeAvailable, message: 'ReFrame is unavailable in the selected environment' } }
    : { run: old }), { headers: { 'Content-Type': 'application/json' } });
  const props = { appName: 'hpc', locale: 'en', allowedApiPaths: ['/api'], allowedEvents: [], fetch, subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {} };
  await render(h(ui.AppApiProvider, props, h(ui.Hpc)));
  assert.equal(document.querySelector('.latest-run .status').textContent, 'Pending');
  await selectTab('Results');
  const rows = [...document.querySelectorAll('.run-table tbody tr')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.prior-specification').textContent, 'Prior specification');
  assert.equal(rows[1].querySelector('.prior-specification'), null);
  await click(rows[0].querySelector('button'));
  assert.match(document.querySelector('.run-evidence').textContent, /old-run/);
  runs = [old];
  await click(document.querySelector('button[aria-label=Refresh]'));
  await selectTab('Method');
  assert.equal(document.querySelector('.latest-run'), null);

  assert.equal(document.querySelector('.app-header').getAttribute('aria-label'), 'HPC Benchmarks');
  assert.equal(document.querySelector('.app-header h1'), null, 'the workbench tab already names the App');
  assert.equal(document.querySelector('.workspace-heading h2').textContent, benchmark.name);
  assert.equal(document.querySelector('button[aria-label=Refresh]').disabled, false);
  assert.ok([...document.querySelectorAll('.app-header button')].some(el => el.textContent === 'Run local reference'));

  reframeAvailable = false;
  await click(document.querySelector('button[aria-label=Refresh]'));
  assert.equal([...document.querySelectorAll('.app-header button')].find(el => el.textContent === 'Run local reference').disabled, true);
  assert.match([...document.querySelectorAll('[role=status]')].map(el => el.textContent).join(' '), /ReFrame is unavailable/);
});
