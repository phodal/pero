// Real discovery/acquisition workers, pause/restart/resume and durable budgets; all providers are loopback fixtures.
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
const keepProfile = process.env.PERO_RESEARCH_KEEP_PROFILE === '1';
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = process.env.PERO_RESEARCH_HOST || join(root, `target/research-validation/debug/pero-host${suffix}`);
const agent = process.env.PERO_RESEARCH_AGENT || join(root, `target/debug/pero-agent-acp${suffix}`);
const python = process.env.PERO_RESEARCH_PYTHON || execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
const directory = await realpath(await mkdtemp(join(tmpdir(), 'pero-paper-journey-')));
const output = join(root, 'test-results/paper-program-journey');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2));
const skill = (await readFile(join(root, 'apps/paper-agent/agent-plugins/paper-autoresearch/SKILL.md'), 'utf8')).trim();
const events = [], requests = [], calls = [], feedback = [], providerErrors = [], metadataRequests = [];
const changed = new EventEmitter();
let host, hostExit, desktop, server, access, run, scope, seed, pdf, sequence = 0, stderr = '', hostEnv;
let stage = 'start', awaiting, state, candidate, job, study, passage, reportId, pausedResponse, releaseMetadata;
let pendingObservations = 0, pdfRequests = 0, pausedModels, pausedApps, pendingContent, contentReads = 0;

function signal(event) { events.push(event); changed.emit('change'); }
async function wait(predicate, after = 0) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const event = events.slice(after).find(predicate); if (event) return event;
    const remaining = deadline - Date.now();
    assert(remaining > 0, `Host timeout: ${stderr}; ${providerErrors.join('; ')}`);
    await new Promise((accept, reject) => {
      const listener = () => { clearTimeout(timer); accept(); };
      const timer = setTimeout(() => { changed.off('change', listener); reject(Error(`Host timeout: ${stderr}; ${providerErrors.join('; ')}; stage=${stage}`)); }, remaining);
      changed.once('change', listener);
    });
  }
}
async function appRequest(action, fields = {}) {
  const id = `journey-${++sequence}`;
  host.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
  const event = await wait(event => event.kind === 'apps_result' && event.request_id === id);
  assert(event.data.ok, event.data.error);
  if (action === 'research-program' && fields.request?.operation === 'feedback') {
    feedback.push(event.data.value);
    if (stage === 'await-discovery' && event.data.value.pendingJob) {
      pendingObservations++;
      assert.equal(requests.length, 3, 'pending discovery consumed another model request');
      if (pendingObservations >= 3) releaseMetadata?.();
    }
  }
  return event.data.value;
}
async function readProgram() {
  const response = await fetch(access.backend.url + '/api/programs', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': access.backend.token },
    body: JSON.stringify({ operation: 'read', programId: seed.context.programId }) });
  const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value;
}
async function startHost() {
  const after = events.length;
  host = spawn(binary, ['--stdio'], { cwd: directory, env: hostEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  hostExit = once(host, 'exit'); host.stderr.on('data', chunk => { stderr += String(chunk); });
  createInterface({ input: host.stdout }).on('line', line => { const event = JSON.parse(line); desktop.accept(event); signal(event); });
  await wait(event => event.kind === 'ready', after);
}
async function closeHost() {
  if (host?.exitCode === null) {
    host.stdin.end(); const timer = setTimeout(() => host.kill('SIGKILL'), 5000);
    const [code] = await hostExit; clearTimeout(timer); assert.equal(code, 0, stderr);
  }
}
function tool(name, operation, fields, nextStage = operation) {
  const document = { ...(operation ? { operation } : {}),
    ...(!operation || ['read', 'poll'].includes(operation) ? {} : { expectedCheckpoint: state.checkpoint, operationId: `journey-operation-${calls.length + 1}` }), ...fields };
  const id = `journey-tool-${calls.length + 1}`; calls.push({ id, name, document }); awaiting = { id, stage: nextStage };
  return { tool_calls: [{ index: 0, id, type: 'function', function: { name: name === 'content_read' ? 'mcp__pero-app-use__content_read' : `mcp__pero-app-use__app__paper-agent__${name}`, arguments: JSON.stringify(document) } }] };
}
function finalize() {
  return tool('research-program', 'study-step', { document: { studyId: study, action: 'finalize', report: {
    title: 'Newly acquired counterexample', sections: [{ heading: 'Observed counterexample', content: passage.content,
      paperIds: [candidate.paperId], evidence: [{ paperId: candidate.paperId, passageId: passage.id, quote: passage.content }] }],
    limitations: 'Synthetic transport acceptance, not scientific verification.',
  } } }, 'finalize');
}
function advance(result, previousStage, response) {
  state = result;
  switch (previousStage) {
    case 'read': return tool('research-search', 'discover', { query: { seedId: seed.paperId, relation: 'references', page: 1 } });
    case 'discover':
      job = result.job.id; assert.equal(result.job.status, 'running'); stage = 'await-discovery';
      return { content: 'Discovery is pending. Observe its worker before continuing.' };
    case 'discover-poll':
      assert.equal(result.job.status, 'completed'); candidate = result.candidates.find(item => item.sourceId === 'W9');
      assert(candidate && !candidate.paperId && !candidate.documentId, 'new source was already saved');
      return tool('research-program', 'screen', { candidateId: candidate.id, decision: 'include', reason: 'Original counterexample related to the seed.' });
    case 'screen': return tool('research-acquire', 'acquire', { candidateId: candidate.id });
    case 'acquire':
      job = result.job.id; stage = 'await-acquire'; return { content: 'Wait for the approved original PDF acquisition.' };
    case 'acquire-poll':
      assert.equal(result.job.status, 'completed'); candidate = result.candidates.find(item => item.id === candidate.id);
      assert(candidate.paperId && candidate.paperId !== seed.paperId && candidate.documentId);
      return tool('research-program', 'prepare-study', { candidateIds: [candidate.id], question: 'Does the new original refute the seed assumption?' }, 'prepare');
    case 'prepare':
      study = result.study.id;
      return tool('research-program', 'study-step', { document: { studyId: study, action: 'read', paperId: candidate.paperId, page: 1 } }, 'source-read');
    case 'source-read':
      passage = result.result.observation.passages[0];
      assert(passage.content.includes(seed.acquiredText)); assert.equal(passage.fileDigest, seed.acquiredDigest);
      stage = 'paused-provider'; pausedResponse = response; signal({ kind: 'fixture_pause_ready' }); return null;
    case 'resume-read': return finalize();
    case 'finalize':
      reportId = result.result.reportId;
      return tool('research-program', 'commit-round', { question: 'Does the new original refute the seed assumption?', reportIds: [reportId],
        claims: [{ text: passage.content, stance: 'counterevidence', reportId, paperId: candidate.paperId, passageId: passage.id, quote: passage.content }],
        gaps: ['Independent replication is still required.'], nextAction: 'Review the new counterexample.' }, 'round');
    case 'round': assert.equal(result.usage.rounds, 1); return tool('research-deliver', null, { checkpoint: result.checkpoint }, 'deliver');
    case 'deliver': stage = 'done'; assert.equal(result.artifacts.length, 4); return { content: 'The approved research round is saved.' };
    default: throw Error(`unexpected stage ${previousStage}`);
  }
}
const work = id => ({ id: `https://openalex.org/${id}`, display_name: id === 'W1' ? 'Fixed-model seed study' : 'New model mismatch counterexample',
  publication_date: '2026-01-01', cited_by_count: 1, authorships: [], abstract_inverted_index: { Original: [0], counterexample: [1] },
  referenced_works: id === 'W1' ? ['https://openalex.org/W9'] : [],
  primary_location: { landing_page_url: `https://openalex.org/${id}`, pdf_url: id === 'W9' ? 'https://papers.fixture.example/new-paper.pdf' : null },
  best_oa_location: { landing_page_url: `https://openalex.org/${id}`, pdf_url: id === 'W9' ? 'https://papers.fixture.example/new-paper.pdf' : null } });

try {
  await mkdir(output, { recursive: true });
  if (keepProfile) await json(join(output, 'profile.json'), { profileDirectory: directory });
  await build({ stdin: { contents: "export { DesktopAppUse } from './desktop/src/main/app-use-mcp.ts'; export { AppWriteRoutes } from './desktop/src/main/app-write-routes.ts';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: join(directory, 'adapter.mjs') });
  const { DesktopAppUse, AppWriteRoutes } = await import(pathToFileURL(join(directory, 'adapter.mjs')).href);
  server = createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/metadata/')) {
        metadataRequests.push(request.url);
        const url = new URL(request.url, 'http://127.0.0.1');
        const value = url.pathname.endsWith('/W1') ? work('W1') : { results: [work('W9')], meta: { count: 1 } };
        if (url.pathname.endsWith('/W1')) await new Promise(resolve => {
          releaseMetadata = resolve;
          if (pendingObservations >= 3) resolve();
        });
        const body = Buffer.from(JSON.stringify(value)); response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length }); response.end(body); return;
      }
      if (request.url === '/new-paper.pdf') {
        pdfRequests++; assert(pdf); response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length }); response.end(pdf); return;
      }
      assert.equal(request.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw); requests.push(input); assert(requests.length <= 40);
      assert(input.messages.some(message => typeof message.content === 'string' && message.content.includes(skill)));
      let delta;
      if (awaiting) {
        const previous = awaiting; awaiting = null;
        const result = input.messages.findLast(message => message.role === 'tool' && message.tool_call_id === previous.id);
        assert(result, `missing real result for ${previous.id}`);
        if (previous.stage === 'content') {
          assert(/^Content [a-f0-9]{64}, bytes \d+\.\.\d+ of \d+\.\n/.test(result.content), result.content.slice(0, 300));
          const boundary = result.content.lastIndexOf('\n'), footer = result.content.slice(boundary + 1);
          pendingContent.text += result.content.slice(result.content.indexOf('\n') + 1, boundary);
          if (footer.startsWith('Next read: ')) {
            contentReads++; delta = tool('content_read', null, JSON.parse(footer.slice('Next read: '.length)), 'content');
          } else {
            assert.equal(footer, 'End of selection.');
            const pending = pendingContent; pendingContent = null;
            delta = advance(JSON.parse(pending.text), pending.stage, response);
          }
        } else {
          assert(result.content.trim().startsWith('{'), `real tool failed: ${result.content}`);
          const envelope = JSON.parse(result.content);
          if (envelope.type === 'content_reference') {
            pendingContent = { stage: previous.stage, text: '' }; contentReads++;
            delta = tool('content_read', null, { id: envelope.artifact.id, pointer: '/result', maxBytes: 16384 }, 'content');
          } else {
            assert(envelope.result, result.content); delta = advance(envelope.result, previous.stage, response);
          }
        }
        if (!delta) return;
      } else if (stage === 'start') delta = tool('research-program', 'read', {});
      else if (stage === 'await-discovery') delta = tool('research-search', 'poll', { jobId: job }, 'discover-poll');
      else if (stage === 'await-acquire') delta = tool('research-acquire', 'poll', { jobId: job }, 'acquire-poll');
      else if (stage === 'resuming') delta = tool('research-program', 'read', {}, 'resume-read');
      else throw Error(`unexpected model request in ${stage}`);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { providerErrors.push(String(error)); response.writeHead(500).end('Fixture assertion failed'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const provider = `http://127.0.0.1:${server.address().port}`;
  const source = join(directory, 'source'); await mkdir(join(source, 'dist'), { recursive: true });
  await writeFile(join(source, 'dist/index.html'), '<h1>Real discovery and restart acceptance</h1>');
  for (const [original, target] of [['paper-program-python-launcher.mjs', 'server.mjs'], ['paper-program-journey-backend.py', 'backend.py'], ['paper-program-journey-worker.py', 'worker.py']])
    await copyFile(join(root, 'tests/runtime', original), join(source, target));
  await cp(join(root, 'apps/paper-agent/agent-plugins'), join(source, 'agent-plugins'), { recursive: true });
  await json(join(source, 'fixture.json'), { python, backend: join(root, 'apps/paper-agent/backend'), provider });
  const actual = JSON.parse(await readFile(join(root, 'apps/paper-agent/app.json'), 'utf8'));
  const names = ['research-program', 'research-search', 'research-acquire', 'research-deliver'];
  await json(join(source, 'app.json'), { schemaVersion: 1, name: 'paper-agent', version: '1', displayName: 'Paper journey fixture',
    permissions: { host: ['agent', 'agent-plugin'], events: ['chat:closed'] }, requiresAgentPlugins: actual.requiresAgentPlugins, backend: { type: 'node', entry: 'server.mjs' },
    contributes: { panels: [{ id: 'main', title: 'Research', entry: 'dist/index.html' }], writes: actual.contributes.writes.filter(route => names.includes(route.name)),
      agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: 'Ordinary Paper fixture', tools: names, maxCalls: 1 } } });
  await json(join(directory, 'agents.json'), [{ id: 'pero', name: 'Real Go Harness', command: agent, args: ['--endpoint', provider + '/v1', '--model', 'fixture', '--session-dir', join(directory, 'sessions'),
    '--api-key-env', 'PAPER_PROGRAM_FIXTURE_KEY', '--approval', 'ask', '--max-retries', '0', '--max-requests', '64', '--max-turn-steps', '64', '--max-tokens', '4096'], env: {} }]);
  desktop = new DesktopAppUse({ selectedThread: async () => 'other-visible-chat', presence() {}, page: async () => { throw Error('No UI'); }, capture: async () => { throw Error('No capture'); } },
    () => {}, join(directory, 'evidence'), new AppWriteRoutes(appRequest, () => {}, fetch));
  const endpoint = await desktop.start();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_') && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  hostEnv = { ...env, ...endpoint, PAPER_PROGRAM_FIXTURE_KEY: 'local-fixture', PERO_AGENTS_FILE: join(directory, 'agents.json'), PERO_APPS_ROOT: join(directory, 'apps'),
    PERO_BUILTIN_APPS_ROOT: '', PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_ENV_FILE: join(directory, 'no-env'), PERO_SETTINGS_PATH: join(directory, 'settings.json'), PERO_HISTORY_PATH: join(directory, 'history.jsonl'), UV_OFFLINE: '1' };
  await startHost(); await appRequest('install', { path: source }); await appRequest('enable', { name: 'paper-agent' });
  access = await appRequest('resolve', { name: 'paper-agent' });
  seed = JSON.parse(await readFile(join(directory, 'app-data/paper-agent/fixture-seed.json'), 'utf8'));
  pdf = await readFile(join(directory, 'app-data/paper-agent/fixture-new.pdf'));
  const catalog = await appRequest('agentcatalog', { name: 'paper-agent', path: '/api/workspaces' }); scope = { workspaceId: catalog.items[0].workspaceId };
  run = await appRequest('agentrun', { name: 'paper-agent', request: { operation: 'start', scope, requestId: seed.context.programId, harnessId: 'pero', text: 'Find and read an original counterexample.', context: seed.context } });
  const created = await wait(event => event.kind === 'session_created' && event.thread_id === run.sessionId);
  assert(created.data.agentPlugins.some(plugin => plugin.name === 'paper-autoresearch'));
  const ready = await wait(event => event.kind === 'session_ready' && event.thread_id === run.sessionId);
  await wait(event => event.kind === 'fixture_pause_ready');
  assert.equal(pdfRequests, 1); assert(pendingObservations >= 3); assert.deepEqual(providerErrors, []);
  const ledger = join(directory, 'settings.research', seed.context.programId);
  pausedModels = await readFile(join(ledger, 'model-attempts.log'), 'utf8'); pausedApps = await readFile(join(ledger, 'app-calls.log'), 'utf8');
  const responseClosed = once(pausedResponse, 'close'); const cancelAfter = events.length;
  await appRequest('agentrun', { name: 'paper-agent', request: { operation: 'cancel', scope, runId: run.id } });
  const cancelled = await wait(event => event.kind === 'turn_finished' && event.thread_id === run.sessionId, cancelAfter);
  assert.equal(cancelled.data.stopReason, 'cancelled'); await responseClosed;
  await wait(event => {
    if (event.kind !== 'artifact_registered' || event.thread_id !== run.sessionId) return false;
    return new Set(events.filter(item => item.kind === 'artifact_registered' && item.thread_id === run.sessionId)
      .map(item => item.data.artifact.id)).size === 4;
  });
  await closeHost(); desktop.reset();
  const restartAfter = events.length; stage = 'resuming'; await startHost();
  access = await appRequest('resolve', { name: 'paper-agent' });
  const resumed = await appRequest('agentrun', { name: 'paper-agent', request: { operation: 'retry', scope, runId: run.id, requestId: 'resume-after-host-restart', text: 'Continue the saved original reading and complete its round.' } });
  assert.equal(resumed.id, run.id); assert.equal(resumed.attempt, 2);
  const resumedReady = await wait(event => event.kind === 'session_ready' && event.thread_id === run.sessionId, restartAfter);
  assert.equal(resumedReady.data.sessionId, ready.data.sessionId, 'restart created another ACP session');
  const finished = await wait(event => event.thread_id === run.sessionId && ['turn_finished', 'session_error'].includes(event.kind), restartAfter);
  assert.equal(finished.kind, 'turn_finished', JSON.stringify(finished)); assert.equal(finished.data.stopReason, 'end_turn');
  assert.equal(stage, 'done'); assert.deepEqual(providerErrors, []);
  await wait(event => {
    if (event.kind !== 'artifact_registered' || event.thread_id !== run.sessionId) return false;
    const latest = new Map(events.filter(item => item.kind === 'artifact_registered' && item.thread_id === run.sessionId).map(item => [item.data.artifact.id, item.data.artifact]));
    return latest.size === 4 && [...latest.values()].every(artifact => artifact.versions.length === 3);
  }, restartAfter);
  const modelAudit = await readFile(join(ledger, 'model-attempts.log'), 'utf8'), appAudit = await readFile(join(ledger, 'app-calls.log'), 'utf8');
  assert(modelAudit.startsWith(pausedModels) && modelAudit.length > pausedModels.length); assert(appAudit.startsWith(pausedApps) && appAudit.length > pausedApps.length);
  assert.equal(modelAudit.trim().split('\n').length, requests.length);
  const current = await readProgram();
  assert.equal(current.usage.searches, 1); assert.equal(current.usage.downloads, 1); assert.equal(current.usage.downloadBytes, pdf.length);
  assert.equal(current.usage.rounds, 1); assert.equal(current.stopReason, 'round_limit'); assert.equal(current.runtime.status, 'completed');
  assert.equal(pdfRequests, 1, 'resume downloaded the original again');
  const original = await readFile(join(directory, 'app-data/paper-agent/research-v1/pdf-files', seed.acquiredDigest + '.pdf'));
  assert.deepEqual(original, pdf);
  const saved = JSON.parse(await readFile(join(directory, 'settings.artifacts', sha(run.sessionId), 'catalog.json'), 'utf8'));
  for (const artifact of saved) for (const version of artifact.versions) {
    const request_id = `journey-artifact-${++sequence}`;
    host.stdin.write(JSON.stringify({ method: 'artifacts', action: 'read', request_id, thread_id: run.sessionId, artifact_id: artifact.id, version: version.version }) + '\n');
    const document = await wait(event => event.request_id === request_id); assert.equal(document.kind, 'artifact_document', JSON.stringify(document));
    assert.equal(sha(document.text), version.sha256);
    if (artifact.title === 'research-report.md' && version.version === 3) assert(document.text.includes(passage.id));
  }
  const report = { passed: true, profileDirectory: keepProfile ? directory : undefined, threadId: run.sessionId, runId: run.id,
    programId: seed.context.programId, sameACPsession: ready.data.sessionId, providerRequests: requests.length, contentReads, pendingObservations,
    newPDFDownloads: pdfRequests, newPDFBytes: pdf.length, resumedAttempts: 2, modelRequestsBeforePause: pausedModels.trim().split('\n').length,
    modelRequestsAfterResume: requests.length, artifactCount: saved.length, versionsPerArtifact: 3, noStatusPolling: true,
    hostSHA256: sha(await readFile(binary)), harnessSHA256: sha(await readFile(agent)),
    limitations: ['Synthetic OpenAlex/PDF provider responses and model decisions; real Python worker/transport parsing, Host/Harness and persistence', 'No scientific or desktop UI acceptance'] };
  await json(join(output, 'result.json'), report); await json(join(output, 'evidence.json'), { events, requests, calls, feedback, current, metadataRequests, pausedModels, modelAudit, pausedApps, appAudit });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await mkdir(output, { recursive: true });
  await json(join(output, 'failure.json'), { error: String(error), profileDirectory: keepProfile ? directory : undefined, stderr, providerErrors, stage, events, requests, calls, feedback, metadataRequests,
    pendingObservations, pdfRequests, current: access && seed ? await readProgram().catch(error => String(error)) : null,
    workerTrace: seed && job ? await readFile(join(directory, 'app-data/paper-agent/research-v1/programs', seed.context.programId, 'jobs', job, 'fixture-worker.jsonl'), 'utf8').catch(error => String(error)) : null });
  throw error;
} finally {
  releaseMetadata?.();
  if (host?.exitCode === null) await closeHost();
  await desktop?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (!keepProfile) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
