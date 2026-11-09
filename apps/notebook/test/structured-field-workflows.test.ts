import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';
import { canonicalStructuredTable } from '../../../packages/notebook/src/structured-table.ts';

const columns = [
  { id: 'name', name: 'Name', type: 'text', required: true, options: [], units: [] },
  { id: 'mass', name: 'Mass', type: 'quantity', required: false, options: [], units: ['mg', 'µg'] },
  { id: 'ref', name: 'Reference', type: 'object', required: false, options: [], units: [] },
];
const table = () => ({ id: 'target', name: 'Samples', schema: { id: 'target-schema', revision: 1, columns }, rows: [
  { id: 'row-a', cells: { name: 'First', mass: '1.20 mg' } }, { id: 'row-b', cells: { name: 'Second', ref: '{"manual":true}' } },
] });
const snapshot = (query: any) => ({ source: 'notebook-local-catalog', catalogId: 'local-catalog', query, refreshedAt: '2026-11-09T12:00:00Z', total: 1, records: [{
  id: 'source-record', name: 'Registered source', version: 3, schemaId: 'source-schema', schemaRevision: 2, tableId: 'source-table', rowId: 'source-row', registeredAt: '2026-11-09T11:00:00Z', columns,
  values: { name: { type: 'text', value: 'Source name' }, mass: { type: 'quantity', value: '0.50', unit: 'µg' }, ref: { type: 'missing' } },
}] });

async function fixture(t: any, fetch: (input: string, init?: RequestInit) => Promise<Response>) {
  let editor: any, dispose = async () => {};
  t.after(() => dispose());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export { NotebookContextProvider } from './notebook-context';
    export function Fixture({ content, capture, readonly }) {
      const editor = useEditor({extensions:notebookExtensions,content,editable:!readonly}); capture(editor);
      return <EditorContent editor={editor} />;
    }
  ` });
  const { React, ui, dom, render, click } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dispose = () => React.act(async () => editor?.destroy());
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch });
  let key = 0;
  let content: any, kind = 'inputTable', isReadonly = false, entryId = 'a'.repeat(32);
  const show = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookContextProvider, { value: { entryId, revision: 1, readonly: isReadonly, document: { content }, getDocument: () => ({ content }) } }, React.createElement(ui.Fixture, { key, readonly: isReadonly, capture(value: any) { editor = value; }, content }))));
  const mount = (type = 'inputTable', readonly = false) => {
    key++; kind = type; isReadonly = readonly; entryId = 'a'.repeat(32);
    content = { type: 'doc', content: [{ type: kind, attrs: { blockId: 'block', table: table(), receipts: [] } }] };
    return show();
  };
  const navigate = (identity = 'b'.repeat(32)) => { entryId = identity; return show(); };
  const button = (label: string, scope: ParentNode = document) => {
    const value = [...scope.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label);
    assert.ok(value, `Missing button ${label}: ${scope.textContent}`); return value as HTMLButtonElement;
  };
  const field = (label: string) => {
    const caption = [...document.querySelectorAll('label')].find(node => node.textContent === label);
    const node = caption ? document.getElementById(caption.htmlFor) : document.querySelector(`[aria-label="${label}"]`);
    assert.ok(node, `Missing field ${label}`); return node as HTMLInputElement;
  };
  const fill = (label: string, value: string) => React.act(async () => {
    const node = field(label), prototype = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const attrs = () => structuredClone(editor.getJSON().content.find((node: any) => node.type.endsWith('Table')).attrs);
  const change = (apply: (attrs: any) => any) => React.act(async () => editor.commands.command(({ tr }: any) => { const node = tr.doc.nodeAt(0); tr.setNodeMarkup(0, undefined, apply(node.attrs)); return true; }));
  const readonly = () => React.act(async () => editor.setEditable(false));
  const ready = async (label: string) => {
    for (let count = 0; count < 100 && button(label).disabled; count++) await React.act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
    assert.equal(button(label).disabled, false, `${label} never became available`);
  };
  return { ...runtime, mount, navigate, button, field, fill, attrs, change, readonly, ready, editor: () => editor };
}

const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('typed row pickers preserve units, copy only the selected cell, reject stale edits and ignore cancelled or superseded lookups', async t => {
  let delay = false, finish: (() => void) | null = null, loads = 0;
  const ui = await fixture(t, async input => {
    loads++;
    const url = new URL(String(input), 'http://localhost'), query = { schemaId: url.searchParams.get('schemaId') ?? '', text: url.searchParams.get('text') ?? '', limit: Number(url.searchParams.get('limit')) };
    if (delay) await new Promise<void>(resolve => { finish = resolve; });
    return json(snapshot(query));
  });
  const { mount, button, fill, attrs, field, click, change, readonly, React } = ui;
  await mount(); await fill('Mass, Row 1 unit', 'µg');
  assert.equal(attrs().table.rows[0].cells.mass, '1.20 µg');
  await fill('Mass, Row 1', '0'); assert.equal(attrs().table.rows[0].cells.mass, '0 µg');
  await change(attrs => ({ ...attrs, table: { ...attrs.table, schema: { ...attrs.table.schema, columns: attrs.table.schema.columns.map((col: any) => col.id === 'mass' ? { ...col, units: ['mg'] } : col) } } }));
  assert.equal(field('Mass, Row 1 unit').value, 'µg'); assert.match(document.body.textContent!, /Choose an allowed unit/);
  await fill('Mass, Row 1 unit', 'mg'); assert.equal(attrs().table.rows[0].cells.mass, '0 mg');
  await change(attrs => ({ ...attrs, table: { ...attrs.table, rows: attrs.table.rows.map((row: any) => row.id === 'row-a' ? { ...row, cells: { ...row.cells, mass: '  2.50 mg  ' } } : row) } }));
  assert.equal(field('Mass, Row 1').value, '2.50'); assert.equal(field('Mass, Row 1 unit').value, 'mg');
  assert.equal(attrs().table.rows[0].cells.mass, '  2.50 mg  ', 'rendering must not normalize stored draft text');

  const open = async (label = 'Reference, Row 2') => { await click(button(`Choose catalog value for ${label}`)); await click(button('Load matching records')); await fill('Catalog record', 'source-record'); };
  const original = structuredClone(attrs());
  await open(); assert.match(document.querySelector('dialog')!.textContent!, /source-record/);
  await click(button('Cancel')); assert.deepEqual(attrs(), original);
  await open(); await click(button('Apply selected value'));
  assert.equal(JSON.parse(attrs().table.rows[1].cells.ref).recordId, 'source-record');
  assert.equal(JSON.parse(attrs().table.rows[1].cells.ref).version, 3);
  assert.deepEqual(attrs().table.rows[0], original.table.rows[0]);
  await open('Name, Row 2'); await fill('Value to insert', 'field:name'); await click(button('Apply selected value'));
  assert.equal(attrs().table.rows[1].cells.name, 'Source name'); assert.equal(attrs().table.rows[0].cells.name, 'First');
  await open('Mass, Row 2'); await fill('Value to insert', 'field:mass');
  assert.equal(button('Apply selected value').disabled, true, 'source unit is not allowed in the changed target schema');
  await click(button('Cancel'));

  await open(); await change(attrs => ({ ...attrs, table: { ...attrs.table, name: 'Newer table' } }));
  const newer = structuredClone(attrs()); await click(button('Apply selected value'));
  assert.deepEqual(attrs(), newer); assert.match(document.querySelector('dialog')!.textContent!, /table changed while the picker was open/);
  await click(button('Cancel'));

  delay = true; await click(button('Choose catalog value for Reference, Row 2')); await click(button('Load matching records'));
  assert.ok(finish); const oldRequest = finish;
  await click(button('Cancel')); delay = false; await open();
  await React.act(async () => oldRequest!());
  assert.equal(field('Catalog record').value, 'source-record'); assert.deepEqual(attrs(), newer);
  await click(button('Cancel'));

  delay = true; await click(button('Choose catalog value for Reference, Row 2')); await click(button('Load matching records'));
  const superseded = finish; await fill('Catalog text filter', 'new query'); delay = false;
  await click(button('Load matching records')); await fill('Catalog record', 'source-record');
  await React.act(async () => superseded!()); assert.equal(field('Catalog record').value, 'source-record');
  await readonly(); assert.equal(button('Apply selected value').disabled, true); await click(button('Apply selected value'));
  assert.deepEqual(attrs(), newer); await click(button('Cancel'));
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent?.startsWith('Choose catalog value for')), false);
  assert.equal(field('Mass, Row 1').readOnly, true); assert.equal((field('Mass, Row 1 unit') as any).disabled, true);
  assert.ok(loads >= 8);
});

test('registration fills committed identities atomically, retries failures and guards repeated, stale, read-only and detached outcomes', async t => {
  let fail = false, delay = false, malformed = false, finish: (() => void) | null = null, writes = 0;
  const ui = await fixture(t, async (_input, init) => {
    assert.equal(init?.method, 'POST'); writes++;
    const body = JSON.parse(String(init?.body));
    if (delay) await new Promise<void>(resolve => { finish = resolve; });
    if (fail) return json({ detail: 'Catalog temporarily unavailable' }, 503);
    const receipt = { source: 'notebook-local-catalog', catalogId: 'local-catalog', tableId: body.table.id, schemaId: body.table.schema.id, schemaRevision: body.table.schema.revision,
      submissionId: body.submissionId, inputHash: createHash('sha256').update(canonicalStructuredTable(body.table)).digest('hex'), registeredAt: '2026-11-09T13:00:00Z',
      records: body.table.rows.toReversed().map((row: any) => ({ rowId: row.id, recordId: `committed-${row.id}`, version: 2 })) };
    if (malformed) receipt.records.pop();
    return json(receipt);
  });
  const { mount, button, fill, attrs, click, ready, change, readonly, React } = ui;
  const submit = 'Submit rows to local catalog';
  const prepare = async () => { await mount('registrationTable'); await fill('After registration, fill references into', 'ref'); await ready(submit); };
  await prepare(); fail = true; await click(button(submit));
  assert.match(document.body.textContent!, /Catalog temporarily unavailable/); assert.equal(attrs().receipts.length, 0); assert.equal(attrs().table.rows[0].cells.ref, undefined);
  fail = false; await click(button('Retry this submission'));
  assert.equal(attrs().receipts.length, 1);
  assert.deepEqual(JSON.parse(attrs().table.rows[0].cells.ref), { source: 'notebook-local-catalog', catalogId: 'local-catalog', recordId: 'committed-row-a', version: 2, schemaId: 'target-schema', schemaRevision: 1 });
  assert.equal(attrs().table.rows[1].cells.ref, '{"manual":true}');
  const roundTrip = structuredClone(attrs());
  await React.act(async () => ui.editor().commands.setContent(ui.editor().getHTML())); assert.deepEqual(attrs(), roundTrip);

  for (const interruption of ['changed', 'readonly', 'detached', 'entry-navigation', 'navigation-back'] as const) {
    await prepare(); const original = structuredClone(attrs()), before = writes; delay = true;
    await click(button(submit)); await click(button(submit)); assert.equal(writes, before + 1);
    assert.ok(finish);
    if (interruption === 'changed') await change(attrs => ({ ...attrs, table: { ...attrs.table, name: 'Keep newer edit' } }));
    if (interruption === 'readonly') await readonly();
    if (interruption === 'detached') await mount('inputTable');
    if (interruption === 'entry-navigation') await ui.navigate();
    if (interruption === 'navigation-back') { await ui.navigate(); await ui.navigate('a'.repeat(32)); }
    await React.act(async () => finish!()); delay = false;
    assert.equal(attrs().receipts.length, 0); assert.equal(attrs().table.rows[0].cells.ref, undefined);
    if (interruption === 'changed') { assert.equal(attrs().table.name, 'Keep newer edit'); assert.match(document.body.textContent!, /catalog committed the submitted snapshot, but this draft changed/); }
    if (interruption === 'readonly') { assert.deepEqual(attrs(), original); assert.match(document.body.textContent!, /notebook is now read-only/); }
  }
  await prepare(); malformed = true; await click(button(submit));
  assert.equal(attrs().receipts.length, 0); assert.match(document.body.textContent!, /receipt does not match/);
});
