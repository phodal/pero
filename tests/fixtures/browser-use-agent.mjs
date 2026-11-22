// Deterministic ACP client for the real, session-bound Desktop MCP endpoint.
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { appUseContent } from './app-use-content.mjs';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let server, next = 0;
const sessionId = 'browser-use-fixture';
async function rpc(method, params) {
  const headers = Object.fromEntries(server.headers.map(({ name, value }) => [name, value]));
  const response = await fetch(server.url, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++next, method, params }),
  });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.error, undefined);
  return reply.result;
}
async function run(commands) {
  const catalog = await rpc('tools/list', {});
  assert.ok(catalog.tools.some(tool => tool.name === 'browser_use'));
  let observed;
  const results = [];
  for (const { name, ...args } of commands) {
    if (name) {
      args.ref = observed?.nodes.find(node => node.name === name)?.ref;
      assert.ok(args.ref, `No observed ref for ${name}`);
    }
    const result = await rpc('tools/call', { name: 'browser_use', arguments: args });
    const text = result.content[0].text;
    const value = text.startsWith('{') ? await appUseContent(text, rpc) : { error: text };
    if (args.action === 'observe' && !result.isError) observed = value;
    results.push({ ...value, isError: result.isError });
  }
  return results;
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize')
    send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } } });
  else if (method === 'session/new') {
    server = params.mcpServers.find(candidate => candidate.name === 'pero-app-use');
    assert.ok(server);
    send({ id, result: { sessionId } });
  } else if (method === 'session/prompt') {
    let result;
    try {
      result = await run(JSON.parse(params.prompt.find(block => block.type === 'text').text));
    } catch (error) {
      result = { error: error.message };
    }
    send({ method: 'session/update', params: { sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `BROWSER_RESULT:${JSON.stringify(result)}` },
    } } });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
