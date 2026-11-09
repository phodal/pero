import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeCheckGeneration, readGeneratedChecks, generatedChecksSnapshot, hasAIApplication, recoveredAIWorkspace } from '../src/ai-generation.ts';

const target = { entryId: 'a'.repeat(32), revision: 2 };
const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'source' }, content: [{ type: 'text', text: 'Measured signal without units.' }] }] });
const frozen = freezeCheckGeneration('check-request', 'configured-host-agent', target, content, 'Review omissions');
const transcript = JSON.stringify({ checks: [{ text: 'Record the signal units.', severity: 'warning', blockIds: ['source'] }] });

test('generated checks pin real input IDs, retain review attribution and detect single application', async () => {
  assert.match(frozen.prompt, /untrusted data/); assert.match(frozen.prompt, /Do not edit files/);
  const generated = readGeneratedChecks(frozen, 'host-session', transcript);
  const snapshot = generatedChecksSnapshot(generated, { 'check-1': 'accepted' }, target, content, true, '2026-11-09T10:00:00Z');
  assert.equal(snapshot.checks[0].usefulness, 'useful'); assert.equal(snapshot.target.revision, 2); assert.equal(snapshot.sessionId, 'host-session');
  assert.match(snapshot.limits, /not executed checks/);
  const withReceipt = JSON.parse(content); withReceipt.content.push({ type: 'codeBlock', content: [{ type: 'text', text: JSON.stringify(snapshot) }] });
  assert.equal(hasAIApplication(JSON.stringify(withReceipt), frozen.requestId, 'host-session'), true);
  assert.equal(hasAIApplication(content, frozen.requestId, 'host-session'), false);
  const workspace = { version: 3, record: { frozen, sessionId: 'host-session', transcript, status: 'completed', decisions: { 'check-1': 'rejected' }, application: 'reviewing' } };
  assert.deepEqual(await recoveredAIWorkspace(workspace), workspace);
});

test('check parser rejects invented source identities and unsupported conclusions; empty output is not a pass', () => {
  for (const value of [
    { checks: [{ text: 'A check', blockIds: ['invented'], severity: 'warning' }] },
    { checks: [{ text: 'A check', blockIds: ['source', 'source'], severity: 'note' }] },
    { checks: [{ text: 'A check', blockIds: [], severity: 'PASS' }] },
    { checks: [{ text: ' ', blockIds: [], severity: 'note' }] },
    { checks: [], verified: true },
  ]) assert.throws(() => readGeneratedChecks(frozen, 'session', JSON.stringify(value)));
  assert.deepEqual(readGeneratedChecks(frozen, 'session', '{"checks":[]}').checks, []);
});

test('review cannot attach stale generation or pretend useful feedback verifies science', () => {
  const generated = readGeneratedChecks(frozen, 'session', transcript);
  for (const [currentTarget, draft] of [[{ ...target, revision: 3 }, content], [target, content + ' '], [{ ...target, entryId: 'b'.repeat(32) }, content]] as const)
    assert.throws(() => generatedChecksSnapshot(generated, {}, currentTarget, draft, true, '2026-11-09T10:00:00Z'), /changed/);
  assert.throws(() => generatedChecksSnapshot(generated, {}, target, content, false, '2026-11-09T10:00:00Z'), /Acknowledge/);
  assert.throws(() => generatedChecksSnapshot(generated, { invented: 'accepted' }, target, content, true, '2026-11-09T10:00:00Z'), /Invalid check/);
});
