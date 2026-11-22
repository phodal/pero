// Deterministic ACP client for the real, session-bound Desktop MCP endpoint.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  let observed, selectedFiles;
  const results = [];
  for (const { name, ...args } of commands) {
    if (args.action === 'repl') {
      const { tool, ...parameters } = args;
      delete parameters.action;
      assert.ok(catalog.tools.some(entry => entry.name === tool), `Missing tool ${tool}`);
      const foreignTool = tool.startsWith('python_') ? 'javascript_repl' : 'python_repl';
      assert.ok(!catalog.tools.some(entry => entry.name === foreignTool), `Unexpected tool ${foreignTool}`);

      const result = await rpc('tools/call', { name: tool, arguments: parameters });
      results.push({
        text: result.content.filter(item => item.type === 'text').map(item => item.text).join(''),
        images: result.content.filter(item => item.type === 'image').map(item =>
          createHash('sha256').update(Buffer.from(item.data, 'base64')).digest('hex')),
        isError: result.isError,
      });
      continue;
    }

    if (name) {
      args.ref = observed?.nodes.find(node => node.name === name)?.ref;
      if (!args.ref) {
        results.push({ error: `No observed ref for ${name}`, isError: true });
        continue;
      }
    }
    if (args.action === 'upload' && !args.fileRef && !args.fileRefs) args.fileRef = selectedFiles?.[0]?.ref;
    if (args.action === 'scroll' && !args.observationId) args.observationId = observed?.observationId;
    const result = await rpc('tools/call', { name: 'browser_use', arguments: args });
    const text = result.content[0].text;
    const value = text.startsWith('{') ? await appUseContent(text, rpc) : { error: text };
    if (value.kind === 'files' && !result.isError) selectedFiles = value.files;
    if (value.kind === 'observation' && !result.isError) observed = value;
    const image = result.content.find(item => item.type === 'image');
    let pixels;
    if (args.action === 'screenshot' && !result.isError) {
      assert.equal(image?.mimeType, 'image/png');
      const png = Buffer.from(image.data, 'base64');
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      pixels = { bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
        width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    }
    results.push({ ...value, isError: result.isError, ...(pixels && { pixels }) });
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
      const text = params.prompt.find(block => block.type === 'text' && block.text.includes('[{"action"')).text;
      result = await run(JSON.parse(text.slice(text.indexOf('[{"action"'))));
    } catch (error) {
      result = { error: error.message };
    }
    send({ method: 'session/update', params: { sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `BROWSER_RESULT:${JSON.stringify(result)}` },
    } } });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
