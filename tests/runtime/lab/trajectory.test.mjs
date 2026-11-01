import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyTrajectory } from './trajectory.mjs';

test('model proposals match export and consume feedback before revision', () => {
  const trials = [{ id: 'a', protocol: { steps: [1] } }, { id: 'b', protocol: { steps: [2] } }];
  const call = (seq, action, fields) => ({ seq, type: 'tool/call', data: { callId: String(seq), name: 'mcp__pero-app-use__app__lab__experiment-step', arguments: { action, ...fields } } });
  const result = (seq, id) => ({ seq, type: 'tool/result', data: { toolCallId: String(id), isError: false } });
  const events = [call(1, 'propose', { protocol: trials[0].protocol }), result(2, 1),
    call(3, 'evaluate', { trialId: 'a' }), result(4, 3),
    call(5, 'propose', { parentTrialId: 'a', protocol: trials[1].protocol }), result(6, 5)];
  assert.equal(verifyTrajectory(events, trials).feedbackBeforeRevision, true);
  const changed = structuredClone(events); changed[4].data.arguments.protocol.steps = [9];
  assert.throws(() => verifyTrajectory(changed, trials));
  assert.throws(() => verifyTrajectory(events.filter(e => e.seq !== 4), trials));
  const tooLate = structuredClone(events); tooLate[3].seq = 7;
  assert.throws(() => verifyTrajectory(tooLate, trials));
});
