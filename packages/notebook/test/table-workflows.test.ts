import assert from 'node:assert/strict';
import test from 'node:test';
import { projectTableView, sameTableSourcePolicy, type TableViewDefinition } from '../src/table-workflows.ts';
import { collectionDestinations, collectionPath } from '../src/template-collections.ts';
import type { StructuredTableDraft } from '../src/structured-table.ts';

const table: StructuredTableDraft = { id: 'table', name: 'Samples', schema: { id: 'schema', revision: 1, columns: [
  { id: 'name', name: 'Name', type: 'text', required: false, options: [], units: [] },
  { id: 'value', name: 'Value', type: 'decimal', required: false, options: [], units: [] },
] }, rows: [{ id: 'a', cells: { name: 'Assay A', value: '10' } }, { id: 'b', cells: { name: 'Assay B', value: '2' } }, { id: 'c', cells: { name: 'Control', value: '0' } }] };
const view: TableViewDefinition = { id: 'view', name: 'Assays', columns: ['value'], text: 'Assay', sortColumn: 'value', descending: false };

test('saved views filter and sort typed rows without mutating or dropping draft cells', () => {
  const original = structuredClone(table);
  assert.deepEqual(projectTableView(table, view), { columns: [table.schema.columns[1]], rows: [table.rows[1], table.rows[0]] });
  assert.deepEqual(projectTableView(table, { ...view, descending: true }).rows.map(row => row.id), ['a', 'b']);
  assert.deepEqual(projectTableView(table, { ...view, text: 'absent' }).rows, []);
  assert.deepEqual(table, original);
  for (const changed of [{ ...view, columns: ['removed'] }, { ...view, sortColumn: 'removed' }, { ...view, columns: [] }]) assert.throws(() => projectTableView(table, changed), /removed columns/);
});

test('collection paths and move destinations follow stable identities after renaming', () => {
  const collections = [{ id: 'a', name: 'Methods', parentId: null }, { id: 'b', name: 'PCR', parentId: 'a' }, { id: 'c', name: 'Controls', parentId: null }];
  assert.deepEqual(collectionPath(collections, 'b').map(item => item.name), ['Methods', 'PCR']);
  assert.deepEqual(collectionDestinations(collections, 'a').map(item => item.id), ['c']);
  assert.deepEqual(collectionDestinations(collections, 'b').map(item => item.id), ['c', 'a']);
});

test('persisted source policy equality ignores property and mapping order but retains every resync option', () => {
  const policy = { query: { schemaId: 'schema', text: '', limit: 200 }, mappings: [{ targetColumnId: 'a', sourceColumnId: 'b' }, { targetColumnId: 'c', sourceColumnId: 'd' }], addNew: true, updateExisting: true, missing: 'keep' as const };
  assert.equal(sameTableSourcePolicy(policy, { ...policy, mappings: [{ sourceColumnId: 'd', targetColumnId: 'c' }, { sourceColumnId: 'b', targetColumnId: 'a' }] }), true);
  assert.equal(sameTableSourcePolicy(policy, { ...policy, updateExisting: false }), false);
  assert.equal(sameTableSourcePolicy(policy, { ...policy, missing: 'remove-unedited' }), false);
  assert.equal(sameTableSourcePolicy(policy, null), false);
});
