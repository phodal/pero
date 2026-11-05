import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ConnectorMcp } from '../src/mcp.ts';

test('Connector MCP distinguishes unsupported methods from denied conversations', async t => {
  const endpoint = new ConnectorMcp({ tools: async () => [], forget: async () => {}, close: async () => {} });
  const environment = await endpoint.start();
  t.after(() => endpoint.close());
  const thread = 'conversation';
  endpoint.accept({ kind: 'session_created', thread_id: thread });
  const headers = {
    Authorization: 'Bearer ' + createHmac('sha256', environment.PERO_CONNECTORS_TOKEN).update(thread).digest('hex'),
    'X-Pero-Thread': thread,
  };
  for (const [method, overrides, status] of [
    ['GET', {}, 405], ['DELETE', {}, 405], ['OPTIONS', {}, 405],
    ['GET', { Authorization: 'Bearer invalid' }, 403],
    ['GET', { 'X-Pero-Thread': 'unknown' }, 403],
    ['GET', { Origin: 'https://untrusted.example' }, 403],
  ]) {
    const response = await fetch(environment.PERO_CONNECTORS_URL, { method, headers: { ...headers, ...overrides } });
    assert.equal(response.status, status, `${method} ${JSON.stringify(overrides)}`);
    if (status === 405) assert.equal(response.headers.get('allow'), 'POST');
    await response.arrayBuffer();
  }
  const client = new Client({ name: 'connector-startup-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(environment.PERO_CONNECTORS_URL), { requestInit: { headers } }));
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['connectors_list', 'connectors_call']);
  endpoint.accept({ kind: 'session_closed', thread_id: thread });
  assert.equal((await fetch(environment.PERO_CONNECTORS_URL, { headers })).status, 403);
});
