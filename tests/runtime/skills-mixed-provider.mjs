// The only fake seam is the provider's authored decisions; all tools are production tools.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const deliveryTool = 'mcp__pero-app-use__deliver_artifact';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export async function mixedProvider(root, python, evidence) {
  const sources = {};
  for (const name of ['analyze.py', 'test_analysis.py', 'workflow.py', 'check_task.py'])
    sources[name] = await readFile(join(root, 'tests/fixtures/skills-mixed', name), 'utf8');
  const calls = [], errors = [], artifacts = [], expected = new Map();
  let requests = 0, selected, iterator, receiptArtifact;
  function* invoke(name, args) {
    const raw = yield {name, args};
    let value = JSON.parse(raw);
    if (Array.isArray(value.content)) value = JSON.parse(value.content[0].text);
    assert(!value.error && !value.isError, JSON.stringify(value));
    return value;
  }
  function* plan() {
    yield* invoke('read_file', {path: 'brief.md'});
    yield* invoke('read_file', {path: 'measurements.csv'});
    yield* invoke('write_file', {path: 'plan.md', content: '# Fixed fixture plan\n\nGoal: descriptive complete-pair mean change in mg/L. Preserve missing p5.\nStop on duplicate ID, nonfinite value, mixed unit, empty pair set or failed test/check.\nWrite code and tests, execute, independently recompute, then deliver exact versions.\nNo significance, causal claim or external publication. Provider decisions are scripted.\n'});
    for (const [path, content] of Object.entries(sources)) yield* invoke('write_file', {path, content});
    const commands = [
      `${quote(python)} -m unittest discover -p 'test_*.py' -v > tests.log 2>&1`,
      `${quote(python)} workflow.py`,
      `${quote(python)} check_task.py`,
    ];
    for (const command of commands) {
      const result = yield* invoke('shell', {command});
      assert.equal(result.exitCode, 0, JSON.stringify(result));
    }
    yield* invoke('read_file', {path: 'result.json'});
    yield* invoke('read_file', {path: 'independent-check.json'});
    const files = [
      ['brief.md', 'input'], ['measurements.csv', 'input'], ['plan.md', 'code'],
      ['analyze.py', 'code'], ['test_analysis.py', 'code'], ['workflow.py', 'code'], ['check_task.py', 'code'],
      ['tests.log', 'execution_log'], ['result.json', 'run_record'],
      ['independent-check.json', 'review'], ['environment.json', 'environment'], ['skill-selection.json', 'run_record'],
    ];
    for (const [path, role] of files) {
      const value = yield* invoke(deliveryTool, {path});
      artifacts.push({path, role, artifact: value.artifact});
    }
    const related = artifacts.map(item => ({artifact_id: item.artifact.id, version: 1, role: item.role}));
    const report = yield* invoke(deliveryTool, {path: 'report.md', title: 'Mixed skills: checked paired measurements', related});
    artifacts.push({path: 'report.md', role: 'run_record', artifact: report.artifact});
    const receipt = {schema: 1, issue: 200, mode: 'scripted-provider-real-host-harness-tools',
      thread: evidence.thread, source: evidence.source, hostSHA256: evidence.hostSHA256, harnessSHA256: evidence.harnessSHA256,
      methods: selected.methods, inputs: evidence.inputs, execution: calls,
      artifacts: artifacts.map(({path, artifact}) => ({path, id: artifact.id, version: 1, sha256: artifact.versions[0].sha256})),
      scope: ['Skill instructions were explicitly selected, resolved and received in this same task',
        'Provider decisions and code are authored fixtures, not model-generated research',
        'Tool success and independent Decimal check are not human scientific acceptance',
        'Host session artifacts are the delivery owner; Notebook attachment not claimed']};
    yield* invoke('write_file', {path: 'task-receipt.json', content: JSON.stringify(receipt, null, 2) + '\n'});
    const stored = yield* invoke(deliveryTool, {path: 'task-receipt.json', title: 'Mixed skills task receipt',
      related: [...related, {artifact_id: report.artifact.id, version: 1, role: 'run_record'}]});
    receiptArtifact = stored.artifact;
    return 'Deterministic fixture complete: actual scripts/tests/independent check and exact input/skill versions saved through Host artifacts. No real model or scientific acceptance claimed.';
  }
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer skills-p3-fixture');
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw); requests++;
      assert.equal(input.model, 'fixture');
      if (requests === 1) {
        const wire = JSON.stringify(input.messages);
        for (const method of selected.methods) assert(wire.includes(method.marker), `Missing selected instruction: ${method.id}`);
      } else {
        const last = input.messages.filter(message => message.role === 'tool').at(-1);
        assert.equal(last.tool_call_id, calls.at(-1).id);
        calls.at(-1).result = last.content;
      }
      const step = iterator.next(requests === 1 ? undefined : calls.at(-1).result);
      let delta, reason;
      if (step.done) {delta = {content: step.value}; reason = 'stop';}
      else {
        const {name, args} = step.value;
        assert(input.tools.some(tool => tool.function.name === name), `Production tool missing: ${name}`);
        const id = `mixed-${requests}`;
        expected.set(id, {name, args});
        calls.push({id, name, args});
        delta = {tool_calls: [{index: 0, id, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
        reason = 'tool_calls';
      }
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.end(`data: ${JSON.stringify({choices: [{index: 0, delta, finish_reason: reason}]})}\n\ndata: [DONE]\n\n`);
    } catch (error) {errors.push(String(error.stack)); response.writeHead(500).end('Scripted provider assertion failed');}
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return {endpoint: `http://127.0.0.1:${server.address().port}/v1`, calls, errors, expected, artifacts,
    select(value) {selected = value; iterator = plan();}, receipt: () => receiptArtifact, requests: () => requests,
    async close() {server.closeAllConnections(); await new Promise(done => server.close(done));}};
}
