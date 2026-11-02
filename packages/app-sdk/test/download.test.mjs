import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadFile } from '../src/download.mjs';

function stubBrowser(t) {
  const calls = { clicked: [], revoked: [], timers: [], blobs: [] };
  const link = { click() { calls.clicked.push({ href: this.href, download: this.download }); } };
  const saved = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL, document: globalThis.document, setTimeout: globalThis.setTimeout };
  URL.createObjectURL = blob => { calls.blobs.push(blob); return 'blob:test'; };
  URL.revokeObjectURL = url => { calls.revoked.push(url); };
  globalThis.document = { createElement: tag => { assert.equal(tag, 'a'); return link; } };
  globalThis.setTimeout = (fn, ms) => { calls.timers.push(ms); fn(); };
  t.after(() => {
    URL.createObjectURL = saved.createObjectURL;
    URL.revokeObjectURL = saved.revokeObjectURL;
    globalThis.document = saved.document;
    globalThis.setTimeout = saved.setTimeout;
  });
  return calls;
}

test('downloadFile clicks a link carrying the file name and the object URL', async t => {
  const calls = stubBrowser(t);
  downloadFile('notes.md', '# hi', 'text/markdown;charset=utf-8');
  assert.deepEqual(calls.clicked, [{ href: 'blob:test', download: 'notes.md' }]);
  assert.equal(calls.blobs[0].type, 'text/markdown;charset=utf-8');
  assert.equal(await calls.blobs[0].text(), '# hi');
});

test('downloadFile releases the object URL one second after the click', t => {
  const calls = stubBrowser(t);
  downloadFile('a.json', '{}', 'application/json');
  assert.deepEqual(calls.timers, [1000]);
  assert.deepEqual(calls.revoked, ['blob:test']);
});
