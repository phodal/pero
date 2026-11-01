import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savePaperClipboard } from '../../tests/e2e/paper-pdf-flow.mjs';

test('reader fixture preserves advertised clipboard data but accepts an empty native item', async () => {
  class ClipboardItem {
    constructor(data) {
      assert.ok(Object.keys(data).length, 'native ClipboardItem rejects zero MIME types');
      this.data = data;
    }
  }
  const text = new Blob(['original text'], { type: 'text/plain' });
  const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const empty = { types: [], getType() { throw Error('empty clipboard has no readable data'); } };
  const populated = { types: ['text/plain', 'image/png'], async getType(type) { return type === 'text/plain' ? text : image; } };
  try {
    for (const [items, expected] of [[[], []], [[empty], []], [[empty, populated], [{ 'text/plain': text, 'image/png': image }]]]) {
      await savePaperClipboard({ clipboard: { async read() { return items; } }, ClipboardItem });
      assert.deepEqual(globalThis.paperClipboard.map(item => item.data), expected);
      if (expected.length) {
        assert.equal(globalThis.paperClipboard[0].data['text/plain'], text);
        assert.equal(globalThis.paperClipboard[0].data['image/png'], image);
      }
    }
  } finally { delete globalThis.paperClipboard; }
});

import { deferPdfLocate } from '../../tests/e2e/paper-search-flow.mjs';

test('App fetch gate holds the real locate response, forwards requests and restores fetch', async () => {
  const previous = globalThis.window;
  const calls = [], response = new Response(JSON.stringify({ id: 'real-anchor', rects: [{ x: 0.1 }] }));
  const other = new Response('library');
  const original = async (...args) => { calls.push(args); return args[0] === '/api/pdf/locate' ? response : other; };
  globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
  try {
    deferPdfLocate();
    const options = { method: 'POST', body: '{"page":2}', headers: { 'X-Pero-App-Token': 'fixture' } };
    const pending = window.fetch('/api/pdf/locate', options);
    await window.paperLocateGate.ready;
    assert.equal(window.paperLocateGate.arrived, true);
    assert.equal(window.paperLocateGate.delivered, false);
    assert.equal(await window.fetch('/api/library'), other);
    assert.deepEqual(calls, [['/api/pdf/locate', options], ['/api/library']]);
    window.paperLocateGate.release();
    assert.equal(await pending, response);
    assert.equal(window.paperLocateGate.delivered, true);
    assert.deepEqual(await response.json(), { id: 'real-anchor', rects: [{ x: 0.1 }] });
    window.paperLocateGate.restore();
    assert.equal(window.fetch, original);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('App fetch gate exposes backend failures instead of waiting indefinitely', async () => {
  const previous = globalThis.window;
  for (const original of [async () => new Response('unavailable', { status: 409 }), async () => { throw Error('transport failed'); }]) {
    globalThis.window = { fetch: original, location: { href: 'pero-app://paper-agent/dist/index.html' } };
    try {
      deferPdfLocate();
      const failure = assert.rejects(window.fetch('/api/pdf/locate'), /409|transport failed/);
      await window.paperLocateGate.ready;
      assert.match(window.paperLocateGate.error, /409|transport failed/);
      assert.equal(window.paperLocateGate.arrived, false);
      await failure;
      window.paperLocateGate.restore();
      assert.equal(window.fetch, original);
    } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  }
});
