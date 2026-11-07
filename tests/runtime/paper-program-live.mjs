// Opt-in real provider qualification. Keep credentials in inherited process memory only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { waitForResearchFinalization } from './research-quality/finalization.mjs';
import { researchExecutablePaths, researchPreflight, researchTarget } from './research-quality/preflight.mjs';
import { shutdownResearchRun } from './research-quality/shutdown.mjs';

const root = resolve(import.meta.dirname, '../..');
if (process.argv.includes('--preflight')) {
  const report = researchPreflight(root);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.localPrerequisitesReady ? 0 : 1);
}
assert.equal(process.env.PERO_RESEARCH_LIVE, '1', 'Explicit PERO_RESEARCH_LIVE=1 required');
assert(process.env.DEEPSEEK_API_KEY, 'Configure the existing Pero provider first');
const { model, provider } = researchTarget(process.env);
const directory = join(root, 'test-results/paper-program-live', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2));
const paths = researchExecutablePaths(root, process.env);
const binary = paths.host;
const agent = paths.agent;
const python = paths.python || execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
const benchmark = JSON.parse(await readFile(join(root, 'tests/runtime/research-quality/cases.json'), 'utf8'));
const caseId = process.env.PERO_RESEARCH_CASE || 'attention-parallelism';
const task = benchmark.cases.find(task => task.id === caseId);
assert(task, 'Unknown PERO_RESEARCH_CASE');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await json(join(directory, 'benchmark.json'), benchmark);
const events = [], changed = new EventEmitter();
let host, hostExit, desktop, access, seed, run, startedAt, sequence = 0, stderr = '';
const redact = value => typeof value === 'string' ? value.replaceAll(process.env.DEEPSEEK_API_KEY, '[REDACTED]')
  : Array.isArray(value) ? value.map(redact)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)])) : value;
const sha = data => createHash('sha256').update(data).digest('hex');
const evaluationCode = {};
for (const name of ['paper-program-live.mjs', 'paper-program-live-backend.py', 'paper-program-quality.py', 'research_quality.py', 'research-quality/finalization.mjs', 'research-quality/preflight.mjs', 'research-quality/shutdown.mjs']) {
  evaluationCode[name] = sha(await readFile(join(root, 'tests/runtime', name)));
}
async function wait(predicate, seconds = 45) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const event = events.find(predicate); if (event) return event;
    const remaining = deadline - Date.now(); assert(remaining > 0, 'Host event deadline');
    await new Promise((done, reject) => {
      const listener = () => { clearTimeout(timer); done(); };
      const timer = setTimeout(() => { changed.off('change', listener); reject(Error('Host event deadline')); }, remaining);
      changed.once('change', listener);
    });
  }
}
async function appRequest(action, fields = {}) {
  const id = `live-${++sequence}`;
  host.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
  const event = await wait(event => event.kind === 'apps_result' && event.request_id === id);
  assert(event.data.ok, event.data.error); return event.data.value;
}
async function readProgram(signal) {
  let current, rounds = [], roundOffset = 0;
  do {
    const response = await fetch(access.backend.url + '/api/programs', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': access.backend.token },
      body: JSON.stringify({ operation: 'read', programId: seed.context.programId, checkpoint: current?.checkpoint, roundOffset, roundLimit: 4, limit: 50 }) });
    assert(response.ok); const page = await response.json();
    if (current) assert.equal(page.checkpoint, current.checkpoint, 'Checkpoint changed during export');
    current ??= page; rounds.push(...page.rounds); roundOffset = page.roundPage.nextOffset;
  } while (roundOffset !== null);
  assert.equal(rounds.length, current.roundPage.total);
  assert.equal(current.candidatePage.nextOffset, null, 'Candidate export is incomplete');
  return { ...current, rounds };
}
try {
  const { build } = await import('esbuild');
  await build({ stdin: { contents: "export { DesktopAppUse } from './desktop/src/main/app-use-mcp.ts'; export { AppWriteRoutes } from './desktop/src/main/app-write-routes.ts';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: join(directory, 'adapter.mjs') });
  const { DesktopAppUse, AppWriteRoutes } = await import(pathToFileURL(join(directory, 'adapter.mjs')).href);
  const source = join(directory, 'source'); await mkdir(join(source, 'dist'), { recursive: true });
  await writeFile(join(source, 'dist/index.html'), '<h1>Opt-in live research qualification</h1>');
  await copyFile(join(root, 'tests/runtime/paper-program-live-backend.py'), join(source, 'backend.py'));
  await copyFile(join(root, 'tests/runtime/paper-program-python-launcher.mjs'), join(source, 'server.mjs'));
  await cp(join(root, 'apps/paper-agent/agent-plugins'), join(source, 'agent-plugins'), { recursive: true });
  await json(join(source, 'fixture.json'), { python, backend: join(root, 'apps/paper-agent/backend'),
    task: { question: task.question, scope: task.scope, seed: benchmark.sources.find(source => source.id === task.seed) } });
  const actual = JSON.parse(await readFile(join(root, 'apps/paper-agent/app.json'), 'utf8'));
  const names = ['research-program', 'research-search', 'research-acquire', 'research-deliver'];
  await json(join(source, 'app.json'), { schemaVersion: 1, name: 'paper-agent', version: '1', displayName: 'Live Paper qualification',
    permissions: { host: ['agent', 'agent-plugin'] }, requiresAgentPlugins: actual.requiresAgentPlugins,
    backend: { type: 'node', entry: 'server.mjs' }, contributes: { panels: [{ id: 'main', title: 'Research', entry: 'dist/index.html' }],
      writes: actual.contributes.writes.filter(route => names.includes(route.name)),
      agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: 'Use the approved plan.', tools: names, maxCalls: 1 } } });
  await json(join(directory, 'agents.json'), [{ id: 'pero', name: 'Pero live research', command: agent,
    args: ['--endpoint', provider.href, '--model', model,
      '--session-dir', join(directory, 'sessions'), '--api-key-env', 'DEEPSEEK_API_KEY', '--approval', 'ask',
      '--max-retries', '0', '--max-requests', '60', '--max-turn-steps', '100', '--max-tokens', '4096'], env: {} }]);
  desktop = new DesktopAppUse({ selectedThread: async () => 'unrelated-chat', presence() {},
    page: async () => { throw Error('No UI'); }, capture: async () => { throw Error('No UI'); } }, () => {},
    join(directory, 'evidence'), new AppWriteRoutes(appRequest, () => {}, fetch));
  const endpoint = await desktop.start();
  host = spawn(binary, ['--stdio'], { cwd: directory, windowsHide: true, env: { ...process.env, ...endpoint,
    PERO_AGENTS_FILE: join(directory, 'agents.json'), PERO_APPS_ROOT: join(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '',
    PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_ENV_FILE: join(directory, 'no-env'), UV_OFFLINE: '1',
    PERO_SETTINGS_PATH: join(directory, 'settings.json'), PERO_HISTORY_PATH: join(directory, 'history.jsonl') }, stdio: ['pipe', 'pipe', 'pipe'] });
  hostExit = once(host, 'exit'); host.stderr.on('data', chunk => { stderr += String(chunk); });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line); desktop.accept(event); events.push(event); changed.emit('change');
    if (['tool_call', 'turn_finished', 'session_error', 'artifact_registered'].includes(event.kind))
      console.log(JSON.stringify({ event: event.kind, text: event.text?.slice(0, 140) }));
  });
  await wait(event => event.kind === 'ready');
  await appRequest('install', { path: source }); access = await appRequest('resolve', { name: 'paper-agent', panel: 'main' });
  seed = JSON.parse(await readFile(join(directory, 'app-data/paper-agent/fixture-seed.json'), 'utf8'));
  const catalog = await appRequest('agentcatalog', { name: 'paper-agent', path: '/api/workspaces' });
  startedAt = Date.now();
  run = await appRequest('agentrun', { name: 'paper-agent', request: { operation: 'start', scope: { workspaceId: catalog.items[0].workspaceId },
    requestId: 'live-approved-plan', harnessId: 'pero', text: 'Execute the approved three-round research program. Acquire the seed original, discover and read at least one new relevant paper, actively seek counterevidence, and deliver the saved evidence. Do not declare success on metadata alone.', context: seed.context } });
  console.log(JSON.stringify({ started: true, directory, model, session: run.sessionId }));
  const finished = await wait(event => event.thread_id === run.sessionId && ['turn_finished', 'session_error'].includes(event.kind), 760);
  await appRequest('agentrun', { name: 'paper-agent', request: { operation: 'status', scope: run.scope, runId: run.id } });
  const { current, artifacts: finalArtifacts } = await waitForResearchFinalization({
    readProgram, programId: seed.context.programId, sessionId: run.sessionId, events: () => events,
    signal: AbortSignal.timeout(45_000),
    readExport: async (checkpoint, signal) => {
      const response = await fetch(access.backend.url + '/api/programs', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': access.backend.token },
        body: JSON.stringify({ operation: 'export', programId: seed.context.programId, checkpoint }) });
      assert(response.ok); return response.json();
    },
  });
  const claims = current.rounds.flatMap(round => round.claims);
  const report = { mode: 'real-provider', caseId, model, provider: provider.origin, revision, sessionId: run.sessionId,
    startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt, evaluationCode, generationConfig: { maxRequests: 60, maxTurnSteps: 100, maxTokens: 4096, maxRetries: 0 }, termination: finished.kind, rounds: current.usage.rounds,
    searches: current.usage.searches, downloads: current.usage.downloads, claims: claims.length,
    claimPapers: new Set(claims.map(claim => claim.paperId)).size,
    counterevidenceOrLimitations: claims.filter(claim => claim.stance !== 'support').length,
    stopReason: current.stopReason, runtime: current.runtime,
    artifacts: finalArtifacts.length, finalArtifacts,
    hostSHA256: sha(await readFile(binary)), harnessSHA256: sha(await readFile(agent)) };
  report.executionChecks = { passed: finished.kind === 'turn_finished' && current.runtime?.status === 'completed' &&
    report.rounds === 3 && report.claimPapers >= 2 && report.searches > 0 && report.artifacts >= 4 };
  report.scientificAcceptance = 'needs_independent_human_review';
  await json(join(directory, 'result.json'), report);
  await json(join(directory, 'evidence.json'), redact({ current, events }));
  execFileSync(python, [join(root, 'tests/runtime/paper-program-quality.py'), 'collect', directory], { cwd: root, stdio: 'inherit' });
  console.log(JSON.stringify(report, null, 2));
  if (!report.executionChecks.passed) process.exitCode = 1;
} catch (error) {
  await json(join(directory, 'failure.json'), redact({ error: String(error), stderr, events }));
  throw error;
} finally {
  await shutdownResearchRun({ host, hostExit, desktop,
    disableApp: access ? () => appRequest('disable', { name: 'paper-agent' }) : undefined });
}
