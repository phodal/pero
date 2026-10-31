// Real stdio Host + SQLite + deterministic local ACP. No network/provider calls.
// Usage: node tests/runtime/automation.mjs [target/debug/pero-host]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { EventEmitter, once } from 'node:events';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with {type:'json'};
const ajv = new Ajv2020({strict:true,strictTypes:false});
ajv.addSchema(schema);
const validateResult = ajv.getSchema(`${schema.$id}#/$defs/AutomationResultEvent`);

const binary = resolve(process.argv[2] || 'target/debug/pero-host');
const fixture = resolve('tests/fixtures/automation-acp.mjs');
const root = await mkdtemp(join(tmpdir(), 'pero-automation-runtime-'));
const workspaceA = join(root, 'workspace-a'), workspaceB = join(root, 'workspace-b');
const profile = join(root, 'profile'), capture = join(root, 'prompts.jsonl');
const artifact = resolve('test-results/automation/runtime.json');
const sha = text => createHash('sha256').update(text).digest('hex');
const children = new Set();
const results = [];
let serial = 0;
await Promise.all([workspaceA, workspaceB, profile].map(path => mkdir(path, { recursive: true })));
await writeFile(capture, '');
await writeFile(join(root, 'agents.json'), JSON.stringify([{ id: 'automation-fixture', name: 'Automation fixture', command: process.execPath, args: [fixture], env: { AUTOMATION_FIXTURE_LOG: capture } }]));

async function launch() {
  const processHost = spawn(binary, ['--stdio'], { cwd: workspaceA, detached: process.platform !== 'win32', env: {
    ...process.env, PERO_SETTINGS_PATH: join(profile, 'settings.json'), PERO_HISTORY_PATH: join(profile, 'history.jsonl'), PERO_AGENTS_FILE: join(root, 'agents.json'),
  }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(processHost);
  const events = [], signal = new EventEmitter();
  let stderr = '';
  processHost.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: processHost.stdout }).on('line', line => {
    try { const event = JSON.parse(line); events.push(event); signal.emit('event', event); }
    catch (error) { signal.emit('failure', error); }
  });
  processHost.on('error', error => signal.emit('failure', error));
  processHost.on('exit', (code, sig) => signal.emit('failure', new Error(`Host exited ${code}/${sig}: ${stderr}`)));
  const wait = (predicate, from = 0) => {
    const existing = events.slice(from).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((accept, reject) => {
      const finish = (error, event) => { clearTimeout(timer); signal.off('event', receive); signal.off('failure', fail); error ? reject(error) : accept(event); };
      const receive = event => { if (predicate(event)) finish(null, event); };
      const fail = error => finish(error);
      const timer = setTimeout(() => finish(new Error(`Host event deadline exceeded: ${stderr}\n${JSON.stringify(events.slice(-4))}`)), 10000);
      signal.on('event', receive); signal.on('failure', fail);
    });
  };
  const send = value => processHost.stdin.write(JSON.stringify(value) + '\n');
  const call = async (command, error = false) => {
    const id = `test-${++serial}`; send({ method: 'automation', id, command });
    const event = await wait(event => event.request_id === id);
    assert.equal(event.kind, error ? 'automation_error' : 'automation_result', event.text);
    if (!error) assert.equal(validateResult(event), true, JSON.stringify(validateResult.errors));
    return error ? event : event.data;
  };
  const query = () => call({ action: 'query' });
  const stateAfter = async (predicate) => {
    // A receipt may be forwarded just before the main loop commits it.
    // Query that observable condition; never drive the timer with polling.
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const state = await query(); if (predicate(state)) return state; }
    throw new Error('Durable projection did not reach the observed execution receipt');
  };
  await wait(event => event.kind === 'ready');
  return { processHost, events, wait, send, call, query, stateAfter };
}
const logs = async () => (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const manual = (id, intent, content) => ({ action: 'manual_input', definition_id: id, intent_id: intent, subject: id, content });
const create = (id, prompt = 'Process frozen input', trigger = { kind: 'manual' }, input = 'process_exact') => ({ action: 'create_local', id, trigger, input, agent_id: 'automation-fixture', prompt });
async function completed(host, from, definitionId) {
  await host.wait(event => event.kind === 'turn_finished', from);
  return host.stateAfter(value => value.state.requests.some(request => request.definition.id === definitionId && request.status.kind === 'completed'));
}
async function stop(host, signal = 'SIGTERM') {
  const exited = once(host.processHost, 'exit');
  host.processHost.kill(signal); await exited;
  if (process.platform !== 'win32') { try { process.kill(-host.processHost.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  children.delete(host.processHost);
}

try {
  let host = await launch();
  const initial = await host.query();
  assert.equal(initial.capabilities.available, true);
  await host.call(create('manual'));
  const from = host.events.length;
  const accepted = await host.call(manual('manual', 'manual-one', 'immutable manual input'));
  const requestId = accepted.receipt.id;
  const done = await completed(host, from, 'manual');
  assert.equal(done.state.requests.find(request => request.id === requestId).snapshot.digest, sha('immutable manual input'));
  const duplicate = await host.call(manual('manual', 'manual-one', 'immutable manual input'));
  assert.equal(duplicate.receipt.duplicate, true);
  await host.call(manual('manual', 'manual-one', 'different input'), true);
  assert.equal((await logs()).length, 1);
  const repeatFrom = host.events.length;
  const repeated = await host.call(manual('manual', 'manual-two', 'immutable manual input'));
  await host.wait(event => event.kind === 'turn_finished', repeatFrom);
  const repeatedDone = await host.stateAfter(value => value.state.requests.find(request => request.id === repeated.receipt.id)?.status.kind === 'completed');
  const repeatRequest = repeatedDone.state.requests.find(request => request.id === repeated.receipt.id);
  assert.equal(repeatRequest.reprocess_of, requestId);
  assert.notEqual(repeatRequest.execution_id, done.state.requests.find(request => request.id === requestId).execution_id);
  assert.equal((await logs()).length, 2);
  results.push('manual identity retries deduplicate; new intent reprocesses identical input with prior-request link');

  await host.call(create('manual-latest', 'Read current manual input', { kind: 'manual' }, 'recheck_latest'));
  await host.call({ action: 'control', definition_id: 'manual-latest', paused: true, revoked: false });
  const latestA = await host.call(manual('manual-latest', 'latest-intent-a', 'manual version A'));
  const latestB = await host.call(manual('manual-latest', 'latest-intent-b', 'manual version B'));
  const retryA = await host.call(manual('manual-latest', 'latest-intent-a', 'manual version A'));
  assert.equal(retryA.receipt.id, latestA.receipt.id);
  assert.equal(retryA.receipt.duplicate, true);
  assert.deepEqual(retryA.state.latest, latestB.state.latest, 'retry A must not roll latest back from B');
  assert.deepEqual(retryA.state.snapshots, latestB.state.snapshots);
  assert.deepEqual(retryA.state.requests, latestB.state.requests);
  await host.call(manual('manual-latest', 'latest-intent-a', 'conflicting retry bytes'), true);
  await host.call({ ...manual('manual-latest', 'latest-intent-a', 'manual version A'), subject: 'conflicting-subject' }, true);
  const afterConflict = await host.query();
  assert.deepEqual(afterConflict.state.latest, latestB.state.latest);
  assert.deepEqual(afterConflict.state.snapshots, latestB.state.snapshots, 'rejected retries must not publish content');
  assert.deepEqual(afterConflict.state.requests, latestB.state.requests);
  const beforeLatestRuns = (await logs()).length;
  await host.call({ action: 'control', definition_id: 'manual-latest', paused: false, revoked: false });
  const latestDone = await host.stateAfter(value => [latestA.receipt.id, latestB.receipt.id].every(id =>
    value.state.requests.find(request => request.id === id)?.status.kind === 'completed'));
  const latestExecutions = (await logs()).slice(beforeLatestRuns);
  assert.equal(latestExecutions.length, 2);
  assert(latestExecutions.every(log => log.text.includes('manual version B') && !log.text.includes('manual version A')));
  assert.equal(latestDone.state.latest.find(candidate => candidate.subject === 'manual-latest').digest, sha('manual version B'));
  results.push('paused latest A/B/retry-A preserves B; conflicting retries publish nothing; resumed work resolves B');

  await host.call(create('exact', 'Read exact revision', { kind: 'event', binding_id: 'local', event_kind: 'changed' }));
  await host.call({ action: 'publish_input', binding_id: 'local', subject: 'exact-subject', revision: 'r1', content: 'old exact bytes', latest: false });
  await host.call({ action: 'publish_input', binding_id: 'local', subject: 'exact-subject', revision: 'r2', content: 'new latest bytes', latest: true });
  const exactEvent = { binding_id: 'local', producer_id: 'event-one', event_kind: 'changed', subject: 'exact-subject', exact: { revision: 'r1', digest: sha('old exact bytes') } };
  let start = host.events.length;
  const eventReceipt = await host.call({ action: 'accept', event: exactEvent });
  await completed(host, start, 'exact');
  const duplicateEvent = await host.call({ action: 'accept', event: exactEvent });
  assert.equal(duplicateEvent.receipt.id, eventReceipt.receipt.id);
  assert.equal(duplicateEvent.receipt.duplicate, true);
  await host.call({ action: 'accept', event: { ...exactEvent, subject: 'changed-subject' } }, true);
  assert((await logs()).at(-1).text.includes('old exact bytes'));
  assert(!(await logs()).at(-1).text.includes('new latest bytes'));
  results.push('exact revision retained; source event duplicate/conflict');

  const owner = initial.state.owner;
  await host.call({ action: 'put_binding', binding: { id: 'latest-source', owner, authority: 'trusted-local-host', event_kinds: ['changed'] } });
  await host.call({ action: 'put_definition', definition: { id: 'latest', revision: 1, owner, trigger: { kind: 'event', binding_id: 'latest-source', event_kind: 'changed' }, input: 'recheck_latest', input_binding_id: 'latest-source', method: { kind: 'agent', agent_id: 'automation-fixture', workspace: workspaceA, prompt: 'Read latest snapshot' }, target: { kind: 'local_host', owner } } });
  await host.call({ action: 'publish_input', binding_id: 'latest-source', subject: 'latest-subject', revision: 'r1', content: 'previous bytes', latest: true });
  await host.call({ action: 'publish_input', binding_id: 'latest-source', subject: 'latest-subject', revision: 'r2', content: 'current bytes', latest: true });
  start = host.events.length;
  await host.call({ action: 'accept', event: { binding_id: 'latest-source', producer_id: 'latest-one', event_kind: 'changed', subject: 'latest-subject', exact: null } });
  await completed(host, start, 'latest');
  assert((await logs()).at(-1).text.includes('current bytes'));
  results.push('latest resolver uses published current snapshot');

  await host.call({ action: 'publish_input', binding_id: 'local', subject: 'clock-subject', revision: 'clock-r1', content: 'scheduled bytes', latest: true });
  const anchor = Math.floor(Date.now() / 1000) + 2;
  start = host.events.length;
  await host.call(create('clock', 'Scheduled method', { kind: 'time', subject: 'clock-subject', exact: null, anchor, interval_seconds: 3, max_lateness_seconds: 30 }, 'recheck_latest'));
  // Intentionally write nothing to stdin until the independently scheduled turn.
  await host.wait(event => event.kind === 'turn_started', start);
  const firstSlot = await completed(host, start, 'clock');
  const firstClockRequest = firstSlot.state.requests.find(request => request.definition.id === 'clock');
  // Same frozen source, distinct scheduler slot: no new input and no manual tick.
  // Keep the original event cursor so a fast next slot cannot outrun observation.
  const nextTurn = await host.wait(event => event.kind === 'turn_started' && event.thread_id !== firstClockRequest.execution_id, start);
  await host.wait(event => event.kind === 'turn_finished' && event.thread_id === nextTurn.thread_id, start);
  const secondSlot = await host.stateAfter(value => value.state.requests.some(request => request.execution_id === nextTurn.thread_id && request.status.kind === 'completed'));
  await host.call({ action: 'control', definition_id: 'clock', paused: true, revoked: false });
  const secondClockRequest = secondSlot.state.requests.find(request => request.execution_id === nextTurn.thread_id);
  assert.equal(secondClockRequest.intent.slot, firstClockRequest.intent.slot + 3);
  assert.equal(secondClockRequest.reprocess_of, firstClockRequest.id);
  assert.deepEqual(secondClockRequest.snapshot, firstClockRequest.snapshot);
  assert.notEqual(secondClockRequest.execution_id, firstClockRequest.execution_id);
  results.push('distinct time slots execute unchanged input while stdin is idle, linked without replay');

  assert.equal((await host.query()).state.limits.max_active, 1);
  start = host.events.length;
  host.send({ action: 'new_session', thread_id: 'busy-interactive', agent_id: 'automation-fixture' });
  await host.wait(event => event.kind === 'session_ready' && event.thread_id === 'busy-interactive', start);
  host.send({ action: 'prompt', thread_id: 'busy-interactive', text: '[hold] interactive workspace owner' });
  await host.wait(event => event.kind === 'session_update' && event.thread_id === 'busy-interactive' && event.data?.content?.text === 'fixture_prompt_received', start);
  const beforeRejectedPrompt = (await logs()).length;
  await host.call(create('busy-workspace', 'Must not enter ACP'));
  const busyRequest = await host.call(manual('busy-workspace', 'busy-one', 'never submitted'));
  const rejected = await host.stateAfter(value => value.state.requests.find(request => request.id === busyRequest.receipt.id)?.status.kind === 'failed');
  const rejectedExecution = rejected.state.requests.find(request => request.id === busyRequest.receipt.id).execution_id;
  await host.wait(event => event.kind === 'session_error' && event.thread_id === rejectedExecution && event.data?.promptRejection === 'workspace_lease', start);
  assert.equal((await logs()).length, beforeRejectedPrompt, 'pre-submit workspace rejection cannot deliver an ACP prompt');
  assert.equal(rejected.fault, null);
  await host.call({ action: 'put_definition', definition: { id: 'independent-workspace', revision: 1, owner, trigger: { kind: 'manual' }, input: 'process_exact', input_binding_id: 'local', method: { kind: 'agent', agent_id: 'automation-fixture', workspace: workspaceB, prompt: 'Independent workspace proceeds' }, target: { kind: 'local_host', owner } } });
  start = host.events.length;
  const independent = await host.call(manual('independent-workspace', 'independent-one', 'free workspace input'));
  await completed(host, start, 'independent-workspace');
  assert.equal((await logs()).at(-1).workspace, workspaceB);
  assert(!host.events.some(event => event.kind === 'turn_finished' && event.thread_id === 'busy-interactive'));
  await stop(host);
  host = await launch();
  const rejectedRestored = await host.query();
  assert.equal(rejectedRestored.state.requests.find(request => request.id === busyRequest.receipt.id)?.status.kind, 'failed');
  assert.equal(rejectedRestored.state.requests.find(request => request.id === independent.receipt.id)?.status.kind, 'completed');
  assert.equal((await logs()).length, beforeRejectedPrompt + 1);
  results.push('interactive workspace collision is durably failed before ACP submission; independent workspace progresses at max_active=1');

  await host.call(create('workspace', 'Check frozen workspace'));
  start = host.events.length;
  host.send({ action: 'workspace', path: workspaceB });
  await host.wait(event => event.kind === 'workspace', start);
  start = host.events.length;
  await host.call(manual('workspace', 'workspace-one', 'workspace assertion'));
  await completed(host, start, 'workspace');
  assert.equal((await logs()).at(-1).workspace, workspaceA);
  results.push('selected workspace changes do not alter frozen execution');

  await host.call(create('cancel', '[hold]'));
  start = host.events.length;
  const held = await host.call(manual('cancel', 'cancel-one', 'cancel test'));
  await host.wait(event => event.kind === 'session_update' && event.data?.content?.text === 'fixture_prompt_received', start);
  await host.call({ action: 'cancel', request_id: held.receipt.id });
  await host.wait(event => event.kind === 'turn_finished' && event.data?.stopReason === 'cancelled', start);
  await host.stateAfter(value => value.state.requests.find(request => request.id === held.receipt.id)?.status.kind === 'cancelled');
  results.push('existing ACP cancellation has a structured receipt');

  const missingWorkspace = join(root, 'will-be-removed');
  await mkdir(missingWorkspace);
  await host.call({ action: 'put_definition', definition: { id: 'bad-admission', revision: 1, owner, trigger: { kind: 'manual' }, input: 'process_exact', input_binding_id: 'local', method: { kind: 'agent', agent_id: 'automation-fixture', workspace: missingWorkspace, prompt: 'Cannot start' }, target: { kind: 'local_host', owner } } });
  await host.call({ action: 'control', definition_id: 'bad-admission', paused: true, revoked: false });
  const bad = await host.call(manual('bad-admission', 'bad-one', 'retained obligation'));
  await rm(missingWorkspace, { recursive: true });
  await host.call({ action: 'control', definition_id: 'bad-admission', paused: false, revoked: false });
  await host.call(create('after-bad-admission'));
  start = host.events.length;
  await host.call(manual('after-bad-admission', 'good-one', 'independent valid work'));
  const progressed = await completed(host, start, 'after-bad-admission');
  assert.equal(progressed.state.requests.find(request => request.id === bad.receipt.id).status.kind, 'pending');
  assert(progressed.attention[bad.receipt.id]);
  assert.equal(progressed.fault, null);
  results.push('failed admission retains pending responsibility without starving independent work');

  await host.call(create('crash', '[hold]'));
  start = host.events.length;
  const crashing = await host.call(manual('crash', 'crash-one', 'must not replay'));
  await host.wait(event => event.kind === 'turn_started', start);
  await host.wait(event => event.kind === 'session_update' && event.data?.content?.text === 'fixture_prompt_received', start);
  const beforeCrash = (await logs()).length;
  await stop(host, 'SIGKILL');
  host = await launch();
  const recovered = await host.query();
  assert.equal(recovered.state.requests.find(request => request.id === crashing.receipt.id)?.status.kind, 'reconcile');
  assert.equal(recovered.state.requests.find(request => request.id === requestId)?.status.kind, 'completed');
  await host.call(manual('crash', 'crash-one', 'must not replay'));
  const blocked = await host.call(manual('crash', 'crash-two', 'must not replay'));
  assert.equal(blocked.state.requests.find(request => request.id === blocked.receipt.id)?.status.kind, 'pending');
  const cancellation = await host.call({ action: 'cancel', request_id: crashing.receipt.id });
  assert.equal(cancellation.state.requests.find(request => request.id === crashing.receipt.id)?.cancel_requested, true);
  assert.equal(cancellation.state.requests.find(request => request.id === crashing.receipt.id)?.status.kind, 'cancel_requested');
  assert(cancellation.attention[crashing.receipt.id], 'unavailable original owner must remain visible, not claim stopped');
  await stop(host);
  host = await launch();
  const stable = await host.query();
  assert.equal(stable.state.requests.find(request => request.id === crashing.receipt.id)?.status.kind, 'reconcile');
  assert.equal(stable.state.requests.find(request => request.id === crashing.receipt.id)?.cancel_requested, true);
  assert.equal(stable.state.requests.find(request => request.id === blocked.receipt.id)?.status.kind, 'pending');
  assert.equal((await logs()).length, beforeCrash);
  results.push('SIGKILL recovery blocks new intents; cancellation remains an unresolved request across restart without replay');
  await stop(host);
  await mkdir(resolve('test-results/automation'), { recursive: true });
  const report = { status: 'passed', level: 'L0 real local Host/SQLite/fixture ACP', binarySha256: sha(await readFile(binary)), scenarios: results, promptInvocations: beforeCrash, persistedRequests: stable.state.requests.map(request => ({ definition: request.definition.id, status: request.status.kind })), providerCalls: 0, limitations: ['No Desktop acceptance', 'No remote source/provider', 'No business/scientific verification', 'No descendant cleanup guarantee'] };
  await writeFile(artifact, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await mkdir(resolve('test-results/automation'), { recursive: true });
  await writeFile(artifact, JSON.stringify({ status: 'failed', scenariosCompleted: results, error: String(error.stack || error), providerCalls: 0 }, null, 2) + '\n');
  throw error;
} finally {
  for (const child of children) {
    try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await rm(root, { recursive: true, force: true });
}
