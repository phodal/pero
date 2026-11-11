// #200 P3: explicit real skills -> real tools -> existing durable artifact owner.
// Public Git is opt-in. Provider decisions alone are a deterministic fixture.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once, EventEmitter} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile, rm, realpath} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {DesktopAppUse} from '../../desktop/src/main/app-use-mcp.ts';
import {HostArtifactDelivery} from '../../desktop/src/main/artifact-delivery.ts';
import {mixedProvider} from './skills-mixed-provider.mjs';

assert.equal(process.env.PERO_SKILLS_MARKET_PUBLIC, '1', 'Set PERO_SKILLS_MARKET_PUBLIC=1 for the two pinned public Git sources');
const root = resolve(import.meta.dirname, '../..');
const binary = process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host');
const harness = process.env.PERO_SKILLS_HARNESS_PATH || join(root, 'target/debug/pero-agent-acp');
const python = process.env.PERO_SKILLS_PYTHON || 'python3';
const outputRoot = join(root, 'test-results/skills-market/mixed-host');
await mkdir(outputRoot, {recursive: true});
const directory = await realpath(await mkdtemp(join(outputRoot, 'run-')));
const workspace = join(directory, 'workspace'); await mkdir(workspace);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const thread = 'skills-mixed-task';
const events = [], errors = [], approvals = [], changed = new EventEmitter();
const pendingCalls = new Map();
let host, exited, stderr = '', sequence = 0;
const source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const evidence = {thread, source, sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim()),
  hostSHA256: sha(await readFile(binary)), harnessSHA256: sha(await readFile(harness)), inputs: []};
for (const name of ['brief.md', 'measurements.csv']) {
  const content = await readFile(join(root, 'tests/fixtures/skills-mixed', name));
  await writeFile(join(workspace, name), content);
  evidence.inputs.push({path: name, sha256: sha(content)});
}
const provider = await mixedProvider(root, python, evidence);
function send(command) {desktop.command(command); host.stdin.write(JSON.stringify(command) + '\n');}
const delivery = new HostArtifactDelivery(command => send(command));
const desktop = new DesktopAppUse({selectedThread: async () => thread, presence() {},
  page: async () => {throw Error('No UI authority');}, capture: async () => {throw Error('No capture authority');}},
  () => {}, join(directory, 'app-evidence'), undefined, undefined, delivery.deliver);
const endpoint = await desktop.start();
async function wait(predicate, start = 0, timeout = 45000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = events.slice(start).find(predicate); if (found) return found;
    const remaining = deadline - Date.now();
    assert(remaining > 0, `Host event timeout: ${stderr}\n${JSON.stringify(events.slice(-4))}\n${provider.errors}`);
    await new Promise((accept, reject) => {
      const listener = () => {clearTimeout(timer); accept();};
      const timer = setTimeout(() => {changed.off('event', listener); reject(Error(`Host event timeout: ${stderr}\n${provider.errors}`));}, remaining);
      changed.once('event', listener);
    });
  }
}
async function apps(action, fields = {}) {
  const id = `mixed-app-${++sequence}`;
  send({method: 'apps', action, id, ...fields});
  const reply = (await wait(event => event.kind === 'apps_result' && event.request_id === id, 0, 330000)).data;
  assert(reply.ok, reply.error); return reply.value;
}
const market = (operation, input = {}) => apps('skillsmarket', {name: 'skills', request: {operation, ...input}});
async function context(action, fields) {
  const request_id = `mixed-context-${++sequence}`;
  send({action, request_id, ...fields});
  const event = await wait(event => event.request_id === request_id);
  assert.notEqual(event.kind, 'context_error', event.text); return event.data;
}
async function start() {
  const before = events.length;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PERO_') && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)));
  host = spawn(binary, ['--stdio'], {cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], env: {...env, ...endpoint,
    MIXED_FIXTURE_KEY: 'skills-p3-fixture', PERO_AGENTS_FILE: join(directory, 'agents.json'),
    PERO_SETTINGS_PATH: join(directory, 'settings.json'), PERO_HISTORY_PATH: join(directory, 'history.jsonl'),
    PERO_APPS_ROOT: join(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '', PERO_REQUIRED_APPS: '',
    PERO_ENV_FILE: join(directory, 'no-env'), PERO_SKILLS_CATALOG: join(root, 'target/skills-p3-catalog.json')}});
  exited = once(host, 'exit');
  host.stderr.on('data', chunk => stderr += chunk);
  createInterface({input: host.stdout}).on('line', line => {
    const event = JSON.parse(line);
    if (!delivery.accept(event)) desktop.accept(event);
    events.push(event);
    if (event.thread_id === thread && event.kind === 'session_update' && event.data.sessionUpdate === 'tool_call')
      pendingCalls.set(event.data.toolCallId, event.data);
    if (event.kind === 'permission') {
      const id = event.data.toolCall?.toolCallId, expected = provider.expected.get(id), observed = pendingCalls.get(id);
      const allowed = event.thread_id === thread && expected && observed && observed.title === expected.name &&
        isDeepStrictEqual(observed.rawInput, expected.args) && !approvals.some(item => item.callId === id);
      const option = event.data.options.find(item => item.kind === (allowed ? 'allow_once' : 'reject_once'));
      approvals.push({callId: id, name: expected?.name, allowed: Boolean(allowed)});
      if (!allowed) errors.push(`Unexpected permission ${id}`);
      send({action: 'permission', thread_id: event.thread_id, request_id: event.data.permission_id, option_id: option?.optionId ?? null});
    }
    changed.emit('event');
  });
  await wait(event => event.kind === 'ready', before);
}
async function stop() {
  if (!host) return;
  host.stdin.end(); const timer = setTimeout(() => host.kill('SIGKILL'), 10000);
  const [code, signal] = await exited; clearTimeout(timer); host = undefined;
  assert.equal(signal, null, stderr); assert.equal(code, 0, stderr);
}
try {
  await json(join(directory, 'agents.json'), [{id: 'pero', name: 'Pero: scripted mixed-task provider', command: harness,
    args: ['--endpoint', provider.endpoint, '--model', 'fixture', '--workspace', '{workspace}',
      '--api-key-env', 'MIXED_FIXTURE_KEY', '--session-dir', join(directory, 'sessions'), '--approval', 'ask',
      '--enable-shell', '--max-retries', '0', '--max-requests', '64'], env: {}}]);
  await json(join(directory, 'settings.json'), {computer_use: {enabled: false}});
  const app = join(directory, 'skills-app'); await mkdir(join(app, 'dist'), {recursive: true});
  await writeFile(join(app, 'dist/index.html'), '<h1>Headless Skills P3 acceptance</h1>');
  await json(join(app, 'app.json'), {schemaVersion: 1, name: 'skills', version: 'fixture', displayName: 'Skills',
    permissions: {host: ['skills']}, contributes: {panels: [{id: 'main', title: 'Skills', entry: 'dist/index.html'}]}});
  await start(); await apps('install', {path: app}); await apps('enable', {name: 'skills'});
  const catalog = await market('catalog'), methods = [], contexts = [];
  for (const id of ['obra/superpowers/skills/verification-before-completion/SKILL.md',
    'K-Dense-AI/scientific-agent-skills/skills/statistical-analysis/SKILL.md']) {
    const entry = catalog.skills.find(item => item.id === id); assert(entry);
    console.log(`Installing ${id}`);
    const installed = (await market('install', {id})).items.find(item => item.id === id);
    assert.equal(installed.enabled, false); assert.equal(installed.revision, entry.source.commit);
    const state = JSON.parse(await readFile(join(directory, 'skill-market/state.json'), 'utf8'));
    const version = state.items[id].versions.find(item => item.revision === entry.source.commit);
    const body = await readFile(join(version.directory, 'source', entry.source.path), 'utf8');
    assert.equal(sha(body), entry.source.sha256);
    const choices = await context('search_context', {kind: 'skill', query: entry.name});
    const choice = choices.find(item => item.source === `pero-market-skill:${id}@${installed.revision}`);
    assert(choice, JSON.stringify(choices));
    const resolved = await context('resolve_context', {kind: 'skill', source: choice.source});
    const marker = body.split('\n').find(line => /^[A-Za-z][A-Za-z ,.;:'()/-]{45,}$/.test(line.trim()))?.trim();
    assert(marker && resolved.content.text.includes(marker));
    contexts.push(resolved);
    methods.push({id, kind: entry.kind, revision: installed.revision, sha256: entry.source.sha256,
      invocation: installed.invocation, contextSource: choice.source, resolvedSHA256: sha(resolved.content.text), marker});
  }
  assert.deepEqual(methods.map(item => item.kind), ['general_skill', 'research_skill']);
  const selection = {methods}; await json(join(workspace, 'skill-selection.json'), selection);
  provider.select(selection);
  const before = events.length;
  send({action: 'new_session', thread_id: thread, agent_id: 'pero'});
  const ready = await wait(event => event.thread_id === thread && ['session_ready', 'session_error'].includes(event.kind), before);
  assert.equal(ready.kind, 'session_ready', ready.text);
  const created = events.slice(before).find(event => event.kind === 'session_created');
  assert(!created.data.skillSelections?.length, 'Manual context selection must not globally enable skills');
  // Existing full-access mode asks for each write/command; auto-review would skip prompts.
  // Only this disposable fixture session uses it, with exact-call allow-once responses above.
  const configured = events.length;
  send({action: 'configure', thread_id: thread, config_id: 'permission', value: 'full-access'});
  await wait(event => event.thread_id === thread && event.kind === 'configuration_changed' &&
    event.data?.options?.some(option => option.id === 'permission' && option.current === 'full-access'), configured);
  assert.equal(provider.requests(), 0);
  const turn = events.length;
  send({action: 'prompt', thread_id: thread, contexts,
    text: 'Execute the fixed brief.md / measurements.csv task with these two explicitly selected methods. Use only workspace files and the existing tools. Run tests and independent checking, then deliver the report, scripts, logs and task receipt through existing session artifacts. This is an explicitly authorized deterministic fixture; do not claim real-model or scientific validation.'});
  const done = await wait(event => event.thread_id === thread && ['turn_finished', 'session_error'].includes(event.kind), turn, 120000);
  assert.equal(done.kind, 'turn_finished', done.text);
  assert.deepEqual(provider.errors, []); assert.deepEqual(errors, []);
  for (const call of provider.calls) {
    const update = events.findLast(event => event.thread_id === thread && event.kind === 'session_update' &&
      event.data.sessionUpdate === 'tool_call_update' && event.data.toolCallId === call.id);
    assert.equal(update?.data.status, 'completed', `Tool ${call.name}: ${JSON.stringify(update)}`);
  }
  assert(approvals.length > 0 && approvals.every(item => item.allowed));
  const independent = JSON.parse(await readFile(join(workspace, 'independent-check.json'), 'utf8'));
  assert(independent.passed);
  const receipt = provider.receipt(); assert(receipt);
  const saved = [...provider.artifacts, {path: 'task-receipt.json', artifact: receipt}];
  const originals = new Map();
  for (const item of saved) originals.set(item.path, await readFile(join(workspace, item.path)));
  await stop(); desktop.reset();
  for (const path of originals.keys()) await rm(join(workspace, path));
  await start();
  const reopened = join(directory, 'reopened'); await mkdir(reopened);
  const persisted = [];
  for (const item of saved) {
    const snapshot = await delivery.resolveSnapshot(thread, item.artifact.id, 1, AbortSignal.timeout(15000));
    const bytes = await readFile(snapshot.path);
    assert.deepEqual(bytes, originals.get(item.path), `Frozen Host artifact differs: ${item.path}`);
    assert.equal(snapshot.sha256, sha(bytes));
    await writeFile(join(reopened, item.path), bytes);
    persisted.push({path: item.path, artifactId: item.artifact.id, version: 1, sha256: snapshot.sha256, bytes: snapshot.bytes});
  }
  const replayCheck = JSON.parse(execFileSync(python, ['check_task.py'], {cwd: reopened, encoding: 'utf8'}));
  assert(replayCheck.passed);
  assert.equal((await market('installed')).items.filter(item => item.selected).length, 0);
  await stop();
  const result = {...evidence, passed: true, mode: 'real-public-git-host-harness-tools-scripted-provider',
    methods, providerRequests: provider.requests(), calls: provider.calls, approvals, persisted,
    taskReceipt: {thread, artifactId: receipt.id, version: 1}, independent,
    reopenedAfterHostRestartAndSourceRemoval: true, reopenedIndependentCheck: replayCheck,
    limits: ['Provider code/decisions are fixtures, no real-model inference', 'Synthetic descriptive data, no scientific acceptance',
      'Existing Host artifact owner; no Notebook-specific attachment or Electron UI claim',
      'Fixture-only shell uses existing per-call approval; no OS/network sandbox is claimed',
      'macOS arm64 development build only; no other platform/Agent/signed-package acceptance']};
  await json(join(directory, 'result.json'), result);
  await json(join(outputRoot, 'latest.json'), {directory, passed: true, taskReceipt: result.taskReceipt});
  console.log(`Mixed-task Host/Harness acceptance passed: ${directory}`);
} finally {
  await json(join(directory, 'events.json'), events);
  await json(join(directory, 'provider-calls.json'), {calls: provider.calls, errors: provider.errors, approvals});
  await writeFile(join(directory, 'host-stderr.log'), stderr);
  await stop(); await provider.close(); await desktop.close();
}
