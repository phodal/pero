import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('table keeps sized columns and does not let a long cell crush neighbors', async t => {
  const env = await createUiRuntime(t, 'table');
  if (!env) return;
  const { React, ui, render } = env;
  const rows = [
    { id: 'a', name: 'ACCTMGMT', detail: 'A + B + C + D + E + F + G + H + I + J + K + L + M', stage: 'Implementing', updated: '2026-10-19 07:45' },
    { id: 'b', name: 'CIFMGMT', detail: 'short', stage: 'Pending', updated: '2026-10-18 12:00' },
  ];
  const opened = [];
  await render(React.createElement(ui.Table, {
    labelledBy: 'recent-title',
    rows,
    rowId: row => row.id,
    columns: [
      { id: 'job', header: 'Program', size: 360, minSize: 220, cell: row => React.createElement('button', { type: 'button', className: 'job', onClick: () => opened.push(row.id) }, row.name, React.createElement('div', { className: 'detail' }, row.detail)) },
      { id: 'stage', header: 'Stage', size: 96, minSize: 80, meta: { nowrap: true }, cell: row => row.stage },
      { id: 'updated', header: 'Updated', size: 148, minSize: 132, meta: { nowrap: true }, cell: row => row.updated },
    ],
  }));
  const table = document.querySelector('.pero-ui-table');
  assert.ok(table);
  assert.equal(table.getAttribute('aria-labelledby'), 'recent-title');
  assert.ok(Number.parseInt(table.style.minWidth, 10) >= 360 + 96 + 148);
  const cols = [...table.querySelectorAll('col')];
  assert.deepEqual(cols.map(col => col.style.width), ['360px', '96px', '148px']);
  assert.ok(table.querySelector('[data-nowrap]'));
  assert.ok(table.textContent.includes('ACCTMGMT'));
  assert.ok(table.textContent.includes('Implementing'));
  await React.act(async () => document.querySelector('.job').click());
  assert.deepEqual(opened, ['a']);
});
