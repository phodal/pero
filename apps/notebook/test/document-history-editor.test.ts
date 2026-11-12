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
  let edits = 0, undos = 0, backs = 0;
  const document = { schemaVersion: 1, title: 'History', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'paragraph-one' }, content: [{ type: 'text', text: 'First revision' }] }] } };
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  const show = (value: typeof document, canUndo: boolean, snapshot = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookEditor, {
    document: value, content: value.content, entryId: 'a'.repeat(32), revision: 1,
    onChange: () => { edits++; }, historyControls: { canUndo, canRedo: !canUndo, undo: () => { undos++; }, redo: () => {} },
    readonly: snapshot, chrome: { status: 'Revision 1', snapshot, onBack: () => { backs++; } },
  })));
  await show(document, false);
  const editor = (globalThis.document.querySelector('.tiptap') as HTMLElement & { editor: any }).editor;
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
  await React.act(async () => ([...globalThis.document.querySelectorAll('[role="tab"]')].find(node => node.textContent === 'Procedures') as HTMLElement).focus());
  const procedures = globalThis.document.querySelector('[role="tabpanel"][data-state="active"]')!;
  await click(procedures.querySelector('button[aria-label="Undo"]')!);
  assert.equal(undos, 2, 'Procedure changes retain document history controls');
  await show(document, false, true);
  assert.equal(procedures.querySelector('button[aria-label="Undo"]'), null);
  await click([...globalThis.document.querySelectorAll('.notebook-documentbar button')].find(node => node.textContent === 'Return to current notebook')!);
  assert.equal(backs, 1, 'Snapshot navigation remains available from Procedures');
  await render(null);
  await React.act(async () => editor.destroy());
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

test('quick import, cell edit and worksheet rename remain separate whole-document undo units', async t => {
  const { ui } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    export { Editor } from '@tiptap/core'; export { notebookExtensions } from './editor-extensions';
    export { notebookHistoryGroup } from './editor-history'; export { renameWorksheet } from './worksheet-model';
    export { documentHistory, transitionDocument } from '@pero/notebook/document-history';
  ` });
  let now = 100;
  let state = ui.documentHistory({ schemaVersion: 1, title: 'History', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'text' } }] } });
  const editor = new ui.Editor({ extensions: ui.notebookExtensions, content: state.present.content,
    onUpdate: ({ editor: instance, transaction }: any) => {
      state = ui.transitionDocument(state, { type: 'edit', document: { ...state.present, content: instance.getJSON() }, group: ui.notebookHistoryGroup(transaction), at: now++ });
    },
  });
  editor.commands.insertContentAt(1, 'A'); editor.commands.insertContentAt(2, 'B');
  assert.equal(state.past.length, 1, 'consecutive prose typing is grouped');
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'spreadsheet', attrs: { blockId: 'sheet', label: 'Controls', sheet: { rows: 1, columns: 1, cells: { A1: '2' } } } });
  const position = editor.state.doc.content.firstChild.nodeSize;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...editor.state.doc.nodeAt(position).attrs, sheet: { rows: 1, columns: 1, cells: { A1: '4' } } }));
  ui.renameWorksheet(editor, 'sheet', 'Calibration data');
  assert.equal(state.past.length, 4, 'structural and widget edits never merge just because they occur quickly');
  const undone = ui.transitionDocument(state, { type: 'undo' }).present.content.content.find((node: any) => node.type === 'spreadsheet');
  assert.equal(undone.attrs.label, 'Controls'); assert.equal(undone.attrs.sheet.cells.A1, '4');
  editor.destroy();
});
