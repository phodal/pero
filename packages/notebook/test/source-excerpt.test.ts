import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createSourceExcerpt, isSourceExcerpt, isSourceExcerptAttributes, readSourceExcerptAttachment, sameSourceExcerptAttachment,
  sourceExcerptAvailability, sourceExcerptLimits, sourceExcerptSelection, verifySourceExcerpt, type SourceExcerptAttachment } from '../src/source-excerpt.ts';

const candidate = (text: string | Uint8Array, mime = 'text/plain'): SourceExcerptAttachment => {
  const bytes = typeof text === 'string' ? Buffer.from(text) : Buffer.from(text);
  return { blockId: 'source-1', attachment: { filename: 'notes.txt', mime, data: bytes.toString('base64'), caption: '', sha256: createHash('sha256').update(bytes).digest('hex') } };
};

test('source excerpt retains exact UTF-8 bytes, BOM, newlines and Unicode codepoint ranges', async () => {
  const file = candidate('\ufeffA🧪e\u0301\r\n终\rLast');
  const snapshot = await readSourceExcerptAttachment(file), excerpt = createSourceExcerpt(snapshot, 2, 8);
  assert.equal(snapshot.text.charCodeAt(0), 0xfeff);
  assert.equal(excerpt.quote, '🧪e\u0301\r\n终');
  assert.equal(excerpt.version, file.attachment.sha256);
  assert.deepEqual(await verifySourceExcerpt(JSON.parse(JSON.stringify(excerpt))), excerpt);
  assert.deepEqual(Buffer.from(snapshot.text), Buffer.from(file.attachment.data, 'base64'));
  assert.equal(sourceExcerptAvailability(excerpt, [file]), 'available');
  assert.equal(sourceExcerptAvailability(excerpt, []), 'missing');
  assert.equal(sourceExcerptAvailability(excerpt, [candidate('Changed source')]), 'changed');
  assert.equal(sourceExcerptAvailability(excerpt, [{ ...file, attachment: { ...file.attachment, data: Buffer.from('Different').toString('base64') } }]), 'changed');
  assert.equal(sourceExcerptAvailability(excerpt, [file, file]), 'changed');
  assert.deepEqual(sourceExcerptSelection(snapshot.text, 2, 8), { start: 2, end: 8 });
  assert.deepEqual(sourceExcerptSelection(snapshot.text, 8, 9), { start: 8, end: 9 });
  assert.throws(() => sourceExcerptSelection(snapshot.text, 3, 8), /complete characters/);
  assert.equal(sameSourceExcerptAttachment(file, { ...file, attachment: { ...file.attachment, caption: 'New caption' } }), true);
  assert.equal(sameSourceExcerptAttachment(file, candidate('Replaced')), false);
  assert.equal(sameSourceExcerptAttachment(file, undefined), false);
});

test('untrusted excerpts fail bounded shape and range rules; claimed digest stays unverified until hashing', async () => {
  const valid = createSourceExcerpt(await readSourceExcerptAttachment(candidate('A🧪B')), 1, 2);
  const invalid = [
    { ...valid, text: 'a'.repeat(sourceExcerptLimits.bytes + 1) },
    { ...valid, text: '中'.repeat(45000) }, { ...valid, text: 'A\u0000B' }, { ...valid, text: 'A\ud800B' },
    { ...valid, start: -1 }, { ...valid, start: 1.5 }, { ...valid, start: true }, { ...valid, end: 99 },
    { ...valid, end: 1 }, { ...valid, quote: 'other' }, { ...valid, version: 'arbitrary' }, { ...valid, extra: true },
    { ...valid, source: { ...valid.source, mime: 'text/html' } }, { ...valid, source: { ...valid.source, filename: '../file' } },
    { ...valid, source: { ...valid.source, blockId: 'bad\n' } }, { ...valid, source: { ...valid.source, sha256: 'no' } },
    { ...valid, source: { ...valid.source, extra: 'no' } },
  ];
  for (const item of invalid) { assert.equal(isSourceExcerpt(item), false, JSON.stringify(item).slice(0, 150)); await assert.rejects(() => verifySourceExcerpt(item)); }
  const forged = { ...valid, source: { ...valid.source, sha256: 'a'.repeat(64) }, version: 'a'.repeat(64) };
  assert.equal(isSourceExcerpt(forged), true, 'sync clipboard admission does not falsely promise digest verification');
  await assert.rejects(() => verifySourceExcerpt(forged), /digest/);
  assert.equal(isSourceExcerptAttributes({ label: '', excerpt: null }), true);
  assert.equal(isSourceExcerptAttributes({ label: 'Pinned', excerpt: valid }), true);
  assert.equal(isSourceExcerptAttributes({ label: 'x'.repeat(201), excerpt: valid }), false);
  assert.equal(isSourceExcerptAttributes({ label: '', excerpt: null, href: 'bad' }), false);
});

test('attachment import refuses binary, malformed UTF-8, unbounded or unsupported sources and digest mismatch', async () => {
  for (const file of [candidate(Uint8Array.of(0xc3, 0x28)), candidate(Uint8Array.of(0xff, 0xfe, 0x41, 0)), candidate('a\u0000b'), candidate('pdf', 'application/pdf'), candidate('html', 'text/html'), candidate('a'.repeat(sourceExcerptLimits.bytes + 1))]) {
    await assert.rejects(() => readSourceExcerptAttachment(file));
  }
  const forged = candidate('real text'); forged.attachment.sha256 = 'b'.repeat(64);
  await assert.rejects(() => readSourceExcerptAttachment(forged), /digest/);
  const malformed = candidate('text'); malformed.attachment.data = 'data:text/plain;base64,dGV4dA==';
  await assert.rejects(() => readSourceExcerptAttachment(malformed));
  const empty = await readSourceExcerptAttachment(candidate(''));
  assert.throws(() => createSourceExcerpt(empty, 0, 0), /nonempty/);
  const maximum = await readSourceExcerptAttachment(candidate('a'.repeat(sourceExcerptLimits.bytes)));
  assert.equal(createSourceExcerpt(maximum, 0, 1).quote, 'a');
});

test('source discovery includes Notes, introductions, nested material notes and steps through workspace roots', async () => {
  const { sourceExcerptAttachments } = await import('../src/source-excerpt.ts');
  const block = (id: string) => ({ type: 'attachment', attrs: { blockId: id, ...candidate(id).attachment } });
  const root = (id: string) => ({ type: 'doc' as const, content: [{ type: 'blockquote', content: [block(id)] }] });
  const document = { content: root('notes'), procedures: [{ id: 'method', title: 'Method', description: '', introduction: root('introduction'),
    materials: [{ id: 'material', name: 'Buffer', quantity: '', children: [{ id: 'nested', name: 'Stock', quantity: '', content: root('nested-note') }] }],
    steps: [{ id: 'step', text: '', level: 'step' as const, critical: false, pause: false, minutes: null, completed: false, content: root('step-source') }],
  }] };
  assert.deepEqual(sourceExcerptAttachments(document).map(item => item.blockId), ['notes', 'introduction', 'nested-note', 'step-source']);
});
