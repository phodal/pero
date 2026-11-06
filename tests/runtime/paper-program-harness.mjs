// Real Host -> Go Harness -> shared DesktopAppUse -> synthetic Paper backend.
// The model is a loopback HTTP fixture. This script never opts into paid inference.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { copyFile, cp, mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '../..');
const withoutStatusPolling = process.argv.includes('--no-status-poll');
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = process.env.PERO_RESEARCH_HOST || join(root, `target/debug/${process.platform === 'win32' ? 'pero-host-research.exe' : 'pero-host'}`);
const agent = process.env.PERO_RESEARCH_AGENT || join(root, `target/debug/pero-agent-acp${suffix}`);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'pero-paper-program-')));
const sha = value => createHash('sha256').update(value).digest('hex');
const protocol = { question: 'Fixture literature question', scope: 'Synthetic transport acceptance only',
  deadline: new Date(Date.now() + 3600000).toISOString(), limits: { modelRequests: 8, appCalls: 20 } };
const context = { kind: 'paper-autoresearch', programId: sha('fixture research program'), protocolDigest: sha(JSON.stringify(protocol)) };
const checkpoints = [sha('fixture initial checkpoint'), sha('fixture finished checkpoint')];
const instructions = 'PAPER_PROGRAM_FIXTURE: use only the approved Paper research tools.';
const nextAction = 'Export the saved checkpoint twice, then finish the approved program.';
const skill = (await readFile(join(root, 'apps/paper-agent/agent-plugins/paper-autoresearch/SKILL.md'), 'utf8')).trim();
const events = [], requests = [], providerErrors = [];
const changed = new EventEmitter();
let host, desktop, hostExit, server, stderr = '', sequence = 0, selected = 'unrelated-visible-chat';
const json = (path, value) => writeFile(path, JSON.stringify(value));
const recentEvents = () => JSON.stringify(events.slice(-6).map(event => ({
  kind: event.kind, thread: event.thread_id, request: event.request_id, text: event.text,
  error: event.data?.error, stopReason: event.data?.stopReason,
})));

async function wait(predicate, after = 0) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const event = events.slice(after).find(predicate);
    if (event) return event;
    const remaining = deadline - Date.now();
    assert(remaining > 0, `Host timeout: ${stderr}\n${recentEvents()}\nProvider: ${providerErrors.join('; ')}`);
    await new Promise((accept, reject) => {
      const listener = () => { clearTimeout(timer); accept(); };
      const timer = setTimeout(() => { changed.off('change', listener); reject(Error(`Host timeout: ${stderr}\n${recentEvents()}\nProvider: ${providerErrors.join('; ')}`)); }, remaining);
      changed.once('change', listener);
    });
  }
}
const send = command => { desktop.command(command); host.stdin.write(JSON.stringify(command) + '\n'); };
async function appRequest(action, fields = {}, accepted = true) {
  const id = `paper-program-${++sequence}`;
  host.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
  const event = await wait(event => event.kind === 'apps_result' && event.request_id === id);
  if (accepted) assert(event.data.ok, event.data.error);
  return accepted ? event.data.value : event.data;
}
const toolName = name => `mcp__pero-app-use__app__paper-agent__${name}`;

try {
  await build({ stdin: { contents: "export { DesktopAppUse } from './desktop/src/main/app-use-mcp.ts'; export { AppWriteRoutes } from './desktop/src/main/app-write-routes.ts';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: join(directory, 'adapter.mjs') });
  const { DesktopAppUse, AppWriteRoutes } = await import(pathToFileURL(join(directory, 'adapter.mjs')).href);
  server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw); requests.push(input);
      assert(requests.length <= 10, 'unexpected extra provider request');
      const ordinary = JSON.stringify(input.messages).includes('ordinary-unbound-check');
      const tools = (input.tools || []).map(tool => tool.function.name);
      let call;
      if (ordinary) {
        assert(!JSON.stringify(input.messages).includes(instructions));
        if (!input.messages.some(message => message.role === 'tool'))
          call = [toolName('research-program'), { operation: 'read' }, 'unbound-read'];
      } else {
        assert(JSON.stringify(input.messages).includes(instructions), 'saved protocol instructions were not injected');
        assert(input.messages.some(message => typeof message.content === 'string' && message.content.includes(skill)), 'the installed Paper Skill did not reach the model');
        assert(tools.includes(toolName('research-program')));
        assert(!tools.includes('shell'), 'research mode exposed shell');
        assert(!tools.some(name => name.startsWith('mcp__external__')), 'research mode exposed unrelated MCP');
        const step = requests.filter(value => !JSON.stringify(value.messages).includes('ordinary-unbound-check')).length;
        if (step === 2) {
          assert(JSON.stringify(input.messages).includes(nextAction), 'normal stop did not inject feedback into the same session');
          call = [toolName('research-deliver'), {}, 'deliver-first'];
        } else if (step === 3) call = [toolName('research-deliver'), {}, 'deliver-retry'];
        else if (step === 4) call = [toolName('research-program'), { operation: 'read', programId: sha('unbound other program') }, 'foreign-program'];
        else if (step === 5) call = [toolName('research-program'), { operation: 'finish', expectedCheckpoint: checkpoints[0], operationId: 'finish-fixture', reason: 'no_progress' }, 'finish-program'];
        else assert([1, 6].includes(step), `unexpected research model step ${step}`);
      }
      const delta = call ? { tool_calls: [{ index: 0, id: call[2], type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] }
        : { content: 'The current reading step is finished.' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { providerErrors.push(String(error)); response.writeHead(500).end('Fixture assertion failed'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const provider = `http://127.0.0.1:${server.address().port}`;
  const source = join(directory, 'source');
  await mkdir(join(source, 'dist'), { recursive: true });
  await writeFile(join(source, 'dist/index.html'), '<h1>Synthetic Paper program fixture</h1>');
  await copyFile(join(root, 'tests/runtime/paper-program-fixture.mjs'), join(source, 'server.mjs'));
  await cp(join(root, 'apps/paper-agent/agent-plugins'), join(source, 'agent-plugins'), { recursive: true });
  await json(join(source, 'fixture.json'), { context, protocol, checkpoints, instructions, nextAction });
  const names = ['research-program', 'research-search', 'research-acquire', 'research-deliver'];
  await json(join(source, 'app.json'), { schemaVersion: 1, name: 'paper-agent', version: '1', displayName: 'Paper program fixture',
    permissions: { host: ['agent', 'agent-plugin'] }, requiresAgentPlugins: ['paper-autoresearch'], backend: { type: 'node', entry: 'server.mjs' }, contributes: {
      panels: [{ id: 'main', title: 'Research', entry: 'dist/index.html' }],
      writes: names.map(name => ({ name, description: name, path: '/api/programs/agent', schema: { type: 'object', properties: {
        operation: { type: 'string' }, programId: { type: 'string' }, expectedCheckpoint: { type: 'string' },
        operationId: { type: 'string' }, reason: { type: 'string' }, checkpoint: { type: 'string' },
      }, additionalProperties: false } })),
      agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: 'Ordinary Paper fixture', tools: names, maxCalls: 1 },
    } });
  await json(join(directory, 'agents.json'), [{ id: 'pero', name: 'Real Go Harness', command: agent,
    args: ['--endpoint', provider + '/v1', '--model', 'fixture', '--session-dir', join(directory, 'sessions'),
      '--api-key-env', 'PAPER_PROGRAM_FIXTURE_KEY', '--approval', 'ask', '--max-retries', '0', '--max-requests', '20', '--max-tokens', '2048'], env: {} }]);
  desktop = new DesktopAppUse({ selectedThread: async () => selected, presence() {},
    page: async () => { throw Error('No UI in runtime acceptance'); }, capture: async () => { throw Error('No screenshot surface'); } },
    () => {}, join(directory, 'evidence'), new AppWriteRoutes(appRequest, () => {}, fetch));
  const endpoint = await desktop.start();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_') && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  host = spawn(binary, ['--stdio'], { cwd: directory, env: { ...env, ...endpoint, PAPER_PROGRAM_FIXTURE_KEY: 'local-fixture',
    PERO_AGENTS_FILE: join(directory, 'agents.json'), PERO_APPS_ROOT: join(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '',
    PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_ENV_FILE: join(directory, 'no-env'),
    PERO_SETTINGS_PATH: join(directory, 'settings.json'), PERO_HISTORY_PATH: join(directory, 'history.jsonl'), UV_OFFLINE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  hostExit = once(host, 'exit');
  host.stderr.on('data', chunk => { stderr += String(chunk); });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line); desktop.accept(event); events.push(event); changed.emit('change');
  });
  await wait(event => event.kind === 'ready');
  await appRequest('install', { path: source });
  await appRequest('enable', { name: 'paper-agent' });
  const catalog = await appRequest('agentcatalog', { name: 'paper-agent', path: '/api/workspaces' });
  const scope = { workspaceId: catalog.items[0].workspaceId };
  const start = { operation: 'start', scope, requestId: 'approved-paper-plan', harnessId: 'pero', text: 'Run the saved plan.', context };
  const run = await appRequest('agentrun', { name: 'paper-agent', request: start });
  const created = await wait(event => event.kind === 'session_created' && event.thread_id === run.sessionId);
  assert.equal(created.data.appPlugin.hostBudgeted, true);
  assert(created.data.agentPlugins.some(plugin => plugin.name === 'paper-autoresearch'));
  assert.equal(created.data.appPlugin.maxCalls, protocol.limits.appCalls);
  assert.deepEqual(created.data.appBinding.run.context, context);
  const finished = await wait(event => event.thread_id === run.sessionId && ['turn_finished', 'session_error'].includes(event.kind));
  assert.equal(finished.kind, 'turn_finished', JSON.stringify(finished));
  assert.equal(finished.data.stopReason, 'end_turn');
  if (!withoutStatusPolling) {
    const status = await appRequest('agentrun', { name: 'paper-agent', request: { operation: 'status', scope, runId: run.id } });
    assert.equal(status.status, 'completed');
    assert(!status.error, status.error);
  }
  // In the no-poll path, only Host events may trigger and expose terminal delivery.
  await wait(event => event.kind === 'artifact_registered' && event.thread_id === run.sessionId && event.data.artifact.versions.length === 2);
  assert.equal(events.filter(event => event.kind === 'session_created' && event.thread_id === run.sessionId).length, 1);
  assert.equal(events.filter(event => event.kind === 'turn_started' && event.thread_id === run.sessionId).length, 1);
  assert.equal(requests.length, 6, JSON.stringify(providerErrors));
  const results = requests.at(-1).messages.filter(message => message.role === 'tool');
  const first = JSON.parse(results.find(message => message.tool_call_id === 'deliver-first').content).result;
  const retry = JSON.parse(results.find(message => message.tool_call_id === 'deliver-retry').content).result;
  assert.deepEqual(retry, first, 'delivery retry created another version or artifact');
  assert.equal(first.artifacts.length, 4);
  assert(first.artifacts.every(artifact => artifact.version === 1 && artifact.checkpoint === checkpoints[0]));
  assert.match(results.find(message => message.tool_call_id === 'foreign-program').content, /another research program/i);
  const duplicateRun = await appRequest('agentrun', { name: 'paper-agent', request: start });
  assert.equal(duplicateRun.id, run.id);
  assert.equal(requests.length, 6, 'idempotent App run launched another request');

  const saved = JSON.parse(await readFile(join(directory, 'settings.artifacts', sha(run.sessionId), 'catalog.json'), 'utf8'));
  assert.equal(saved.length, 4);
  for (const artifact of saved) {
    assert.equal(artifact.thread_id, run.sessionId);
    assert.equal(artifact.versions.length, 2);
    const snapshot = artifact.versions[0];
    const bytes = await readFile(join(directory, 'settings.artifacts', sha(run.sessionId), 'snapshots', snapshot.sha256 + '.bin'));
    assert.equal(sha(bytes), snapshot.sha256);
    assert(bytes.toString().includes(checkpoints[0]), 'old snapshot changed after final export');
  }
  const calls = (await readFile(join(directory, 'app-data/paper-agent/calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(call => call.operation === 'feedback').length, 2);
  assert(calls.some(call => call.operation === 'observe-run' && call.status === 'completed'),
    'Host did not reconcile the terminal run with its bound program');
  assert(calls.filter(call => call.threadId).every(call => call.threadId === run.sessionId), 'backend received a selected/foreign thread');
  const audit = await readFile(join(directory, 'settings.research', context.programId, 'model-attempts.log'), 'utf8');
  assert.equal(audit.trim().split('\n').length, 6);
  const appAudit = await readFile(join(directory, 'settings.research', context.programId, 'app-calls.log'), 'utf8');
  assert.equal(appAudit.trim().split('\n').length, 1, 'only the admitted finish consumed an App call');

  selected = 'ordinary';
  send({ action: 'new_session', thread_id: selected, agent_id: 'pero', scope: { app: 'paper-agent', panel: 'main' } });
  await wait(event => event.kind === 'session_ready' && event.thread_id === selected);
  const after = events.length;
  send({ action: 'prompt', thread_id: selected, text: 'ordinary-unbound-check' });
  const ordinary = await wait(event => event.thread_id === selected && ['turn_finished', 'session_error'].includes(event.kind), after);
  assert.equal(ordinary.kind, 'turn_finished', JSON.stringify(ordinary));
  const unbound = requests.at(-1).messages.find(message => message.role === 'tool' && message.tool_call_id === 'unbound-read');
  assert.match(unbound?.content || '', /bound|start a research plan/i);
  assert.equal(await readFile(join(directory, 'settings.research', context.programId, 'model-attempts.log'), 'utf8'), audit,
    'ordinary conversation changed the research request ledger');
  assert.deepEqual(providerErrors, []);
  const report = { passed: true, provider: 'scripted loopback only', providerRequests: requests.length, researchRequests: 6,
    artifactCount: saved.length, versionsPerArtifact: 2, hostSHA256: sha(await readFile(binary)), harnessSHA256: sha(await readFile(agent)),
    checks: ['saved App run context selects research mode', 'normal model stop resumes in the same session/turn',
      ...(withoutStatusPolling ? ['terminal artifacts are delivered without UI status polling'] : []),
      'Host protocol budgets remain authoritative', 'direct artifact exports deduplicate and retain old snapshots',
      'foreign program and ordinary unbound research calls are rejected'],
    limitations: ['Synthetic Paper backend; Python domain tested separately', 'No desktop UI or scientific acceptance'] };
  await mkdir(join(root, 'test-results/paper-program-harness'), { recursive: true });
  await json(join(root, `test-results/paper-program-harness/${withoutStatusPolling ? 'no-status-' : ''}result.json`), report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const evidence = join(root, 'test-results/paper-program-harness');
  await mkdir(evidence, { recursive: true });
  await json(join(evidence, `${withoutStatusPolling ? 'no-status-' : ''}failure.json`), { error: String(error), stderr, providerErrors, events, requests,
    backendCalls: await readFile(join(directory, 'app-data/paper-agent/calls.jsonl'), 'utf8').catch(() => ''),
    backendState: await readFile(join(directory, 'app-data/paper-agent/state.json'), 'utf8').catch(() => ''),
  });
  throw error;
} finally {
  if (host && host.exitCode === null) {
    host.stdin.end();
    const timer = setTimeout(() => host.kill('SIGKILL'), 5000);
    await hostExit; clearTimeout(timer);
  }
  await desktop?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await rm(directory, { recursive: true, force: true });
}
