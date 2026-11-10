import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCatalogCellSelection, applyRegistrationReceipt, catalogCellValue, validateStructuredTable,
  type CatalogSnapshot, type RegistrationReceipt, type StructuredColumn, type StructuredTableDraft,
} from '../src/structured-table.ts';

const column = (id: string, type: StructuredColumn['type'], patch: Partial<StructuredColumn> = {}): StructuredColumn => ({ id, name: id, type, required: false, options: [], units: [], ...patch });
const columns = [column('name', 'text', { required: true }), column('mass', 'quantity', { units: ['mg', 'µg'] }), column('active', 'boolean'), column('ref', 'object')];
const table = (): StructuredTableDraft => ({ id: 'table', name: 'Samples', schema: { id: 'schema', revision: 1, columns }, rows: [
  { id: 'row-a', cells: { name: 'First', mass: '1.20 mg' } }, { id: 'row-b', cells: { name: 'Second', ref: '{"manual":true}' } },
] });
const receipt = (): RegistrationReceipt => ({ source: 'notebook-local-catalog', catalogId: 'real-catalog', tableId: 'table', schemaId: 'schema', schemaRevision: 1,
  submissionId: 'submission', inputHash: 'a'.repeat(64), registeredAt: '2026-11-09T13:00:00Z',
  records: [{ rowId: 'row-b', recordId: 'record-b', version: 3 }, { rowId: 'row-a', recordId: 'record-a', version: 2 }] });
const snapshot = (): CatalogSnapshot => ({ source: 'notebook-local-catalog', catalogId: 'real-catalog', query: { schemaId: '', text: '', limit: 200 },
  refreshedAt: '2026-11-09T13:00:00Z', total: 1, records: [{ id: 'source-record', version: 7, schemaId: 'source-schema', schemaRevision: 2,
    tableId: 'source-table', rowId: 'source-row', name: 'Registered source', registeredAt: '2026-11-09T12:00:00Z', columns,
    values: { name: { type: 'text', value: 'Source sample' }, mass: { type: 'quantity', value: '0.00', unit: 'µg' }, active: { type: 'boolean', value: false }, ref: { type: 'missing' } },
  }] });

test('registration atomically attaches the receipt and fills empty references by committed row identity, preserving manual values', () => {
  const submitted = table(), original = structuredClone(submitted), committed = receipt();
  const result = applyRegistrationReceipt({ table: submitted, receipts: [] }, { table: submitted, inputHash: committed.inputHash, submissionId: committed.submissionId, referenceColumnId: 'ref' }, committed);
  assert.deepEqual(JSON.parse(result.table.rows[0].cells.ref), { source: 'notebook-local-catalog', catalogId: 'real-catalog', recordId: 'record-a', version: 2, schemaId: 'schema', schemaRevision: 1 });
  assert.equal(result.table.rows[1].cells.ref, '{"manual":true}');
  assert.equal(result.table.schema.revision, 1);
  assert.equal(result.receipts[0], committed);
  assert.deepEqual(submitted, original);
  assert.deepEqual(validateStructuredTable(result.table), []);
  const disabled = applyRegistrationReceipt({ table: submitted, receipts: [committed] }, { table: submitted, inputHash: committed.inputHash, submissionId: committed.submissionId, referenceColumnId: '' }, committed);
  assert.equal(disabled.table, submitted); assert.equal(disabled.receipts.length, 1);
});

test('registration does not attach forged, incomplete, stale or conflicting receipts and never bypasses the autofill column type', () => {
  const submitted = table(), committed = receipt(), input = { table: submitted, inputHash: committed.inputHash, submissionId: committed.submissionId, referenceColumnId: 'ref' };
  const cases = [
    { label: 'changed cells', current: { ...submitted, rows: submitted.rows.map(row => ({ ...row, cells: { ...row.cells, name: 'Newer edit' } })) }, receipt: committed, input },
    { label: 'missing rows', current: submitted, receipt: { ...committed, records: committed.records.slice(1) }, input },
    { label: 'different row', current: submitted, receipt: { ...committed, records: committed.records.map(record => ({ ...record, rowId: record.rowId + '-other' })) }, input },
    { label: 'schema', current: submitted, receipt: { ...committed, schemaRevision: 2 }, input },
    { label: 'hash', current: submitted, receipt: { ...committed, inputHash: 'b'.repeat(64) }, input },
    { label: 'submission', current: submitted, receipt: { ...committed, submissionId: 'other' }, input },
    { label: 'column type', current: submitted, receipt: committed, input: { ...input, referenceColumnId: 'name' } },
  ];
  for (const item of cases) {
    const before = structuredClone(item.current), state = { table: item.current, receipts: [] };
    assert.throws(() => applyRegistrationReceipt(state, item.input, item.receipt), undefined, item.label);
    assert.deepEqual(state, { table: before, receipts: [] }, item.label);
  }
  assert.throws(() => applyRegistrationReceipt({ table: submitted, receipts: [committed] }, input, { ...committed, registeredAt: '2026-11-10T00:00:00Z' }), /conflicting receipt/);
});

test('catalog selection pins actual catalog, record and schema versions into only the selected row and column', () => {
  const current = table(), source = snapshot(), before = structuredClone(current);
  const result = applyCatalogCellSelection(current, before, 'row-b', 'ref', source, 'source-record', { type: 'reference' });
  assert.deepEqual(JSON.parse(result.rows[1].cells.ref), { source: 'notebook-local-catalog', catalogId: 'real-catalog', recordId: 'source-record', version: 7, schemaId: 'source-schema', schemaRevision: 2 });
  assert.deepEqual(result.rows[0], before.rows[0]);
  assert.equal(result.rows[1].cells.name, 'Second'); assert.deepEqual(current, before);
  assert.throws(() => applyCatalogCellSelection({ ...current, name: 'Newer' }, before, 'row-b', 'ref', source, 'source-record', { type: 'reference' }), /table changed/);
  assert.throws(() => applyCatalogCellSelection(current, before, 'removed', 'ref', source, 'source-record', { type: 'reference' }), /Unknown cell/);
});

test('compatible field selection preserves false, exact decimals and units while rejecting type, unit, option and required mismatches', () => {
  const source = snapshot();
  assert.equal(catalogCellValue(columns[1], source, 'source-record', { type: 'field', columnId: 'mass' }), '0.00 µg');
  assert.equal(catalogCellValue(columns[2], source, 'source-record', { type: 'field', columnId: 'active' }), 'false');
  assert.equal(catalogCellValue(columns[3], source, 'source-record', { type: 'field', columnId: 'ref' }), '');
  const cases = [
    { target: columns[0], selection: { type: 'reference' } },
    { target: columns[0], selection: { type: 'field', columnId: 'mass' } },
    { target: { ...columns[1], units: ['mg'] }, selection: { type: 'field', columnId: 'mass' } },
    { target: { ...columns[0], options: ['Allowed'] }, selection: { type: 'field', columnId: 'name' } },
    { target: { ...columns[3], required: true }, selection: { type: 'field', columnId: 'ref' } },
  ] as const;
  for (const item of cases) assert.throws(() => catalogCellValue(item.target, source, 'source-record', item.selection));
  assert.throws(() => catalogCellValue(columns[3], source, 'absent-record', { type: 'reference' }), /loaded catalog snapshot/);
});
