// Real local Python -> wrapper -> Rust Host snapshots. No model or external network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '../..');
const binary = process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host');
const python = process.env.PERO_PROVENANCE_PYTHON || 'python3';
const wrapper = join(root, 'scripts/record-external-run.mjs');
const output = join(root, 'test-results/artifact-provenance');
const directory = await realpath(await mkdtemp(join(tmpdir(), 'pero-artifact-provenance-')));
const workspace = join(directory, 'workspace'), thread = 'artifact-provenance';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await Promise.all([mkdir(workspace), mkdir(output, { recursive: true })]);
await rm(join(output, 'result.json'), { force: true });
await rm(join(output, 'host-snapshots'), { recursive: true, force: true });
await mkdir(join(output, 'host-snapshots'));
const settings = join(directory, 'settings.json'), history = join(directory, 'sessions.jsonl');
const agents = join(directory, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'No-model provenance session',
  command: process.execPath, args: [join(root, 'tests/fixtures/acp-agent.mjs')] }]));
const env = { ...process.env, PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: history,
  PERO_AGENTS_FILE: agents, PERO_APPS_ROOT: join(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '',
  PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_ENV_FILE: join(directory, 'no-env'), UV_OFFLINE: '1' };
let host, hostExit, events = [], sequence = 0, hostLog = '';
const changed = new EventEmitter();
function start() {
  events = [];
  host = spawn(binary, ['--stdio'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
  hostExit = once(host, 'exit');
  host.stderr.on('data', bytes => { hostLog += bytes; });
  createInterface({ input: host.stdout }).on('line', line => {
    events.push(JSON.parse(line)); changed.emit('event');
  });
}
function send(command) { host.stdin.write(JSON.stringify(command) + '\n'); }
async function wait(predicate) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const found = events.find(predicate);
    if (found) return found;
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, `Host response timeout: ${hostLog}`);
    await new Promise((resolveWait, reject) => {
      const listener = () => { clearTimeout(timer); resolveWait(); };
      const timer = setTimeout(() => { changed.off('event', listener); reject(Error(`Host timeout: ${hostLog}`)); }, remaining);
      changed.once('event', listener);
    });
  }
}
async function request(action, fields = {}) {
  const request_id = `provenance-${++sequence}`;
  send({ method: 'artifacts', action, thread_id: thread, request_id, ...fields });
  return wait(event => event.request_id === request_id);
}
async function stop() {
  if (!host) return;
  const child = host;
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { assert.deepEqual(await hostExit, [0, null], hostLog); }
  finally { clearTimeout(timer); host = undefined; }
}
async function run(runId, filename, script, args = [], cancel = false, inputs = []) {
  const child = spawn(process.execPath, [wrapper, 'python', runId, filename,
    ...inputs.flatMap(input => ['--input', input]), '--', python, script, ...args],
  { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', interrupted = false;
  child.stdout.on('data', bytes => {
    stdout += bytes;
    // Observe the child's readiness line instead of guessing how long startup takes.
    if (cancel && !interrupted && stdout.includes('READY TO CANCEL\n')) {
      interrupted = true; child.kill('SIGINT');
    }
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
  let exit;
  try { exit = await once(child, 'exit'); }
  finally { clearTimeout(timer); }
  assert.equal(exit[1], null, `Wrapper did not settle: ${stdout}\n${stderr}`);
  if (cancel) assert.equal(interrupted, true);
  const receipt = JSON.parse(await readFile(join(workspace, `${filename}.pero-run.json`), 'utf8'));
  assert.equal(receipt.output_sha256, digest(await readFile(join(workspace, filename))));
  for (const evidence of receipt.evidence) {
    assert.equal(evidence.sha256, digest(await readFile(join(workspace, evidence.path))));
  }
  return { receipt, exit: exit[0], stdout, stderr };
}
async function register(path, artifact_id) {
  const event = await request('register_file', { path, ...(artifact_id ? { artifact_id } : {}) });
  assert.equal(event.kind, 'artifact_registered', JSON.stringify(event));
  return event.data.artifact;
}
async function read(id, version) {
  const event = await request('read', { artifact_id: id, version });
  assert.equal(event.kind, 'artifact_document', JSON.stringify(event));
  return event.text;
}
async function linked(artifact, version, role) {
  const link = artifact.versions.find(entry => entry.version === version).related.find(entry => entry.role === role);
  assert.ok(link, `Missing ${role} in artifact ${artifact.id} v${version}`);
  return read(link.artifact_id, link.version);
}

try {
  start();
  await wait(event => event.kind === 'ready');
  send({ action: 'new_session', thread_id: thread, agent_id: 'fixture' });
  await wait(event => event.kind === 'session_ready' && event.thread_id === thread);
  const code = 'import json,sys\nfrom pathlib import Path\nvalues=json.loads(Path(sys.argv[1]).read_text())\nresult={"sum":sum(values)*int(sys.argv[3]),"count":len(values)}\nPath(sys.argv[2]).write_text(json.dumps(result,sort_keys=True)+"\\n")\nprint("calculated",result["sum"],flush=True)\n';
  await writeFile(join(workspace, 'compute.py'), code);
  const originalInput = '[1,2,3,4]\n';
  await writeFile(join(workspace, 'input.json'), originalInput);
  const firstRun = await run('sum-1', 'result.json', 'compute.py', ['input.json', 'result.json', '1'], false, ['input.json']);
  assert.equal(firstRun.exit, 0);
  assert.equal(firstRun.receipt.outcome, 'succeeded');
  assert.deepEqual(firstRun.receipt.invocation, { command: python, args: ['compute.py', 'input.json', 'result.json', '1'], cwd: '.' });
  assert.equal(firstRun.receipt.execution.exit_code, 0);
  assert.deepEqual(JSON.parse(await readFile(join(workspace, 'result.json'), 'utf8')), { count: 4, sum: 10 });
  const first = await register('result.json');
  const firstRecord = JSON.parse(await linked(first, 1, 'run_record'));
  assert.equal(firstRecord.output_sha256, first.versions[0].sha256);
  assert.equal(await linked(first, 1, 'code'), code);
  assert.equal(await linked(first, 1, 'input'), originalInput);
  const environment = JSON.parse(await linked(first, 1, 'environment'));
  assert.equal(environment.python.status, 'observed');
  assert.equal(environment.python.selection, 'command_interpreter');
  assert.ok(environment.python.executable && environment.python.version);
  assert.ok(Array.isArray(environment.python.packages));
  assert.equal(environment.environment_variables, undefined);

  await writeFile(join(workspace, 'input.json'), '[2,4,6,8]\n');
  const secondRun = await run('sum-2', 'result.json', 'compute.py', ['input.json', 'result.json', '2'], false, ['input.json']);
  const second = await register('result.json', first.id);
  assert.equal(second.id, first.id);
  assert.equal(second.versions.length, 2);
  assert.notEqual(second.versions[0].sha256, second.versions[1].sha256);
  assert.equal(JSON.parse(await read(first.id, 1)).sum, 10);
  assert.equal(JSON.parse(await read(first.id, 2)).sum, 40);
  assert.equal(JSON.parse(await linked(second, 1, 'run_record')).run_id, 'sum-1');
  assert.equal(JSON.parse(await linked(second, 2, 'run_record')).run_id, 'sum-2');
  assert.equal(await linked(second, 1, 'input'), originalInput);
  assert.equal(secondRun.receipt.output_sha256, second.versions[1].sha256);

  await writeFile(join(workspace, 'fail.py'), 'from pathlib import Path\nimport sys\nPath("failed.json").write_text("{\\"partial\\":true}\\n")\nprint("partial computation",flush=True)\nprint("intentional failure",file=sys.stderr,flush=True)\nsys.exit(7)\n');
  const failedRun = await run('failure', 'failed.json', 'fail.py');
  assert.equal(failedRun.exit, 7);
  assert.equal(failedRun.receipt.outcome, 'failed');
  assert.equal(failedRun.receipt.execution.exit_code, 7);
  const failed = await register('failed.json');
  assert.equal(JSON.parse(await linked(failed, 1, 'run_record')).outcome, 'failed');
  const failedLogs = failed.versions[0].related.filter(link => link.role === 'execution_log');
  assert.equal(failedLogs.length, 2);
  const failedText = (await Promise.all(failedLogs.map(link => read(link.artifact_id, link.version)))).join('\n');
  assert.match(failedText, /partial computation/);
  assert.match(failedText, /intentional failure/);

  await writeFile(join(workspace, 'cancel.py'), 'from pathlib import Path\nimport signal,sys\nPath("cancelled.json").write_text("{\\"partial\\":true}\\n")\ndef stopped(signum,frame):\n print("interrupted; no final result",flush=True)\n sys.exit(0)\nsignal.signal(signal.SIGINT,stopped)\nprint("READY TO CANCEL",flush=True)\nsignal.pause()\n');
  const cancelledRun = await run('cancelled', 'cancelled.json', 'cancel.py', [], true);
  assert.equal(cancelledRun.exit, 1, 'A child catching cancellation and exiting zero cannot imply success');
  assert.equal(cancelledRun.receipt.outcome, 'cancelled');
  assert.equal(cancelledRun.receipt.execution.exit_code, 0);
  assert.equal(cancelledRun.receipt.execution.cancellation_requested, true);
  const cancelled = await register('cancelled.json');
  assert.equal(JSON.parse(await linked(cancelled, 1, 'run_record')).outcome, 'cancelled');
  const cancelLogs = cancelled.versions[0].related.filter(link => link.role === 'execution_log');
  assert.match((await Promise.all(cancelLogs.map(link => read(link.artifact_id, link.version)))).join('\n'), /interrupted; no final result/);

  const missing = spawn(process.execPath, [wrapper, 'missing', 'spawn-failure', 'never.json', '--',
    join(directory, 'command-does-not-exist')], { cwd: workspace, stdio: 'ignore' });
  assert.deepEqual(await once(missing, 'exit'), [1, null]);
  const noOutputPath = '.pero/run-records/missing/spawn-failure/run.json';
  const noOutputRun = JSON.parse(await readFile(join(workspace, noOutputPath), 'utf8'));
  assert.equal(noOutputRun.outcome, 'failed');
  assert.deepEqual(noOutputRun.outputs, []);
  assert.equal(noOutputRun.execution.exit_code, null);
  assert.equal(noOutputRun.execution.spawn_error, 'ENOENT');
  const noOutput = await register(noOutputPath);
  assert.equal(JSON.parse(await linked(noOutput, 1, 'run_record')).outcome, 'failed');
  const noOutputLogs = noOutput.versions[0].related.filter(link => link.role === 'execution_log');
  assert.match((await Promise.all(noOutputLogs.map(link => read(link.artifact_id, link.version)))).join('\n'), /Failed to start command: ENOENT/);

  await writeFile(join(workspace, 'legacy.txt'), 'Historical output with no execution observations.\n');
  const unknown = await register('legacy.txt');
  assert.equal(unknown.versions[0].related, undefined);
  await writeFile(join(workspace, 'v1.txt'), 'Version 1 receipt remains readable.\n');
  await writeFile(join(workspace, 'v1.txt.pero-run.json'), JSON.stringify({ schema_version: 1,
    system: 'legacy', run_id: 'legacy-1', outcome: 'failed',
    output_sha256: digest(await readFile(join(workspace, 'v1.txt'))), evidence: [] }));
  const legacy = await register('v1.txt');
  assert.equal(JSON.parse(await linked(legacy, 1, 'run_record')).schema_version, 1);

  const stdout = secondRun.receipt.evidence.find(item => item.role === 'execution_log').path;
  await writeFile(join(workspace, stdout), 'tampered after capture');
  const stale = await request('register_file', { path: 'result.json', artifact_id: first.id });
  assert.equal(stale.kind, 'artifact_error');
  assert.equal(stale.data.reason, 'integrity');
  assert.equal((await request('list')).data.artifacts.find(item => item.id === first.id).versions.length, 2);

  await stop();
  for (const file of await readdir(workspace)) await rm(join(workspace, file), { recursive: true, force: true });
  start();
  await wait(event => event.kind === 'ready');
  const catalog = await request('list');
  assert.equal(catalog.kind, 'artifact_catalog');
  const restored = catalog.data.artifacts.find(item => item.id === first.id);
  assert.deepEqual(restored.versions, second.versions);
  assert.equal(await linked(restored, 1, 'code'), code);
  assert.equal(await linked(restored, 1, 'input'), originalInput);
  assert.equal(JSON.parse(await read(first.id, 1)).sum, 10);
  assert.equal(JSON.parse(await linked(restored, 2, 'run_record')).run_id, 'sum-2');
  const snapshots = {};
  for (const artifact of catalog.data.artifacts) for (const version of artifact.versions) {
    const event = await request('resolve_snapshot', { artifact_id: artifact.id, version: version.version });
    assert.equal(event.kind, 'artifact_snapshot_result');
    assert.equal(event.data.ok, true, JSON.stringify(event));
    const snapshot = event.data.value;
    const bytes = await readFile(snapshot.path);
    assert.equal(digest(bytes), version.sha256);
    assert.equal(bytes.length, version.bytes);
    const file = `host-snapshots/${artifact.id}-v${version.version}.bin`;
    await writeFile(join(output, file), bytes);
    snapshots[`${artifact.id}/${version.version}`] = { filename: snapshot.filename, media: snapshot.media,
      sha256: snapshot.sha256, bytes: snapshot.bytes, file };
  }
  await writeFile(join(output, 'catalog.json'), JSON.stringify({ thread_id: thread,
    artifacts: catalog.data.artifacts, selected: { thread_id: thread, artifact_id: first.id, version: 1 }, view: 'list' }, null, 2));
  await writeFile(join(output, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
  const result = { passed: true, date: new Date().toISOString(), binarySha256: digest(await readFile(binary)),
    level: 'Real local Python and Rust Host with ACP fixture session; no model',
    selected: { artifactId: first.id, version: 1 }, failed: failed.id, cancelled: cancelled.id,
    noOutputFailure: noOutput.id, unknown: unknown.id, legacy: legacy.id,
    python: { executable: environment.python.executable, version: environment.python.version,
      observedPackages: environment.python.packages.length },
    checks: ['real-python-result', 'exact-command-and-arguments', 'input-and-code-hashes', 'interpreter-and-package-observation',
      'same-id-next-version', 'old-version-after-restart-and-source-deletion', 'failure-retains-output-and-logs',
      'caught-cancellation-exit-zero-remains-cancelled', 'v1-sidecar-compatible', 'unknown-artifact-has-no-invented-provenance',
      'no-output-spawn-failure-delivers-run-record-and-logs', 'stale-evidence-rejected-without-new-version',
      'all-retained-snapshot-bytes-and-hashes'],
    limits: ['No model requests', 'No scientific conclusion acceptance', 'No Native or packaged Desktop acceptance'] };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log('Artifact provenance Host acceptance passed: local Python, exact old versions, failure, cancellation and retained evidence.');
} finally {
  await stop();
  await writeFile(join(output, 'host.log'), hostLog);
  await rm(directory, { recursive: true, force: true });
}
