import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('file tree distinguishes equal basenames by path and preserves controlled selection after reordering', async t => {
  const env = await createUiRuntime(t, 'file-tree');
  if (!env) return;
  const { React, dom, ui, render } = env;
  const picked = [];
  const paths = ['src/main/Slice.java', 'src/test/Slice.java', 'pom.xml'];
  const show = (selectedPath, next = paths) => render(React.createElement(ui.FileTree, { paths: next, selectedPath, onSelect: p => picked.push(p), label: 'Files' }));
  await show(paths[0]);
  const item = path => document.querySelector(`[aria-label="${path}"]`);
  assert.ok(item(paths[0]) && item(paths[1]));
  await React.act(async () => {
    item(paths[1]).focus();
    item(paths[1]).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    item(paths[1]).dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  });
  assert.ok(picked.includes(paths[1]), JSON.stringify(picked));
  await show(paths[1], [...paths].reverse());
  assert.equal(item(paths[1]).getAttribute('aria-selected'), 'true');
  assert.equal(item(paths[0]).getAttribute('aria-selected'), 'false');
});
