// Deterministic Agent; calls the actual Host connector endpoint and native driver.
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const capture = process.env.PERO_CONNECTORS_CAPTURE;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const sessionId = 'native-connectors-fixture';
let server, rpcId = 0;
async function call(name, args) {
  const headers = Object.fromEntries(server.headers.map(header => [header.name, header.value]));
  const response = await fetch(server.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.error, undefined);
  return value.result;
}
createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } } });
  else if (method === 'session/new') {
    server = params.mcpServers.find(entry => entry.name === 'pero-connectors' && entry.type === 'http');
    assert(server, 'Host must bind the shared connector MCP endpoint');
    assert(!process.env.PERO_CONNECTORS_TOKEN, 'The master token reached the Agent');
    send({ id, result: { sessionId } });
    await writeFile(capture.replace(/\.json$/, '.ready'), 'ready');
  } else if (method === 'session/prompt') {
    try {
      const listed = await call('connectors_list', {});
      const connections = JSON.parse(listed.content[0].text);
      assert.deepEqual(connections.find(entry => entry.connectorId === 'fixture').tools, ['counter']);
      const denied = await call('connectors_call', { connectorId: 'fixture', name: 'unknown', arguments: {} });
      assert.equal(denied.isError, true);
      const actual = await call('connectors_call', { connectorId: 'fixture', name: 'counter', arguments: {} });
      assert.notEqual(actual.isError, true);
      assert.equal(JSON.parse(actual.content[0].text).count, 1);
      await writeFile(capture, JSON.stringify({ passed: true, listed: true, unknownDenied: true, counter: 1 }));
      send({ id, result: { stopReason: 'end_turn' } });
    } catch (error) {
      await writeFile(capture, JSON.stringify({ passed: false, error: String(error) }));
      send({ id, error: { code: -32603, message: String(error) } });
    }
  }
});
