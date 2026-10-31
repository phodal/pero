// Loopback-only synthetic provider to exercise the real ACP/Host transport and
// exhaustion path. It never receives a real credential or external data.
import { createServer } from 'node:http';
import { once } from 'node:events';

export async function startFixtureProvider(skillName, digest) {
  let attempts = 0;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer local-control-lab-fixture' || req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(403); res.end(); return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    attempts++;
    const request = JSON.parse(body);
    if (request.max_tokens !== 8192) { res.writeHead(400); res.end(); return; }
    const experimentId = /Review Control Lab experiment ([a-f0-9]{32})/.exec(JSON.stringify(request.messages))?.[1];
    const step = (action, extra = {}) => ({ app: 'control-lab', tool: 'experiment-step', document: { action, experimentId, ...extra } });
    const steps = [
      [['skill', {}]],
      [['skill', { name: skillName, digest }], ['mcp__pero-app-use__app_write', step('read')]],
      [['mcp__pero-app-use__app_write', step('search')]],
      [['mcp__pero-app-use__app_write', step('read')]],
      [['mcp__pero-app-use__app_write', step('lock', { candidateId: 'baseline' })]],
      [['mcp__pero-app-use__app_write', step('verify')]],
    ];
    const calls = steps[attempts - 1] || [['skill', {}]];
    const toolCalls = calls.map(([name, args], index) => ({ index, id: `fixture-${attempts}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: `fixture-${attempts}`, object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: 'tool_calls' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { endpoint: `http://127.0.0.1:${server.address().port}/v1`, attempts: () => attempts, close: () => new Promise((done, reject) => server.close(error => error ? reject(error) : done())) };
}
