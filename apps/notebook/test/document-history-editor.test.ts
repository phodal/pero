import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('whole-document undo controls replace Notes content without recording another edit', async t => {
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { NotebookEditor } from './editor';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const { React, ui, render, click } = runtime;
  let edits = 0, undos = 0;
  const document = { schemaVersion: 1, title: 'History', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'paragraph-one' }, content: [{ type: 'text', text: 'First revision' }] }] } };
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  const show = (value: typeof document, canUndo: boolean) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookEditor, {
    document: value, content: value.content, entryId: 'a'.repeat(32), revision: 1,
    onChange: () => { edits++; }, historyControls: { canUndo, canRedo: !canUndo, undo: () => { undos++; }, redo: () => {} },
  })));
  await show(document, false);
  const undo = () => documentNode('Undo');
  function documentNode(label: string): HTMLButtonElement {
    const button = globalThis.document.querySelector(`button[aria-label="${label}"]`);
    assert.ok(button); return button as HTMLButtonElement;
  }
  assert.equal(undo().disabled, true);
  await show({ ...document, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'paragraph-one' }, content: [{ type: 'text', text: 'Restored snapshot' }] }] } }, true);
  assert.match(globalThis.document.querySelector('.notebook-prose')?.textContent ?? '', /Restored snapshot/);
  assert.equal(edits, 0);
  assert.equal(undo().disabled, false);
  await click(undo());
  assert.equal(undos, 1);
  assert.equal(edits, 0);
});

test('document shortcuts leave review and transient dialog inputs to local undo', async t => {
  const { React, ui, render } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { documentHistoryShortcut } from './workspace-views';`,
  });
  await render(React.createElement('div', null,
    React.createElement('input', { id: 'title', 'data-notebook-document-edit': true }),
    React.createElement('div', { className: 'notebook-editor' }, React.createElement('textarea', { id: 'notes' })),
    React.createElement('div', { 'data-notebook-document-edit': true },
      React.createElement('input', { id: 'procedure' }),
      React.createElement('div', { role: 'dialog' }, React.createElement('input', { id: 'dialog' }))),
    React.createElement('input', { id: 'metadata', 'data-notebook-document-edit': true }),
    ...['review', 'search', 'template', 'new-tag'].map(id => React.createElement('input', { id, key: id })),
  ));
  const event = (id: string, changes = {}) => ({ target: document.getElementById(id), key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...changes });
  for (const id of ['title', 'notes', 'procedure', 'metadata']) {
    assert.equal(ui.documentHistoryShortcut(event(id)), 'undo', id);
    assert.equal(ui.documentHistoryShortcut(event(id, { shiftKey: true })), 'redo', id);
    assert.equal(ui.documentHistoryShortcut(event(id, { key: 'y' })), 'redo', id);
    assert.equal(ui.documentHistoryShortcut(event(id, { ctrlKey: false, metaKey: true })), 'undo', id);
  }
  for (const id of ['review', 'search', 'template', 'dialog', 'new-tag']) assert.equal(ui.documentHistoryShortcut(event(id)), null, id);
  assert.equal(ui.documentHistoryShortcut(event('notes', { altKey: true })), null);
  assert.equal(ui.documentHistoryShortcut(event('notes', { key: 'a' })), null);
});
