import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('a hidden inspector restores its saved width when opened and after remount', async t => {
  const { React, dom, ui, render } = await createUiRuntime(t, 'split');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
  localStorage.setItem('inspector-width', JSON.stringify({ inspector: 460 }));
  const tree = hidden => React.createElement(ui.Split, { storageKey: 'inspector-width' },
    React.createElement(ui.SplitPane, { id: 'content' }, 'Document'),
    React.createElement(ui.SplitPane, { id: 'inspector', hidden, size: 400, min: 320 }, 'Properties'));
  await render(tree(true));
  assert.equal(document.querySelector('[role=separator]'), null);
  assert.equal(document.querySelector('#inspector'), null);
  assert.equal(JSON.parse(localStorage.getItem('inspector-width')).inspector, 460);
  await render(tree(false));
  const handle = document.querySelector('[role=separator]');
  assert.equal(handle.getAttribute('aria-valuenow'), '460');
  await React.act(async () => handle.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  const resized = handle.getAttribute('aria-valuenow');
  assert.notEqual(resized, '460');
  await render(null);
  await render(tree(true));
  await render(tree(false));
  assert.equal(document.querySelector('[role=separator]').getAttribute('aria-valuenow'), resized);
});
