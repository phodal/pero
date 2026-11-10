import assert from 'node:assert/strict';
import test from 'node:test';
import type { NotebookDocument, NotebookNode } from '../src/document.ts';
import { changeMetadata, changeProcedures, notebookMarkdown, notebookRelevantItems, notebookSearchItems, searchNotebook, workspaceLimits,
  type NotebookProcedure, type ProcedureChange } from '../src/workspace.ts';

const procedure = (): NotebookProcedure => ({
  id: 'procedure-1', title: 'Extract DNA', description: 'Keep samples cold.',
  materials: [{ id: 'buffer', name: 'Buffer', quantity: '2 mL' }],
  steps: [
    { id: 'prepare', text: 'Prepare', level: 'section', critical: false, pause: false, minutes: null, completed: false },
    { id: 'mix', text: 'Mix sample', level: 'step', critical: true, pause: true, minutes: 2.5, completed: false },
    { id: 'spin', text: 'Spin', level: 'substep', critical: false, pause: false, minutes: 1, completed: true },
  ],
});

function apply(procedures: NotebookProcedure[], change: ProcedureChange): NotebookProcedure[] {
  const original = structuredClone(procedures);
  const result = changeProcedures(procedures, change);
  assert.deepEqual(procedures, original, 'authoring does not mutate previous snapshots');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') throw new Error(result.status);
  return result.procedures;
}

test('procedure authoring preserves identities, annotations and manual completion while rows change', () => {
  let records = [procedure()];
  records = apply(records, { type: 'moveStep', id: 'procedure-1', stepId: 'spin', direction: -1 });
  assert.deepEqual(records[0].steps.map(step => step.id), ['prepare', 'spin', 'mix']);
  assert.deepEqual(records[0].steps[2], procedure().steps[1]);
  records = apply(records, { type: 'editStep', id: 'procedure-1', stepId: 'mix', patch: { completed: true, minutes: 0, level: 'substep' } });
  assert.deepEqual(records[0].steps[2], { ...procedure().steps[1], completed: true, minutes: 0, level: 'substep' });
  records = apply(records, { type: 'editMaterial', id: 'procedure-1', materialId: 'buffer', patch: { quantity: '3 mL' } });
  records = apply(records, { type: 'addMaterial', id: 'procedure-1', materialId: 'tube' });
  records = apply(records, { type: 'editMaterial', id: 'procedure-1', materialId: 'tube', patch: { name: 'Tube' } });
  records = apply(records, { type: 'removeMaterial', id: 'procedure-1', materialId: 'buffer' });
  assert.deepEqual(records[0].materials, [{ id: 'tube', name: 'Tube', quantity: '' }]);
  records = apply(records, { type: 'addStep', id: 'procedure-1', stepId: 'new-step' });
  assert.equal(records[0].steps.at(-1)?.completed, false);
  records = apply(records, { type: 'removeStep', id: 'procedure-1', stepId: 'prepare' });
  assert.deepEqual(records[0].steps.map(step => step.id), ['spin', 'mix', 'new-step']);
  records = apply(records, { type: 'edit', id: 'procedure-1', patch: { title: 'New method', description: 'Retained draft' } });
  assert.equal(records[0].title, 'New method');
  assert.equal(records[0].description, 'Retained draft');
  records = apply(records, { type: 'add', id: 'procedure-2', title: 'Other method' });
  records = apply(records, { type: 'remove', id: 'procedure-1' });
  assert.deepEqual(records.map(record => record.id), ['procedure-2']);
});

test('procedure bounds reject invalid local changes and boundary moves leave the draft unchanged', () => {
  const records = [procedure()];
  const invalid: ProcedureChange[] = [
    { type: 'add', id: 'procedure-1', title: 'Duplicate' },
    { type: 'add', id: 'invalid id', title: '' },
    { type: 'edit', id: 'procedure-1', patch: { title: 'x'.repeat(201) } },
    { type: 'edit', id: 'procedure-1', patch: { description: 'x'.repeat(32769) } },
    { type: 'addMaterial', id: 'procedure-1', materialId: 'mix' },
    { type: 'addStep', id: 'procedure-1', stepId: 'buffer' },
    { type: 'editMaterial', id: 'procedure-1', materialId: 'buffer', patch: { quantity: 'x'.repeat(201) } },
    ...[-1, Infinity, NaN, 10080.1].map(minutes => ({ type: 'editStep' as const, id: 'procedure-1', stepId: 'mix', patch: { minutes } })),
  ];
  for (const change of invalid) assert.equal(changeProcedures(records, change).status, 'invalid', JSON.stringify(change));
  assert.equal(changeProcedures(records, { type: 'editStep', id: 'procedure-1', stepId: 'missing', patch: { text: 'No' } }).status, 'missing');
  assert.deepEqual(apply(records, { type: 'moveStep', id: 'procedure-1', stepId: 'prepare', direction: -1 }), records);
  assert.deepEqual(apply(records, { type: 'moveStep', id: 'procedure-1', stepId: 'spin', direction: 1 }), records);
  for (const minutes of [null, 0, 0.5, 10080]) assert.equal(apply(records, { type: 'editStep', id: 'procedure-1', stepId: 'mix', patch: { minutes } })[0].steps[1].minutes, minutes);
  const maxProcedures = Array.from({ length: workspaceLimits.procedures }, (_, index) => ({ ...procedure(), id: `p-${index}` }));
  assert.equal(changeProcedures(maxProcedures, { type: 'add', id: 'overflow', title: '' }).status, 'limit');
  assert.equal(changeProcedures([{ ...procedure(), materials: Array.from({ length: 100 }, (_, index) => ({ id: `m-${index}`, name: '', quantity: '' })) }], { type: 'addMaterial', id: 'procedure-1', materialId: 'overflow' }).status, 'limit');
  assert.equal(changeProcedures([{ ...procedure(), steps: Array.from({ length: 500 }, (_, index) => ({ ...procedure().steps[0], id: `s-${index}` })) }], { type: 'addStep', id: 'procedure-1', stepId: 'overflow' }).status, 'limit');
});

test('metadata authoring retains display-only labels and bounds distinct tags', () => {
  const initial = { project: '', author: '', tags: ['Existing'] };
  for (const type of ['project', 'author'] as const) {
    const result = changeMetadata(initial, { type, value: '标签😀'.repeat(50) });
    assert.equal(result.status, 'ok');
    assert.deepEqual(initial, { project: '', author: '', tags: ['Existing'] });
    assert.equal(changeMetadata(initial, { type, value: 'x'.repeat(201) }).status, 'invalid');
  }
  assert.deepEqual(changeMetadata(initial, { type: 'addTag', value: '  second  ' }), { status: 'ok', metadata: { ...initial, tags: ['Existing', 'second'] } });
  assert.equal(changeMetadata(initial, { type: 'addTag', value: 'Existing' }).status, 'duplicate');
  for (const value of ['', ' ', 'x'.repeat(101)]) assert.equal(changeMetadata(initial, { type: 'addTag', value }).status, 'invalid');
  assert.equal(changeMetadata({ ...initial, tags: Array.from({ length: 50 }, (_, index) => `tag-${index}`) }, { type: 'addTag', value: 'overflow' }).status, 'limit');
  assert.deepEqual(changeMetadata(initial, { type: 'removeTag', index: 0 }), { status: 'ok', metadata: { ...initial, tags: [] } });
});

function content(): NotebookNode & { type: 'doc'; content: NotebookNode[] } {
  return { type: 'doc', content: [
    { type: 'heading', attrs: { blockId: 'heading', level: 2 }, content: [{ type: 'text', text: 'Observations' }] },
    { type: 'paragraph', attrs: { blockId: 'body' }, content: [{ type: 'text', text: 'Café sample ' }, { type: 'text', text: 'control', marks: [{ type: 'bold' }] }] },
    { type: 'section', attrs: { blockId: 'section', label: 'Monday extraction', date: '2026-11-09' }, content: [
      { type: 'spreadsheet', attrs: { blockId: 'sheet', label: 'Measurements', sheet: { rows: 1, columns: 2, cells: { A1: '42', B1: '=A1*2' } }, annotations: { A1: { unit: 'mL', evidenceIds: ['evidence'] } } } },
      { type: 'evidence', attrs: { blockId: 'evidence', label: 'Paper source', source: { app: 'paper-agent', kind: 'report', id: 'source-id', version: 'v1', locator: 'pero-app-location://paper-agent/source-id' }, snapshot: { kind: 'paper-report', quote: 'Measured temperature', exportSha256: 'digest' } } },
      { type: 'experiment', attrs: { blockId: 'experiment', label: 'Trial reference', source: { app: 'control-lab', kind: 'trial', id: 'trial-id', version: '', locator: '' }, snapshot: null } },
      { type: 'attachment', attrs: { blockId: 'attachment', filename: 'sample.png', mime: 'image/png', data: 'secretFileBytes', caption: 'Instrument photograph', sha256: 'attachment-digest' } },
      { type: 'inputTable', attrs: { blockId: 'inputs', table: { name: 'Daily counts', schema: { columns: [{ name: 'Count' }] }, rows: [{ cells: { count: '18 replicates' } }] } } },
      { type: 'registrationTable', attrs: { blockId: 'registry', table: { name: 'Samples', schema: { columns: [{ name: 'Name' }] }, rows: [{ cells: { name: 'Stored sample A' } }] }, receipts: [{ records: [{ rowId: 'row-a', recordId: 'rec-1' }], waiver: { reason: 'field blank', attribution: 'local operator' }, inputHash: 'deadbeefhash' }] } },
      { type: 'lookupTable', attrs: { blockId: 'lookup', query: { text: 'PBS stock' }, snapshot: { records: [{ id: 'rec-pbs', name: 'Phosphate buffer', values: { name: { type: 'text', value: 'Phosphate buffer', unit: 'mM' } } }] } } },
      { type: 'mixturePrep', attrs: { blockId: 'mixture', label: 'Lysis mix', mixture: { draft: { name: 'Lysis buffer', notes: 'keep cold', ingredients: [{ reference: 'Tris', source: 'catalog tris', target: { value: 1, unit: 'g' } }] }, records: [{ operator: 'Ada', notes: 'prepared overnight' }] } } },
      { type: 'chemical', attrs: { blockId: 'chemical', chemical: { name: 'Caffeine', graph: { atoms: [{ element: 'N', x: 12.25, y: 4 }] }, source: { moleculeId: 'mol-caf' } } } },
      { type: 'reactionScheme', attrs: { blockId: 'reaction', reaction: { name: 'Esterification', notes: 'acid catalyst', molecules: [{ name: 'Ethanol', role: 'reactant', graph: { atoms: [{ element: 'O' }] } }] } } },
      { type: 'sampleIntake', attrs: { blockId: 'intake', intake: { name: 'Plate map', mode: 'barcode', input: 'A1 barcode', fileName: 'plate.csv', bindings: [{ source: { input: 'A1 barcode', well: 'A1', fileName: 'plate.csv' }, snapshot: { records: [{ id: 'rec-1', name: 'Stored sample A' }] } }] } } },
      { type: 'sourceExcerpt', attrs: { blockId: 'excerpt', label: 'Methods quote', excerpt: { quote: 'quoted passage', text: 'page text about incubation', source: { filename: 'methods.pdf', mime: 'application/pdf', sha256: 'excerptdigest' } } } },
      { type: 'savedSearch', attrs: { blockId: 'saved', label: 'Open buffers', queryId: 'query-1', snapshot: { results: [{ title: 'Prior entry title', summary: 'buffer inventory', tags: ['stock'], entryId: 'entry-9' }] } } },
      { type: 'appCanvas', attrs: { blockId: 'canvas', label: 'Dataset inspector', binding: { id: 'bind-1', app: 'data', panel: 'inspector', view: 'dataset', declaration: 'abcdefdeclaration', inputs: { dataset: 'measurements-set' } } } },
    ] },
  ] };
}

test('search, outline and relevant-item projections address real nested content without searching file bytes', () => {
  const tree = content(), before = structuredClone(tree);
  const items = notebookSearchItems(tree);
  for (const [query, ids] of [
    ['CONTROL café', ['body']], ['monday', ['section']], ['=A1*2', ['sheet']],
    ['source-id', ['evidence']], ['temperature', ['evidence']], ['photograph', ['attachment']],
    ['18 replicates', ['inputs']], ['Stored sample A', ['registry', 'intake']], ['field blank', ['registry']],
    ['PBS stock', ['lookup']], ['Phosphate buffer', ['lookup']], ['Tris', ['mixture']], ['Ada', ['mixture']],
    ['Caffeine', ['chemical']], ['mol-caf', ['chemical']], ['Ethanol', ['reaction']], ['acid catalyst', ['reaction']],
    ['A1 barcode', ['intake']], ['quoted passage', ['excerpt']], ['incubation', ['excerpt']],
    ['Prior entry title', ['saved']], ['measurements-set', ['canvas']],
    ['secretFileBytes', []], ['deadbeefhash', []], ['12.25', []], ['excerptdigest', []], ['abcdefdeclaration', []], ['not present', []],
  ] as const) assert.deepEqual(searchNotebook(items, query).map(item => item.id), ids);
  assert.deepEqual(searchNotebook(items, '').map(item => item.id), ['heading', 'section', 'sheet', 'evidence', 'experiment', 'attachment', 'inputs', 'registry', 'lookup', 'mixture', 'chemical', 'reaction', 'intake', 'excerpt', 'saved', 'canvas']);
  assert.equal(items.find(item => item.id === 'sheet')?.depth, 1);
  assert.deepEqual(notebookRelevantItems(tree).map(({ id, state, imported }) => ({ id, state, imported })), [
    { id: 'evidence', state: 'pinned', imported: true }, { id: 'experiment', state: 'unpinned', imported: false }, { id: 'attachment', state: 'embedded', imported: false },
  ]);
  assert.deepEqual(tree, before);
});

test('Markdown snapshot carries actual formulas, provenance, manual procedures and attachment identity without file bytes', () => {
  const document: NotebookDocument = { schemaVersion: 1, title: 'Research record', content: content(), metadata: { project: 'Project label', author: 'Author label', tags: ['control'] }, procedures: [procedure()] };
  const before = structuredClone(document);
  const markdown = notebookMarkdown(document);
  for (const text of ['# Research record', '## Observations', '**control**', 'Monday extraction (2026-11-09)', '=A1*2', 'pero-app-location://paper-agent/source-id', 'Measured temperature', 'exportSha256', 'attachment-digest', 'Instrument photograph', 'Cell annotations', 'mL', 'Project label', 'planned minutes: 2.5', '[x] Spin']) assert.ok(markdown.includes(text), text);
  assert.ok(!markdown.includes('secretFileBytes'));
  assert.deepEqual(document, before);
});

test('procedure timer measures wall-clock intervals and preserves planned duration independently', async () => {
  const { procedureElapsed, procedurePlannedMinutes } = await import('../src/workspace.ts');
  let records = apply([procedure()], { type: 'editStep', id: 'procedure-1', stepId: 'mix', patch: { kind: 'timer' } });
  const timer = (action: 'start' | 'pause' | 'reset', now: number) => {
    records = apply(records, { type: 'timer', id: 'procedure-1', stepId: 'mix', action, now });
    return records[0].steps[1];
  };
  assert.equal(procedurePlannedMinutes(records[0]), 3.5);
  assert.equal(procedureElapsed(timer('start', 1000).timer, 4000), 3000);
  assert.equal(procedureElapsed(timer('start', 2000).timer, 4000), 3000, 'repeated start does not restart');
  assert.equal(procedureElapsed(timer('pause', 5000).timer, 9000), 4000);
  assert.equal(procedureElapsed(timer('start', 10000).timer, 12000), 6000);
  assert.equal(procedureElapsed(timer('pause', 12000).timer, 20000), 6000);
  assert.equal(records[0].steps[1].minutes, 2.5);
  assert.equal(records[0].steps[1].completed, false);
  assert.equal(procedureElapsed(timer('reset', 21000).timer, 22000), 0);
  assert.equal(changeProcedures(records, { type: 'timer', id: 'procedure-1', stepId: 'spin', action: 'start', now: 10 }).status, 'invalid');
});

test('all procedure kinds retain rich blocks across edits, reorder and Markdown export', async () => {
  const { procedureKinds } = await import('../src/workspace.ts');
  let records = [procedure()];
  for (const kind of procedureKinds) records = apply(records, { type: 'addStep', id: 'procedure-1', stepId: `kind-${kind}`, kind });
  const rich: NotebookNode = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'rich-prose' }, content: [{ type: 'text', text: 'Rich instruction', marks: [{ type: 'bold' }] }] }] };
  records = apply(records, { type: 'editStep', id: 'procedure-1', stepId: 'kind-description', patch: { content: rich } });
  records = apply(records, { type: 'moveStep', id: 'procedure-1', stepId: 'kind-description', direction: -1 });
  assert.deepEqual(records[0].steps.find(step => step.id === 'kind-description')?.content, rich);
  const markdown = notebookMarkdown({ schemaVersion: 1, title: 'Protocol', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'notes' } }] }, procedures: records });
  assert.match(markdown, /\*\*Rich instruction\*\*/);
  assert.match(markdown, /Kind: timer/);
});
