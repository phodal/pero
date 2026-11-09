import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRegistrationReceipt, createStructuredTable, createRegistrationWaiver, isRegistrationReceipt, isCatalogSnapshot, type RegistrationReceipt } from '../src/structured-table.ts';

test('required-missing waiver is explicit, narrow, snapshot-bound and retained on receipts', () => {
  const table = { ...createStructuredTable('table', 'schema', 'row', 'name'), name: 'Pending sample' };
  const hash = 'a'.repeat(64);
  const waiver = createRegistrationWaiver(table, hash, 'Awaiting measurement', 'Local researcher');
  const receipt: RegistrationReceipt = { source: 'notebook-local-catalog', catalogId: 'catalog', submissionId: 'submission', inputHash: hash, tableId: 'table', schemaId: 'schema', schemaRevision: 1, registeredAt: '2026-11-09T12:00:00Z', records: [{ rowId: 'row', recordId: 'record', version: 1 }], waiver };
  const input = { table, inputHash: hash, submissionId: 'submission', referenceColumnId: '', waiver };
  assert.equal(isRegistrationReceipt(receipt), true);
  for (const malformed of [null, true, false, 0, 1, 'row', {}, { rowId: 'row' }, { rowId: 'row', recordId: 'record' }]) {
    assert.equal(isRegistrationReceipt({ ...receipt, records: [malformed] }), false);
    assert.equal(isRegistrationReceipt({ ...receipt, records: [receipt.records[0], malformed] }), false);
  }
  const applied = applyRegistrationReceipt({ table, receipts: [] }, input, receipt);
  assert.deepEqual(applied.receipts[0].waiver, waiver);
  assert.equal(applyRegistrationReceipt(applied, input, receipt).receipts.length, 1);
  assert.throws(() => createRegistrationWaiver(table, hash, '', 'Local researcher'));
  assert.throws(() => createRegistrationWaiver({ ...table, name: '' }, hash, 'Reason', 'Local researcher'));
  assert.throws(() => applyRegistrationReceipt({ table, receipts: [] }, input, { ...receipt, waiver: { ...waiver, reason: 'Forged' } }));
  assert.throws(() => applyRegistrationReceipt({ table: { ...table, name: 'Edited' }, receipts: [] }, input, receipt));
  assert.equal(isRegistrationReceipt({ ...receipt, waiver: { ...waiver, inputHash: 'b'.repeat(64) } }), false);
  const snapshot = { source: receipt.source, catalogId: 'catalog', query: { schemaId: '', text: '', limit: 100 }, refreshedAt: receipt.registeredAt, total: 1, records: [{ id: 'record', version: 1, schemaId: 'schema', schemaRevision: 1, tableId: 'table', rowId: 'row', name: table.name, registeredAt: receipt.registeredAt, values: { name: { type: 'missing' } }, columns: table.schema.columns, waiver }] };
  assert.equal(isCatalogSnapshot(snapshot), true);
  assert.equal(isCatalogSnapshot({ ...snapshot, records: [{ ...snapshot.records[0], waiver: { ...waiver, issues: [{ code: 'required', rowId: 'row', columnId: 'unknown' }] } }] }), false);
});
