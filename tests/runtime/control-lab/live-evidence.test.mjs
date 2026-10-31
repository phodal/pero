import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fixtureExhaustionVerified, inspectSession } from './live-evidence.mjs';
const digest = `sha256:${'a'.repeat(64)}`, id = 'example';
function sample() {
  let seq = 0; const events = [];
  const add = (type, data) => events.push({ seq: ++seq, type, data });
  const call = (name, args, result) => {
    const callId = `call-${seq}`; add('tool/call', { name, arguments: args, callId });
    add('tool/result', { toolCallId: callId, content: [{ type: 'text', text: JSON.stringify(result) }] });
  };
  add('request/header', { tools: [{ name: 'skill' }, { name: 'mcp__pero-app-use__app_write' }, { name: 'chart' }] });
  call('skill', {}, [{ name: 'control-design', digest }]);
  call('skill', { name: 'control-design', digest }, { name: 'control-design', digest, content: 'guidance' });
  for (const action of ['read', 'baseline', 'search', 'lock', 'verify']) call('mcp__pero-app-use__app_write', { document: { action, experimentId: id } }, {});
  return events;
}
test('validates real skill results, target, actions and full advertised tools', () => {
  const evidence = inspectSession(sample(), 'control-design', digest, id);
  assert.deepEqual(evidence.tools, ['chart', 'mcp__pero-app-use__app_write', 'skill']);
  assert.ok(inspectSession(sample(), 'control-design', digest, id, ['read', 'baseline', 'lock', 'verify']));
  const missingBaseline = sample().filter(event => !(event.type === 'tool/call' && event.data.arguments?.document?.action === 'baseline'));
  assert.throws(() => inspectSession(missingBaseline, 'control-design', digest, id, ['read', 'baseline', 'lock', 'verify']), /No successful baseline/);
  const wrong = sample(); wrong.find(event => event.type === 'tool/call' && event.data.arguments?.document).data.arguments.document.experimentId = 'other';
  assert.throws(() => inspectSession(wrong, 'control-design', digest, id), /another experiment/);
  assert.throws(() => inspectSession(sample(), 'control-design', `sha256:${'b'.repeat(64)}`, id), /launch digest/);
  const exposed = sample(); exposed[0].data.tools.push({ name: 'edit_file' });
  assert.throws(() => inspectSession(exposed, 'control-design', digest, id), /disabled native/);
});
test('fixture exhaustion never converts an unrelated error into success', () => {
  const cleanup = { allExited: true };
  const evidence = { recordedHttpAttemptsTotal: 6, fixtureHttpRequests: 6, sessions: [{ validated: {}, budgetExhausted: true }] };
  assert.equal(fixtureExhaustionVerified(undefined, cleanup, evidence), true);
  assert.equal(fixtureExhaustionVerified('frozen policy changed', cleanup, evidence), false);
  assert.equal(fixtureExhaustionVerified(undefined, cleanup, { ...evidence, sessions: [{ validated: {}, budgetExhausted: false }] }), false);
  assert.equal(fixtureExhaustionVerified(undefined, { allExited: false }, evidence), false);
});
