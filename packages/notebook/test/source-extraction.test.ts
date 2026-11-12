import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { isSourceExtraction, verifyExtractedSource, selectedSourceSegments, type SourceExtraction } from '../src/source-extraction.ts';
import { createSourceExcerpt, verifySourceExcerpt, copySourceExcerpt, isSourceExcerpt } from '../src/source-excerpt.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const text = 'Sample 🧪\n42 mg';
function extraction(): SourceExtraction {
  return { version: 1, original: { sha256: digest('original binary'), bytes: 15 }, parser: { name: 'test-parser', version: '1.0' }, method: 'native', textSha256: digest(text),
    segments: [{ start: 0, end: 8, page: 1, part: 'page/1', region: null, score: null }, { start: 9, end: 14, page: 2, part: 'page/2', region: null, score: null }], limitations: ['Unverified derived text.'] };
}
test('derived excerpts pin original file hash separately from exact extracted UTF-8 text', async () => {
  const receipt = extraction(), source = { blockId: 'original', filename: 'original.pdf', mime: 'application/pdf', sha256: receipt.original.sha256 };
  const retained = createSourceExcerpt({ source, text, extraction: receipt }, 7, 11);
  assert.equal(retained.quote, '🧪\n42');
  assert.equal(retained.version, source.sha256);
  assert.notEqual(retained.extraction!.textSha256, retained.version);
  assert.equal(await verifySourceExcerpt(retained), retained);
  assert.deepEqual(await verifyExtractedSource({ text, extraction: receipt }, source.sha256), { text, extraction: receipt });
  assert.equal(selectedSourceSegments(receipt, 9, 11).length, 1);
  assert.equal(copySourceExcerpt(retained, new Map([['original', 'copied']]))!.source.blockId, 'copied');
  assert.equal(isSourceExcerpt({ ...retained, extraction: { ...receipt, original: { ...receipt.original, sha256: digest('wrong source') } } }), false);
  await assert.rejects(verifySourceExcerpt({ ...retained, text: text.replace('Sample', 'SAMPLE') }), /digest/);
  for (const region of [{ x: 0, y: 0, width: NaN, height: 1 }, { x: .9, y: 0, width: .2, height: 1 }]) assert.equal(isSourceExtraction({ ...receipt, segments: [{ ...receipt.segments[0], region }] }, text), false);
});
