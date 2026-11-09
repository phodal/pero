import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { attachmentBytes, deriveImageAttachment, imageDerivationLimits, isAttachmentAttributes, verifiedAttachmentBytes,
  type AttachmentAttributes } from '../src/attachment.ts';

const file = (data: string, filename = 'image.png'): AttachmentAttributes => ({ filename, mime: 'image/png',
  data: Buffer.from(data).toString('base64'), sha256: createHash('sha256').update(data).digest('hex'), caption: 'Observed sample' });
const edit = { x: 2, y: 0, width: 2, height: 2, outputWidth: 4, outputHeight: 2, rotation: 90 };
const original = file('original image bytes');
const derived = deriveImageAttachment(original, file('derived image bytes'), 4, 2, edit);
const second = deriveImageAttachment(derived, file('second derived image'), 2, 4,
  { x: 0, y: 0, width: 2, height: 4, outputWidth: 2, outputHeight: 2, rotation: 0 });

test('image history retains original and intermediate bytes, dimensions, exact edits and connected hashes', async () => {
  assert.equal(isAttachmentAttributes(second), true);
  assert.deepEqual(second.derivation!.steps.map(step => step.source.data), [original.data, derived.data]);
  assert.deepEqual(second.derivation!.steps.map(step => step.outputSha256), [derived.sha256, second.sha256]);
  assert.deepEqual(second.derivation!.steps[0].edit, edit);
  assert.equal(second.caption, original.caption);
  assert.deepEqual(await verifiedAttachmentBytes(JSON.parse(JSON.stringify(second))), attachmentBytes(second.data));
  assert.equal(original.derivation, undefined);
  assert.equal(derived.derivation!.steps.length, 1);
});

test('image history rejects broken chains, dimensions, active sources and unknown fields', () => {
  const mutations: ((value: AttachmentAttributes) => void)[] = [
    v => { v.mime = 'text/plain'; },
    v => { v.derivation!.version = 2 as 1; },
    v => { v.derivation!.steps = []; },
    v => { v.derivation!.steps[0].source.mime = 'image/svg+xml'; },
    v => { v.derivation!.steps[0].source.data = 'https://example.com/image'; },
    v => { v.derivation!.steps[0].source.filename = '../image.png'; },
    v => { v.derivation!.steps[0].edit.rotation = 45; },
    v => { v.derivation!.steps[0].edit.x = 3; },
    v => { v.derivation!.steps[0].sourceWidth = 8193; },
    v => { v.derivation!.steps[0].sourceHeight = NaN; },
    v => { v.derivation!.steps[0].edit.outputWidth = 8192; v.derivation!.steps[0].edit.outputHeight = 8192; },
    v => { v.derivation!.steps[0].outputSha256 = '0'.repeat(64); },
    v => { v.derivation!.steps[1].outputSha256 = '0'.repeat(64); },
    v => { v.derivation!.steps[1].sourceWidth = 4; },
    v => { (v.derivation!.steps[0] as any).attested = true; },
    v => { (v.derivation!.steps[0].source as any).derivation = {}; },
    v => { (v.derivation!.steps[0].edit as any).filter = 'remote'; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(second); mutate(value);
    assert.equal(isAttachmentAttributes(value), false, mutate.toString());
  }
});

test('image history verifies every embedded digest, without claiming edit replay', async () => {
  for (const which of ['current', 'original', 'intermediate']) {
    const value = structuredClone(second);
    const target = which === 'current' ? value : value.derivation!.steps[which === 'original' ? 0 : 1].source;
    target.data = Buffer.from('tampered bytes').toString('base64');
    assert.equal(isAttachmentAttributes(value), true, 'Structural validation does not certify file digests');
    await assert.rejects(verifiedAttachmentBytes(value), /digest mismatch/);
  }
  const unverifiedEdit = structuredClone(second);
  unverifiedEdit.derivation!.steps[0].edit.x = 0;
  assert.deepEqual(await verifiedAttachmentBytes(unverifiedEdit), attachmentBytes(second.data), 'Hash validation is not edit replay');
});

test('image history bounds retained source bytes and steps without dropping ancestors', () => {
  const identity = { x: 0, y: 0, width: 1, height: 1, outputWidth: 1, outputHeight: 1, rotation: 0 };
  let value = file('small');
  for (let index = 0; index < imageDerivationLimits.steps; index++) value = deriveImageAttachment(value, file(`image ${index}`), 1, 1, identity);
  assert.equal(value.derivation!.steps.length, 8);
  assert.equal(isAttachmentAttributes(value), true);
  assert.throws(() => deriveImageAttachment(value, file('next'), 1, 1, identity), /limited to 8/);
  const tooMany = structuredClone(value); tooMany.derivation!.steps.push(tooMany.derivation!.steps[0]);
  assert.equal(isAttachmentAttributes(tooMany), false);
  const boundary = deriveImageAttachment(file('a'.repeat(imageDerivationLimits.sourceBytes)), file('new'), 1, 1, identity);
  assert.equal(isAttachmentAttributes(boundary), true);
  assert.throws(() => deriveImageAttachment(boundary, file('next'), 1, 1, identity), /exceed 512 KiB/);
  const oversized = structuredClone(second);
  oversized.derivation!.steps[0].source = file('a'.repeat(imageDerivationLimits.sourceBytes));
  delete (oversized.derivation!.steps[0].source as any).caption;
  assert.equal(isAttachmentAttributes(oversized), false);
  assert.equal(second.derivation!.steps.length, 2);
});
