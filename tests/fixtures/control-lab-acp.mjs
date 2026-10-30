// Scripted ACP fixture, not a model. Every domain operation uses the Host's real MCP.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { setTimeout as poll } from 'node:timers/promises';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const sessionId = 'control-lab-transport-fixture';
let server, nextId = 0, active;
async function rpc(method, params, signal) {
  assert.ok(server, 'App-bound session must supply its Host MCP endpoint');
  const response = await fetch(server.url, { method: 'POST', headers: { ...Object.fromEntries(server.headers.map(item => [item.name, item.value])), 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }), signal });
  assert.equal(response.status, 200);
  const reply = await response.json(); assert.equal(reply.error, undefined, JSON.stringify(reply.error)); return reply.result;
}
// Read just the selected JSON field through the existing content_read contract;
// numerical observations stay in the immutable App ledger, not in model prose.
async function selected(result, pointer, signal) {
  const value = JSON.parse(result.content.find(item => item.type === 'text').text);
  if (value.type !== 'content_reference') return pointer.split('/').slice(1).reduce((current, key) => current[key], value);
  assert.equal(value.read.tool, 'content_read');
  let request = { id: value.artifact.id, pointer, maxBytes: 16384 }, offset;
  const chunks = [];
  for (let count = 0; count < 16; count++) {
    const read = await rpc('tools/call', { name: 'content_read', arguments: request }, signal);
    assert.notEqual(read.isError, true);
    const envelope = /^Content ([a-f0-9]{64}), bytes (\d+)\.\.(\d+) of (\d+)\.\n([\s\S]*)\n(End of selection\.|Next read: (.*))$/.exec(read.content[0].text);
    assert.ok(envelope, 'Expected content_read selection envelope'); assert.equal(envelope[1], value.artifact.id);
    if (offset !== undefined) assert.equal(Number(envelope[2]), offset);
    offset = Number(envelope[3]); chunks.push(envelope[5]);
    if (envelope[6] === 'End of selection.') return JSON.parse(chunks.join(''));
    request = JSON.parse(envelope[7]);
  }
  assert.fail('Fixture exceeded bounded content selection reads');
}
async function exercise(prompt, signal) {
  const text = prompt.filter(item => item.type === 'text').map(item => item.text).join('\n');
  const experimentId = /Review Control Lab experiment ([a-f0-9]{32})/.exec(text)?.[1];
  assert.ok(experimentId, 'The actual Discuss in chat draft must identify its frozen experiment');
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Control Lab ACP fixture', version: '1' } }, signal);
  const steps = [];
  async function tool(name, args, pointer = '/result', rejection) {
    const toolCallId = `control-lab-${nextId + 1}`;
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title: `Control Lab fixture: ${args.document?.action ?? name}`, kind: 'other', status: 'in_progress', rawInput: args } } });
    const result = await rpc('tools/call', { name, arguments: args }, signal);
    const text = result.content?.find(item => item.type === 'text')?.text ?? '';
    if (rejection) {
      assert.equal(result.isError, true, text); assert.match(text, rejection);
      steps.push({ action: args.document.action, rejected: true, reason: text });
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', rawOutput: { expectedRejection: true } } } });
      return;
    }
    assert.notEqual(result.isError, true, text);
    const value = await selected(result, pointer, signal);
    steps.push({ action: args.document?.action ?? name, selected: pointer });
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', rawOutput: { fixture: true, selected: pointer } } } });
    return value;
  }
  const declarations = await tool('app_describe', {}, '/apps');
  assert.ok(declarations.some(item => item.app === 'control-lab' && item.tool === 'experiment-step'));
  const step = (document, pointer = '/result', rejection) => tool('app_write', { app: 'control-lab', tool: document.action === 'propose' ? 'propose-candidate' : 'experiment-step', document: { experimentId, ...document } }, pointer, rejection);
  assert.ok(declarations.some(item => item.app === 'control-lab' && item.tool === 'propose-candidate'));
  const original = await step({ action: 'read' });
  assert.equal(original.templateId, 'robust-pid'); assert.equal(original.candidateBudget, 2); assert.equal(original.trials.length, 0);
  await step({ action: 'propose', parameters: { kp: 999 } }, '/result', /between|bounds|range/i);
  await step({ action: 'propose', parameters: { horizon: 60 } }, '/result', /only|frozen|controller|component|additional|schema|unknown|invalid/i);
  await step({ action: 'propose', parameters: { kp: 3 }, criteria: { steadyErrorMax: .5 } }, '/result', /declared|schema|invalid|frozen|policy/i);
  await step({ action: 'search', budget: 3 }, '/result', /frozen|budget/i);
  await step({ action: 'propose', parameters: { kp: 3 } }, '/result/status');
  async function settled() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const status = await step({ action: 'read' }, '/result/status');
      if (status !== 'running') { assert.equal(status, 'completed'); return; }
      await poll(200, undefined, { signal });
    }
    assert.fail('Real solver did not finish within fixture deadline');
  }
  await settled();
  await step({ action: 'search', budget: original.candidateBudget }, '/result/status'); await settled();
  const candidates = await step({ action: 'read' }, '/result/candidates');
  assert.equal(candidates.length, 2);
  const proposal = candidates.find(item => item.id.startsWith('proposal-'));
  assert.ok(proposal); assert.equal(proposal.parameters.kp, 3);
  await step({ action: 'lock', candidateId: proposal.id }, '/result/lockedCandidateId');
  await step({ action: 'verify' }, '/result/status'); await settled();
  const report = await step({ action: 'read' }, '/result/report');
  assert.ok(['PASS', 'FAIL', 'INCONCLUSIVE'].includes(report.verdict));
  assert.ok(report.evidence.length > 0); assert.ok(report.checks.length > 0);
  assert.equal(await step({ action: 'read' }, '/result/specHash'), original.specHash);
  assert.deepEqual(await step({ action: 'read' }, '/result/criteria'), original.criteria);
  return { fixture: true, realModel: false, experimentId, specHash: original.specHash, proposalId: proposal.id, report, steps };
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } }, agentInfo: { name: 'Control Lab scripted transport fixture', version: '1' } } });
  else if (method === 'session/new') { server = params.mcpServers.find(item => item.type === 'http' && item.name === 'pero-app-use'); send({ id, result: { sessionId } }); }
  else if (method === 'session/cancel') active?.abort(new Error('Fixture cancelled'));
  else if (method === 'session/prompt') {
    active = new AbortController(); let result;
    try { result = await exercise(params.prompt, active.signal); }
    catch (error) { result = { fixture: true, realModel: false, error: String(error.stack || error) }; }
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'CONTROL_LAB_RESULT:' + JSON.stringify(result) } } } });
    send({ id, result: { stopReason: active.signal.aborted ? 'cancelled' : 'end_turn' } }); active = undefined;
  }
});
