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
