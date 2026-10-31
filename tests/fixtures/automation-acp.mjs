// Local protocol fixture only: no tools, providers or network. Capture is test-owned.
import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let active, workspace;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'automation-fixture', version: '1' } } });
  else if (method === 'session/new') { workspace = params.cwd; send({ id, result: { sessionId: 'automation-fixture' } }); }
  else if (method === 'session/prompt') {
    active = id;
    const text = params.prompt.filter(block => block.type === 'text').map(block => block.text).join('\n');
    appendFileSync(process.env.AUTOMATION_FIXTURE_LOG, JSON.stringify({ workspace, text }) + '\n');
    send({ method: 'session/update', params: { sessionId: 'automation-fixture', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fixture_prompt_received' } } } });
    if (!text.includes('[hold]')) { send({ id, result: { stopReason: 'end_turn' } }); active = undefined; }
  } else if (method === 'session/cancel' && active !== undefined) { send({ id: active, result: { stopReason: 'cancelled' } }); active = undefined; }
  else if (id !== undefined) send({ id, error: { code: -32601, message: 'Unsupported fixture method' } });
});
