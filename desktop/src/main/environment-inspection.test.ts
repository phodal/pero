import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentInspectionInput } from './environment-inspection.ts';

test('environment transport only forwards the target, never a caller or executable', () => {
  assert.deepEqual(environmentInspectionInput({ target: 'paper-agent.pcgym' }), { target: 'paper-agent.pcgym' });
  for (const input of [null, [], 'paper-agent.pcgym', {}, { target: 1 },
    { target: 'paper-agent.pcgym', name: 'environments' },
    { target: 'paper-agent.pcgym', executable: '/tmp/python' },
    { target: 'x'.repeat(129) }, { target: 'paper-agent.pcgym', operation: 'prepare' }]) {
    assert.throws(() => environmentInspectionInput(input));
  }
});
