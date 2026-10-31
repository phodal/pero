import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileContent, filterAssets, formatBytes, validateImport, IMPORT_LIMIT, type Asset } from '../ui-src/catalog.ts';
const assets: Asset[] = [
  { id: 'one', name: 'Measurements.csv', kind: 'dataset', format: 'csv', size: 123, source: 'Lab', revision: '', license: '', sha256: '', createdAt: '', localAvailable: true, location: '/test/files/asset', checksums: [] },
  { id: 'two', name: 'Potential.model', kind: 'model', format: 'model', size: 456, source: 'MACE', revision: '', license: 'MIT', sha256: '', createdAt: '', localAvailable: true, location: '/test/files/asset', checksums: [] },
];
test('catalog filters combine asset kind and searchable metadata', () => {
  assert.deepEqual(filterAssets(assets, 'model', 'MIT MACE'), [assets[1]]);
  assert.deepEqual(filterAssets(assets, 'dataset', 'mace'), []);
  assert.deepEqual(filterAssets(assets, 'all', ' MEASUREMENTS '), [assets[0]]);
  assert.deepEqual(filterAssets(assets, 'all', ''), assets);
  assert.deepEqual(filterAssets(assets, 'all', 'model'), [assets[1]]);
});
test('sizes do not imply an unknown file is empty', () => {
  assert.equal(formatBytes(undefined), 'Unknown size');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(67622684), '64.5 MiB');
});
test('import rejects empty and oversized files before reading bytes', () => {
  assert.throws(() => validateImport(0), /non-empty/);
  assert.throws(() => validateImport(IMPORT_LIMIT + 1), /10 MiB/);
  assert.doesNotThrow(() => validateImport(IMPORT_LIMIT));
});

test('import transports model bytes without interpreting them', async () => {
  const bytes = new Uint8Array([0, 128, 255, 13, 10]);
  const result = await fileContent(new File([bytes], 'weights.model'));
  assert.deepEqual(Buffer.from(result, 'base64'), Buffer.from(bytes));
});
