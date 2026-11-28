import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  capabilityOutcome,
  createCapabilityClient,
  createCapabilitySnapshot,
  createCorrelation,
  createFrameTransport,
  createLocalCapabilityTransport,
  renderAgentStatus,
} from '../src/capability-client.mjs';

const run = {
  id: 'app:paper-agent:0123456789abcdef0123456789abcdef',
  sessionId: 'app:paper-agent:0123456789abcdef0123456789abcdef',
  scope: { workspaceId: 'ws_0123456789abcdef0123456789abcdef' },
  status: 'running',
  attempt: 1,
  requestId: 'request-1',
  updatedAt: '2026-11-28T00:00:00Z',
};
const input = { scope: run.scope, runId: run.id };

function snapshot(overrides = {}) {
  return createCapabilitySnapshot({
    providerGeneration: 'gen-1',
    operations: { 'agent/status': { version: 1 }, 'research-assets/queries': { version: 1 } },
    ...overrides,
  });
}

test('legacy call and the typed client perform the same agent status read', async () => {
  const seen = [];
  const hostCall = async (capability, operation, body) => {
    seen.push([capability, operation, body]);
    return run;
  };
  const legacy = await hostCall('agent', 'status', input);
  const client = createCapabilityClient({
    snapshot: snapshot(),
    transport: { call: (capability, operation, body) => hostCall(capability, operation, body) },
  });
  const typed = await client.call('agent', 'status', input);
  assert.deepEqual(typed, legacy);
  assert.deepEqual(seen, [['agent', 'status', input], ['agent', 'status', input]]);
  assert.equal(renderAgentStatus(typed), `running ${run.id}`);
});

test('hints reject before the transport is called', async () => {
  const cases = [
    [snapshot({ operations: {} }), 'unsupported'],
    [snapshot({ protocolVersion: 2 }), 'incompatible'],
    [snapshot({ availability: 'unavailable' }), 'offline'],
    [snapshot({ authorization: 'denied' }), 'denied'],
    [snapshot({ authorization: 'consent' }), 'requires-consent'],
  ];
  for (const [item, code] of cases) {
    const calls = [];
    const client = createCapabilityClient({
      snapshot: item,
      transport: { call: () => { calls.push('called'); } },
    });
    await assert.rejects(client.call('agent', 'status', input), error => error.code === code);
    assert.deepEqual(calls, [], code);
    assert.equal(capabilityOutcome(item, 'agent', 'status'), code);
  }
});

test('rebind, revocation, disposal and one subscription', async () => {
  let release;
  const transport = { call: () => new Promise(resolve => { release = resolve; }) };
  const client = createCapabilityClient({ snapshot: snapshot(), transport });
  const events = [];
  const listener = event => events.push(event.type);
  const stop = client.subscribe(listener);
  assert.throws(() => client.subscribe(listener), error => error.code === 'duplicate-subscription');
  const handle = client.handle();
  const pending = client.call('agent', 'status', input);
  client.rebind(snapshot({ providerGeneration: 'gen-2' }));
  await assert.rejects(pending, error => error.code === 'revoked');
  release(run);
  assert.throws(() => handle.call('agent', 'status', input), error => error.code === 'revoked');
  const next = client.call('agent', 'status', input);
  release(run);
  assert.equal((await next).status, 'running');
  stop();
  client.rebind(snapshot({ providerGeneration: 'gen-3' }));
  assert.deepEqual(events, ['rebind']);
  client.dispose();
  await assert.rejects(client.call('agent', 'status', input), error => error.code === 'disposed');
});

test('correlation accepts one reply and ignores late, duplicate and malformed messages', async () => {
  const box = createCorrelation();
  let sent = 0;
  const first = box.request('1', () => { sent += 1; });
  assert.equal(box.receive({ id: '1', ok: true, value: run }), 'accepted');
  assert.deepEqual(await first, run);
  assert.equal(box.receive({ id: '1', ok: true, value: run }), 'late');
  assert.equal(box.receive({ id: 'missing' }), 'late');
  const second = box.request('2', () => { sent += 1; });
  assert.equal(box.receive({ id: '2', ok: false }), 'accepted');
  await assert.rejects(second, error => error.code === 'failed');
  const third = box.request('3', () => { sent += 1; });
  assert.equal(box.receive({ id: '3', value: run }), 'accepted');
  await assert.rejects(third, error => error.code === 'malformed');
  let rejected;
  const fourth = box.request('4', () => {}).catch(error => { rejected = error; });
  box.dispose();
  await fourth;
  assert.equal(rejected.code, 'disposed');
  assert.equal(box.pending(), 0);
  assert.equal(sent, 3);
  box.request('5', () => {});
  assert.throws(() => box.request('5', () => {}), error => error.code === 'duplicate');
});

test('a failed call is not repeated against another operation', async () => {
  const seen = [];
  const client = createCapabilityClient({
    snapshot: snapshot(),
    transport: { call: (capability, operation) => { seen.push([capability, operation]); throw Object.assign(new Error('down'), { code: 'transport' }); } },
  });
  await assert.rejects(client.call('agent', 'status', input), error => error.code === 'transport');
  assert.deepEqual(seen, [['agent', 'status']]);
  assert.deepEqual(client.observedCalls(), [{ capability: 'agent', operation: 'status', correlationId: 'gen-1:1' }]);
});

test('the browser fixture uses an injected transport and does not import Electron', async () => {
  const source = readFileSync(new URL('../src/capability-client.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('electron'), false);
  const fetches = [];
  const transport = createLocalCapabilityTransport(async (url, init) => {
    fetches.push([url, JSON.parse(init.body)]);
    return { ok: true, json: async () => run };
  });
  const client = createCapabilityClient({ snapshot: snapshot(), transport });
  assert.equal(renderAgentStatus(await client.call('agent', 'status', input)), `running ${run.id}`);
  assert.equal(fetches[0][0], '/host/capability');
  assert.deepEqual(fetches[0][1], { capability: 'agent', operation: 'status', input });
  const posted = [];
  const frame = createFrameTransport({
    targetOrigin: 'pero-app://paper-agent',
    postMessage: (message, origin) => posted.push([message, origin]),
  });
  const pending = frame.call('research-assets', 'queries', { queryId: 'a'.repeat(64) }, { correlationId: 'q1' });
  assert.equal(posted.length, 1);
  assert.equal(posted[0][1], 'pero-app://paper-agent');
  frame.correlation.receive({ id: 'q1', ok: true, value: { acceptance: 'needs_review' } });
  assert.deepEqual(await pending, { acceptance: 'needs_review' });
  assert.throws(() => createFrameTransport({ targetOrigin: '*', postMessage() {} }), TypeError);
});
