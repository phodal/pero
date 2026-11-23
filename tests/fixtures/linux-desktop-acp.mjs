import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { appUseContent } from './app-use-content.mjs';
import { waitFor } from './computer-app.mjs';

const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const sessionId = 'linux-desktop-fixture';
let server, previous, sequence = 0;
async function rpc(method, params) {
  const headers = Object.fromEntries(server.headers.map(({ name, value }) => [name, value]));
  const response = await fetch(server.url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.error, undefined);
  return reply.result;
}
async function computer(args) {
  const result = await rpc('tools/call', { name: 'computer_use', arguments: args });
  const text = result.content[0].text;
  return { value: text.startsWith('{') ? await appUseContent(text, rpc) : { error: text },
    image: result.content.find(item => item.type === 'image') };
}
async function observe() {
  const target = await waitFor(async () => {
    const { value } = await computer({ operation: 'targets' });
    assert(Array.isArray(value.targets), JSON.stringify(value));
    return value.targets.find(target => target.application_id === 'mousepad' &&
      target.title.includes('remote-proof.txt'))?.reference;
  }, 'Mousepad window for remote-proof.txt');
  const { value: reply, image } = await computer({ operation: 'observe', target });
  assert.equal(image?.mimeType, 'image/jpeg');
  assert.ok(Buffer.from(image.data, 'base64').length > 1000);
  return reply.observation;
}
async function act(observation, input) {
  const screenshot = observation.screenshot;
  const anchor = { kind: 'pixel', screenshot_id: screenshot.id, point: { x: Math.floor(screenshot.width / 2), y: Math.floor(screenshot.height / 2) } };
  return (await computer({ operation: 'act', action: { request_id: randomUUID(), target: observation.target,
    observation_id: observation.id, delivery: 'foreground', input: { ...input, anchor } } })).value.receipt;
}
async function scenario(name) {
  if (name === 'while-human' || name === 'after-stop' || name === 'detached') return (await computer({ operation: 'status' })).value;
  if (name === 'stale') return act(previous, { kind: 'type_text', text: 'WRONG' });
  if (name === 'write') {
    const observation = await observe();
    const receipt = await act(observation, { kind: 'type_text', text: 'Agent' });
    previous = await observe();
    return { receipt, runtime: previous.target.runtime_id };
  }
  const observation = await observe();
  const receipt = await act(observation, { kind: 'type_text', text: '-Resumed' });
  const save = await act(await observe(), { kind: 'press_key', keys: ['Control', 's'] });
  return { receipt, save, runtime: observation.target.runtime_id };
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } } });
  else if (method === 'session/new') {
    server = params.mcpServers.find(candidate => candidate.name === 'pero-app-use');
    assert.ok(server);
    send({ id, result: { sessionId } });
  } else if (method === 'session/prompt') {
    const command = params.prompt.find(block => block.type === 'text' && block.text.includes('DESKTOP_TEST:')).text;
    let result;
    try { result = await scenario(/DESKTOP_TEST:([a-z-]+)/.exec(command)[1]); }
    catch (error) { result = { error: error.message }; }
    send({ method: 'session/update', params: { sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `LINUX_RESULT:${JSON.stringify(result)}` },
    } } });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
