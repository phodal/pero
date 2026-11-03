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
