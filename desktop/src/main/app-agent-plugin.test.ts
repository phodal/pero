import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppAgentPluginBinding } from './app-agent-plugin.ts';
import { DesktopAppUse } from './app-use-mcp.ts';
import type { AppWriteDefinition } from './app-write.ts';

const revision = 'a'.repeat(64);
const route = { name: 'save', description: 'Save a result', path: '/api/save', schema: {
  type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false,
} };
const snapshot = { app: 'demo', revision, instructions: 'Use the declared result tool.', tools: [route], maxCalls: 2 };
const scope = { app: 'demo', panel: 'secondary' };
const definition: AppWriteDefinition = { app: 'demo', panel: 'main', version: '1', revision, ...route };

test('App plugin binding selects frozen routes and bounds calls within one mount', () => {
  const binding = AppAgentPluginBinding.bind(snapshot, scope);
  const other = { ...definition, name: 'other' };
  assert.deepEqual(binding.definitions([other, definition]), [definition]);
  for (const current of [[], [{ ...definition, revision: 'b'.repeat(64) }],
    [{ ...definition, schema: { type: 'string' } }], [{ ...definition, app: 'foreign' }]]) {
    assert.throws(() => binding.definitions(current), /changed or is disabled/);
  }
  assert.throws(() => AppAgentPluginBinding.bind(snapshot, { ...scope, app: 'foreign' }), /conversation scope/);
  assert.throws(() => binding.consume(other, [definition, other]), /did not declare/);
  const next = binding.consume(definition, [definition]);
  const exhausted = next.consume(definition, [definition]);
  assert.equal(binding.calls, 0);
  assert.deepEqual(exhausted.definitions([definition]), []);
  assert.throws(() => exhausted.consume(definition, [definition]), /call limit/);
});

test('shared MCP narrows App plugin calls, preserves ordinary tools and revokes stale mounts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-app-plugin-'));
  let definitions = [definition, { ...definition, name: 'other' }, { ...definition, app: 'foreign' }];
  const applied: string[] = [];
  const desktop = new DesktopAppUse({
    selectedThread: async () => 'ordinary',
    page: async () => { throw new Error('Plugin writes must not use a panel'); },
    capture: async () => { throw new Error('Plugin writes must not capture'); },
    presence: () => {},
  }, () => {}, root, {
    describe: async () => definitions,
    apply: async write => { applied.push(write.definition.name); return write.document; },
  });
  const env = await desktop.start();
  const request = async (thread: string, method: string, params?: object) => {
    const response = await fetch(env.PERO_APP_USE_URL, { method: 'POST', headers: {
      Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': thread,
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return (await response.json()).result;
  };
  const call = (thread: string, name: string, args: object) => request(thread, 'tools/call', { name, arguments: args });
  const write = (thread: string) => call(thread, 'app_write', { app: 'demo', tool: 'save', document: { value: 1 } });
  const mount = (thread: string, maxCalls = 2) => {
    desktop.accept({ kind: 'session_created', thread_id: thread, data: {
      scope, appBinding: { app: 'demo' }, appPlugin: { ...snapshot, maxCalls },
    } });
    desktop.accept({ kind: 'turn_started', thread_id: thread });
  };
  const tools = async (thread: string) => (await request(thread, 'tools/list')).tools
    .filter((tool: { name: string }) => tool.name.startsWith('app__')).map((tool: { name: string }) => tool.name);
  try {
    mount('plugin');
    desktop.accept({ kind: 'session_created', thread_id: 'ordinary' });
    desktop.accept({ kind: 'turn_started', thread_id: 'ordinary' });
    assert.deepEqual(await tools('plugin'), ['app__demo__save']);
    assert.equal((await tools('ordinary')).length, 3);
    const described = await call('plugin', 'app_describe', {});
    assert.deepEqual(JSON.parse(described.content[0].text).apps.map((tool: { tool: string }) => tool.tool), ['save']);
    assert.equal((await call('plugin', 'app__demo__other', { value: 1 })).isError, true);
    assert.equal((await call('plugin', 'app_write', { app: 'foreign', tool: 'save', document: { value: 1 } })).isError, true);
    assert.equal((await write('plugin')).isError, false);
    desktop.command({ action: 'cancel', thread_id: 'plugin' });
    desktop.accept({ kind: 'turn_started', thread_id: 'plugin' });
    assert.equal((await call('plugin', 'app__demo__save', { value: 2 })).isError, false);
    assert.deepEqual(await tools('plugin'), []);
    assert.equal((await write('plugin')).isError, true);
    assert.equal((await call('plugin', 'app__demo__save', { value: 3 })).isError, true);
    assert.equal(applied.length, 2);

    mount('independent', 1);
    const concurrent = await Promise.all([write('independent'), write('independent')]);
    assert.equal(concurrent.filter(value => !value.isError).length, 1);
    assert.equal(applied.length, 3);

    for (const kind of ['session_error', 'session_closed', 'session_deleted', 'disconnected']) {
      mount(kind);
      desktop.accept({ kind, thread_id: kind });
      assert.deepEqual(await tools(kind), [], kind);
      assert.equal((await write(kind)).isError, true, kind);
    }
    for (const action of ['close', 'delete']) {
      mount(action);
      desktop.command({ action, thread_id: action });
      assert.deepEqual(await tools(action), []);
      assert.equal((await write(action)).isError, true);
    }
    desktop.accept({ kind: 'replay', data: { active: ['restored'], events: [
      { kind: 'session_created', thread_id: 'restored', data: { scope, appPlugin: snapshot, appBinding: { app: 'demo' } } },
      { kind: 'turn_started', thread_id: 'restored' },
    ] } });
    assert.deepEqual(await tools('restored'), []);
    assert.equal((await write('restored')).isError, true);
    mount('restored');
    assert.equal((await write('restored')).isError, false);
    mount('stale');
    definitions = definitions.map(value => ({ ...value, revision: 'b'.repeat(64) }));
    assert.equal((await request('stale', 'tools/list')).isError, true);
    assert.equal((await write('stale')).isError, true);
    definitions = [];
    assert.equal((await write('stale')).isError, true);
    assert.equal(applied.length, 4);
  } finally {
    await desktop.close();
    await rm(root, { recursive: true, force: true });
  }
});
