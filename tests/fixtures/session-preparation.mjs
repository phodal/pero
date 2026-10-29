// ACP lifecycle fixture: the test controls readiness through a file signal.
import readline from 'node:readline';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const [name, log, gate = '', failure = ''] = process.argv.slice(2);
let authenticated = !['auth', 'external'].includes(name);
let model = 'model-a';
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const options = () => [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model,
  options: [{ value: 'model-a', name: `${name} Model A` }, { value: 'model-b', name: `${name} Model B` }] }];
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  appendFileSync(log, `${JSON.stringify({ name, method, params, pid: process.pid })}\n`);
  if (method === 'initialize') {
    if (failure && !existsSync(failure)) { writeFileSync(failure, 'failed'); process.exit(1); }
    send({ id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true, embeddedContext: true } },
      authMethods: [{ id: name === 'external' ? 'opencode-login' : 'login', name: name === 'external' ? 'Login with opencode' : 'Sign in' }], agentInfo: { name, version: '1' } } });
  } else if (method === 'session/new') {
    if (gate && !existsSync(gate)) await new Promise(resolve => {
      const poll = setInterval(() => { if (existsSync(gate)) { clearInterval(poll); resolve(); } }, 20);
    });
    if (!authenticated) { send({ id, error: { code: -32000, message: 'Authentication required' } }); return; }
    send({ id, result: { sessionId: `${name}-${process.pid}`, configOptions: options() } });
  } else if (method === 'authenticate') {
    authenticated = true; send({ id, result: {} });
  } else if (method === 'session/set_config_option') {
    model = params.value; send({ id, result: { configOptions: options() } });
  } else if (method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${name}: ${params.prompt[0].text}` } } } });
    send({ id, result: { stopReason: 'end_turn' } });
  } else if (id !== undefined) send({ id, result: {} });
});
