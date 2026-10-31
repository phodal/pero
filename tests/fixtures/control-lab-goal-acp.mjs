// Local scripted ACP transport only; no provider, solver or arbitrary execution.
import readline from 'node:readline';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let server;
async function write(experimentId) {
  const response = await fetch(server.url, { method: 'POST', headers: {
    ...Object.fromEntries(server.headers.map(item => [item.name, item.value])), 'Content-Type': 'application/json',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'app_write', arguments: { app: 'control-lab', tool: 'experiment-step', document: { action: 'read', experimentId } },
  } }) });
  return (await response.json()).result;
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } }, agentInfo: { name: 'goal-fixture', version: '1' } } });
  else if (method === 'session/new') { server = params.mcpServers.find(item => item.name === 'pero-app-use'); send({ id, result: { sessionId: 'goal-fixture' } }); }
  else if (method === 'session/prompt') {
    const good = await write('a'.repeat(32)), foreign = await write('c'.repeat(32));
    send({ method: 'session/update', params: { sessionId: 'goal-fixture', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify({ good, foreign }) } } } });
    send({ id, result: { stopReason: 'end_turn' } });
  }
});
