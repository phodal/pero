import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardSize, paneLimit, readStoredSizes, resizeDelta, separatorPane, shownPaneSize, type SplitPaneSpec } from './split.ts';

const preview: SplitPaneSpec[] = [
  { id: 'list', size: null, min: 320 },
  { id: 'preview', size: 380, min: 280 },
];

const workbench: SplitPaneSpec[] = [
  { id: 'fields', size: 190, min: 160 },
  { id: 'records', size: null, min: 240 },
  { id: 'chart', size: 280, min: 200 },
];

test('a preview split resizes the sized pane and keeps the list readable', () => {
  assert.deepEqual(separatorPane(preview[0], preview[1]), { id: 'preview', side: 'end' });
  assert.equal(paneLimit(preview, 'preview', { preview: 380 }, 1000), 680);
  assert.equal(shownPaneSize(900, 280, 680), 680);
  assert.equal(shownPaneSize(100, 280, 680), 280);
  assert.equal(resizeDelta('end', -40, false), 40);
  assert.equal(resizeDelta('end', 40, false), -40);
  assert.equal(resizeDelta('start', 40, false), 40);
  assert.equal(resizeDelta('end', -40, true), -40);
});

test('each separator resizes the sized neighbor in a three-pane workbench', () => {
  assert.deepEqual(separatorPane(workbench[0], workbench[1]), { id: 'fields', side: 'start' });
  assert.deepEqual(separatorPane(workbench[1], workbench[2]), { id: 'chart', side: 'end' });
  assert.equal(separatorPane({ id: 'a', size: null, min: 10 }, { id: 'b', size: null, min: 10 }), null);
  const sizes = { fields: 190, chart: 280 };
  assert.equal(paneLimit(workbench, 'fields', sizes, 1000), 480);
  assert.equal(paneLimit(workbench, 'chart', sizes, 1000), 570);
});

test('stored sizes keep an in-range width and otherwise use the default', () => {
  assert.deepEqual(readStoredSizes(null, preview), { preview: 380 });
  assert.deepEqual(readStoredSizes('600', preview), { preview: 600 });
  assert.deepEqual(readStoredSizes('{"preview":500,"list":10}', preview), { preview: 500 });
  assert.deepEqual(readStoredSizes('{"preview":10}', preview), { preview: 380 });
  assert.deepEqual(readStoredSizes('nope', preview), { preview: 380 });
  assert.deepEqual(readStoredSizes('{"fields":220,"chart":40}', workbench), { fields: 220, chart: 280 });
});

test('keyboard moves a separator toward the opposite pane', () => {
  assert.equal(keyboardSize(380, 'ArrowLeft', false, false, 'end', 280, 680), 396);
  assert.equal(keyboardSize(380, 'ArrowRight', false, false, 'end', 280, 680), 364);
  assert.equal(keyboardSize(380, 'ArrowRight', true, false, 'end', 280, 680), 300);
  assert.equal(keyboardSize(380, 'Home', false, false, 'end', 280, 680), 680);
  assert.equal(keyboardSize(380, 'End', false, false, 'end', 280, 680), 280);
  assert.equal(keyboardSize(190, 'ArrowRight', false, false, 'start', 160, 500), 206);
  assert.equal(keyboardSize(190, 'Home', false, false, 'start', 160, 500), 160);
  assert.equal(keyboardSize(190, 'End', false, false, 'start', 160, 500), 500);
  assert.equal(keyboardSize(380, 'ArrowLeft', false, true, 'end', 280, 680), 364);
  assert.equal(keyboardSize(380, 'Enter', false, false, 'end', 280, 680), null);
});
