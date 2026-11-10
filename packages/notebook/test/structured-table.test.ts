import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canonicalStructuredTable, changeStructuredTable, createStructuredTable, isCatalogSnapshot, isStructuredTable,
  isStructuredTableAttributes, parseTypedCell, validateStructuredTable,
  type CatalogSnapshot, type ColumnType, type RegistrationReceipt, type StructuredColumn, type StructuredTableDraft,
} from '../src/structured-table.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/structured-table-contract.json', import.meta.url), 'utf8'));
const column = (patch: Partial<StructuredColumn> = {}): StructuredColumn => ({ id: 'name', name: 'Name', type: 'text', required: false, options: [], units: [], ...patch });
const draft = (): StructuredTableDraft => ({ ...createStructuredTable('table-1', 'schema-1', 'row-1', 'name'), name: '样品 😀', rows: [{ id: 'row-1', cells: { name: 'A' } }] });
const receipt: RegistrationReceipt = { source: 'notebook-local-catalog', catalogId: 'catalog-1', submissionId: 'submit-1', inputHash: 'a'.repeat(64), tableId: 'table-1', schemaId: 'schema-1', schemaRevision: 1,
  registeredAt: '2026-11-09T01:02:03.000001+00:00', records: [{ rowId: 'row-1', recordId: 'record-1', version: 1 }] };

test('typed cells preserve decimals, units, false and zero and distinguish missing values', () => {
  for (const example of fixtures) {
    const definition = column({ type: example.type as ColumnType, required: example.required ?? false, options: example.options ?? [], units: example.units ?? [] });
    assert.deepEqual(parseTypedCell(definition, example.raw), example.error ? { error: example.error } : { value: example.value }, `${example.type}: ${example.raw}`);
  }
});

test('table edits keep stable identities, advance schema only for column changes, and retain previous snapshots', () => {
  const initial = draft(), untouched = structuredClone(initial);
  let table = changeStructuredTable(initial, { type: 'addRow', id: 'row-2' });
  table = changeStructuredTable(table, { type: 'cell', rowId: 'row-2', columnId: 'name', value: 'B' });
  assert.equal(table.schema.revision, 1);
  table = changeStructuredTable(table, { type: 'addColumn', column: column({ id: 'mass', name: 'Mass', type: 'quantity', units: ['mg'] }) });
  table = changeStructuredTable(table, { type: 'cell', rowId: 'row-2', columnId: 'mass', value: '1.5 mg' });
  assert.equal(table.schema.revision, 2);
  table = changeStructuredTable(table, { type: 'configureColumn', column: { ...table.schema.columns[1], units: ['µg'] } });
  assert.equal(table.schema.revision, 3);
  assert.equal(table.rows[1].cells.mass, '1.5 mg', 'schema edits never discard now-invalid input');
  assert.deepEqual(validateStructuredTable(table), [{ code: 'unit', rowId: 'row-2', columnId: 'mass' }]);
  table = changeStructuredTable(table, { type: 'removeColumn', id: 'mass' });
  assert.deepEqual(table.rows.map(row => row.cells), [{ name: 'A' }, { name: 'B' }]);
  table = changeStructuredTable(table, { type: 'removeRow', id: 'row-1' });
  assert.equal(table.rows[0].id, 'row-2');
  assert.equal(table.schema.columns[0].id, 'name');
  assert.deepEqual(initial, untouched);
  assert.deepEqual(receipt.records, [{ rowId: 'row-1', recordId: 'record-1', version: 1 }]);
});

test('draft structure permits invalid semantic values but rejects lost identity and unsupported fields', () => {
  const valid = draft();
  const unfinished = { ...valid, name: '', rows: [{ id: 'row-1', cells: { name: '' } }] };
  assert.ok(isStructuredTable(unfinished));
  assert.deepEqual(validateStructuredTable(unfinished), [{ code: 'name' }, { code: 'required', rowId: 'row-1', columnId: 'name' }]);
  for (const invalid of [
    { ...valid, rows: [...valid.rows, ...valid.rows] },
    { ...valid, rows: [{ id: 'row-1', cells: { absent: 'x' } }] },
    { ...valid, schema: { ...valid.schema, columns: [...valid.schema.columns, ...valid.schema.columns] } },
    { ...valid, schema: { ...valid.schema, revision: 0 } },
    { ...valid, surprise: true },
    { ...valid, rows: [{ id: 'row-1', cells: { name: 'x'.repeat(4097) } }] },
    { ...valid, rows: Array.from({ length: 201 }, (_, index) => ({ id: `r-${index}`, cells: {} })) },
  ]) assert.equal(isStructuredTable(invalid), false);
  assert.throws(() => changeStructuredTable(valid, { type: 'addRow', id: 'row-1' }));
  assert.throws(() => changeStructuredTable(valid, { type: 'removeColumn', id: 'name' }));
  assert.throws(() => changeStructuredTable(valid, { type: 'cell', rowId: 'absent', columnId: 'name', value: 'lost' }));
});

test('registration validation owns required names, controlled options and quantity rules', () => {
  const table = draft();
  table.schema.columns = [column({ required: true, options: ['B'] }), column({ id: 'mass', name: 'name', type: 'quantity' }), column({ id: 'blank', name: '', type: 'missing', required: true })];
  assert.deepEqual(validateStructuredTable(table).map(issue => issue.code), ['duplicateName', 'option', 'columnRules', 'duplicateName', 'name', 'columnRules', 'required']);
});

test('canonical inputs are property-order independent, UTF-8 stable, and change when the draft changes', () => {
  const table = draft();
  const reordered = { rows: table.rows, schema: table.schema, name: table.name, id: table.id };
  assert.equal(canonicalStructuredTable(table), canonicalStructuredTable(reordered));
  assert.equal(createHash('sha256').update(canonicalStructuredTable(table)).digest('hex'), '038e18e259c0eadf86d60146c71cd28ecde2fd94500126d2fe641f1eb9d77005');
  assert.notEqual(canonicalStructuredTable(table), canonicalStructuredTable(changeStructuredTable(table, { type: 'cell', rowId: 'row-1', columnId: 'name', value: 'B' })));
});

test('clipboard snapshots retain immutable receipts but reject malformed or schema-inconsistent data', () => {
  assert.ok(isStructuredTableAttributes('registrationTable', { table: draft(), receipts: [receipt] }));
  assert.equal(isStructuredTableAttributes('registrationTable', { table: draft(), receipts: [receipt, receipt] }), false);
  assert.ok(isStructuredTableAttributes('registrationTable', { table: draft(), receipts: [receipt, { ...receipt, catalogId: 'another-installation' }] }));
  assert.equal(isStructuredTableAttributes('registrationTable', { table: draft(), receipts: [{ ...receipt, inputHash: 'invalid' }] }), false);
  const snapshot: CatalogSnapshot = { source: 'notebook-local-catalog', catalogId: 'catalog-1', query: { schemaId: '', text: '', limit: 100 }, refreshedAt: receipt.registeredAt, total: 1, records: [{
    id: 'record-1', version: 1, schemaId: 'schema-1', schemaRevision: 1, tableId: 'table-1', rowId: 'row-1', name: 'Samples', registeredAt: receipt.registeredAt,
    columns: [column()], values: { name: { type: 'text', value: 'A' } },
  }] };
  assert.ok(isCatalogSnapshot(snapshot));
  assert.ok(isStructuredTableAttributes('lookupTable', { query: snapshot.query, snapshot }));
  const wrongType = structuredClone(snapshot); wrongType.records[0].values.name = { type: 'boolean', value: false };
  assert.equal(isCatalogSnapshot(wrongType), false);
  const missingValue = structuredClone(snapshot); delete missingValue.records[0].values.name;
  assert.equal(isCatalogSnapshot(missingValue), false);
  assert.equal(isCatalogSnapshot({ ...snapshot, total: 0 }), false);
  assert.equal(isCatalogSnapshot({ ...snapshot, source: 'benchling' }), false);
});
