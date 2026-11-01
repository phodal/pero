import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../../apps/paper-agent/ui-src/structured-reading.tsx', import.meta.url), 'utf8');
const effect = source.match(/useEffect\(\(\) => \{\n(    const version = \+\+epoch\.current; setDocument\(null\);[\s\S]*?)\n  \}, \[api, paperId, openToken\]\);/);
assert.ok(effect, 'explicit same-paper open must rerun the actual overview effect');
const argumentsList = ['epoch', 'originalEpoch', 'setDocument', 'setRecordedScope', 'setOverview', 'setBusy', 'setError', 'setOriginal', 'onReady', 'api', 'paperId', 'readSetting', 'load'];
const runEffect = new Function(...argumentsList, transformSync(effect[1], { loader: 'ts' }).code);
const drain = () => new Promise(resolve => setImmediate(resolve));

test('same-paper reopen refreshes scopes and rejects a late previous overview', async () => {
  const epoch = { current: 0 }, originalEpoch = { current: 0 }, pending = [], loaded = [], errors = [];
  let overview;
  const api = { get(path) { assert.equal(path, '/api/paper-documents?paperId=same-pdf'); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } };
  const noop = () => {};
  const open = () => runEffect(epoch, originalEpoch, noop, noop, value => { overview = value; }, noop, value => errors.push(value), noop, noop, api, 'same-pdf', () => 'immutable-A', async (id, version) => loaded.push({ id, version }));
  const first = open();
  pending[0].resolve({ revisions: [{ id: 'immutable-A' }], sources: ['A'] }); await drain();
  assert.deepEqual(overview.sources, ['A']);
  first(); const old = open(); // An earlier reopen is still awaiting metadata.
  old(); const current = open(); // A second bundle was approved meanwhile.
  pending[2].resolve({ revisions: [{ id: 'immutable-A' }], sources: ['A', 'B'] }); await drain();
  pending[1].resolve({ revisions: [{ id: 'obsolete' }], sources: ['A'] }); await drain();
  assert.deepEqual(overview.sources, ['A', 'B']);
  assert.deepEqual(loaded.map(value => value.id), ['immutable-A', 'immutable-A']);
  assert.equal(loaded[1].version, epoch.current);
  assert.ok(errors.every(value => value === ''));
  current();
});

test('existing explicit read token reaches structured metadata without remounting PDF', () => {
  const index = readFileSync(new URL('../../apps/paper-agent/ui-src/index.tsx', import.meta.url), 'utf8');
  const reader = readFileSync(new URL('../../apps/paper-agent/ui-src/documents.tsx', import.meta.url), 'utf8');
  assert.match(index, /<Reader key=\{reading.id\} openToken=\{readVersion.current\}/);
  assert.match(reader, /<StructuredReading openToken=\{openToken\}/);
  assert.match(reader, /<PdfReader key=\{paper.id\}/);
});
