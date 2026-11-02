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

test('saving refreshes only a missing PDF and ignores a late refresh after navigation', async () => {
  const pdf = readFileSync(new URL('../../apps/paper-agent/ui-src/pdf-reader.tsx', import.meta.url), 'utf8');
  const refresh = pdf.match(/useEffect\(\(\) => \{\n(    if \(lockText \|\| seenPdfReload\.current === pdfReloadToken\)[\s\S]*?)\n  \}, \[api, paper.id, pdfReloadToken, lockText, reading.document, focus\?\.documentId\]\);/);
  assert.ok(refresh, 'save refresh must use the mounted PDF owner');
  const run = new Function('lockText', 'seenPdfReload', 'pdfReloadToken', 'focus', 'reading', 'pdfLoadEpoch', 'api', 'paper', 'setReading', 'setMode', 'loadReaderState', 'setError', 'setBusy', transformSync(refresh[1], { loader: 'ts' }).code);
  const requests = [], changes = [], modes = [], errors = [], seen = { current: 0 }, epoch = { current: 4 };
  const api = { get(path) { assert.equal(path, '/api/pdf?paperId=metadata'); return new Promise(resolve => requests.push(resolve)); } };
  const open = (document, token) => run(false, seen, token, null, { document }, epoch, api, { id: 'metadata' }, value => changes.push(value), value => modes.push(value), () => null, value => errors.push(value), () => {});
  // Existing Read/PDF state is untouched, including its annotation owner.
  open({ id: 'original', fileDigest: 'same-bytes' }, 1);
  assert.equal(requests.length, 0); assert.deepEqual(changes, []); assert.deepEqual(modes, []);
  const current = open(null, 2);
  assert.equal(epoch.current, 5, 'the refresh supersedes an older initial PDF lookup');
  const acquired = { document: { id: 'attached', fileDigest: 'same-bytes' }, annotations: [{ id: 'original-note' }] };
  requests[0](acquired); await drain();
  assert.deepEqual(changes, [acquired]); assert.deepEqual(modes, ['pdf']); current();
  const stale = open(null, 3); stale(); requests[1]({ document: { id: 'obsolete' }, annotations: [] }); await drain();
  assert.deepEqual(changes, [acquired]); assert.deepEqual(errors, []);
});

test('unlocking after export keeps explicit version focus ahead of a pending save refresh', async () => {
  const pdf = readFileSync(new URL('../../apps/paper-agent/ui-src/pdf-reader.tsx', import.meta.url), 'utf8');
  const initial = pdf.match(/useEffect\(\(\) => \{\n(    if \(lockText\) return;[\s\S]*?)\n  \}, \[api, paper.id, focus\?\.documentId, lockText\]\);/);
  const reload = pdf.match(/useEffect\(\(\) => \{\n(    if \(lockText \|\| seenPdfReload\.current === pdfReloadToken\)[\s\S]*?)\n  \}, \[api, paper.id, pdfReloadToken, lockText, reading.document, focus\?\.documentId\]\);/);
  assert.ok(initial); assert.ok(reload);
  const parameters = ['lockText', 'focus', 'reading', 'pdfLoadEpoch', 'api', 'paper', 'setReading', 'setMode', 'loadReaderState', 'setError', 'setBusy', 'seenPdfReload', 'pdfReloadToken'];
  const runInitial = new Function(...parameters, transformSync(initial[1], { loader: 'ts' }).code);
  const runReload = new Function(...parameters, transformSync(reload[1], { loader: 'ts' }).code);
  const requests = [], documents = [], modes = [], errors = [], epoch = { current: 0 }, seen = { current: 0 };
  const api = { get(path) { return new Promise(resolve => requests.push({ path, resolve })); } };
  const args = locked => [locked, { documentId: 'explicit-old-version' }, { document: null }, epoch, api, { id: 'metadata' }, value => documents.push(value.document?.id ?? null), value => modes.push(value), () => null, value => errors.push(value), () => {}, seen, 1];
  runInitial(...args(true)); runReload(...args(true)); // Export happened while search locked text.
  assert.equal(requests.length, 0);
  const cleanup = runInitial(...args(false)); runReload(...args(false));
  assert.deepEqual(requests.map(value => value.path), ['/api/pdf/explicit-old-version']);
  assert.equal(seen.current, 1, 'focused navigation consumes the pending save signal');
  requests[0].resolve({ document: { id: 'explicit-old-version' }, annotations: [] }); await drain();
  assert.deepEqual(documents, [null, 'explicit-old-version']); assert.deepEqual(modes, ['text', 'pdf']);
  assert.deepEqual(errors, ['']); cleanup();
});
