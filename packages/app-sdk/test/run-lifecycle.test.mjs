import assert from 'node:assert/strict';
import test from 'node:test';
import { observeRun } from '../src/run-lifecycle.mjs';

const binding = { kind: 'control_plane_run', ownerHost: 'host-a', project: 'lab', id: 'run-1' };
const snapshot = { status: 'running', outcome: 'observed', effect: 'none', cursor: 3, events: [1, 2, 3], continuation: 'not_applicable', ownerHost: 'host-a', bindingId: 'run-1' };

test('two clients see one run and a closed client does not cancel it', async () => {
  let calls = 0;
  const transport = { observe: async () => { calls += 1; return snapshot; } };
  const desktop = await observeRun(transport, { binding, request: { operation: 'status', requestId: 'a', inputHash: 'h' } });
  const other = await observeRun(transport, { binding, request: { operation: 'lookup', requestId: 'b', inputHash: 'h' } });
  assert.equal(desktop.status, other.status);
  assert.equal(desktop.effect, 'none');
  const closed = await observeRun({ observe: async () => { throw new Error('socket closed'); } }, {
    binding, knownStatus: 'running', request: { operation: 'cancel', requestId: 'c', inputHash: 'h', consumerClosed: true },
  });
  assert.equal(closed.outcome, 'transport_abort');
  assert.equal(closed.effect, 'none');
  assert.equal(closed.status, 'running');
  await assert.rejects(observeRun(transport, { binding, fallbackHost: 'host-b', request: { operation: 'start', requestId: 'd', inputHash: 'h' } }), error => error.code === 'spoofed');
  await assert.rejects(observeRun({ observe: async () => ({ ...snapshot, ownerHost: 'host-b' }) }, { binding, request: { operation: 'status', requestId: 'e', inputHash: 'h' } }), error => error.code === 'stale_binding');
  const acp = await observeRun({ observe: async () => ({ ...snapshot, continuation: 'unsupported' }) }, {
    binding: { ...binding, kind: 'acp_session' }, request: { operation: 'status', requestId: 'f', inputHash: 'h' },
  });
  assert.equal(acp.continuation, 'unsupported');
  assert.equal(calls, 2);
});
