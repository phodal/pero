// Actual Host + Go ACP harness + shell, with an explicitly scripted loopback model.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectAgentProvider } from '../fixtures/project-agent-provider.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(join(tmpdir(), 'pero-project-agent-')));
const output = join(root, 'test-results/project-agent-contract');
const workspace = join(temp, 'workspace');
await Promise.all([mkdir(workspace), mkdir(output, { recursive: true })]);
await writeFile(join(workspace, 'source.txt'), 'Original source remains owned by the project.\n');
const git = args => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });
git(['init', '-q']); git(['add', 'source.txt']);
git(['-c', 'user.name=Project fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Seed isolated fixture']);
const provider = await projectAgentProvider();
const settings = join(temp, 'settings.json'), agents = join(temp, 'agents.json');
await writeFile(settings, JSON.stringify({ workbench: { research_projects: [{ id: 'fixture-project', title: 'Project coordination fixture',
  goal: 'Delegate a reproducible local evidence check and summarize original session receipts.', workspace, resources: [] }] } }));
await writeFile(agents, JSON.stringify([{ id: 'project-fixture', name: 'Project / scripted model fixture',
  command: process.env.PERO_PROJECT_HARNESS || join(root, 'target/debug/pero-agent-acp'),
  args: ['--endpoint', provider.endpoint, '--model', 'project-agent-fixture', '--session-dir', join(temp, 'harness-sessions'),
    '--workspace', workspace, '--enable-shell', '--approval', 'ask', '--max-requests', '32', '--max-tokens', '1024', '--max-retries', '0'],
  env: { AGENT_PROVIDER_API_KEY: 'loopback-fixture-only' } }]));
const env = { ...process.env, PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: join(temp, 'history.jsonl'),
  PERO_AGENTS_FILE: agents, PERO_ENV_FILE: join(temp, 'no-env'), PERO_APPS_ROOT: join(temp, 'apps'), PERO_REQUIRED_APPS: '', PERO_BUILTIN_APPS: '' };
for (const key of ['PERO_CLOUD_URL', 'PERO_CLIENT_TOKEN', 'PERO_OPERATOR_TOKEN']) delete env[key];
const logs = [], checks = [];
let host, serial = 0;
function launch() {
  const child = spawn(process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host'), ['--stdio'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [], waiting = new Set();
  const closed = new Promise(done => child.once('close', (code, signal) => done({ code, signal })));
  child.stderr.on('data', data => logs.push(String(data)));
  child.on('error', error => { for (const waiter of waiting) waiter.reject(error); });
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  createInterface({ input: child.stdout }).on('line', line => {
    let event;
    try { event = JSON.parse(line); } catch (error) { logs.push(line); for (const waiter of waiting) waiter.reject(error); return; }
    events.push(event);
    if (event.kind === 'permission') {
      const option = event.data.options.find(option => option.kind === 'allow_once') || event.data.options.find(option => option.kind === 'allow_always');
      assert(option, `No affirmative ACP permission: ${JSON.stringify(event.data)}`);
      send({ action: 'permission', thread_id: event.thread_id, request_id: event.data.permission_id, option_id: option.optionId });
    }
    for (const waiter of waiting) if (waiter.accept(event)) waiting.delete(waiter);
  });
  const next = (kind, predicate = () => true, timeout = 30000) => new Promise((resolveEvent, reject) => {
    const accept = event => {
      if (!(Array.isArray(kind) ? kind.includes(event.kind) : event.kind === kind) || !predicate(event) || event.taken) return false;
      event.taken = true; clearTimeout(timer); resolveEvent(event); return true;
    };
    const timer = setTimeout(() => { waiting.delete(waiter); reject(Error(`Host timed out: ${kind}; ${logs.slice(-3).join('\n')}`)); }, timeout);
    const waiter = { accept, reject: error => { clearTimeout(timer); reject(error); } };
    if (!events.some(accept)) waiting.add(waiter);
  });
  const request = async input => {
    const request_id = input.request_id || `project-contract-${++serial}`;
    const result = next(['project_agent', 'project_agent_error'], event => event.request_id === request_id);
    send({ method: 'project_agent', request_id, ...input });
    const event = await result;
    if (event.kind === 'project_agent_error') throw Error(event.text);
    return event.data;
  };
  return { events, next, send, request, stop: async () => { child.stdin.end(); return closed; } };
}
async function snapshot() { return host.request({ action: 'snapshot', project_id: 'fixture-project' }); }
async function until(read, predicate, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    if (provider.errors.length) throw Error(provider.errors.join('\n'));
    value = await read();
    if (predicate(value)) return value;
    await new Promise(done => setTimeout(done, 100)); // Poll an observable external process condition.
  }
  throw Error(`${label} timed out: ${JSON.stringify(value)}`);
}
try {
  host = launch(); await host.next('ready');
  const started = await host.request({ action: 'start', project_id: 'fixture-project', agent_id: 'project-fixture' });
  const primary = started.selected_thread;
  assert(primary, JSON.stringify(started));
  await host.next('session_ready', event => event.thread_id === primary);
  await assert.rejects(host.request({ action: 'start', project_id: 'fixture-project', agent_id: 'project-fixture', prompt: 'Do not silently drop this instruction' }), /already exists.*Followup/);
  checks.push('Existing primary rejects new Start input explicitly instead of silently dropping it');
  host.send({ action: 'configure', thread_id: primary, config_id: 'permission', value: 'read-only' });
  await host.next('configuration_changed', event => event.thread_id === primary
    && event.data.options.some(option => option.id === 'permission' && option.current === 'read-only'));
  const readonly = await host.request({ action: 'delegate', thread_id: primary, agent_id: 'project-fixture',
    title: 'Read only proof', prompt: 'PROJECT_CHILD_READONLY' });
  const readonlyReady = await host.next('session_ready', event => event.thread_id === readonly.selected_thread);
  assert(readonlyReady.data.peroSettings.options.some(option => option.id === 'permission' && option.current === 'read-only'));
  const denied = await until(snapshot, data => data.sessions.some(session => session.thread_id === readonly.selected_thread
    && session.status === 'completed' && session.result.includes('PROJECT_READONLY_DENIED')), 'Read-only child denial');
  const readonlyChild = denied.sessions.find(session => session.thread_id === readonly.selected_thread);
  assert.equal(await readFile(join(readonlyChild.workspace, 'read-only-proof.txt'), 'utf8').then(() => true, () => false), false);
  checks.push('Primary View only permission is acknowledged by the child before its prompt and rejects shell writes');
  host.send({ action: 'configure', thread_id: primary, config_id: 'permission', value: 'full-access' });
  await host.next('configuration_changed', event => event.thread_id === primary
    && event.data.options.some(option => option.id === 'permission' && option.current === 'full-access'));
  await host.request({ action: 'followup', thread_id: primary, prompt: 'PROJECT_DELEGATE' });
  const completed = await until(snapshot, data => data.sessions.some(session => session.binding.label === 'Evidence check' && session.status === 'completed'), 'Delegated shell evidence');
  const child = completed.sessions.find(session => session.binding.label === 'Evidence check');
  assert.equal(child.binding.label, 'Evidence check');
  assert.notEqual(child.workspace, workspace);
  assert.match(child.result, /The shell check wrote/);
  const shellReceipt = child.evidence.find(item => item.status === 'completed' && item.output.includes('observed fixture evidence'));
  assert(shellReceipt, 'Child must retain the actual completed shell receipt');
  assert(host.events.some(event => event.kind === 'session_update' && event.thread_id === child.thread_id
    && event.data.toolCallId === shellReceipt.tool_call_id), 'Receipt tool ID must refer to the original ACP tool event');
  assert.equal(await readFile(join(child.workspace, 'evidence.txt'), 'utf8'), 'observed fixture evidence\n');
  assert.equal(await readFile(join(workspace, 'source.txt'), 'utf8'), 'Original source remains owned by the project.\n');
  assert(host.events.some(event => event.kind === 'permission' && event.thread_id === child.thread_id));
  checks.push('Primary MCP delegation to original ACP child, actual isolated worktree shell evidence and original approval path');

  await host.request({ action: 'followup', thread_id: child.thread_id, prompt: 'PROJECT_FOLLOWUP' });
  await until(() => readFile(join(child.workspace, 'evidence.txt'), 'utf8'), text => text.includes('followup evidence'), 'Child followup file effect');
  await until(snapshot, data => data.sessions.some(session => session.thread_id === child.thread_id
    && session.status === 'completed' && session.result.includes('followup evidence')), 'Child followup completion');
  checks.push('Followup reaches the original child and updates its real evidence');

  const retry = { request_id: 'stable-delegation-recovery', action: 'delegate', thread_id: primary,
    agent_id: 'not-installed', title: 'Retry proof', prompt: 'PROJECT_CHILD_EVIDENCE' };
  await assert.rejects(host.request(retry), /not installed|unavailable/i);
  const retried = await host.request({ ...retry, agent_id: 'project-fixture' });
  await until(snapshot, data => data.sessions.some(session => session.thread_id === retried.selected_thread && session.status === 'completed'), 'Missing Agent recovery');
  const repeated = await host.request({ ...retry, agent_id: 'project-fixture' });
  assert.equal(repeated.selected_thread, retried.selected_thread);
  await assert.rejects(host.request({ ...retry, agent_id: 'project-fixture', prompt: 'Changed frozen work' }), /different delegated work/);
  checks.push('Missing Agent preflight recovers with the same request, and delegated input stays frozen on retries');

  await until(snapshot, data => data.sessions.find(session => session.thread_id === primary)?.status === 'completed', 'Primary settled');
  await host.request({ action: 'followup', thread_id: primary, prompt: 'PROJECT_SUMMARY' });
  await until(snapshot, data => data.sessions.find(session => session.thread_id === primary)?.result.includes('PROJECT_SUMMARY_VERIFIED'), 'Evidence summary');
  checks.push('Primary summary reads original child receipts through project_work list');

  await host.request({ action: 'followup', thread_id: primary, prompt: 'PROJECT_WAIT' });
  const running = await until(snapshot, data => data.sessions.some(session => session.binding.label === 'Cancellation check'), 'Cancellation child creation');
  const slow = running.sessions.find(session => session.binding.label === 'Cancellation check');
  await until(async () => readFile(join(slow.workspace, 'slow-ready'), 'utf8').catch(() => ''), value => value === 'ready', 'Slow shell readiness signal');
  await host.request({ action: 'cancel', thread_id: slow.thread_id });
  await until(snapshot, data => data.sessions.find(session => session.thread_id === slow.thread_id)?.status === 'cancelled', 'Child cancellation');
  checks.push('Cancellation follows actual child shell readiness and receives terminal cancelled state');

  await until(snapshot, data => data.sessions.find(session => session.thread_id === primary)?.status === 'completed', 'Primary wait delegation settled');
  await host.request({ action: 'followup', thread_id: primary, prompt: 'PROJECT_FAIL' });
  await until(snapshot, data => data.sessions.some(session => session.binding.label === 'Failed check' && session.status === 'failed' && session.error), 'Provider failure projection');
  checks.push('Provider failure stays distinct from completion and exposes original error');

  const remote = host.events.find(event => event.kind === 'session_ready' && event.thread_id === child.thread_id).data.sessionId;
  const before = await snapshot();
  assert.equal((await host.stop()).code, 0); host = launch(); await host.next('ready');
  const restored = await snapshot();
  assert.deepEqual(restored.sessions.map(session => [session.thread_id, session.binding]), before.sessions.map(session => [session.thread_id, session.binding]));
  assert(restored.sessions.every(session => !session.active));
  assert.equal(restored.sessions.find(session => session.thread_id === child.thread_id).status, 'completed');
  await host.request({ action: 'followup', thread_id: child.thread_id, prompt: 'PROJECT_FOLLOWUP' });
  const ready = await host.next('session_ready', event => event.thread_id === child.thread_id);
  assert.equal(ready.data.sessionId, remote, 'Restart followup must load the exact original ACP session');
  await until(() => readFile(join(child.workspace, 'evidence.txt'), 'utf8'), text => text.split('followup evidence').length === 3, 'Restart followup file effect');
  await until(snapshot, data => data.sessions.some(session => session.thread_id === child.thread_id
    && session.status === 'completed' && session.result.split('followup evidence').length === 3), 'Resumed child completion');
  checks.push('Restart restores all project/parent relationships and explicit followup loads exact original ACP session');
  assert.deepEqual(provider.errors, []);
  console.log(`Project Agent Host integration passed (${checks.length} behaviors; scripted loopback model, actual Host/harness/shell).`);
} finally {
  if (host) await host.stop();
  await provider.close();
  await writeFile(join(output, 'results.json'), JSON.stringify({ temp, checks, providerErrors: provider.errors, modelRequests: provider.calls.length, logs }, null, 2));
}
