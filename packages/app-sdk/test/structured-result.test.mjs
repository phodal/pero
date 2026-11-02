import test from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURED_RESULT_LIMITS, PROVENANCE_KINDS, PROVENANCE_REF_TYPES, truncateStructuredResult, validateStructuredResult } from '../src/structured-result.mjs';
import { createUiRuntime } from './ui-test-runtime.mjs';

const prov = { kind: 'calculated', label: 'Data Lab run', ref: { type: 'run', id: 'run_1', digest: 'sha256:ab' } };
const table = (extra = {}) => ({ version: 1, kind: 'table', title: 'Groups', columns: ['group', 'mean'], rows: [['a', 1.5], ['b', null]], provenance: prov, ...extra });
const chart = (extra = {}) => ({ version: 1, kind: 'chart', chart: 'bar', title: 'Means', unit: 'V', series: [{ name: 'mean', points: [['a', 1], ['b', -2]] }], provenance: prov, ...extra });

test('accepts bounded tables and charts', () => {
  assert.equal(validateStructuredResult(table()).ok, true);
  assert.equal(validateStructuredResult(chart()).ok, true);
  assert.equal(validateStructuredResult(chart({ chart: 'line', series: [{ name: 's', points: [[1, 2], [2, null]] }] })).ok, true);
});

test('rejects missing provenance, ragged rows, non-finite values, unknown fields, and overflow', () => {
  const bad = [
    table({ provenance: undefined }), table({ provenance: { kind: 'guess', label: 'x' } }), table({ provenance: { kind: 'sourced', label: ' ' } }),
    table({ rows: [['a']] }), table({ rows: [['a', { html: '<b>' }]] }), table({ rows: [['a', Infinity]] }),
    table({ columns: Array(13).fill('c'), rows: [] }), table({ rows: Array(201).fill(['a', 1]) }), table({ script: 'x' }),
    chart({ series: [{ name: 's', points: [['a', NaN]] }] }), chart({ chart: 'pie' }), chart({ series: Array(7).fill({ name: 's', points: [] }) }),
    chart({ provenance: { kind: 'sourced', label: 'x', ref: { type: 'url', id: 'javascript:alert(1)' } } }),
    { ...table(), version: 2 }, null, 'table',
  ];
  for (const value of bad) assert.equal(validateStructuredResult(value).ok, false, JSON.stringify(value)?.slice(0, 80));
});

test('truncate clips to limits and records omitted counts', () => {
  const t = truncateStructuredResult(table({ rows: Array(250).fill(['a', 1]) }));
  assert.equal(t.rows.length, 200); assert.deepEqual(t.truncated, { rows: 50 }); assert.equal(validateStructuredResult(t).ok, true);
  const c = truncateStructuredResult(chart({ chart: 'line', series: [{ name: 's', points: Array.from({ length: 510 }, (_, i) => [i, i]) }] }));
  assert.equal(c.series[0].points.length, 500); assert.deepEqual(c.truncated, { points: 10 }); assert.equal(validateStructuredResult(c).ok, true);
});

test('truncate records whole dropped series and keeps prior counts', () => {
  const seven = chart({ chart: 'line', series: Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, points: [[1, i]] })) });
  const c = truncateStructuredResult(seven);
  assert.equal(c.series.length, 6); assert.deepEqual(c.truncated, { series: 1, points: 1 });
  assert.equal(validateStructuredResult(c).ok, true);
  const again = truncateStructuredResult({ ...seven, truncated: { points: 4, series: 2 } });
  assert.deepEqual(again.truncated, { series: 3, points: 5 });
});

test('chart x values must be unique within a series', () => {
  assert.equal(validateStructuredResult(chart({ series: [{ name: 's', points: [['a', 1], ['a', 2]] }] })).ok, false);
});

test('ResultView renders table, chart, states, notices, and provenance natively', async (t) => {
  const runtime = await createUiRuntime(t, 'result-view');
  if (!runtime) return;
  const { React, ui: { ResultView }, render, click } = runtime;
  const h = React.createElement;
  const root = document.getElementById('root');
  await render(h(ResultView, { loading: true }));
  assert.equal(root.querySelector('[role=status]').getAttribute('aria-busy'), 'true');
  await render(h(ResultView, { error: 'boom' }));
  assert.equal(root.querySelector('[role=alert]').textContent, 'boom');
  await render(h(ResultView, { result: table({ rows: [['<img src=x onerror=1>', 2]] }) }));
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('td').textContent, '<img src=x onerror=1>');
  assert.equal(root.querySelector('caption').textContent, 'Groups');
  assert.equal(root.querySelectorAll('th[scope=col]').length, 2);
  assert.equal(root.querySelector('td[data-numeric]').textContent, '2');
  assert.match(root.querySelector('.pero-ui-result-source').textContent, /Calculated.*Data Lab run.*run:run_1/);
  await render(h(ResultView, { result: table({ rows: [], truncated: { rows: 3 } }) }));
  assert.match(root.textContent, /No rows to display/); assert.match(root.querySelector('[role=note]').textContent, /3 more rows/);
  await render(h(ResultView, { result: table({ provenance: undefined }) }));
  assert.equal(root.querySelector('[data-state=invalid]').getAttribute('role'), 'alert');
  const opened = [];
  await render(h(ResultView, { result: chart(), onOpenRef: ref => opened.push(ref), labels: { source: '来源' } }));
  assert.equal(root.querySelectorAll('svg rect').length, 2);
  assert.match(root.querySelector('svg').getAttribute('aria-label'), /Means: bar chart, 1 series, 2 x values/);
  assert.equal(root.querySelectorAll('details tbody tr').length, 2);
  assert.match(root.querySelector('.pero-ui-result-source').textContent, /来源/);
  await click(root.querySelector('.pero-ui-result-ref'));
  assert.deepEqual(opened, [prov.ref]);
  assert.ok(document.getElementById('pero-app-ui-styles'));
});

test('ResultView: readable x labels, host-labelled title, tab stop only when scrollable', async (t) => {
  const runtime = await createUiRuntime(t, 'result-view');
  if (!runtime) return;
  const { React, ui: { ResultView }, render, dom: { window } } = runtime;
  const h = React.createElement;
  const root = document.getElementById('root');
  const long = 'Iris-versicolor-with-a-long-name';
  await render(h(ResultView, { result: chart({ series: [{ name: 'mean', points: [[long, 1], ['Iris-virginica', 2]] }] }) }));
  const ticks = [...root.querySelectorAll('.pero-ui-result-xticks li')];
  assert.deepEqual(ticks.map(li => li.textContent), [long, 'Iris-virginica']);
  assert.equal(ticks[0].getAttribute('title'), long);
  assert.equal(root.querySelector('svg text[text-anchor=middle]'), null);
  await render(h('div', null, h('h2', { id: 'host' }, 'Groups'), h(ResultView, { labelledBy: 'host', result: table() })));
  const section = root.querySelector('section');
  assert.equal(section.getAttribute('aria-labelledby'), 'host'); assert.equal(section.getAttribute('aria-label'), null);
  assert.ok(root.querySelector('caption').classList.contains('pero-ui-visually-hidden'));
  assert.equal(root.querySelectorAll('[role=region]').length, 0);
  const scroll = root.querySelector('.pero-ui-result-scroll');
  assert.equal(scroll.getAttribute('tabindex'), null);
  await render(h(ResultView, { labelledBy: 'none', result: chart() }));
  assert.equal(root.querySelector('.pero-ui-result-title'), null);
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.classList?.contains('pero-ui-result-scroll') ? 900 : 0; } });
  t.after(() => delete window.HTMLElement.prototype.scrollWidth);
  await render(h(ResultView, { result: table({ title: 'Wide' }) }));
  const wide = root.querySelector('.pero-ui-result-scroll');
  assert.equal(wide.getAttribute('tabindex'), '0'); assert.equal(wide.getAttribute('role'), 'group'); assert.equal(wide.getAttribute('aria-label'), 'Wide');
});
