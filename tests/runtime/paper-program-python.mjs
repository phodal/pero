// Full real Host/Harness/AppUse/Python Paper journey; only model decisions and source PDF are synthetic.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { copyFile, cp, mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '../..');
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = process.env.PERO_RESEARCH_HOST || join(root, `target/research-validation/debug/pero-host${suffix}`);
const agent = process.env.PERO_RESEARCH_AGENT || join(root, `target/debug/pero-agent-acp${suffix}`);
const python = process.env.PERO_RESEARCH_PYTHON || execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
const directory = await realpath(await mkdtemp(join(tmpdir(), 'pero-paper-python-')));
const keepProfile = process.env.PERO_RESEARCH_KEEP_PROFILE === '1';
const output = join(root, 'test-results/paper-program-python');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2));
const events = [], requests = [], errors = [], calls = [], questions = [], deliveries = [], passages = [], reportIds = [];
const changed = new EventEmitter();
const gaps = ['Does the method tolerate model mismatch?', 'Which bounded correction restores the result?', 'Independent replication remains missing.'];
const skill = (await readFile(join(root, 'apps/paper-agent/agent-plugins/paper-autoresearch/SKILL.md'), 'utf8')).trim();
let host, hostExit, desktop, server, access, seed, run, sequence = 0, stderr = '';
let round = 1, state, study, passage, reportId, stage = 'start', awaiting, pendingContent, contentReads = 0;
let receipt;

async function wait(predicate, after = 0) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const found = events.slice(after).find(predicate); if (found) return found;
    const remaining = deadline - Date.now();
    assert(remaining > 0, `Host timeout: ${stderr}; provider: ${errors.join('; ')}`);
    await new Promise((accept, reject) => {
      const listener = () => { clearTimeout(timer); accept(); };
      const timer = setTimeout(() => { changed.off('change', listener); reject(Error(`Host timeout: ${stderr}; provider: ${errors.join('; ')}; events: ${events.slice(-5).map(e => e.kind).join(',')}`)); }, remaining);
      changed.once('change', listener);
    });
  }
}
async function appRequest(action, fields = {}) {
  const id = `python-program-${++sequence}`;
  host.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
  const event = await wait(event => event.kind === 'apps_result' && event.request_id === id);
  assert(event.data.ok, event.data.error); return event.data.value;
}
async function backendRead(value) {
  const response = await fetch(access.backend.url + '/api/programs', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': access.backend.token }, body: JSON.stringify(value) });
  const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result;
}
function call(name, document, nextStage = name) {
  const id = `python-tool-${calls.length + 1}`;
  calls.push({ id, name, document, round });
  awaiting = { id, stage: nextStage };
  return { tool_calls: [{ index: 0, id, type: 'function', function: {
    name: name === 'content_read' ? 'mcp__pero-app-use__content_read' : `mcp__pero-app-use__app__paper-agent__${name}`,
    arguments: JSON.stringify(document),
  } }] };
}
function program(operation, fields = {}) {
  return call('research-program', { operation, ...(operation === 'read' ? {} : {
    expectedCheckpoint: state.checkpoint, operationId: `round-${round}-${operation}-${calls.length + 1}`,
  }), ...fields }, operation === 'study-step' ? fields.document.action : operation);
}
function advance(result, previousStage) {
  assert(result && typeof result === 'object', `invalid ${previousStage} result`);
  if (previousStage === 'read') {
    state = result;
    const question = round === 1 ? 'What assumptions does the original source make?' : state.gaps[0];
    if (round > 1) assert.equal(question, gaps[round - 2]);
    questions.push(question);
    return program('prepare-study', { candidateIds: [state.candidates[0].id], question });
  }
  if (previousStage === 'prepare-study') {
    state = result; study = result.study.id;
    return program('study-step', { document: { studyId: study, action: 'read', paperId: seed.paperId, page: round } });
  }
  if (previousStage === 'source-read') {
    state = result; passage = result.result.observation.passages[0];
    assert(passage.content.includes(seed.pages[round - 1])); passages.push(passage.id);
    return program('study-step', { document: { studyId: study, action: 'finalize', report: {
      title: `Observed source round ${round}`, sections: [{ heading: 'Finding', content: passage.content,
        paperIds: [seed.paperId], evidence: [{ paperId: seed.paperId, passageId: passage.id, quote: passage.content }] }],
      limitations: 'Synthetic source; exact citation is not scientific verification.',
    } } });
  }
  if (previousStage === 'finalize') {
    state = result; reportId = result.result.reportId; reportIds.push(reportId);
    return program('commit-round', { question: questions.at(-1), reportIds: [reportId], claims: [{
      text: passage.content, stance: round === 2 ? 'counterevidence' : 'support', reportId,
      paperId: seed.paperId, passageId: passage.id, evidenceIndex: 0,
    }], gaps: [gaps[round - 1]], nextAction: round < 3 ? gaps[round - 1] : 'Review the completed three-round evidence.' });
  }
  if (previousStage === 'commit-round') {
    state = result;
    assert.equal(state.usage.rounds, round);
    return call('research-deliver', { checkpoint: state.checkpoint }, 'deliver');
  }
  if (previousStage === 'deliver') {
    assert.equal(result.artifacts.length, 4); deliveries.push(result);
    stage = round++ < 3 ? 'resume' : 'done';
    return { content: 'This reading round is complete.' };
  }
  throw Error(`unexpected scripted stage ${previousStage}`);
}

try {
  await mkdir(output, { recursive: true });
  await rm(join(output, 'result.json'), { force: true });
  await build({ stdin: { contents: "export { DesktopAppUse } from './desktop/src/main/app-use-mcp.ts'; export { AppWriteRoutes } from './desktop/src/main/app-write-routes.ts';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: join(directory, 'adapter.mjs') });
  const { DesktopAppUse, AppWriteRoutes } = await import(pathToFileURL(join(directory, 'adapter.mjs')).href);
  server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw); requests.push(input); assert(requests.length <= 60);
      assert(input.messages.some(message => typeof message.content === 'string' && message.content.includes(skill)), 'the installed Paper Skill did not reach the model');
      assert((input.tools || []).every(tool => tool.function.name.startsWith('mcp__pero-app-use__')), 'research mode exposed another tool family');
      let delta;
      if (awaiting) {
        const previous = awaiting; awaiting = null;
        const tool = input.messages.findLast(message => message.role === 'tool' && message.tool_call_id === previous.id);
        assert(tool, `missing real result for ${previous.id}`);
        if (previous.stage === 'content') {
          assert(/^Content [a-f0-9]{64}, bytes \d+\.\.\d+ of \d+\.\n/.test(tool.content), tool.content.slice(0, 300));
          const boundary = tool.content.lastIndexOf('\n');
          const footer = tool.content.slice(boundary + 1);
          pendingContent.text += tool.content.slice(tool.content.indexOf('\n') + 1, boundary);
          if (footer.startsWith('Next read: ')) {
            contentReads++; delta = call('content_read', JSON.parse(footer.slice('Next read: '.length)), 'content');
          }
          else {
            assert.equal(footer, 'End of selection.');
            const pending = pendingContent; pendingContent = null;
            delta = advance(JSON.parse(pending.text), pending.stage);
          }
        } else {
          assert(tool.content.trim().startsWith('{'), `real ${previous.stage} tool failed: ${tool.content}`);
          const envelope = JSON.parse(tool.content);
          if (envelope.type === 'content_reference') {
            pendingContent = { stage: previous.stage, text: '' }; contentReads++;
            delta = call('content_read', { id: envelope.artifact.id, pointer: '/result', maxBytes: 16384 }, 'content');
          } else {
            assert(envelope.result, `tool ${previous.stage} failed: ${tool.content}`);
            delta = advance(envelope.result, previous.stage);
          }
        }
      } else {
        assert(['start', 'resume'].includes(stage), `unexpected model request after ${stage}`);
        if (stage === 'resume') assert(JSON.stringify(input.messages).includes('continue'), 'normal stop did not receive runtime feedback');
        delta = program('read');
      }
      // Distinguish the Study read from the program read while preserving the real operation schema.
      if (awaiting?.stage === 'read' && calls.at(-1).document.operation === 'study-step') awaiting.stage = 'source-read';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(String(error)); response.writeHead(500).end('Scripted model assertion failed'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const provider = `http://127.0.0.1:${server.address().port}`;
  const source = join(directory, 'source'); await mkdir(join(source, 'dist'), { recursive: true });
  await writeFile(join(source, 'dist/index.html'), '<h1>Real Python Paper integration</h1>');
  await copyFile(join(root, 'tests/runtime/paper-program-python-backend.py'), join(source, 'backend.py'));
  await copyFile(join(root, 'tests/runtime/paper-program-python-launcher.mjs'), join(source, 'server.mjs'));
  await cp(join(root, 'apps/paper-agent/agent-plugins'), join(source, 'agent-plugins'), { recursive: true });
  await json(join(source, 'fixture.json'), { python, backend: join(root, 'apps/paper-agent/backend') });
  const actual = JSON.parse(await readFile(join(root, 'apps/paper-agent/app.json'), 'utf8'));
  const names = ['research-program', 'research-search', 'research-acquire', 'research-deliver'];
  const writes = actual.contributes.writes.filter(route => names.includes(route.name)); assert.equal(writes.length, 4);
  await json(join(source, 'app.json'), { schemaVersion: 1, name: 'paper-agent', version: '1', displayName: 'Real Paper backend fixture',
    permissions: { host: ['agent', 'agent-plugin'], events: ['chat:closed'] }, requiresAgentPlugins: actual.requiresAgentPlugins, backend: { type: 'node', entry: 'server.mjs' }, contributes: {
      panels: [{ id: 'main', title: 'Research', entry: 'dist/index.html' }], writes,
      agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: 'Ordinary Paper fixture', tools: names, maxCalls: 1 },
    } });
  await json(join(directory, 'agents.json'), [{ id: 'pero', name: 'Real Go Harness', command: agent,
    args: ['--endpoint', provider + '/v1', '--model', 'fixture', '--session-dir', join(directory, 'sessions'),
      '--api-key-env', 'PAPER_PROGRAM_FIXTURE_KEY', '--approval', 'ask', '--max-retries', '0', '--max-requests', '64',
      '--max-turn-steps', '64', '--max-tokens', '4096'], env: {} }]);
  desktop = new DesktopAppUse({ selectedThread: async () => 'unrelated-visible-chat', presence() {},
    page: async () => { throw Error('No UI'); }, capture: async () => { throw Error('No capture'); } }, () => {},
    join(directory, 'evidence'), new AppWriteRoutes(appRequest, () => {}, fetch));
  const endpoint = await desktop.start();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_') && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  host = spawn(binary, ['--stdio'], { cwd: directory, env: { ...env, ...endpoint, PAPER_PROGRAM_FIXTURE_KEY: 'local-fixture',
    PERO_AGENTS_FILE: join(directory, 'agents.json'), PERO_APPS_ROOT: join(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '',
    PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_ENV_FILE: join(directory, 'no-env'),
    PERO_SETTINGS_PATH: join(directory, 'settings.json'), PERO_HISTORY_PATH: join(directory, 'history.jsonl'), UV_OFFLINE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  hostExit = once(host, 'exit'); host.stderr.on('data', chunk => { stderr += String(chunk); });
  createInterface({ input: host.stdout }).on('line', line => { const event = JSON.parse(line); desktop.accept(event); events.push(event); changed.emit('change'); });
  await wait(event => event.kind === 'ready');
  await appRequest('install', { path: source }); await appRequest('enable', { name: 'paper-agent' });
  access = await appRequest('resolve', { name: 'paper-agent' });
  seed = JSON.parse(await readFile(join(directory, 'app-data/paper-agent/fixture-seed.json'), 'utf8'));
  const catalog = await appRequest('agentcatalog', { name: 'paper-agent', path: '/api/workspaces' });
  run = await appRequest('agentrun', { name: 'paper-agent', request: { operation: 'start', scope: { workspaceId: catalog.items[0].workspaceId },
    requestId: seed.context.programId, harnessId: 'pero', text: 'Perform the saved three-round reading plan.', context: seed.context } });
  const created = await wait(event => event.kind === 'session_created' && event.thread_id === run.sessionId);
  assert(created.data.agentPlugins.some(plugin => plugin.name === 'paper-autoresearch'));
  const finished = await wait(event => event.thread_id === run.sessionId && ['turn_finished', 'session_error'].includes(event.kind));
  assert.equal(finished.kind, 'turn_finished', JSON.stringify(finished));
  assert.deepEqual(errors, []);
  assert.equal(stage, 'done', 'program ended before three complete rounds');
  await wait(event => {
    if (event.kind !== 'artifact_registered' || event.thread_id !== run.sessionId) return false;
    const latest = new Map(events.filter(item => item.kind === 'artifact_registered' && item.thread_id === run.sessionId)
      .map(item => [item.data.artifact.id, item.data.artifact]));
    return latest.size === 4 && [...latest.values()].every(artifact => artifact.versions.length === 4);
  });
  assert.equal(events.filter(event => event.kind === 'session_created' && event.thread_id === run.sessionId).length, 1);
  assert.equal(events.filter(event => event.kind === 'turn_started' && event.thread_id === run.sessionId).length, 1);
  assert.equal(requests.length, 21 + contentReads);
  assert.deepEqual(questions.slice(1), gaps.slice(0, 2));
  assert.equal(new Set(passages).size, 3);
  const current = await backendRead({ operation: 'read', programId: seed.context.programId });
  assert.equal(current.usage.rounds, 3); assert.equal(current.stopReason, 'round_limit');
  assert.equal(current.runtime.status, 'completed');
  const saved = JSON.parse(await readFile(join(directory, 'settings.artifacts', sha(run.sessionId), 'catalog.json'), 'utf8'));
  assert.equal(saved.length, 4);
  const snapshots = [];
  for (const artifact of saved) {
    assert.equal(artifact.thread_id, run.sessionId); assert.equal(artifact.versions.length, 4);
    for (const version of artifact.versions) {
      const bytes = await readFile(join(directory, 'settings.artifacts', sha(run.sessionId), 'snapshots', version.sha256 + '.bin'));
      assert.equal(sha(bytes), version.sha256);
      const request_id = `python-artifact-${++sequence}`;
      host.stdin.write(JSON.stringify({ method: 'artifacts', action: 'read', request_id,
        thread_id: run.sessionId, artifact_id: artifact.id, version: version.version }) + '\n');
      const document = await wait(event => event.request_id === request_id);
      assert.equal(document.kind, 'artifact_document', JSON.stringify(document));
      assert.equal(document.text, bytes.toString(), 'Host artifact read changed a saved version');
      snapshots.push({ title: artifact.title, version: version.version, content: bytes.toString() });
    }
  }
  const firstReport = snapshots.find(snapshot => snapshot.title === 'research-report.md' && snapshot.version === 1).content;
  const finalReport = snapshots.find(snapshot => snapshot.title === 'research-report.md' && snapshot.version === 4).content;
  assert(firstReport.includes(`/report/${reportIds[0]}/citation/0`)); assert(!firstReport.includes(reportIds[1]));
  for (const id of reportIds) assert(finalReport.includes(`/report/${id}/citation/0`));
  const matrix = JSON.parse(snapshots.find(snapshot => snapshot.title === 'evidence-matrix.json' && snapshot.version === 4).content);
  assert.deepEqual(matrix.claims.map(claim => claim.passageId), passages);
  assert(finalReport.includes('needs_review')); assert(finalReport.includes('round_limit'));
  const audit = await readFile(join(directory, 'settings.research', seed.context.programId, 'model-attempts.log'), 'utf8');
  assert.equal(audit.trim().split('\n').length, requests.length);
  receipt = { passed: true, backend: 'real Python paper_agent.http.handler', model: 'scripted loopback',
    profileDirectory: keepProfile ? directory : null, threadId: run.sessionId, runId: run.id, programId: seed.context.programId,
    rounds: 3, questions, passages, providerRequests: requests.length, contentReads, artifacts: saved.length, versionsPerArtifact: 4,
    noStatusPolling: true, hostSHA256: sha(await readFile(binary)), harnessSHA256: sha(await readFile(agent)),
    limitations: ['Synthetic source and model decisions; no scientific acceptance or desktop UI verification'] };
  await json(join(output, 'evidence.json'), { events, requests, calls, deliveries, current, snapshots });
} catch (error) {
  await mkdir(output, { recursive: true });
  await json(join(output, 'failure.json'), { error: String(error), stderr, errors, events, requests, calls, questions, deliveries, stage,
    seed, current: access && seed ? await backendRead({ operation: 'read', programId: seed.context.programId }).catch(e => String(e)) : null });
  throw error;
} finally {
  // Stop the real App backend while its Host still owns the child process.
  if (access && host && host.exitCode === null) await appRequest('disable', { name: 'paper-agent' });
  if (host && host.exitCode === null) { host.stdin.end(); const timer = setTimeout(() => host.kill('SIGKILL'), 5000); await hostExit; clearTimeout(timer); }
  await desktop?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (!keepProfile) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
await json(join(output, 'result.json'), receipt);
console.log(await readFile(join(output, 'result.json'), 'utf8'));
