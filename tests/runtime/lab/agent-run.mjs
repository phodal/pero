// Opt-in real Agent acceptance; launch configuration is supplied by the operator.
// No direct provider client or model implementation lives in this runner.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { openHost, root } from './host-harness.mjs';
import { sha256, verifyExport } from './verify-export.mjs';
import { readTrajectory, verifyTrajectory } from './trajectory.mjs';
import { scrubTree } from '../research-import/cleanup.mjs';

const [executable, python, agentExecutable, endpoint, model, audit, target = '0.5', tolerance = '0.05', objective] = process.argv.slice(2);
assert([executable, python, agentExecutable, audit].every(p => isAbsolute(p || '')),
  'Usage: node --experimental-transform-types tests/runtime/lab/agent-run.mjs /absolute/host /absolute/python-venv /absolute/go-agent endpoint model /absolute/fresh-audit [target-fraction] [tolerance] [objective]');
assert.equal(process.platform, 'linux');
assert(endpoint && model, 'Explicit provider endpoint/model required');
// Same selective credential seam as the existing research-import Host runner.
// Operator supplies one line over stdin; it is never written to configuration.
assert(!process.stdin.isTTY, 'Credential input must be a non-echo pipe');
let credential = '';
for await (const chunk of process.stdin) {
  credential += chunk;
  assert(credential.length <= 4096, 'Invalid credential input');
}
credential = credential.trim();
assert(/^[\x21-\x7e]{8,4096}$/.test(credential), 'Supply one credential via stdin');
const scrub = value => String(value).split(credential).join('[REDACTED]');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '', 'Commit source before recording acceptance');
const output = resolve(root, 'test-results/lab-agent');
await mkdir(output, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(resolve(output, 'attempt-'));
const sessions = resolve(directory, 'sessions');
await mkdir(sessions, { mode: 0o700 });
const agent = { id: 'lab-agent', name: 'Lab Go Harness', command: agentExecutable,
  args: ['--endpoint', endpoint, '--model', model, '--session-dir', sessions,
    '--api-key-env', 'LAB_ACCEPTANCE_KEY', '--approval', 'ask', '--http-attempt-audit', audit,
    ...(process.env.LAB_USE_ENV_PROXY === '1' ? ['--use-env-proxy'] : [])] };
const result = {
  mode: 'real Agent / Go Harness / Rust Host / production Desktop MCP / actual PLR Chatterbox',
  provider: { endpoint, model },
  scenario: { targetFraction: Number(target), tolerance: Number(tolerance), ...(objective === undefined ? {} : { objective }) },
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: git('rev-parse', 'HEAD^{tree}'),
  sourceStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  hostSHA256: sha256(await readFile(executable)), agentSHA256: sha256(await readFile(agentExecutable)),
  manifestSHA256: sha256(await readFile(resolve(root, 'apps/lab/app.json'))),
  skillSHA256: sha256(await readFile(resolve(root, 'crates/pero-runtime/src/app-use-skill.md'))),
  startedAt: new Date().toISOString(), hostExits: [],
  limits: 'Headless simulation only; frozen goal supplied by trusted test client, not a UI click or verified human identity. No physical or biological claim.',
};
async function auditCount() {
  const text = await readFile(audit, 'utf8');
  assert(/^(attempt\n)*$/.test(text), 'Malformed HTTP attempt audit');
  return text.length / 'attempt\n'.length;
}
let host, exported;
try {
  result.httpAttemptsBefore = await auditCount();
  assert.equal(result.httpAttemptsBefore, 0, 'Use a fresh empty HTTP audit file for this attempt');
  host = await openHost({ directory, executable, python, agent, credential });
  const state = await host.backend('/api/state');
  assert.equal(state.engine.available, true, state.engine.error);
  assert.equal(state.engine.version, '0.2.2');
  assert.match(state.engine.python, /^3\.12\./);
  result.engine = state.engine;
  const initial = await host.backend('/api/experiments', { target_fraction: Number(target), tolerance: Number(tolerance), max_trials: 2, ...(objective === undefined ? {} : { objective }) }, 201);
  await writeFile(resolve(directory, 'frozen.json'), JSON.stringify(initial, null, 2), { mode: 0o600 });
  const path = '/api/experiments/' + initial.id;
  const thread = await host.start();
  const first = `Color Mixing experiment ${initial.id}. Use only the declared Lab tools. Read its frozen objective, criteria and virtual resource state. Propose your own initial typed protocol for the target; validate and simulate it, attach the synthetic observation and independently evaluate. Complete exactly ONE trial this turn, then report the observed discrepancy and stop before proposing a revision. Do not change the frozen criteria or record review acceptance. This is a software simulation, not a physical experiment.`;
  await host.prompt(thread, first, 600000, host.approve(thread, initial));
  const baseline = await host.backend(path);
  await writeFile(resolve(directory, 'baseline.json'), JSON.stringify(baseline, null, 2), { mode: 0o600 });
  assert.equal(baseline.trials.length, 1, 'First turn must complete exactly one model-proposed trial');
  assert.equal(baseline.trials[0].status, 'completed');
  assert(['PASS', 'FAIL'].includes(baseline.trials[0].verification?.verdict));
  await host.prompt(thread, `Continue the same Color Mixing experiment ${initial.id}. Read the first trial's persisted protocol, synthetic observation and verification. Based on that feedback, propose ONE revised protocol linked to the first trial, explaining the discrepancy and your change. Validate, simulate, observe, evaluate and compare using the declared Lab tools. Keep all frozen rules unchanged. Stop after this second trial; report actual results and limitations, without UI review acceptance.`, 600000);
  exported = await host.backend(path + '/export');
  await writeFile(resolve(directory, 'export.json'), JSON.stringify(exported, null, 2), { mode: 0o600 });
  result.checks = verifyExport(initial, exported);
  result.trajectoryChecks = verifyTrajectory(await readTrajectory(sessions), exported.experiment.trials);
  assert.equal(host.writes.filter(e => e.data.tool === 'propose-protocol').length, 2);
  assert(host.writes.some(e => e.data.tool === 'experiment-step'));
  await writeFile(resolve(directory, 'host-events.json'), JSON.stringify(host.events, null, 2), { mode: 0o600 });
  const completedHost = host; host = undefined;
  result.hostExits.push(await completedHost.close());
  host = await openHost({ directory, executable, python });
  assert.deepEqual(await host.backend(path + '/export'), exported, 'Restart must not change or replay evidence');
  result.restartPreserved = true;
  assert.equal(sha256(await readFile(executable)), result.hostSHA256);
  assert.equal(sha256(await readFile(agentExecutable)), result.agentSHA256);
} catch (error) { result.failure = scrub(error.stack || error); }
finally {
  if (host) {
    await writeFile(resolve(directory, 'host-events-final.json'), JSON.stringify(host.events, null, 2), { mode: 0o600 });
    await writeFile(resolve(directory, 'host-stderr.log'), host.stderr(), { mode: 0o600 });
    try { result.hostExits.push(await host.close()); }
    catch (error) { result.cleanupFailure = String(error); result.failure ||= result.cleanupFailure; }
  }
  for (const exit of result.hostExits)
    if (exit.code !== 0 || exit.forcedHost || exit.forcedDescendants || !exit.descendantsExited) result.failure ||= 'Host descendant cleanup failed or forced';
  try {
    result.httpAttemptsAfter = await auditCount();
    result.httpAttemptsThisRun = result.httpAttemptsBefore === undefined ? null : result.httpAttemptsAfter - result.httpAttemptsBefore;
  } catch (error) {
    result.httpAttemptsThisRun = null; result.auditFailure = String(error); result.failure ||= result.auditFailure;
  }
  try {
    const events = await readTrajectory(sessions);
    result.usage = events.filter(e => e.type === 'assistant/message').map(e => e.data.usage ?? null);
    result.providerErrors = events.filter(e => /error|retry/.test(e.type)).map(e => ({ type: e.type, data: e.data }));
    result.sessionEventCount = events.length;
    assert.equal(git('rev-parse', 'HEAD'), result.sourceCommit, 'Source changed during run');
    assert.equal(git('status', '--porcelain'), '', 'Source dirtied during run');
    assert.equal(sha256(await readFile(resolve(root, 'crates/pero-runtime/src/app-use-skill.md'))), result.skillSHA256);
  } catch (error) { result.usage ??= null; result.evidenceFailure = scrub(error); result.failure ||= result.evidenceFailure; }
  try { if (await scrubTree(directory, credential)) result.failure ||= 'Credential echo was removed from private evidence'; }
  catch (error) { result.failure ||= scrub(error); }
  result.status = result.failure ? 'failed' : 'passed';
  result.passed = !result.failure; result.finishedAt = new Date().toISOString();
  await writeFile(resolve(directory, 'result.json'), scrub(JSON.stringify(result, null, 2)), { mode: 0o600 });
  console.log(scrub(JSON.stringify({ passed: result.passed, evidence: directory, checks: result.checks, failure: result.failure, status: result.status }, null, 2)));
  if (!result.passed) process.exitCode = 1;
}
