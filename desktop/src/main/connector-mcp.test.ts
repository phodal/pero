import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HostConnectors } from '../../../packages/connectors/src/host.mjs';
import { ConnectorMcp } from '../../../packages/connectors/src/mcp.ts';

test('MCP admits only registered Host conversations and their own derived token; deletion revokes it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pero-connector-mcp-'));
  const owner = new HostConnectors({ root, executable: resolve('target/debug/pero-connector-worker'),
    store: { read: async () => null, write: async () => {}, remove: async () => {} }, authorize: async () => {}, openURL: async () => {} });
  const bridge = new ConnectorMcp(owner);
  const client = new Client({ name: 'connector-test', version: '1' });
  t.after(async () => { await client.close(); await bridge.close(); await rm(root, { recursive: true, force: true }); });
  await owner.start();
  const env = await bridge.start(), thread = 'host-conversation';
  const token = createHmac('sha256', env.PERO_CONNECTORS_TOKEN).update(thread).digest('hex');
  const post = (authorization: string, current = thread) => fetch(env.PERO_CONNECTORS_URL, { method: 'POST', headers: {
    authorization: 'Bearer ' + authorization, 'x-pero-thread': current, 'content-type': 'application/json',
  }, body: '{}' });
  assert.equal((await post(token)).status, 403);
  bridge.accept({ kind: 'session_created', thread_id: thread });
  assert.equal((await post(env.PERO_CONNECTORS_TOKEN)).status, 403);
  assert.equal((await post(token, 'another-conversation')).status, 403);
  await client.connect(new StreamableHTTPClientTransport(new URL(env.PERO_CONNECTORS_URL), { requestInit: { headers: { authorization: 'Bearer ' + token, 'x-pero-thread': thread } } }));
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['connectors_list', 'connectors_call']);
  const result = await client.callTool({ name: 'connectors_call', arguments: { connectorId: 'point.table', name: 'table_summary', arguments: { values: [2, 4] } } });
  assert.equal(JSON.parse((result.content as { text: string }[])[0].text).sum, 6);
  const denied = await client.callTool({ name: 'connectors_call', arguments: { connectorId: 'point.table', name: 'secret.set', arguments: {} } });
  assert.equal(denied.isError, true);
  bridge.accept({ kind: 'session_deleted', thread_id: thread });
  assert.equal((await post(token)).status, 403);
});
