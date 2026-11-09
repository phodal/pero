import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const resolveDir = fileURLToPath(new URL('../ui-src', import.meta.url));
function controls(runtime: any) {
  const { React, dom } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const button = (text: string) => { const target = [...document.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text); assert.ok(target, text); return target; };
  const field = (text: string) => { const label = [...document.querySelectorAll('label')].find(node => node.textContent === text); const target = label && (document.getElementById(label.htmlFor) ?? label.querySelector('input')); assert.ok(target, text); return target as HTMLInputElement; };
  const fill = async (text: string, value: string) => React.act(async () => { const target = field(text), type = target.tagName === 'SELECT' ? dom.window.HTMLSelectElement : target.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype, 'value')!.set!.call(target, value); target.dispatchEvent(new dom.window.Event(target.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  return { button, field, fill };
}

test('research example recomputes with real owners, inserts explicit snapshots and compares pinned evidence', async t => {
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './research-tools'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click } = runtime, { button, fill } = controls(runtime);
  const snapshots: any[] = [], inserted: any[] = [];
  const sheets = [{ name: 'Data', sheet: { rows: 2, columns: 2, cells: { A1: '=2+2', B1: '4' } } }];
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookResearchTools, { worksheets: sheets, onSnapshot: (...args: any[]) => snapshots.push(args), onInsertExample: (example: any) => inserted.push(example) })));
  await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Master-mix'))!);
  assert.match(document.body.textContent!, /1760 µL/);
  await click(button('Set 100 reactions')); assert.match(document.body.textContent!, /2200 µL/);
  await click(button('Insert editable worksheet and recipe'));
  assert.equal(inserted[0].total, 2200); assert.deepEqual(inserted[0].mixture.records, []);
  await click(button('Insert example snapshot')); assert.equal(snapshots[0][1].input.reactions, 100);
  await fill('Reaction count', '0'); assert.match(document.body.textContent!, /Use 1–10,000 reactions/);
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === 'Insert editable worksheet and recipe'), false);
  await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Compare formula'))!);
  await click(button('Pin baseline')); await click(button('Insert comparison snapshot'));
  assert.equal(snapshots[1][1].comparison.sameResult, true); assert.equal(snapshots[1][1].comparison.sameSource, false);
  await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Technical dependencies'))!);
  await fill('Search Pero dependencies and sources', 'fast-formula-parser'); assert.match(document.body.textContent!, /1.0.19/);
  await fill('Search Pero dependencies and sources', 'nonexistent-private-path'); assert.match(document.body.textContent!, /No matching Pero sources/);
});

test('print preview preserves cross-section calculations, filters real output and persists settings before actual print invocation', async t => {
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './notebook-print'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click, dom } = runtime, { button, field, fill } = controls(runtime);
  const documentValue = { schemaVersion: 1, title: 'Print <script>never execute</script>', content: { type: 'doc', content: [
    { type: 'section', attrs: { blockId: 'inputs', label: 'Inputs' }, content: [{ type: 'spreadsheet', attrs: { blockId: 'data', label: 'Data', sheet: { rows: 1, columns: 1, cells: { A1: '7' } } } }] },
    { type: 'section', attrs: { blockId: 'results', label: 'Results' }, content: [{ type: 'spreadsheet', attrs: { blockId: 'result', label: 'Result', sheet: { rows: 1, columns: 1, cells: { A1: '=Data!A1*3' } } } }] },
  ] }, procedures: [{ id: 'procedure', title: 'Hidden procedure tab', description: 'Print this without switching tabs', materials: [], steps: [] }] };
  let printed = 0; dom.window.print = () => { printed++; assert.match(document.querySelector('.notebook-print-output')!.textContent!, /21/); };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookPrintTools, { document: documentValue, entryId: 'entry', revision: 2, dirty: true })));
  await click(button('Print options'));
  const output = () => document.querySelector('.notebook-print-output')!;
  assert.match(output().textContent!, /UNSAVED DRAFT/); assert.match(output().textContent!, /Hidden procedure tab/);
  assert.equal(output().querySelector('button, input, textarea, script'), null);
  await click(field('Inputs')); assert.equal(output().querySelectorAll('figure').length, 1); assert.match(output().textContent!, /21/);
  await fill('Paper', 'Letter'); await fill('Orientation', 'landscape'); await fill('Margins (mm, 5–40)', '12');
  await click(field('Show formulas under calculated values'));
  assert.match(output().textContent!, /=Data!A1\*3/); assert.match(output().querySelector('style')!.textContent!, /size: Letter landscape; margin: 12mm/);
  await click(button('Save print preferences')); await click(button('Print')); assert.equal(printed, 1);
  await click(button('Close print options')); assert.equal(document.querySelector('.notebook-print-output'), null);
  await click(button('Print options')); assert.equal(field('Orientation').value, 'landscape'); assert.equal(field('Inputs').checked, false);
  await fill('Margins (mm, 5–40)', '0'); assert.equal(document.querySelector('.notebook-print-output'), null); assert.equal((button('Print') as HTMLButtonElement).disabled, true);
  await click(button('Close print options'));
  await React.act(async () => window.dispatchEvent(new dom.window.CustomEvent(ui.NOTEBOOK_PRINT_OPEN_EVENT, { detail: { entryId: 'other' } }))); assert.equal(document.querySelector('dialog'), null);
});

test('scoped commands preserve widget/native/IME/modal keys and symbol command uses existing text picker', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './notebook-commands'; export * from './text-tools'; export { Editor } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, dom, click } = runtime, { button } = controls(runtime);
  const scope = document.createElement('div'); scope.dataset.notebookEntryId = 'entry'; scope.innerHTML = '<div class="notebook-editor"><div id="editing"></div><input id="widget"></div>';
  document.body.append(scope);
  editor = new ui.Editor({ element: scope.querySelector('#editing'), extensions: [ui.StarterKit, ui.NotebookSubscript, ui.NotebookSuperscript, ui.NotebookTextColor, ui.NotebookTextBackground], content: '<p>text</p>' });
  const calls: string[] = [];
  const handlers = { save: () => { calls.push('save'); }, export: () => { calls.push('export'); }, print: () => { calls.push('print'); }, section: () => { calls.push('section'); }, symbols: () => editor.view.dom.dispatchEvent(new dom.window.Event(ui.NOTEBOOK_SYMBOLS_EVENT)) };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(React.Fragment, null, React.createElement(ui.NotebookCommandTools, { entryId: 'entry', handlers }), React.createElement(ui.NotebookTextTools, { editor }))));
  const press = async (target: Element, key: string, extra = {}) => { let event: any; await React.act(async () => { event = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key, ...extra }); target.dispatchEvent(event); }); return event.defaultPrevented; };
  assert.equal(await press(editor.view.dom, '\\'), true); assert.deepEqual(calls, ['section']);
  assert.equal(await press(scope.querySelector('#widget')!, '\\'), false); assert.equal(await press(editor.view.dom, '\\', { isComposing: true }), false);
  assert.equal(await press(editor.view.dom, 's'), true); assert.equal(await press(editor.view.dom, 's', { shiftKey: true }), true); assert.equal(await press(editor.view.dom, 'p'), true);
  assert.deepEqual(calls, ['section', 'save', 'print']);
  await React.act(async () => editor.commands.setTextSelection(3));
  assert.equal(await press(editor.view.dom, ';'), true); assert.match(document.querySelector('dialog')!.textContent!, /Insert symbol/);
  await click(button('Insert α (alpha)')); assert.equal(editor.getText(), 'teαxt');
  await click(button('Keyboard shortcuts')); const dialog = document.querySelector('dialog')!;
  assert.equal(await press(dialog, 's'), false); await click(button('Close shortcuts'));
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookCommandTools, { entryId: 'entry', readonly: true, handlers })));
  assert.equal(await press(editor.view.dom, '\\'), false); assert.equal(await press(editor.view.dom, 's'), false); assert.equal(await press(editor.view.dom, 'p'), true);
});

test('science-tool insertion uses real notebook identities and unique recipe references, blocks duplicates and stale edits', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './science-tools'; export { notebookExtensions } from './editor-extensions'; export { Editor } from '@tiptap/core'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click, dom } = runtime, { button, fill } = controls(runtime);
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'original' }, content: [{ type: 'text', text: 'Original experiment' }] }] } });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookScienceTools, { editor, onInsert: (nodes: any[]) => editor.commands.insertContentAt(editor.state.doc.content.size, nodes) })));
  const open = async () => { await click(button('Scientific tools')); await fill('Scientific tools', 'formula'); await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Master-mix'))!); };
  const sheets = () => editor.getJSON().content.filter((node: any) => node.type === 'spreadsheet');
  const recipes = () => editor.getJSON().content.filter((node: any) => node.type === 'mixturePrep');
  await open(); await click(button('Insert editable worksheet and recipe'));
  assert.equal(sheets().length, 1, document.body.textContent!.slice(0,500)); assert.equal(recipes().length, 1);
  const firstIds = [sheets()[0].attrs.blockId, recipes()[0].attrs.blockId]; assert.equal(new Set(firstIds).size, 2); assert.ok(firstIds.every(Boolean));
  await click(button('Insert editable worksheet and recipe')); assert.equal(sheets().length, 1); assert.match(document.body.textContent!, /already been inserted/);
  await click(button('Set 100 reactions')); await click(button('Insert editable worksheet and recipe'));
  assert.equal(sheets().length, 2); assert.equal(sheets()[1].attrs.label, 'Master mix 2');
  for (const recipe of [recipes()[1].attrs.mixture.draft, recipes()[1].attrs.mixture.recipes[0].recipe]) assert.equal(recipe.ingredients[0].source, 'Master mix 2!C4');
  assert.ok(!firstIds.includes(sheets()[1].attrs.blockId)); assert.deepEqual(recipes()[1].attrs.mixture.records, []);
  await React.act(async () => editor.commands.insertContentAt(1, 'Intervening edit. '));
  await click(button('Reset example')); await click(button('Insert editable worksheet and recipe'));
  assert.equal(sheets().length, 2); assert.match(document.body.textContent!, /notebook changed/);
  await click(button('Close')); assert.equal(document.querySelector('dialog'), null);
});

test('printed duplicate-name worksheets retain each block calculation and match the editor', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const { React, ui, render } = await createUiRuntime(t, { resolveDir, contents: "export * from './notebook-print-content'; export * from './worksheet-model'; export { notebookExtensions } from './editor-extensions'; export { Editor } from '@tiptap/core'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  for (const secondName of ['Data', 'data']) {
    const content = { type: 'doc', content: [
      { type: 'spreadsheet', attrs: { blockId: 'first', label: 'Data', sheet: { rows: 1, columns: 2, cells: { A1: '2', B1: '=A1*3' } } } },
      { type: 'spreadsheet', attrs: { blockId: 'second', label: secondName, sheet: { rows: 1, columns: 2, cells: { A1: '9', B1: '=A1*3' } } } },
    ] };
    editor?.destroy(); editor = new ui.Editor({ extensions: ui.notebookExtensions, content });
    await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookPrintContent, { document: { schemaVersion: 1, title: 'Repeated names', content }, entryId: 'entry', revision: 1, dirty: false, preparedAt: '2026-11-09T00:00:00Z', settings: { version: 1, orientation: 'portrait', paper: 'A4', marginMm: 15, includeMetadata: false, includeInputs: false, sections: ['notes'] } })));
    const printed = [...document.querySelectorAll('figure')].map(figure => [...figure.querySelectorAll('tbody td')].map(cell => cell.textContent));
    assert.deepEqual(printed, [['2', '6'], ['9', '27']]);
    assert.deepEqual(printed, ['first', 'second'].map(id => Object.values(ui.worksheetCalculation(editor.state.doc, id).values).map(String)));
    assert.equal(document.querySelectorAll('figure p').length, 2);
  }
});

test('scientific blocks print as experiment records without attribute JSON', async t => {
  const { React, ui, render } = await createUiRuntime(t, { resolveDir, contents: "export * from './notebook-print-content'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const recipe = {
    name: 'Lysis buffer', output: 'LB-001', notes: 'Keep cold, then aliquot.',
    target: { value: 10, unit: 'mL' }, additiveVolumes: false,
    ingredients: [
      { id: 'tris', reference: 'Tris base', source: 'Lot T-9', mode: 'quantity', target: { value: 1.2, unit: 'g' } },
      { id: 'salt', reference: 'Salt', source: 'Lot S', mode: 'quantity', target: { value: 0.1 + 0.2, unit: 'g' } },
      { id: 'water', reference: 'Water', source: 'Milli-Q', mode: 'qs', target: { value: null, unit: 'mL' } },
    ],
  };
  const sourceSha = 'b'.repeat(64);
  const declaration = 'ab'.repeat(32);
  const digest = 'e'.repeat(64);
  const content = { type: 'doc', content: [
    { type: 'mixturePrep', attrs: { label: 'Lysis mix', mixture: { version: 1, draft: recipe, recipes: [{ revision: 1, recipe }], measurements: { tris: { value: 1.21, unit: 'g' } }, records: [{ id: 'prep-1', recipeRevision: 1, recipe, operator: 'Ada', recordedAt: '2026-11-09T08:15:00.000Z', output: 'LB-001-actual', notes: 'Prepared overnight', actual: { tris: { value: 1.21, unit: 'g' }, salt: { value: 0.1 + 0.2, unit: 'g' }, water: { value: 9.4, unit: 'mL' } } }] } } },
    { type: 'reactionScheme', attrs: { label: 'Scheme', reaction: { name: 'Esterification', notes: 'Acid catalyst, reflux 2 h.', molecules: [
      { id: 'etoh', name: 'Ethanol', role: 'reactant', graph: { atoms: [{ id: 'a', element: 'C', x: 12.25, y: 40, charge: 0 }, { id: 'b', element: 'O', x: 80, y: 40, charge: -1 }], bonds: [{ id: 'bond', from: 'a', to: 'b', order: 1 }] } },
      { id: 'ester', name: 'Ethyl acetate', role: 'product', graph: { atoms: [{ id: 'c', element: 'C', x: 1, y: 2, charge: 0 }], bonds: [] } },
    ] }, record: { id: 'rxn-1', revision: 3, savedAt: '2026-11-09T09:00:00Z', definition: { name: 'Esterification', notes: 'hidden definition json', molecules: [] } } } },
    { type: 'chemical', attrs: { chemical: { name: 'Caffeine', graph: { atoms: [{ id: 'n1', element: 'N', x: 12.25, y: 4, charge: 0 }], bonds: [] }, source: { id: 'rxn-1', revision: 3, moleculeId: 'mol-caf', original: { atoms: [{ element: 'N', x: 99.5, y: 1, charge: 0 }], bonds: [] } } } } },
    { type: 'sampleIntake', attrs: { intake: { name: 'Plate map', mode: 'plate', field: 'barcode', schemaId: 'schema-1', input: `well\tid\nA1\tS-100\n${'x'.repeat(500)}`, fileName: 'plate.csv', plateSize: { rows: 8, columns: 12 }, bindings: [{ source: { mode: 'plate', input: 'S-100', fileName: 'plate.csv', row: 1, well: 'A1', field: 'barcode' }, snapshot: { catalogId: 'cat-1', records: [{ id: 'rec-1', version: 2, name: 'Stored sample A', registeredAt: '2026-11-09T07:00:00Z', values: { mass: { type: 'quantity', value: '15', unit: 'mg' }, blob: { type: 'object', value: { data: 'AAAABBBBCCCC' } } }, columns: [{ id: 'mass', name: 'Mass' }] }] } }] } } },
    { type: 'savedSearch', attrs: { label: 'Open buffers', queryId: 'query-1', queryRevision: 4, mode: 'snapshot', snapshot: { queryId: 'query-1', queryRevision: 4, refreshedAt: '2026-11-09T10:00:00Z', results: [{ entryId: 'entry-9', revision: 2, title: 'Prior entry title', summary: 'buffer inventory', tags: ['stock'], updatedAt: '2026-11-08T00:00:00Z' }] } } },
    { type: 'savedSearch', attrs: { label: 'Live buffers', queryId: 'query-live', queryRevision: 1, mode: 'live', snapshot: null } },
    { type: 'appCanvas', attrs: { label: 'Dataset inspector', binding: { id: 'bind-1', app: 'data', panel: 'inspector', view: 'dataset', declaration, inputs: { dataset: 'measurements-set', payload: { data: 'EMBEDDEDFILEBYTES' } }, receipt: { result: { status: 'completed', outcome: 'applied', reason: 'Rows accepted', dataset: { name: 'measurements-set', bytes: 'MOREBYTES' } } } } } },
    { type: 'appCanvas', attrs: { label: 'Unbound canvas', binding: null } },
    { type: 'sourceExcerpt', attrs: { label: 'Methods quote', excerpt: { version: 'a'.repeat(64), start: 0, end: 15, quote: 'quoted passage', text: 'quoted passage and retained incubation narrative that must stay out of the print', source: { blockId: 'file-1', filename: 'methods.pdf', mime: 'application/pdf', sha256: sourceSha }, extraction: { version: 1, original: { sha256: 'c'.repeat(64), bytes: 99999 }, parser: { name: 'pdftotext', version: '1' }, method: 'native', textSha256: 'd'.repeat(64), segments: [{ start: 0, end: 15, page: 2, part: 'body', region: { x: 0.12, y: 0.34, width: 0.2, height: 0.1 }, score: null }], limitations: ['OCR was not used'] } } } },
    { type: 'sourceExcerpt', attrs: { label: 'Empty excerpt', excerpt: null } },
    { type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'referenceMention', attrs: { label: 'Paper note', source: { app: 'paper-agent', kind: 'report-passage', id: 'rep-1', version: 'v2', locator: 'page 4 paragraph' } } }] },
    { type: 'lookupTable', attrs: { label: 'Buffer lookup', query: { schemaId: 'schema-buffers', text: 'PBS', limit: 10 }, snapshot: { catalogId: 'cat-lookup', refreshedAt: '2026-11-09T11:00:00Z', total: 1, records: [{ id: 'buf-1', version: 3, name: 'Phosphate buffer', registeredAt: '2026-11-09T06:00:00Z', columns: [{ id: 'conc', name: 'Concentration' }, { id: 'blob', name: 'Raw file' }], values: { conc: { type: 'quantity', value: '10', unit: 'mM' }, blob: { type: 'object', value: { data: 'FILEBYTESLOOKUP' } } } }] } } },
    { type: 'evidence', attrs: { label: 'Cited passage', blockId: 'ev-1', source: { app: 'paper-agent', kind: 'report-passage', id: 'rep-1', version: 'v2', locator: 'pero-app-location://paper-agent/main/report/abc/passage/def' }, snapshot: { kind: 'paper-report', quote: 'The yield increased.', page: 4, occurrences: 2, reportId: digest, fileDigest: digest, exportSha256: digest, start: 10, end: 28, x: 12.25, y: 40 } } },
    { type: 'experiment', attrs: { label: 'Verification run', source: { app: 'control-lab', kind: 'verification-report', id: 'exp-1', version: 'v1', locator: 'pero-app-location://control-lab/main/experiment/abc/trial/def' }, snapshot: { kind: 'control-receipt', verdict: 'PASS', phase: 'verification', candidateId: 'cand-1', trialId: 'ab'.repeat(16), checks: [{ name: 'Mass balance', verdict: 'PASS', message: 'Within tolerance', actual: '1.0', limit: '0.1' }], specHash: digest, inputDigest: digest, exportSha256: digest, observationId: digest } } },
    { type: 'registrationTable', attrs: { receipts: [{ catalogId: 'cat-reg', submissionId: 'sub-1', inputHash: digest, registeredAt: '2026-11-09T12:00:00Z', schemaId: 'schema-reg', schemaRevision: 2, records: [{ rowId: 'row-1', recordId: 'rec-reg', version: 1 }], waiver: { reason: 'Field left blank', attribution: 'Ada', inputHash: digest, issues: [{ code: 'required', rowId: 'row-1', columnId: 'mass' }] } }], table: { name: 'Registered samples', schema: { columns: [{ id: 'name', name: 'Name', type: 'text' }] }, rows: [{ id: 'row-1', cells: { name: 'Sample A' } }] } } },
    { type: 'finding', attrs: { claim: 'Yield improved after the cold hold.', limitations: 'Single batch.', evidenceIds: ['ev-1', 'run-1'] } },
  ] };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookPrintContent, {
    document: { schemaVersion: 1, title: 'Experiment record', metadata: { project: 'Buffer study', author: 'Ada Lovelace', tags: ['lysis', 'qs'] }, procedures: [{ id: 'prep', title: 'Prep procedure', description: 'Bench steps', materials: [{ id: 'mat-1', name: 'Tris stock', quantity: '1.2 g', source: { source: 'notebook-local-catalog', catalogId: 'cat-mat', recordId: 'rec-tris', version: 4, schemaId: 'schema-mat', schemaRevision: 1 } }], steps: [] }], content }, entryId: 'entry', revision: 1, dirty: false, preparedAt: '2026-11-09T00:00:00Z',
    settings: { version: 1, orientation: 'portrait', paper: 'A4', marginMm: 15, includeMetadata: true, includeInputs: false, sections: ['notes', 'procedure:prep'] },
  })));
  const article = document.querySelector('.notebook-print-document')!;
  const text = article.textContent!;
  for (const readable of [
    'Lysis mix', 'Lysis buffer', 'LB-001', 'Keep cold, then aliquot.', 'Tris base', 'Lot T-9', '1.2 g', '1.21 g', 'Salt', '0.3 g',
    'QS to final volume', 'Water', 'Milli-Q', 'Ada', '2026-11-09T08:15:00.000Z', '9.4 mL', 'Prepared overnight',
    'Esterification', 'Acid catalyst, reflux 2 h.', 'Reactant', 'Ethanol', 'Product', 'Ethyl acetate', 'O charge -1',
    'Saved record rxn-1 · v3 · 2026-11-09T09:00:00Z', 'Caffeine', 'mol-caf', 'Explicit atoms: N',
    'Plate map', 'Plate mapping', 'Stored sample A', 'Well A1', 'S-100', 'Mass: 15 mg', 'plate.csv',
    'Open buffers', 'Prior entry title', 'buffer inventory', 'stock', 'query-1', 'Live query',
    'Dataset inspector', 'data / inspector', 'View dataset', 'dataset: measurements-set', 'Rows accepted',
    `Declaration SHA-256: ${declaration}`, 'No canvas binding saved.',
    'Methods quote', 'quoted passage', 'methods.pdf', 'application/pdf', 'Page 2', 'Extracted by pdftotext (native).',
    'OCR was not used', `SHA-256: ${sourceSha}`, 'Full source text omitted.', 'Embedded bytes omitted.', 'Atom coordinates omitted.',
    'No excerpt saved.',
    'Paper note', 'paper-agent / report-passage', 'rep-1', 'page 4 paragraph',
    'Buffer lookup', 'PBS', 'schema-buffers', 'Phosphate buffer', 'buf-1', 'Concentration: 10 mM',
    'Cited passage', 'The yield increased.', 'Page 4', '2 occurrences', `${digest.slice(0, 12)}…`,
    'Verification run', 'control-lab / verification-report', 'PASS', 'Mass balance', 'Within tolerance', 'cand-1',
    'Registered samples', 'Sample A', 'Field left blank', 'rec-reg', 'row-1 → rec-reg v1',
    'Yield improved after the cold hold.', 'Single batch.', 'ev-1', '2 linked evidence blocks',
    'Buffer study', 'Ada Lovelace', 'lysis', 'Prep procedure', 'Tris stock', 'rec-tris', 'cat-mat',
    'Digest omitted.',
  ]) assert.match(text, new RegExp(readable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(article.querySelector('pre'), null);
  assert.doesNotMatch(text, /Recorded structured content/);
  assert.doesNotMatch(text, /\{/);
  for (const hidden of ['12.25', '99.5', '0.12', '0.34', 'AAAABBBBCCCC', 'EMBEDDEDFILEBYTES', 'MOREBYTES', 'FILEBYTESLOOKUP', 'hidden definition json', 'retained incubation narrative', 'x'.repeat(40), 'a'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), digest, '0.30000000000000004', '"ingredients"', '"declaration"', '"sha256"', '"evidenceIds"', '"receipts"']) {
    assert.equal(text.includes(hidden), false, hidden);
  }
});

test('mixture QS estimate and history show readable quantities without rewriting stored values', async t => {
  let editor: any;
  const runtime = await createUiRuntime(t, { resolveDir, contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ content, capture }) {
      const editor = useEditor({ extensions: notebookExtensions, content });
      capture(editor);
      return <EditorContent editor={editor} />;
    }
  ` });
  const { React, ui, render, dom } = runtime;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const residue = 0.1 + 0.2;
  const recipe = {
    name: 'Buffer', output: 'batch', notes: '', target: { value: 1, unit: 'mL' }, additiveVolumes: true,
    ingredients: [
      { id: 'salt', reference: 'Salt', source: 'lot', mode: 'quantity', target: { value: residue, unit: 'mL' } },
      { id: 'water', reference: 'Water', source: '', mode: 'qs', target: { value: null, unit: 'mL' } },
    ],
  };
  const mixture = { version: 1, draft: recipe, recipes: [], measurements: {}, records: [{ id: 'rec', recipeRevision: 1, recipe, operator: 'Ada', recordedAt: '2026-11-09T00:00:00.000Z', output: 'out', notes: '', actual: { salt: { value: residue, unit: 'mL' }, water: { value: residue, unit: 'mL' } } }] };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.Fixture, { content: { type: 'doc', content: [{ type: 'mixturePrep', attrs: { blockId: 'mix', mixture } }] }, capture: (value: any) => { editor = value; } })));
  const block = document.querySelector('[data-kind=mixturePrep]')!;
  assert.ok(block, document.body.textContent!.slice(0, 300));
  const estimate = [...block.querySelectorAll('p')].find(node => node.textContent?.includes('QS planning estimate'));
  assert.match(estimate?.textContent ?? '', /0\.7 mL/);
  assert.doesNotMatch(estimate?.textContent ?? '', /999999|000000000000004/);
  const history = block.querySelector('details')!;
  assert.match(history.textContent!, /0\.3 mL/);
  assert.doesNotMatch(history.textContent!, /000000000000004/);
  assert.equal(editor.getJSON().content[0].attrs.mixture.draft.ingredients[0].target.value, residue);
  assert.equal(editor.getJSON().content[0].attrs.mixture.records[0].actual.salt.value, residue);
  await React.act(async () => editor.destroy());
});
