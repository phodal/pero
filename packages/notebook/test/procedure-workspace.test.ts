import assert from 'node:assert/strict';
import test from 'node:test';
import type { NotebookDocument, NotebookNode } from '../src/document.ts';
import { changeProcedures, materialItems, notebookContentRoots, notebookMarkdown, notebookSearchItems, notebookLinkHash, parseNotebookLink, notebookTarget, searchNotebook, type NotebookProcedure, type ProcedureChange } from '../src/workspace.ts';
import { instantiateTemplate, templateBindingChoices, type PublishedTemplate } from '../src/templates.ts';
const paragraph = (id: string, text: string): NotebookNode => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }] });
const source = { source: 'notebook-local-catalog' as const, catalogId: 'catalog', recordId: 'registered', version: 3, schemaId: 'schema', schemaRevision: 2 };
const document = (): NotebookDocument => ({ schemaVersion: 1, title: 'Method', content: paragraph('notes', 'Main notes') as NotebookDocument['content'], procedures: [{ id: 'p', title: 'Rich method', description: 'obsolete introduction', introduction: paragraph('intro', 'Cold handling'), materials: [{ id: 'mixture', name: 'Mixture', quantity: '2 mL', content: paragraph('mixture-notes', 'Premix freshly'), children: [{ id: 'buffer', name: 'Buffer', quantity: '1 mL', source, content: paragraph('buffer-notes', 'Keep on ice') }] }], steps: [{ id: 'step', text: 'obsolete step', content: paragraph('step-notes', 'Mix gently'), level: 'step', critical: false, pause: false, completed: false, minutes: null }] }] });
function apply(procedures: NotebookProcedure[], change: ProcedureChange) { const before = structuredClone(procedures), result = changeProcedures(procedures, change); assert.deepEqual(procedures, before); assert.equal(result.status, 'ok'); if (result.status !== 'ok') throw new Error(); return result.procedures; }

test('nested material authoring preserves source pins, bounded trees, order and immutable prior drafts', () => {
  let procedures = document().procedures!;
  procedures = apply(procedures, { type: 'addMaterial', id: 'p', materialId: 'water', parentId: 'mixture' });
  procedures = apply(procedures, { type: 'editMaterial', id: 'p', materialId: 'water', patch: { name: 'Water', quantity: '1 mL' } });
  procedures = apply(procedures, { type: 'moveMaterial', id: 'p', materialId: 'water', direction: -1 });
  assert.deepEqual(procedures[0].materials[0].children!.map(item => item.id), ['water', 'buffer']);
  assert.deepEqual(procedures[0].materials[0].children![1].source, source);
  procedures = apply(procedures, { type: 'addMaterial', id: 'p', materialId: 'third', parentId: 'buffer' });
  procedures = apply(procedures, { type: 'addMaterial', id: 'p', materialId: 'fourth', parentId: 'third' });
  assert.equal(changeProcedures(procedures, { type: 'addMaterial', id: 'p', materialId: 'too-deep', parentId: 'fourth' }).status, 'limit');
  for (const id of ['p', 'mixture', 'buffer', 'intro', 'step-notes']) assert.equal(changeProcedures(procedures, { type: 'addMaterial', id: 'p', materialId: id }).status, 'invalid');
  assert.equal(changeProcedures(procedures, { type: 'addMaterial', id: 'p', materialId: 'new', parentId: 'missing' }).status, 'missing');
  procedures = apply(procedures, { type: 'removeMaterial', id: 'p', materialId: 'buffer' });
  assert.deepEqual(materialItems(procedures[0].materials).map(item => item.id), ['mixture', 'water']);
  const full = [{ ...procedures[0], materials: [{ id: 'parent', name: '', quantity: '', children: Array.from({ length: 99 }, (_, i) => ({ id: `child${i}`, name: '', quantity: '' })) }] }];
  assert.equal(changeProcedures(full, { type: 'addMaterial', id: 'p', materialId: 'overflow' }).status, 'limit');
});

test('rich procedure text, nested materials and pinned identities participate in search and Markdown without stale fallback', () => {
  const value = document(), items = notebookSearchItems(value.content, value.procedures);
  for (const [query, id] of [['Cold', 'intro'], ['ice', 'buffer-notes'], ['registered', 'buffer'], ['gently', 'step-notes']]) {
    const result = searchNotebook(items, query); assert.equal(result[0].id, id); assert.equal(result[0].procedureId, 'p');
  }
  assert.equal(searchNotebook(items, 'obsolete').length, 0);
  const markdown = notebookMarkdown(value);
  assert.match(markdown, /\*\*Cold handling\*\*/); assert.match(markdown, /  - Buffer: 1 mL/); assert.match(markdown, /registered/); assert.match(markdown, /v3/); assert.doesNotMatch(markdown, /obsolete/);
  assert.equal(notebookContentRoots(value).length, 5);
});

test('deep links resolve actual owner/tab including non-searchable blocks without changing the draft', () => {
  const value = document(), before = structuredClone(value);
  for (const id of ['p', 'intro', 'mixture', 'mixture-notes', 'buffer', 'buffer-notes', 'step', 'step-notes']) assert.equal(notebookTarget(value, id)?.tab, 'procedures');
  assert.deepEqual(notebookTarget(value, 'buffer-notes'), { tab: 'procedures', procedureId: 'p', ownerId: 'buffer' });
  assert.deepEqual(notebookTarget(value, 'notes'), { tab: 'notes', ownerId: 'notes' });
  assert.equal(notebookTarget(value, 'gone'), null);
  assert.deepEqual(parseNotebookLink(notebookLinkHash('entry', 'buffer-notes')), { entryId: 'entry', targetId: 'buffer-notes' });
  assert.deepEqual(parseNotebookLink('#notebook-entry=entry'), { entryId: 'entry', targetId: '' });
  for (const hash of ['', '#notebook-entry=entry&notebook-target=bad%20id']) assert.equal(parseNotebookLink(hash), null);
  assert.deepEqual(value, before);
});

test('template instances remap every rich/material identity and expose binding choices while retaining catalog provenance', () => {
  const template: PublishedTemplate = { id: 'template', revision: 1, name: 'Protocol', description: '', kind: 'entry', collections: [], archived: false, publishedAt: '2026-11-09T00:00:00Z', document: document(), parameters: [{ key: 'temperature', label: 'Handling', type: 'text', required: true, target: { kind: 'block-text', blockId: 'intro' } }] };
  const choices = templateBindingChoices(template.document, 'entry');
  for (const id of ['intro', 'mixture-notes', 'buffer-notes', 'step-notes']) assert.ok(choices.some(item => 'blockId' in item.target && item.target.blockId === id));
  let next = 0; const result = instantiateTemplate(template, { temperature: 'Room temperature' }, () => `new-${++next}`);
  for (const id of ['p', 'intro', 'mixture', 'mixture-notes', 'buffer', 'buffer-notes', 'step', 'step-notes', 'notes']) assert.ok(result.origin.idMap[id]);
  assert.deepEqual(result.document.procedures![0].materials[0].children![0].source, source);
  assert.match(notebookMarkdown(result.document), /Room temperature/);
  assert.equal(result.document.procedures![0].materials[0].children![0].id, result.origin.idMap.buffer);
  assert.equal(template.document.procedures![0].introduction!.content![0].content![0].text, 'Cold handling');
});
