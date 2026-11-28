import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runProtocolSlice } from './session.mjs';

test('browser harness reads evidence, imports one PDF, and reconciles the same run', async () => {
  const origin = process.env.PROTOCOL_READY_ORIGIN;
  assert.ok(origin, 'PROTOCOL_READY_ORIGIN is required');
  const corpus = JSON.parse(readFileSync(new URL('../../protocol/fixtures/protocol-ready/corpus.json', import.meta.url), 'utf8'));
  const result = await runProtocolSlice({ origin, corpus });
  assert.equal(result.me.role, 'client');
  assert.equal(result.opened.digest, corpus.revision);
  assert.equal(result.opened.ownerHost, corpus.ownerHost);
  assert.equal(result.first.created, true);
  assert.equal(result.second.created, false);
  assert.equal(result.second.paperId, result.first.paperId);
  assert.notEqual(result.first.paperId, `paper-${result.digest.slice(0, 12)}`);
  assert.equal(result.imported.digest, result.digest);
  assert.equal(Buffer.from(result.reopened.body).toString(), corpus.pdf);
  assert.equal(result.observed.outcome, 'observed');
  assert.equal(result.observed.effect, 'none');
  assert.equal(result.observed.status, 'running');
  assert.equal(result.disconnected.outcome, 'transport_abort');
  assert.equal(result.disconnected.status, 'running');
  assert.equal(result.disconnected.effect, 'none');
  assert.equal(result.replay.outcome, 'duplicate');
  assert.equal(result.replay.effect, 'none');
});
