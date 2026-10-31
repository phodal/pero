import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import type { ContextReference } from '../../../protocol/generated/host';
import { ControlLabGoals } from './control-lab-goal.ts';
import { DesktopAppUse } from './app-use-mcp.ts';

const id = 'a'.repeat(32), hash = 'b'.repeat(64);
const scope = { app: 'control-lab', panel: 'main' };
const ref = (experimentId = id, specHash = hash): ContextReference => ({
  id: 'app-object-example', kind: 'app_object', label: 'Control Lab', source: 'pero-app://control-lab/',
  content: { type: 'text', text: JSON.stringify({ schema: 'pero.app-object.v1', scope, objectId: 'control-lab', state: { experimentId, specHash } }) },
});

test('goal binds one submitted frozen reference to one session and fails closed on replay or tampering', () => {
  const goals = new ControlLabGoals();
  assert.throws(() => goals.require('one', id), /Approve/);
  goals.approve(scope, 'one', [ref()]);
  assert.throws(() => goals.require('one', id), /Approve/);
  goals.accept('other', [ref()]);
  assert.throws(() => goals.require('other', id), /Approve/);
  goals.accept('one', [ref(id, 'c'.repeat(64))]);
  assert.throws(() => goals.require('one', id), /Approve/);
  goals.accept('one', [ref()]); // replay without a fresh approval
  assert.throws(() => goals.require('one', id), /Approve/);
  goals.approve(scope, 'one', [ref()]);
  goals.accept('one', [ref()]);
  assert.deepEqual(goals.require('one', id), { experimentId: id, specHash: hash, maxExperiments: 1 });
  assert.throws(() => goals.require('one', 'c'.repeat(32)), /Approve/);
  assert.throws(() => goals.approve(scope, 'one', [ref('c'.repeat(32))]), /new conversation/);
  goals.revoke('one');
  assert.throws(() => goals.approve(scope, 'one', [ref('c'.repeat(32))]), /new conversation/);
  goals.approve(scope, 'one', [ref()]);
  goals.accept('one', [ref()]);
  assert.equal(goals.require('one', id).specHash, hash);
  goals.forget('one');
  assert.throws(() => goals.require('one', id), /Approve/);
  goals.blockRestored('one');
  assert.throws(() => goals.approve(scope, 'one', [ref()]), /new conversation/);
  assert.throws(() => goals.approve(scope, 'one', [ref('c'.repeat(32))]), /new conversation/);
});

test('MCP requires the bound target and rejects generic Control Lab UI tasks in ordinary sessions', async () => {
  let selected = 'one';
  const surface = { ...scope, surfaceId: 'control-lab:main', instance: 'instance', visible: true,
    active: true, operable: true, rect: { x: 0, y: 0, width: 1, height: 1 } };
  const window = { webContents: { mainFrame: { frames: [] }, executeJavaScript: (expression: string) =>
    runInNewContext(expression, { window: {
      peroDiagnostics: { snapshot: () => JSON.stringify({ chats: [{ id: selected }], activeChat: 0 }) },
      peroAppUse: () => ({ ok: true, value: { surfaces: [surface] } }),
    } }) } };
  const applied: unknown[] = [];
  const definition = { app: 'control-lab', panel: 'main', version: '1', name: 'experiment-step',
    description: '', path: '/api/agent-step', schema: { type: 'object', required: ['action', 'experimentId'],
      properties: { action: { type: 'string' }, experimentId: { type: 'string' } }, additionalProperties: false } };
  const proposal = { ...definition, name: 'propose-candidate' };
  const desktop = new DesktopAppUse(() => window as never, () => {}, tmpdir(), {
    describe: async () => [definition, proposal], apply: async (_write, _signal, goal) => { applied.push(goal); return {}; },
  }, { stop: async () => {}, forget: async () => {} } as never);
  const env = await desktop.start();
  const call = async (name: string, args: object) => {
    const response = await fetch(env.PERO_APP_USE_URL, { method: 'POST', headers: {
      Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': selected,
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return (await response.json()).result;
  };
  desktop.accept({ kind: 'session_created', thread_id: selected });
  desktop.accept({ kind: 'turn_started', thread_id: selected });
  const write = (experimentId: string, tool = 'experiment-step') => call('app_write', { app: 'control-lab', tool, document: { action: 'read', experimentId } });
  try {
    assert.equal((await write(id)).isError, true);
    assert.equal((await call('app_use', { action: 'start', surfaceId: surface.surfaceId, actions: ['dom.click'] })).isError, true);
    assert.equal((await call('app_use', { action: 'runPlan', taskId: 'nonexistent', steps: [{ id: 'x', request: { action: 'act' } }] })).isError, true);
    // A queued approval emitted during an earlier live turn must not grant that turn authority.
    desktop.goals.approve(scope, selected, [ref()]);
    desktop.accept({ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } });
    assert.equal((await write(id)).isError, true);
    desktop.accept({ kind: 'turn_finished', thread_id: selected });
    desktop.goals.approve(scope, selected, [ref()]);
    desktop.accept({ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } });
    desktop.accept({ kind: 'turn_started', thread_id: selected });
    assert.equal((await write('c'.repeat(32))).isError, true);
    assert.equal((await write('c'.repeat(32), 'propose-candidate')).isError, true);
    assert.equal((await write(id)).isError, false);
    assert.deepEqual(applied, [{ experimentId: id, specHash: hash, maxExperiments: 1 }]);
    desktop.command({ action: 'cancel', thread_id: selected });
    desktop.accept({ kind: 'turn_started', thread_id: selected });
    assert.equal((await write(id)).isError, true);
    assert.equal((await call('computer_use', { operation: 'status' })).isError, true);
    assert.throws(() => desktop.goals.approve(scope, selected, [ref('c'.repeat(32))]), /new conversation/);
    selected = 'scoped';
    desktop.accept({ kind: 'session_created', thread_id: selected, data: { scope } });
    // Two prompts enqueued before the first turn starts cannot authorize the first turn with the second prompt's reference.
    desktop.accept({ kind: 'user_message', thread_id: selected, data: { contexts: [] } });
    desktop.goals.approve(scope, selected, [ref()]);
    desktop.accept({ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } });
    desktop.accept({ kind: 'turn_started', thread_id: selected });
    assert.equal((await call('computer_use', { operation: 'status' })).isError, true);
    desktop.accept({ kind: 'replay', data: { events: [{ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } }] } });
    assert.equal((await write(id)).isError, true);
    selected = 'restored';
    desktop.accept({ kind: 'replay', data: { events: [
      { kind: 'session_created', thread_id: selected, data: { scope } },
      { kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } },
    ], active: [] } });
    assert.throws(() => desktop.goals.approve(scope, selected, [ref()]), /new conversation/);
    assert.throws(() => desktop.goals.approve(scope, selected, [ref('c'.repeat(32))]), /new conversation/);
    selected = 'active-restored';
    desktop.accept({ kind: 'session_created', thread_id: selected, data: { scope } });
    desktop.goals.approve(scope, selected, [ref()]);
    desktop.accept({ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } });
    desktop.accept({ kind: 'turn_started', thread_id: selected });
    desktop.reset();
    desktop.accept({ kind: 'replay', data: { events: [
      { kind: 'session_created', thread_id: selected, data: { scope } },
      { kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } },
      { kind: 'turn_started', thread_id: selected },
    ], active: [selected] } });
    assert.throws(() => desktop.goals.approve(scope, selected, [ref()]), /new conversation/);
    assert.throws(() => desktop.goals.approve(scope, selected, [ref('c'.repeat(32))]), /new conversation/);
    assert.equal((await write(id)).isError, true);
    selected = 'truncated';
    desktop.accept({ kind: 'replay', data: { events: [{ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } }], active: [] } });
    assert.throws(() => desktop.goals.approve(scope, selected, [ref()]), /new conversation/);
    selected = 'reused-before-replay';
    desktop.accept({ kind: 'session_created', thread_id: selected, data: { scope } });
    desktop.goals.approve(scope, selected, [ref()]);
    desktop.accept({ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } });
    desktop.accept({ kind: 'turn_started', thread_id: selected });
    desktop.accept({ kind: 'replay', data: { events: [{ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } }], active: [selected] } });
    assert.equal((await write(id)).isError, true);
    assert.throws(() => desktop.goals.approve(scope, selected, [ref()]), /new conversation/);
    for (const kind of ['session_error', 'session_auth_required', 'session_auth_error', 'command_rejected']) {
      selected = `reject-${kind}`;
      desktop.accept({ kind: 'session_created', thread_id: selected, data: { scope } });
      desktop.goals.approve(scope, selected, [ref()]);
      desktop.accept({ kind: 'user_message', thread_id: selected, data: { contexts: [ref()] } });
      desktop.accept({ kind, thread_id: selected });
      desktop.accept({ kind: 'turn_started', thread_id: selected });
      assert.equal((await write(id)).isError, true, kind);
      assert.throws(() => desktop.goals.approve(scope, selected, [ref('c'.repeat(32))]), /new conversation/);
    }
  } finally { await desktop.close(); }
});

test('computer dispatch rechecks research scope after the asynchronous session wait', async () => {
  let release!: () => void, started!: () => void, calls = 0;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const window = { webContents: { mainFrame: { frames: [] }, executeJavaScript: async (expression: string) => {
    started(); await delayed;
    return runInNewContext(expression, { window: { peroDiagnostics: { snapshot: () => JSON.stringify({ chats: [{ id: 'thread' }], activeChat: 0 }) } } });
  } } };
  const desktop = new DesktopAppUse(() => window as never, () => {}, tmpdir(), undefined,
    { stop: async () => {}, call: async () => { calls++; return {}; } } as never);
  const env = await desktop.start();
  try {
    const result = fetch(env.PERO_APP_USE_URL, { method: 'POST', headers: {
      Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': 'thread',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'computer_use', arguments: {} } }) }).then(response => response.json());
    await waiting;
    desktop.accept({ kind: 'session_created', thread_id: 'thread', data: { scope } });
    desktop.accept({ kind: 'turn_started', thread_id: 'thread' });
    release();
    const reply = await result;
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /APP_GOAL_DENIED/);
    assert.equal(calls, 0);
  } finally { release(); await desktop.close(); }
});

test('replay revokes a running goal call and makes the conversation ineligible', async () => {
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const window = { webContents: { mainFrame: { frames: [] }, executeJavaScript: (expression: string) =>
    runInNewContext(expression, { window: { peroDiagnostics: { snapshot: () => JSON.stringify({ chats: [{ id: 'thread' }], activeChat: 0 }) } } }) } };
  const definition = { app: 'control-lab', panel: 'main', version: '1', name: 'experiment-step', description: '', path: '/api/agent-step',
    schema: { type: 'object', required: ['action', 'experimentId'], properties: { action: { type: 'string' }, experimentId: { type: 'string' } }, additionalProperties: false } };
  const desktop = new DesktopAppUse(() => window as never, () => {}, tmpdir(), { describe: async () => [definition],
    apply: async (_write, signal) => new Promise((_resolve, reject) => {
      started(); signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
    }) });
  const env = await desktop.start();
  try {
    desktop.accept({ kind: 'session_created', thread_id: 'thread', data: { scope } });
    desktop.goals.approve(scope, 'thread', [ref()]);
    desktop.accept({ kind: 'user_message', thread_id: 'thread', data: { contexts: [ref()] } });
    desktop.accept({ kind: 'turn_started', thread_id: 'thread' });
    const result = fetch(env.PERO_APP_USE_URL, { method: 'POST', headers: {
      Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': 'thread',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'app_write', arguments: {
      app: 'control-lab', tool: 'experiment-step', document: { action: 'read', experimentId: id },
    } } }) }).then(response => response.json());
    await entered;
    desktop.accept({ kind: 'replay', data: { events: [{ kind: 'session_created', thread_id: 'thread', data: { scope } }], active: ['thread'] } });
    assert.equal((await result).result.isError, true);
    assert.throws(() => desktop.goals.approve(scope, 'thread', [ref()]), /new conversation/);
  } finally { await desktop.close(); }
});
