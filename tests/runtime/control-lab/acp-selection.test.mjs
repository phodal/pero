// Fixture contract only: synthetic MCP data, no model or scientific acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

test('scripted ACP reads five frozen scenario identities without loading numerical payloads', { timeout: 15000 }, async () => {
  const id = 'a'.repeat(32), hash = 'b'.repeat(64), references = new Map(), pointers = [];
  const scenarios = Array.from({ length: 5 }, (_, index) => ({ id: `search-${index}`, role: 'search' }));
  const value = { templateId: 'robust-pid', candidateBudget: 3, specHash: hash, criteria: { limit: 1 },
    scenarios, candidates: [], trials: [], status: 'completed', progress: { completed: 0, total: 0 } };
  const text = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  let serial = 0, fullReads = 0;
  const server = createServer(async (req, res) => {
    const parts = []; for await (const chunk of req) parts.push(chunk);
    const request = JSON.parse(Buffer.concat(parts).toString());
    let result;
    if (request.method === 'initialize') result = {};
    else {
      const { name, arguments: args } = request.params;
      if (name === 'content_read') {
        pointers.push(args.pointer);
        const document = references.get(args.id);
        const selected = args.pointer.split('/').slice(1).reduce((current, key) => current[key], document);
        const bytes = JSON.stringify(selected), offset = args.offset ?? 0;
        if (args.pointer === '/result' && value.trials.length) fullReads++;
        const end = Math.min(bytes.length, offset + args.maxBytes);
        const next = end === bytes.length ? 'End of selection.' : `Next read: ${JSON.stringify({ ...args, offset: end })}`;
        result = { content: [{ type: 'text', text: `Content ${args.id}, bytes ${offset}..${end} of ${bytes.length}.\n${bytes.slice(offset, end)}\n${next}` }] };
      } else if (name === 'app_describe') result = text({ apps: [{ app: 'control-lab', tool: 'experiment-step' }, { app: 'control-lab', tool: 'propose-candidate' }] });
      else {
        const d = args.document;
        if (d.experimentId !== id || d.parameters?.kp === 999 || d.parameters?.horizon || d.criteria || d.budget) {
          result = { isError: true, content: [{ type: 'text', text: 'APP_GOAL_DENIED invalid schema frozen bounds' }] };
        } else {
          if (d.action === 'baseline') {
            value.candidates = [{ id: 'baseline', parameters: {} }];
            value.trials = scenarios.map(scenario => ({ candidateId: 'baseline', phase: 'search', scenarioId: scenario.id,
              status: 'completed', observation: { samples: 'x'.repeat(100000) } }));
            value.progress = { completed: 5, total: 5 };
          } else if (d.action === 'propose') value.candidates.push({ id: 'proposal-1', parameters: { kp: 3 } });
          else if (d.action === 'search-next') value.candidates.push({ id: 'candidate-01', parameters: {} });
          else if (d.action === 'lock') value.lockedCandidateId = d.candidateId;
          else if (d.action === 'verify') value.report = { verdict: 'FAIL', evidence: ['fixture'], checks: [{ name: 'fixture', verdict: 'FAIL' }] };
          const key = (++serial).toString(16).padStart(64, '0');
          references.set(key, structuredClone({ result: value }));
          result = text({ type: 'content_reference', artifact: { id: key }, read: { tool: 'content_read' } });
        }
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const child = spawn(process.execPath, [resolve('tests/fixtures/control-lab-acp.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise(done => child.once('exit', done));
  const lines = createInterface({ input: child.stdout });
  try {
    const result = new Promise((accept, reject) => {
      child.once('error', reject); child.once('exit', code => reject(new Error(`Fixture exited before result: ${code}`)));
      lines.on('line', line => {
        const event = JSON.parse(line), update = event.params?.update;
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.text.includes('CONTROL_LAB_RESULT:'))
          accept(JSON.parse(update.content.text.split('CONTROL_LAB_RESULT:')[1]));
      });
    });
    const send = (method, params) => child.stdin.write(JSON.stringify({ id: ++serial, method, params }) + '\n');
    send('session/new', { mcpServers: [{ type: 'http', name: 'pero-app-use', url: `http://127.0.0.1:${server.address().port}`, headers: [] }] });
    send('session/prompt', { prompt: [{ type: 'text', text: `Review Control Lab experiment ${id}` }] });
    const receipt = await result;
    assert.equal(receipt.error, undefined); assert.equal(receipt.steps.filter(step => step.rejected).length, 6);
    assert.equal(fullReads, 0);
    for (let index = 0; index < 5; index++) for (const field of ['candidateId', 'status', 'phase', 'scenarioId'])
      assert.ok(pointers.includes(`/result/trials/${index}/${field}`));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited; lines.close();
    server.closeAllConnections(); await new Promise(done => server.close(done));
  }
});
