import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentBytes, attachmentLimits, isAttachmentAttributes, isAttachmentMime, isPreviewImage } from '../src/attachment.ts';

const attachment = {
  filename: 'observations.txt', mime: 'text/plain', data: 'YWJj', caption: 'Measured values',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};

test('embedded attachment data accepts bounded canonical bytes, not URLs or malformed base64', () => {
  assert.deepEqual([...attachmentBytes(attachment.data)], [97, 98, 99]);
  assert.equal(attachmentBytes('').length, 0);
  assert.equal(attachmentBytes(btoa('a'.repeat(attachmentLimits.bytes))).length, attachmentLimits.bytes);
  for (const data of ['https://example.com/file', 'data:image/png;base64,YWJj', 'YWJj\n', 'YQ', 'YQ=', 'YR==', 'YWJ=', '-_==', btoa('a'.repeat(attachmentLimits.bytes + 1))]) {
    assert.throws(() => attachmentBytes(data), /Invalid attachment data/);
  }
});

test('attachment metadata preserves ordinary files and restricts preview MIME types', () => {
  assert.equal(isAttachmentAttributes(attachment), true);
  assert.equal(isAttachmentAttributes({ ...attachment, filename: '测'.repeat(255) }), true);
  assert.equal(isAttachmentAttributes({ ...attachment, caption: '🧪'.repeat(2000) }), true);
  for (const patch of [
    { filename: '' }, { filename: '../notes.txt' }, { filename: 'folder\\notes.txt' }, { filename: '.' },
    { filename: 'a\n.txt' }, { filename: '测'.repeat(256) }, { caption: '🧪'.repeat(2001) },
    { mime: 'image/svg+xml' }, { mime: 'image/gif' }, { mime: 'text/html; charset=utf-8' },
    { mime: 'https://example.com/file' }, { data: 'YR==' }, { sha256: 'A'.repeat(64) }, { extra: true },
  ]) assert.equal(isAttachmentAttributes({ ...attachment, ...patch }), false, JSON.stringify(patch).slice(0, 100));
  for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
    assert.equal(isAttachmentMime(mime), true);
    assert.equal(isPreviewImage(mime), true);
  }
  for (const mime of ['application/pdf', 'text/plain', 'text/html', 'application/octet-stream']) {
    assert.equal(isAttachmentMime(mime), true);
    assert.equal(isPreviewImage(mime), false);
  }
  assert.equal(isAttachmentAttributes({ ...attachment, data: '', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }), true);
});
