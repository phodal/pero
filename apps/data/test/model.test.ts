import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availabilityLabel, encodeBytes, retainSelection, visibleDatasets, type Asset, type CatalogState, type Dataset } from '../ui-src/model.ts';

const asset = (id: string, source = 'Local files'): Asset => ({ id, name: 'sample.csv', kind: 'dataset', format: 'csv', size: 4,
  source, revision: '', license: 'Unknown', sha256: 'digest', createdAt: '', checksums: [], bundleId: '', sourceId: '', localAvailable: true, availability: 'present' });
const dataset = (id: string, versions: string[], projectRef = '', archived = false): Dataset => ({ id, versions, name: `Data ${id}`, kind: 'dataset', projectRef, archived });
const state: CatalogState = { assets: [asset('a', 'Control Lab'), asset('b'), asset('c')],
  datasets: [dataset('first', ['a', 'b'], 'control'), dataset('second', ['c'], 'bio', true)], views: [], sources: [], download: null,
  parserVersion: 'pero-data/1', limits: { importBytes: 10, previewBytes: 10, records: 100, fields: 256, columns: 32 } };

test('catalog search covers historical source metadata and explicit project/archive filters', () => {
  assert.deepEqual(visibleDatasets(state, 'Control Lab', '', false).map(d => d.id), ['first']);
  assert.deepEqual(visibleDatasets(state, '', 'bio', false), []);
  assert.deepEqual(visibleDatasets(state, '', 'bio', true).map(d => d.id), ['second']);
  assert.deepEqual(visibleDatasets(state, 'absent', '', false), []);
});

test('refresh preserves a pinned older version, not a moving latest alias', () => {
  const pinned = { datasetId: 'first', assetId: 'a' };
  assert.equal(retainSelection(state, pinned), pinned);
  assert.deepEqual(retainSelection(state, null), { datasetId: 'first', assetId: 'b' });
  assert.deepEqual(retainSelection(state, { datasetId: 'first', assetId: 'c' }), { datasetId: 'first', assetId: 'b' });
  assert.equal(retainSelection({ ...state, datasets: [] }, pinned), null);
});

test('byte encoding preserves opaque content, including non-UTF8 and a chunk boundary', () => {
  const bytes = new Uint8Array(65539);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  assert.deepEqual(Uint8Array.from(atob(encodeBytes(bytes.buffer)), c => c.charCodeAt(0)), bytes);
});

test('stored is not a scientific or current-byte verification claim', () => {
  assert.equal(availabilityLabel(asset('a')), 'Stored');
  assert.equal(availabilityLabel({ ...asset('a'), availability: 'changed' }), 'Changed');
  assert.equal(availabilityLabel({ ...asset('a'), availability: 'missing' }), 'Missing');
});

test('interpretation preview reads full input without applying to the current analysis', async () => {
  const { emptyView, interpretationPreview } = await import('../ui-src/model.ts');
  const view = { ...emptyView(), columns: ['id', 'amount'], filter: { field: 'amount', operator: 'gte', value: '10' },
    sort: { field: 'id', descending: true }, selection: [3], chart: { category: 'id', measure: 'amount', aggregation: 'sum' },
    issue: { kind: 'empty' as const, field: 'amount' }, interpretations: { id: 'number' as const }, units: { amount: 'kg' } };
  const original = structuredClone(view);
  const draft = interpretationPreview(view, 'amount', true);
  assert.deepEqual(draft, { ...view, columns: ['amount'], filter: null, sort: null, selection: [], chart: null, issue: null,
    interpretations: { id: 'number', amount: 'number' } });
  assert.deepEqual(view, original);
  assert.deepEqual(interpretationPreview(draft, 'amount', false).interpretations, { id: 'number' });
});

test('reverting a number removes only conversion issues that lose their interpretation', async () => {
  const { emptyView, applyInterpretation } = await import('../ui-src/model.ts');
  const view = { ...emptyView(), interpretations: { amount: 'number' as const, id: 'number' as const },
    issue: { kind: 'conversion' as const, field: 'amount' }, filter: { field: 'id', operator: 'gte', value: '1' } };
  const reverted = applyInterpretation(view, 'amount', false);
  assert.equal(reverted.issue, null);
  assert.deepEqual(reverted.interpretations, { id: 'number' });
  assert.deepEqual(reverted.filter, view.filter);
  const allFailures = { ...view, issue: { kind: 'conversion' as const } };
  assert.deepEqual(applyInterpretation(allFailures, 'amount', false).issue, allFailures.issue);
  assert.equal(applyInterpretation(applyInterpretation(allFailures, 'amount', false), 'id', false).issue, null);
  const missing = { ...view, issue: { kind: 'missing' as const, field: 'amount' } };
  assert.deepEqual(applyInterpretation(missing, 'amount', false).issue, missing.issue);
  assert.deepEqual(view.interpretations, { amount: 'number', id: 'number' });
  assert.deepEqual(applyInterpretation(reverted, 'amount', true).interpretations, { id: 'number', amount: 'number' });
});

test('semantic samples omit absent optional values and pass the SDK JSON boundary', async () => {
  const { sampleRows, applyInterpretation, emptyView } = await import('../ui-src/model.ts');
  const { AppSurface } = await import('../../../packages/app-sdk/src/app-use.ts');
  const sample = sampleRows({ columns: ['text', 'number', 'failed', 'missing'], rows: Array.from({ length: 11 }, (_, index) => ({
    row: index + 1, pointer: `/records/${index}`, line: index + 2, cells: [
      { kind: 'string', text: '001' }, { kind: 'number', text: '02', exact: '2' },
      { kind: 'string', text: 'bad'.repeat(100), conversionError: 'Not a finite decimal number' },
    ],
  })) } as import('../ui-src/model.ts').OkInspection);
  assert.equal(sample.length, 10);
  assert.deepEqual(sample[0].cells.text, { kind: 'string', display: '001', truncated: false });
  assert.equal(sample[0].cells.number.exact, '2');
  assert.equal(sample[0].cells.failed.display.length, 240);
  assert.equal(sample[0].cells.failed.truncated, true);
  assert.equal(sample[0].cells.failed.conversionError, 'Not a finite decimal number');
  assert.deepEqual(sample[0].cells.missing, { kind: 'missing', display: '', truncated: false });
  const surface = new AppSurface('data');
  assert.doesNotThrow(() => surface.register({ id: 'dataset-view', kind: 'dataset-view', state: { sample } }));
  const { issue: _issue, interpretations: _interpretations, ...legacy } = emptyView();
  const interpretedLegacy = applyInterpretation(legacy, 'number', true);
  assert.equal(interpretedLegacy.issue, null);
  assert.doesNotThrow(() => surface.register({ id: 'legacy-view', kind: 'dataset-view', state: interpretedLegacy }));
  for (const columns of [['number'], Array.from({ length: 32 }, (_, i) => `field-${i}`)]) {
    const exact = '9'.repeat(40000);
    const input = { columns, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 1, pointer: `/${i}`, line: null,
      cells: columns.map(() => ({ kind: 'number', text: exact, exact })) })) } as import('../ui-src/model.ts').OkInspection;
    const bounded = sampleRows(input);
    assert.doesNotThrow(() => surface.register({ id: `large-${columns.length}`, kind: 'dataset-view', state: { sample: bounded } }));
    assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).length <= 8192);
    assert.ok(bounded.length > 0);
    assert.equal(bounded[0].cells[columns[0]].exact, undefined);
    assert.equal(bounded[0].cells[columns[0]].exactOmitted, true);
    assert.equal(input.rows[0].cells[0].exact, exact);
  }
});
