import assert from 'node:assert/strict';
import test from 'node:test';
import { admitAgents, admitMcpSettingsInput, chooseAgent, exchangeMcpSettings } from './mcp-settings-bridge.ts';

const agents = [{ id: 'fixture', name: 'Fixture', available: true }, { id: 'other', name: 'Other', available: false }];

test('admission keeps the Host command narrow', () => {
  assert.deepEqual(admitMcpSettingsInput({ method: 'settings.mcp.get', agent_id: '' }), { method: 'settings.mcp.get', agent_id: '' });
  assert.deepEqual(admitMcpSettingsInput({ method: 'settings.mcp.set', agent_id: 'fixture', revision: 2, servers: [] }), { method: 'settings.mcp.set', agent_id: 'fixture', revision: 2, servers: [] });
  for (const input of [
    null, { method: 'settings.mcp.get' }, { method: 'settings.mcp.get', agent_id: '', extra: true },
    { method: 'settings.mcp.set', agent_id: '', revision: 0, servers: [] },
    { method: 'settings.mcp.set', agent_id: 'fixture', revision: 1.5, servers: [] },
    { method: 'settings.mcp.set', agent_id: 'fixture', revision: 0, servers: [], env: {} },
    { method: 'settings.other', agent_id: 'fixture' },
  ]) assert.throws(() => admitMcpSettingsInput(input), /invalid/);
  assert.deepEqual(admitAgents([{ id: 'fixture', name: 'Fixture', available: 1 }, { id: '', name: 'x' }]), [{ id: 'fixture', name: 'Fixture', available: false }]);
  assert.equal(chooseAgent(agents, ''), 'fixture');
  assert.equal(chooseAgent(agents, 'missing'), 'missing');
});

test('an empty Agent list does not call the Host, and a reply stays correlated', async () => {
  const commands: { request_id?: string; agent_id?: string }[] = [];
  const listeners = new Set<(event: { kind: string; request_id: string | null; data?: unknown }) => void>();
  const host = (events: { kind: string; request_id: string | null; data?: unknown }[]) => ({
    sessionCommand: async (command: { request_id?: string; agent_id?: string }) => {
      commands.push(command);
      queueMicrotask(() => { for (const event of events) for (const listener of listeners) listener(event); });
    },
    onEvent: (listener: (event: { kind: string; request_id: string | null; data?: unknown }) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
  assert.deepEqual(await exchangeMcpSettings(host([]), { method: 'settings.mcp.get', agent_id: '' }, [], 'empty'), { agents: [], agent_id: '', revision: 0, servers: [], sessions: [] });
  assert.equal(commands.length, 0);
  listeners.clear();
  const view = await exchangeMcpSettings(host([{ kind: 'mcp_settings', request_id: 'one', data: { agent_id: 'fixture', revision: 3, servers: [{ name: 'docs' }], sessions: [] } }]), { method: 'settings.mcp.get', agent_id: '' }, agents, 'one');
  assert.equal(view.revision, 3);
  assert.equal(commands.at(-1)?.request_id, 'one');
  assert.equal(commands.at(-1)?.agent_id, 'fixture');
  listeners.clear();
  await assert.rejects(exchangeMcpSettings(host([{ kind: 'mcp_settings_error', request_id: 'two', data: { reason: 'conflict' } }]), { method: 'settings.mcp.get', agent_id: 'fixture' }, agents, 'two'), /conflict/);
  await assert.rejects(exchangeMcpSettings({ sessionCommand: async () => { throw new Error('closed'); }, onEvent: () => () => {} }, { method: 'settings.mcp.get', agent_id: 'fixture' }, agents, 'three'), /closed/);
});
