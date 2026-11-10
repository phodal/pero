import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

// Host transport is the test seam. The Python test separately covers the real SQLite/HTTP owner.
test('table workflows retain drafts, save real view definitions, confirm source changes and ignore closed previews', async t => {
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export * from './table-workflows'; export { NotebookContextProvider } from './notebook-context'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const { React, ui, dom, render, click } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const table = { id: 'target', name: 'Target', schema: { id: 'target-schema', revision: 1, columns: [{ id: 'name', name: 'Name', type: 'text', required: false, options: [], units: [] }] }, rows: [{ id: 'manual', cells: { name: 'Keep my row' } }] };
  const imported = { ...table, rows: [...table.rows, { id: 'source_record', cells: { name: 'Actual source' } }] };
  const source = { query: { schemaId: 'source-schema', text: '', limit: 200 }, mappings: [{ sourceColumnId: 'name', targetColumnId: 'name' }], addNew: true, updateExisting: true, missing: 'keep' };
  let workflow: any = { revision: 1, views: [], source, baseline: [], lastApplied: null }, applied: any = null, chosen: any = null;
  const calls: { path: string; body: any }[] = [];
  let delay = false, finish: (() => void) | null = null;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string, init?: RequestInit) => {
    const path = String(input), body = init?.body ? JSON.parse(String(init.body)) : null; calls.push({ path, body });
    let result: any;
    if (path.endsWith('/preview')) {
      if (delay) await new Promise<void>(resolve => { finish = resolve; });
      result = { id: 'preview', entryId: 'a'.repeat(32), workflowRevision: workflow.revision, inputTable: table, table: imported, baseline: [], changes: [{ type: 'add-row', rowId: 'source_record', columnId: '', before: '', after: '' }], snapshot: { records: [], total: 0, refreshedAt: '2026-11-09T00:00:00Z' } };
    } else if (path.endsWith('/apply')) {
      workflow = { ...workflow, revision: workflow.revision + 1 };
      result = { previewId: 'preview', entryId: 'a'.repeat(32), inputTable: table, table: imported, workflow, appliedAt: '2026-11-09T00:00:00Z' };
    } else if (body?.change?.type === 'save-view') { workflow = { ...workflow, revision: workflow.revision + 1, views: [body.change.view] }; result = workflow; }
    else result = workflow;
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } });
  const doc = { schemaVersion: 1, title: 'Entry', content: { type: 'doc', content: [{ type: 'inputTable', attrs: { blockId: 'table', table, receipts: [] } }] } };
  const mount = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookContextProvider, { value: { entryId: 'a'.repeat(32), revision: 1, readonly: false, document: doc, getDocument: () => doc } }, React.createElement(ui.TableWorkflowTools, { table, receipts: [], editable: true, activeView: null, onApplyTable: (value: any) => { applied = value; }, onViewChange: (value: any) => { chosen = value; } }))));
  const button = (label: string) => { const result = [...document.querySelectorAll('button')].find(item => item.textContent === label); assert.ok(result, `Missing ${label}: ${document.body.textContent}`); return result; };
  const input = async (label: string, value: string) => {
    const name = [...document.querySelectorAll('label')].find(item => item.textContent === label)!;
    const field = document.getElementById(name.htmlFor)!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  };
  await mount(); await click(button('Views, sources and archive'));
  await input('View name', 'Assays'); await input('Filter cell text', 'Keep'); await click(button('Save view'));
  assert.equal(workflow.views[0].name, 'Assays'); assert.equal(chosen.text, 'Keep');
  assert.deepEqual(workflow.views[0].columns, ['name']); assert.equal(applied, null);
  assert.equal(calls.find(call => call.body?.change)?.path, `/api/entries/${'a'.repeat(32)}/table-workflows/target`);
  assert.deepEqual(calls.find(call => call.body?.change)?.body.table, table);
  await click(button('Source mapping and resync')); await click(button('Preview resync'));
  assert.match(document.body.textContent!, /Actual source/); assert.equal(applied, null);
  await click(button('Cancel preview')); assert.equal(calls.filter(call => call.path.endsWith('/apply')).length, 0);
  await click(button('Preview resync'));
  table.name = 'Newer local edit'; await mount();
  await click(button('Confirm changes to draft'));
  assert.equal(applied, null); assert.match(document.body.textContent!, /table changed after preview/);
  assert.equal(calls.filter(call => call.path.endsWith('/apply')).length, 0);
  table.name = 'Target'; await mount(); await click(button('Confirm changes to draft'));
  assert.deepEqual(applied, imported); assert.equal(calls.filter(call => call.path.endsWith('/apply')).length, 1);
  await click(document.querySelector('button[aria-label="Close"]')!);
  applied = null; delay = true;
  await click(button('Views, sources and archive')); await click(button('Source mapping and resync')); await click(button('Preview resync'));
  assert.ok(finish); await click(document.querySelector('button[aria-label="Close"]')!);
  await React.act(async () => finish!());
  assert.equal(document.querySelector('dialog'), null); assert.equal(applied, null);
});

test('collection editing waits for confirmation, retains failed input and shows saved hierarchy', async t => {
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export * from './template-collections'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const { React, ui, dom, render, click } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let state = { revision: 0, collections: [] as any[], memberships: {} }, posted = 0, fail = true;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (_input: string, init?: RequestInit) => {
    if (init?.body) {
      posted++; const body = JSON.parse(String(init.body));
      if (fail) return new Response(JSON.stringify({ detail: 'A collection with this name already exists' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      state = { revision: 1, collections: [{ id: 'collection', name: body.change.name, parentId: null }], memberships: {} };
    }
    return new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } });
  } });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.TemplateCollections, { selected: '', onSelect() {}, onLibrary() {} })));
  const button = (label: string) => { const result = [...document.querySelectorAll('button')].find(item => item.textContent === label); assert.ok(result, label); return result; };
  await click(button('Create collection'));
  const field = document.querySelector('dialog input') as HTMLInputElement;
  await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, 'Methods'); field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  assert.equal(posted, 0); await click(button('Confirm organization change'));
  assert.equal(posted, 1); assert.equal(field.value, 'Methods'); assert.match(document.querySelector('dialog')!.textContent!, /already exists/);
  fail = false; await click(button('Confirm organization change'));
  assert.equal(document.querySelector('dialog'), null); assert.equal(state.collections[0].name, 'Methods');
});

test('archive refuses a receipt from another catalog instead of treating a matching record ID as authority', async t => {
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export * from './catalog-archive'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const { React, ui, render, click } = runtime;
  let writes = 0;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (_path: string, init?: RequestInit) => {
    if (init?.body) writes++;
    return new Response(JSON.stringify({ catalogId: 'current-catalog', archived: false, archiveRevision: 0, history: [], record: { id: 'same-record', name: 'Current source', version: 1 } }), { headers: { 'Content-Type': 'application/json' } });
  } });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.CatalogArchivePanel, { editable: true, receipts: [{ catalogId: 'other-catalog', records: [{ recordId: 'same-record' }] }] })));
  const load = [...document.querySelectorAll('button')].find(item => item.textContent === 'Load record status')!;
  await click(load);
  assert.match(document.body.textContent!, /another local catalog/);
  assert.equal([...document.querySelectorAll('button')].some(item => item.textContent === 'Confirm archive'), false);
  assert.equal(writes, 0);
});

test('entry context isolates same-ID imported tables and drops delayed responses after entry navigation', async t => {
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export * from './table-workflows'; export { NotebookContextProvider } from './notebook-context'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const { React, ui, dom, render, click } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const firstId = 'a'.repeat(32), secondId = 'b'.repeat(32);
  const table = { id: 'same-table', name: 'Same imported table', schema: { id: 'schema', revision: 1, columns: [{ id: 'name', name: 'Name', type: 'text', required: false, options: [], units: [] }] }, rows: [] };
  const doc = { schemaVersion: 1, title: 'Same exported document', content: { type: 'doc', content: [{ type: 'inputTable', attrs: { blockId: 'table', table, receipts: [] } }] } };
  const first = { revision: 3, views: [{ id: 'view-a', name: 'Only first entry', columns: ['name'], text: '', sortColumn: '', descending: false }], source: { query: { schemaId: 'source', text: '', limit: 200 }, mappings: [{ sourceColumnId: 'name', targetColumnId: 'name' }], addNew: true, updateExisting: true, missing: 'keep' }, baseline: [], lastApplied: { entryId: firstId, inputTable: table, table: { ...table, rows: [{ id: 'source-row', cells: { name: 'Only first recovery' } }] } } };
  const states: Record<string, any> = { [firstId]: first, [secondId]: { revision: 0, views: [], source: null, baseline: [], lastApplied: null } };
  const firstSnapshot = structuredClone(first), calls: string[] = [];
  let finishFirst: (() => void) | null = null;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string, init?: RequestInit) => {
    const path = String(input); calls.push(path);
    const entryId = /\/api\/entries\/([^/]+)\/table-workflows\/same-table$/.exec(path)?.[1];
    assert.ok(entryId, `A real entry must scope every workflow call: ${path}`);
    if (entryId === firstId) await new Promise<void>(resolve => { finishFirst = resolve; });
    if (init?.body) {
      const body = JSON.parse(String(init.body)); assert.deepEqual(body.table, table);
      states[entryId] = { ...states[entryId], revision: states[entryId].revision + 1, views: [body.change.view] };
    }
    return new Response(JSON.stringify(states[entryId]), { headers: { 'Content-Type': 'application/json' } });
  } });
  const mount = (entryId: string | null, readonly = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookContextProvider, { value: entryId ? { entryId, revision: 1, readonly, document: doc, getDocument: () => doc } : null }, React.createElement(ui.TableWorkflowTools, { table, receipts: [], editable: true, activeView: null, onApplyTable() { assert.fail('An imported entry must not apply another entry’s recovery'); }, onViewChange() {} }))));
  const button = (label: string) => { const result = [...document.querySelectorAll('button')].find(item => item.textContent === label); assert.ok(result, label); return result; };
  await mount(null);
  assert.equal(button('Views, sources and archive').disabled, true);
  assert.match(document.body.textContent!, /Open a saved Notebook entry/);
  assert.equal(calls.length, 0);
  await mount(firstId); await click(button('Views, sources and archive'));
  assert.ok(finishFirst);
  await mount(secondId);
  assert.equal(document.querySelector('dialog'), null);
  await click(button('Views, sources and archive'));
  const label = [...document.querySelectorAll('label')].find(item => item.textContent === 'View name')!;
  const field = document.getElementById(label.htmlFor) as HTMLInputElement;
  assert.equal(field.value, '');
  await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, 'Only second entry'); field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await click(button('Save view'));
  assert.equal(states[secondId].views[0].name, 'Only second entry');
  assert.deepEqual(states[firstId], firstSnapshot);
  await click(button('Source mapping and resync'));
  await React.act(async () => finishFirst!());
  assert.equal([...document.querySelectorAll('button')].some(item => item.textContent === 'Recover last confirmed resync into this unchanged draft'), false);
  assert.doesNotMatch(document.body.textContent!, /Only first recovery/);
  assert.equal(states[secondId].lastApplied, null);
  await click(document.querySelector('button[aria-label="Close"]')!);
  await mount(secondId, true); await click(button('Views, sources and archive'));
  assert.equal(button('Save view').disabled, true);
});
