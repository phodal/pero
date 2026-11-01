// Scripted ACP fixture, not a model. Every domain operation uses the Host's real MCP.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { setTimeout as poll } from 'node:timers/promises';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const sessionId = 'lab-transport-fixture';
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
  const experimentId = /Color Mixing experiment ([a-f0-9]{32})/.exec(text)?.[1];
  assert.ok(experimentId, 'The actual Discuss in chat draft must identify its frozen experiment');
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Lab ACP fixture', version: '1' } }, signal);
  const steps = [];
  async function tool(name, args, pointer = '/result', rejection) {
    const toolCallId = `lab-${nextId + 1}`;
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title: `Lab fixture: ${args.document?.action ?? name}`, kind: 'other', status: 'in_progress', rawInput: args } } });
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
  assert.ok(declarations.some(item => item.app === 'lab' && item.tool === 'experiment-step'));
  const step = (document, pointer = '/result', rejection) => tool('app_write', { app: 'lab', tool: document.action === 'propose' ? 'propose-protocol' : 'experiment-step', document: { experimentId, ...document } }, pointer, rejection);
  assert.ok(declarations.some(item => item.app === 'lab' && item.tool === 'propose-protocol'));
  const original = await step({ action: 'read' });
  await tool('app_write', {app:'control-lab',tool:'experiment-step',document:{action:'read',experimentId}}, '/result', /scope|bound|denied|available|enabled|installed/i);
  await step({action:'read',experimentId:'f'.repeat(32)}, '/result', /APP_GOAL_DENIED|approved|experiment/i);
  assert.equal(original.mode, 'simulation'); assert.equal(original.trials.length, 0);
  await step({ action: 'propose', protocol: { version: 1, initial_revision: 0, steps: [] }, reason: 'invalid' }, '/result', /steps|schema|invalid|minimum/i);
  await step({ action: 'propose', criteria: { tolerance: 1 } }, '/result', /required|schema|invalid|declared/i);
  const protocol = red => ({ version: 1, initial_revision: 0, steps: [
    { op: 'pickup_tip', resource: 'T1' }, { op: 'aspirate', resource: 'A1', volume_ul: red },
    { op: 'dispense', resource: 'B1', volume_ul: red }, { op: 'return_tip', resource: 'T1' },
    { op: 'pickup_tip', resource: 'T2' }, { op: 'aspirate', resource: 'A2', volume_ul: 100-red },
    { op: 'dispense', resource: 'B1', volume_ul: 100-red }, { op: 'return_tip', resource: 'T2' },
  ] });
  async function run(red, parentTrialId) {
    const proposed = await step({ action: 'propose', protocol: protocol(red), ...(parentTrialId ? { parentTrialId } : {}),
      reason: parentTrialId ? 'Observed synthetic +0.1 fraction discrepancy; reduce red input from 50 to 40 µL.' : 'Baseline equal volumes' });
    const trialId = proposed.trials.at(-1).id;
    await step({ action: 'validate', trialId }, '/result/trials');
    await step({ action: 'simulate', trialId }, '/result/trials');
    const deadline = Date.now()+30000;
    while (true) {
      const trials = await step({ action: 'read' }, '/result/trials');
      const trial = trials.find(t => t.id === trialId);
      if (trial.status !== 'running') { assert.equal(trial.status, 'completed'); break; }
      assert.ok(Date.now()<deadline,'Chatterbox execution timed out'); await poll(100, undefined, {signal});
    }
    await step({ action: 'observe', trialId }, '/result/trials');
    const evaluated = await step({ action: 'evaluate', trialId });
    return evaluated.trials.find(t => t.id===trialId);
  }
  const baseline = await run(50);
  assert.equal(baseline.verification.verdict,'FAIL');
  const revised = await run(40,baseline.id);
  assert.equal(revised.verification.verdict,'PASS');
  assert.equal(revised.events.length,8);
  assert.ok(revised.events.every(e=>e.backend.version==='0.2.2' && e.status==='completed'));
  const comparison = await step({ action:'compare' }); assert.ok(comparison.improvement>0);
  const final = await step({action:'read'});
  assert.equal(final.spec_hash, original.spec_hash); assert.deepEqual(final.criteria,original.criteria);
  assert.equal(final.decisions.length,0);
  return { fixture:true, realModel:false, experimentId, baselineId:baseline.id, revisionId:revised.id, comparison, steps };

}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } }, agentInfo: { name: 'Lab scripted transport fixture', version: '1' } } });
  else if (method === 'session/new') { server = params.mcpServers.find(item => item.type === 'http' && item.name === 'pero-app-use'); send({ id, result: { sessionId } }); }
  else if (method === 'session/cancel') active?.abort(new Error('Fixture cancelled'));
  else if (method === 'session/prompt') {
    active = new AbortController(); let result;
    try { result = await exercise(params.prompt, active.signal); }
    catch (error) { result = { fixture: true, realModel: false, error: String(error.stack || error) }; }
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'LAB_RESULT:' + JSON.stringify(result) } } } });
    send({ id, result: { stopReason: active.signal.aborted ? 'cancelled' : 'end_turn' } }); active = undefined;
  }
});
