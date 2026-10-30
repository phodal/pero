import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// This deterministic fixture consumes the complete observation for its existing
// assertions and normalized transcript. Production result budgets stay intact.
export async function appUseContent(text, rpc, signal) {
  const value = JSON.parse(text);
  if (value.type !== 'content_reference') return value;
  const { artifact, read } = value;
  assert.match(artifact?.id ?? '', /^[a-f0-9]{64}$/);
  assert.equal(artifact.sha256, artifact.id);
  assert.equal(artifact.mediaType, 'application/json');
  assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 128 * 1024);
  assert.equal(read?.tool, 'content_read');
  assert.deepEqual(read.arguments, { id: artifact.id, startByte: 0, maxBytes: 16384 });
  let request = read.arguments, offset = 0;
  const chunks = [];
  for (let count = 0; count < 8; count++) {
    const result = await rpc('tools/call', { name: 'content_read', arguments: request }, signal);
    assert.equal(result.isError, false);
    assert.ok(Array.isArray(result.content) && result.content.length === 1 && result.content[0].type === 'text');
    const envelope = /^Content ([a-f0-9]{64}), bytes (\d+)\.\.(\d+) of (\d+)\.\n([\s\S]*)\n(End of selection\.|Next read: (.*))$/.exec(result.content[0].text);
    assert.ok(envelope, 'content_read must return the advertised complete envelope');
    const [, id, startText, endText, totalText, chunk, ending, continuation] = envelope;
    const start = Number(startText), end = Number(endText);
    assert.equal(id, artifact.id);
    assert.equal(Number(totalText), artifact.bytes);
    assert.equal(start, offset);
    assert.ok(end > start && end <= artifact.bytes && end - start <= 16384);
    assert.equal(Buffer.byteLength(chunk), end - start);
    chunks.push(Buffer.from(chunk));
    offset = end;
    if (ending === 'End of selection.') {
      assert.equal(offset, artifact.bytes, 'content_read ended before the entire fixture observation');
      const complete = Buffer.concat(chunks);
      assert.equal(createHash('sha256').update(complete).digest('hex'), artifact.sha256);
      return JSON.parse(complete.toString('utf8'));
    }
    assert.ok(offset < artifact.bytes);
    request = JSON.parse(continuation);
    assert.deepEqual(request, { id: artifact.id, startByte: offset, endByte: artifact.bytes, maxBytes: 16384 });
  }
  assert.fail('fixture content_read exceeded its bounded continuation count');
}
