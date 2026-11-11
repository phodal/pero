import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';
const rich = (id: string, text: string) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] }] });

test('nested materials edit/reorder real drafts and select only returned local records with pinned versions', async t => {
  const { React, ui, dom, render, click } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { ProcedureMaterials } from './procedure-materials'; export { changeProcedures } from '@pero/notebook/workspace'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let procedure: any = { id: 'p', title: 'Method', description: '', materials: [{ id: 'mixture', name: 'Mixture', quantity: '2 mL', children: [{ id: 'buffer', name: 'Buffer', quantity: '1 mL' }] }], steps: [] };
  const calls: any[] = [];
  let delayed = false, finish: (() => void) | undefined;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method });
    if (delayed) await new Promise<void>(resolve => { finish = resolve; });
    const params = new URL(String(input), 'http://localhost').searchParams;
    return new Response(JSON.stringify({ source: 'notebook-local-catalog', catalogId: 'local-catalog', query: { schemaId: params.get('schemaId'), text: params.get('text'), limit: 100 }, refreshedAt: '2026-11-09T00:00:00Z', total: 1, records: [{ id: 'record', version: 7, schemaId: 'schema', schemaRevision: 3, tableId: 'registered-table', rowId: 'registered-row', name: 'Registered buffer', registeredAt: '2026-11-09T00:00:00Z', values: { name: { type: 'text', value: 'Registered buffer' } }, columns: [{ id: 'name', name: 'Name', type: 'text', required: true, options: [], units: [] }] }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  let readonly = false;
  function Harness() { const [value, setValue] = React.useState(procedure); procedure = value; return React.createElement(ui.ProcedureMaterials, { procedure: value, readonly, onCopyLink() {}, apply(change: any) { const result = ui.changeProcedures([value], change); assert.equal(result.status, 'ok'); setValue(result.procedures[0]); } }); }
  const draw = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(Harness)));
  const button = (text: string, scope: ParentNode = document) => { const value = [...scope.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text); assert.ok(value, text); return value; };
  await draw();
  const root = () => document.querySelector('[data-material-id="mixture"]')!;
  await click(button('Add component', root()));
  assert.equal(procedure.materials[0].children.length, 2);
  await click(button('Move material 1.2 up'));
  assert.equal(procedure.materials[0].children[1].id, 'buffer');
  await click(button('Select registered material', document.querySelector('[data-material-id="buffer"]')!));
  assert.equal(calls.length, 0, 'picker does not invent or automatically select catalog data');
  await click(button('Find records'));
  await click(button('Use Registered buffer · v7'));
  const selected = procedure.materials[0].children[1];
  assert.equal(selected.name, 'Registered buffer'); assert.equal(selected.quantity, '1 mL');
  assert.deepEqual(selected.source, { source: 'notebook-local-catalog', catalogId: 'local-catalog', recordId: 'record', version: 7, schemaId: 'schema', schemaRevision: 3 });
  assert.equal(document.querySelector('dialog'), null);
  delayed = true;
  await click(button('Select registered material', root())); await click(button('Find records'));
  assert.ok(finish);
  await click(button('Close'));
  await React.act(async () => finish!());
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(procedure.materials[0].source, undefined, 'closed request cannot select a record');
  await click(button('Remove material 1.1')); assert.equal(procedure.materials[0].children.length, 1);
  readonly = true; await draw();
  assert.equal([...document.querySelectorAll('button')].some(item => item.textContent === 'Select registered material' || item.textContent === 'Add component'), false);
  assert.ok([...document.querySelectorAll('input')].every(input => input.readOnly));
  assert.ok(calls.every(call => !call.method || call.method === 'GET'), 'material selection never registers or reserves stock');
});

test('workspace deep links switch the selected procedure, reveal rich blocks and retain unsaved Notes without a document edit', async t => {
  let dispose = async () => {}; t.after(() => dispose());
  const { React, ui, dom, render, click } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { NotebookWorkspace } from './workspace-views'; export { notebookExtensions } from './editor-extensions'; export { Editor } from '@tiptap/core'; export { EditorContent } from '@tiptap/react'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const content = rich('main', 'Unsaved observation');
  const documentValue: any = { schemaVersion: 1, title: 'Method', content, procedures: [
    { id: 'first', title: 'First method', description: 'Legacy introduction', materials: [], steps: [] },
    { id: 'second', title: 'Second method', description: 'Old text', introduction: rich('intro', 'Rich introduction'), materials: [{ id: 'buffer', name: 'Buffer', quantity: '1 mL', content: rich('material-body', 'Keep on ice') }], steps: [] },
  ] };
  const editor = new ui.Editor({ extensions: ui.notebookExtensions, content });
  let edits = 0;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  const draw = (readonly = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookWorkspace, { editor, entryId: 'entry', revision: 1, document: documentValue, readonly, onChange: () => { edits++; } }, React.createElement(ui.EditorContent, { editor }))));
  await draw();
  dispose = () => React.act(async () => { for (const element of document.querySelectorAll('.tiptap')) (element as any).editor?.destroy(); editor.destroy(); });
  const hash = async (id: string) => React.act(async () => { dom.window.history.replaceState(null, '', `#notebook-entry=entry&notebook-target=${id}`); dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange')); });
  await hash('material-body');
  assert.equal(document.querySelector('[role="tab"][data-state="active"]')!.textContent, 'Procedures');
  const label = [...document.querySelectorAll('label')].find(item => item.textContent === 'Procedure title')!;
  assert.equal((document.getElementById(label.htmlFor) as HTMLInputElement).value, 'Second method');
  const materialEditor = (document.querySelector('[data-material-id="buffer"] .tiptap') as any).editor;
  assert.equal(materialEditor.state.selection.node?.attrs.blockId, 'material-body');
  assert.equal(editor.getText(), 'Unsaved observation');
  await hash('main');
  const activeNotes = document.querySelector('[role="tab"][data-state="active"]')!;
  assert.equal(activeNotes.getAttribute('aria-label'), 'Notes');
  assert.equal(activeNotes.textContent, 'Notes');
  assert.equal((document.querySelector('[data-notebook-document-edit]') as HTMLInputElement).value, documentValue.title);
  assert.equal(editor.state.selection.node?.attrs.blockId, 'main');
  await hash('intro'); await hash('first');
  assert.equal((document.getElementById([...document.querySelectorAll('label')].find(item => item.textContent === 'Procedure title')!.htmlFor) as HTMLInputElement).value, 'First method');
  assert.equal(edits, 0, 'navigation never changes the draft');
  await hash('deleted'); assert.match(document.body.textContent!, /no longer in the document/);
  await draw(true); await hash('material-body');
  assert.equal((document.querySelector('[data-material-id="buffer"] .tiptap') as any).editor.isEditable, false);
  const notesTab = document.querySelector('[role="tab"][aria-label="Notes"]')!;
  await click(notesTab); assert.equal(editor.getText(), 'Unsaved observation');
});
