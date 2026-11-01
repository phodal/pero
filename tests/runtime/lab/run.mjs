// No provider, model credential, device backend, or arbitrary Agent tool exists here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { setTimeout as poll } from 'node:timers/promises';
import { openHost, root } from './host-harness.mjs';

const [executable, python] = process.argv.slice(2);
assert(isAbsolute(executable || '') && isAbsolute(python || ''), 'Usage: node --experimental-transform-types tests/runtime/lab/run.mjs /absolute/pero-host /absolute/python-venv');
assert.equal(process.platform, 'linux', 'Owned descendant cleanup requires Linux /proc');
const hash = value => createHash('sha256').update(value).digest('hex');
const evidenceRoot = resolve(root, 'test-results/lab-runtime');
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(resolve(evidenceRoot, 'fixture-'));
const result = {
  mode: 'deterministic scripted ACP / actual Rust Host / production Desktop MCP routing / installed real Lab Python backend',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  hostExecutable: executable, hostSHA256: hash(await readFile(executable)),
  manifestSHA256: hash(await readFile(resolve(root, 'apps/lab/app.json'))),
  fixtureSHA256: hash(await readFile(resolve(root, 'tests/fixtures/lab-acp.mjs'))),
  pythonEnvironment: python,
  limits: 'Software simulation only. No GUI, natural model reasoning, physical/biological validity or signed package acceptance. A reused Host binary is not a rebuilt Desktop.',
  startedAt: new Date().toISOString(), checks: {}, hostExits: [],
};
let host;
try {
  host = await openHost({ directory, executable, python });
  const state = await host.backend('/api/state');
  assert.equal(state.engine.available, true, state.engine.error);
  assert.equal(state.engine.version, '0.2.2'); assert.match(state.engine.python, /^3\.12\./);
  result.engine = state.engine;
  const initial = await host.backend('/api/experiments', { max_trials: 2 }, 201);
  const path = '/api/experiments/' + initial.id;
  const unapproved = await host.start();
  const deniedEvents = await host.prompt(unapproved, `Color Mixing experiment ${initial.id}. No frozen approval is attached.`);
  const denial = deniedEvents.filter(event => event.data?.sessionUpdate === 'agent_message_chunk').map(event => event.data.content?.text || '').join('');
  assert.match(JSON.parse(denial.slice('LAB_RESULT:'.length)).error, /APP_GOAL_DENIED/);
  assert.deepEqual(await host.backend(path), initial, 'Unapproved session changed state');
  result.checks.unapprovedActualHostSessionDenied = true;
  const thread = await host.start();
  const events = await host.prompt(thread, `Color Mixing experiment ${initial.id}. Run the bounded deterministic simulation comparison.`, 120000, host.approve(thread, initial));
  const message = events.filter(event => event.data?.sessionUpdate === 'agent_message_chunk').map(event => event.data.content?.text || '').join('');
  assert.ok(message.startsWith('LAB_RESULT:'), 'Expected ACP result marker');
  const fixture = JSON.parse(message.slice('LAB_RESULT:'.length));
  result.fixture = fixture;
  assert.equal(fixture.error, undefined, fixture.error);
  assert.equal(fixture.fixture, true); assert.equal(fixture.realModel, false);
  assert.ok(fixture.steps.some(step => step.rejected && /APP_GOAL_DENIED/.test(step.reason)), 'Foreign experiment must be denied');
  assert.ok(fixture.steps.filter(step => step.rejected && step.action === 'read').length >= 2, 'Foreign App and experiment probes must be rejected');
  result.checks.foreignAppAndExperimentDenied = true;
  const exported = await host.backend(path + '/export');
  const record = exported.experiment;
  result.export = exported;
  assert.equal(record.trials.length, 2);
  for (const key of ['spec_hash', 'objective', 'criteria', 'initial_state', 'max_trials', 'max_steps', 'allowed_operations', 'mode'])
    assert.deepEqual(record[key], initial[key], `Frozen ${key} changed`);
  const [baseline, revision] = record.trials;
  assert.equal(baseline.id, fixture.baselineId); assert.equal(revision.id, fixture.revisionId);
  assert.equal(revision.parent_trial_id, baseline.id);
  assert.equal(baseline.verification.verdict, 'FAIL'); assert.equal(revision.verification.verdict, 'PASS');
  assert.deepEqual(record.decisions, [], 'Agent verification must not claim human acceptance');
  for (const trial of record.trials) {
    assert.equal(trial.status, 'completed'); assert.equal(trial.events.length, 8);
    assert.deepEqual(trial.initial_state, initial.initial_state, 'Every trial starts from frozen virtual state');
    assert.equal(trial.protocol.version, 1);
    for (let index = 0; index < trial.events.length; index++) {
      const event = trial.events[index];
      assert.equal(event.status, 'completed'); assert.equal(event.backend.version, '0.2.2');
      assert.equal(event.backend.mode, 'simulation');
      assert.deepEqual(event.operation, trial.protocol.steps[index]);
      assert.deepEqual(event.before, index ? trial.events[index - 1].after : initial.initial_state);
      for (const well of event.after.wells) assert.ok(Math.abs(event.backend.well_volumes_ul[well.id] - well.volume_ul) < 1e-7);
    }
    assert.deepEqual(trial.final_state, trial.events.at(-1).after);
    const observation = trial.observations[0];
    assert.equal(observation.origin, 'synthetic'); assert.match(observation.source, /not a device measurement/);
    const raw = Buffer.from(exported.assets[observation.sha256], 'base64');
    assert.equal(hash(raw), observation.sha256); assert.deepEqual(JSON.parse(raw), observation.measurements);
    const observed = observation.measurements[0].value;
    const predicted = trial.final_state.wells.find(well => well.id === 'B1').red_fraction;
    assert.ok(Math.abs(observed - predicted - .1) < 1e-12, 'Synthetic observation is not backend prediction');
    assert.ok(Math.abs(trial.verification.absolute_error - Math.abs(observed - initial.criteria.target_fraction)) < 1e-12);
    assert.ok(trial.verification.evidence.includes(observation.sha256));
  }
  assert.ok(Math.abs(exported.comparison.improvement - .1) < 1e-12);
  result.checks.frozenTwoTrialActualPlr = true;
  result.checks.independentObservationEvaluation = true;
  // Boundary requests are deliberate rejected client inputs, not duplicated core transition tests.
  const rejected = [];
  for (const [route, data] of [
    ['/propose', { protocol: revision.protocol, parentTrialId: revision.id, reason: 'Exceeds frozen two-trial budget' }],
    ['/simulate', { trialId: baseline.id }],
    ['/observe', { trialId: baseline.id }],
  ]) rejected.push(await host.backend(path + route, data, 400));
  rejected.push(await host.backend('/api/agent-step', { action: 'read', experimentId: initial.id, criteria: { tolerance: 1 } }, 400));
  rejected.push(await host.backend('/api/agent-step', { action: 'review', experimentId: initial.id, trialId: revision.id, decision: 'accepted' }, 400));
  assert.deepEqual(await host.backend(path + '/export'), exported, 'Rejected request changed evidence/state');
  result.rejections = rejected;
  result.checks.rejectedBoundaryRequestsDoNotMutate = true;
  result.writes = host.writes;
  assert.ok(host.writes.some(event => event.data.tool === 'propose-protocol'));
  assert.ok(host.writes.some(event => event.data.tool === 'experiment-step'));
  result.checks.hostDeclaredToolRouting = true;

  // Separate installed-backend CSV ingress, not a second Agent or human measurement claim.
  const importedExperiment = await host.backend('/api/experiments', { max_trials: 1 }, 201);
  const importPath = '/api/experiments/' + importedExperiment.id;
  const proposed = await host.backend(importPath + '/propose', { protocol: revision.protocol, reason: 'Original-byte imported evidence transport check' });
  const importedTrialId = proposed.trials[0].id;
  await host.backend(importPath + '/validate', { trialId: importedTrialId });
  await host.backend(importPath + '/simulate', { trialId: importedTrialId });
  const deadline = Date.now() + 30000;
  let finished;
  do {
    finished = await host.backend(importPath);
    if (finished.trials[0].status !== 'running') break;
    assert.ok(Date.now() < deadline, 'Imported-observation trial timed out'); await poll(50);
  } while (true);
  assert.equal(finished.trials[0].status, 'completed');
  const csv = 'well,value,unit\nB1,0.5,fraction\n';
  await host.backend(importPath + '/import', { trialId: importedTrialId, filename: 'test.csv', source: 'Synthetic CSV supplied by deterministic integration test; not a device', content_base64: Buffer.from(csv).toString('base64') });
  await host.backend(importPath + '/evaluate', { trialId: importedTrialId });
  const imported = await host.backend(importPath + '/export');
  const observation = imported.experiment.trials[0].observations[0];
  assert.equal(observation.origin, 'imported'); assert.equal(observation.sha256, hash(csv));
  assert.equal(Buffer.from(imported.assets[observation.sha256], 'base64').toString(), csv);
  assert.equal(imported.experiment.trials[0].verification.verdict, 'PASS');
  result.importExport = imported; result.checks.importOriginalBytes = true;
  await writeFile(resolve(directory, 'host-events.json'), JSON.stringify(host.events, null, 2));
  result.hostExits.push(await host.close()); host = undefined;
  host = await openHost({ directory, executable, python });
  assert.deepEqual(await host.backend(path + '/export'), exported, 'Restart changed/reexecuted first experiment');
  assert.deepEqual(await host.backend(importPath + '/export'), imported, 'Restart changed/reexecuted imported experiment');
  result.checks.restartPreservesAttemptIdsEventsAssets = true;
  assert.equal(hash(await readFile(executable)), result.hostSHA256);
} catch (error) { result.failure = String(error.stack || error); }
finally {
  if (host) {
    await writeFile(resolve(directory, 'host-stderr.log'), host.stderr());
    result.hostExits.push(await host.close());
  }
  for (const exit of result.hostExits)
    if (exit.code !== 0 || exit.forcedHost || exit.forcedDescendants || !exit.descendantsExited) result.failure ||= 'Host descendant cleanup failed or forced';
  result.passed = !result.failure; result.finishedAt = new Date().toISOString();
  await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, evidence: directory, checks: result.checks, failure: result.failure }, null, 2));
  if (!result.passed) process.exitCode = 1;
}
