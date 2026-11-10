import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('Home shows provenance, reuses saved local labels, preserves tags and honors read-only metadata', async t => {
  const { React, ui, dom, render, click } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { NotebookHome } from './notebook-home'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const documentValue = { schemaVersion: 1, title: 'Tracked record', metadata: { project: 'Project A', author: 'Author A', tags: ['retain'] },
    templateOrigin: { templateId: 'template', revision: 2, instanceId: 'instance', parameterValues: {}, idMap: {} }, content: { type: 'doc', content: [{ type: 'evidence', attrs: { blockId: 'evidence', source: { app: 'paper-agent', kind: 'report', id: 'source', version: 'v1', locator: 'recorded locator' } } }] } };
  const entry = { id: 'a'.repeat(32), title: 'Tracked record', revision: 3, updatedAt: '2026-11-09T00:00:00Z', document: documentValue };
  const host = ui.createAppHost({ name: 'notebook', allowedApiPaths: ['/api'], fetch: async () => Response.json({ scope: 'local-display-labels', limited: false, entries: [{ entryId: entry.id, title: entry.title, revision: 3, project: 'Project B', author: 'Author B' }] }) });
  let metadata: any, opened = '', closed = 0;
  const mount = (readonly = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookHome, { entry, document: documentValue, dirty: true, readonly, onMetadata: (value: unknown) => { metadata = value; }, onOpenEntry: (id: string) => { opened = id; }, onClose: () => { closed++; } })));
  const button = (text: string) => { const value = [...document.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(value, text); return value; };
  await mount(); assert.match(document.body.textContent!, /instance/); assert.match(document.body.textContent!, /paper-agent \/ report \/ source/); assert.match(document.body.textContent!, /does not change project membership/);
  const select = document.querySelector<HTMLSelectElement>('select')!;
  await React.act(async () => { select.value = 'Project B'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await click(button('Apply labels to draft'));
  assert.deepEqual(metadata, { project: 'Project B', author: 'Author A', tags: ['retain'] }); assert.equal(closed, 1);
  await click(button('Tracked record · v3')); assert.equal(opened, entry.id);
  await render(null); await mount(true); assert.equal(document.querySelectorAll('input:not([disabled])').length, 0);
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === 'Apply labels to draft'), false);
});

test('staged local files preview before insertion, cancel late reads, reject stale drafts and insert once with original digest', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const { React, ui, dom, render, click } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { FileIntakeDialog } from './file-intake'; export { notebookExtensions } from './editor-extensions'; export { Editor } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const element = document.createElement('div'); document.body.append(element);
  editor = new ui.Editor({ element, extensions: ui.notebookExtensions, content: '<p>Existing content</p>' });
  const host = ui.createAppHost({ name: 'notebook', allowedApiPaths: ['/api'], fetch: async () => assert.fail('Local staged import must not call a backend or remote account') });
  let inserts = 0, closed = 0;
  const mount = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.FileIntakeDialog, { editor, onClose: () => { closed++; }, onInsert: (nodes: any) => { inserts++; editor.commands.insertContentAt(editor.state.doc.content.size, nodes); } })));
  const button = (text: string) => { const value = [...document.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(value, text); return value; };
  const file = (name: string, text: string) => ({ name, type: 'text/plain', size: new TextEncoder().encode(text).length, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
  const choose = async (value: unknown) => React.act(async () => { const picker = document.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(picker, 'files', { configurable: true, value: [value] }); picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  const settle = async (condition: () => boolean) => { const until = Date.now() + 4000; while (!condition() && Date.now() < until) await React.act(async () => new Promise<void>(done => setImmediate(done))); assert.ok(condition(), document.body.textContent); };
  await mount(); await choose(file('observations.txt', 'Measured 2.5 mg.')); await settle(() => document.body.textContent!.includes('SHA-256:'));
  assert.equal(inserts, 0); assert.match(document.body.textContent!, /Measured 2.5 mg/);
  await React.act(async () => editor.commands.insertContentAt(1, 'changed '));
  await click(button('Insert reviewed file')); assert.equal(inserts, 0); assert.match(document.body.textContent!, /draft changed/);
  await click(button('Discard staged file')); assert.equal(editor.getJSON().content.some((node: any) => node.type === 'attachment'), false);
  let resolveRead: (() => void) | undefined;
  await choose({ name: 'late.txt', type: 'text/plain', size: 4, arrayBuffer: async () => { await new Promise<void>(done => { resolveRead = done; }); return new TextEncoder().encode('late').buffer; } });
  await click(button('Cancel file read')); await React.act(async () => resolveRead!());
  assert.equal(document.querySelector('[aria-label="Staged file"]'), null);
  await choose(file('observations.txt', 'Measured 2.5 mg.')); await settle(() => document.body.textContent!.includes('SHA-256:'));
  await React.act(async () => { button('Insert reviewed file').click(); button('Insert reviewed file').click(); });
  assert.equal(inserts, 1); assert.equal(closed, 1);
  const imported = editor.getJSON().content.find((node: any) => node.type === 'attachment'); assert.equal(imported.attrs.filename, 'observations.txt'); assert.match(imported.attrs.sha256, /^[a-f0-9]{64}$/);
  assert.equal(atob(imported.attrs.data), 'Measured 2.5 mg.');
  await React.act(async () => assert.ok(editor.commands.undo())); assert.equal(editor.getJSON().content.some((node: any) => node.type === 'attachment'), false);
});
