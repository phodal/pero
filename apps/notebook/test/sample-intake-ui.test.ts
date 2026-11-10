import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const snapshot = { source: 'notebook-local-catalog', catalogId: 'local', query: { text: '', schemaId: '', limit: 200 }, refreshedAt: '2026-11-09T00:00:00Z', total: 2, records: ['A', 'B'].map((box, index) => ({
  id: `record${index}`, name: `Sample ${box}`, version: 1, schemaId: 'samples', schemaRevision: 1, tableId: 'table', rowId: `row${index}`, registeredAt: '2026-11-09T00:00:00Z',
  columns: [{ id: 'box', name: 'Storage box', type: 'text', required: true, units: [], options: [] }], values: { box: { type: 'text', value: box } },
})) };

test('catalog browsing resolves actual returned fields and stage/apply edits the live destination only', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    export * from './sample-catalog'; export * from './sample-propagation';
    export { sampleIntakeDefaults, bindCatalogSelection } from '@pero/notebook/sample-intake';
    export { Editor, Node } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
  ` });
  const { React, ui, render, click, dom } = runtime;
  let intake = structuredClone(ui.sampleIntakeDefaults.intake), response = snapshot, fail = false;
  const calls: string[] = [];
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string) => {
    calls.push(String(input));
    return new Response(JSON.stringify(fail ? { detail: 'Catalog unavailable' } : response), { status: fail ? 500 : 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const mount = (child: any) => render(React.createElement(ui.AppSdkProvider, { host }, child));
  const button = (name: string) => {
    const node = [...document.querySelectorAll('button')].find(item => item.textContent === name);
    assert.ok(node, `Missing button ${name}`); return node;
  };
  const act = (action: () => void) => React.act(async () => action());
  const fill = async (name: string, value: string) => act(() => {
    const label = [...document.querySelectorAll('label')].find(item => item.textContent === name);
    const node = document.querySelector(`[aria-label="${name}"]`) ?? (label ? document.getElementById(label.htmlFor) : null);
    assert.ok(node, `Missing control ${name}`);
    const constructor = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement : dom.window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(constructor.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const catalog = () => mount(React.createElement(ui.SampleCatalogBrowser, { intake, editable: true, onChange: (next: any) => { intake = next; } }));
  await catalog();
  assert.equal(calls.length, 0);
  await click(button('Load catalog records'));
  assert.ok(calls[0].includes('/api/catalog/lookup?'));
  await fill('Box / location text column', 'box'); await fill('Box / location value', 'B');
  assert.match(document.body.textContent!, /Sample B/); assert.doesNotMatch(document.body.textContent!, /Sample A/);
  await click(button('Select displayed samples'));
  assert.equal(intake.bindings[0].snapshot.records[0].id, 'record1');
  assert.equal(intake.bindings[0].source.field, '$id');
  await catalog(); assert.equal(button('Select displayed samples').disabled, true);
  fail = true; await click(button('Load catalog records'));
  assert.match(document.body.textContent!, /Catalog unavailable/); assert.match(document.body.textContent!, /Sample B/);
  assert.equal(intake.bindings.length, 1);
  fail = false; response = { ...snapshot, total: 201 }; await click(button('Load catalog records'));
  assert.match(document.body.textContent!, /Showing 2 of 201/); assert.equal(button('Select displayed samples').disabled, true);

  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const element = document.createElement('div'); document.body.append(element);
  const source = ui.bindCatalogSelection(structuredClone(ui.sampleIntakeDefaults.intake), snapshot, ['record0']);
  const destination = { ...structuredClone(ui.sampleIntakeDefaults.intake), name: 'Receiving batch' };
  editor = new ui.Editor({ element, extensions: [ui.StarterKit.configure({ trailingNode: false }), ui.Node.create({
    name: 'sampleIntake', group: 'block', atom: true, addAttributes() { return { blockId: { default: '' }, intake: { default: null } }; }, renderHTML() { return ['div']; },
  })], content: { type: 'doc', content: [
    { type: 'sampleIntake', attrs: { blockId: 'source', intake: source } }, { type: 'sampleIntake', attrs: { blockId: 'destination', intake: destination } }, { type: 'paragraph' },
  ] } });
  const blocks = () => editor.getJSON().content.filter((node: any) => node.type === 'sampleIntake');
  const view = { editor, node: editor.state.doc.nodeAt(0) };
  await mount(React.createElement(ui.SamplePropagation, { view }));
  await fill('Destination intake block', 'destination'); await click(button('Stage propagation'));
  assert.equal(blocks()[1].attrs.intake.bindings.length, 0);
  assert.match(document.body.textContent!, /1 pinned bindings will be appended/);
  await click(button('Cancel staged propagation')); assert.equal(blocks()[1].attrs.intake.bindings.length, 0);
  await click(button('Stage propagation'));
  await act(() => editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, { blockId: 'destination', intake: { ...destination, name: 'Changed target' } })));
  await click(button('Apply staged bindings')); assert.match(document.body.textContent!, /Source or destination changed/);
  assert.equal(blocks()[1].attrs.intake.bindings.length, 0);
  await click(button('Stage propagation'));
  // A benign positional change must not target a different block or invalidate identity.
  await act(() => editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: 'prefix' }] }));
  await click(button('Apply staged bindings'));
  assert.deepEqual(blocks()[1].attrs.intake.bindings, source.bindings);
  assert.deepEqual(blocks()[0].attrs.intake.bindings, source.bindings);
  await click(button('Stage propagation')); assert.match(document.body.textContent!, /duplicate records/);
});
