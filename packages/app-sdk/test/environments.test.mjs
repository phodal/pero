import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS, readInspection, observationState, filterMethods, requirementText, OBSERVATION_MAX_AGE_MS } from '../src/environments/model.mjs';
import { inspectEnvironment, createInspectionSession } from '../src/environments/client.mjs';

const target = 'paper-agent.pcgym';
function observation(matched = true) {
  const rule = { kind: 'package', name: 'torch', version: null };
  return { schema: 'pero.environment.inspection.v1', method: target, scope: 'configured-interpreter', evidence: 'metadata_only',
    observed_at_ms: 1000, matched, missing: matched ? [] : [rule],
    profile: { id: 'a'.repeat(64), observation: { name: 'paper-agent', python: { major: 3, minor: 12, patch: 11 }, system: 'Linux', machine: 'x86_64', interpreter_sha256: null, packages: { torch: matched ? '2.0' : null }, native: {} } },
    requirements: { method: target, required: [rule], preferred: [] } };
}
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('catalog contains the supported scientific methods', () => {
  assert.deepEqual(METHODS.map(x => x.id), [target, 'control-lab.python-control', 'control-lab.ngspice', 'virtual-cell.comparison', 'lcms2yield.inference']);
  assert.equal(Object.isFrozen(METHODS), true);
});
test('preserves valid blocked and matching observations without verdicts', () => {
  for (const matched of [false, true]) {
    const report = readInspection(observation(matched), target);
    assert.equal(report.matched, matched); assert.equal(report.scope, 'configured-interpreter');
    assert.equal('verdict' in report, false); assert.equal('use_id' in report, false);
  }
});
test('does not accept one App observation for another method', () => {
  assert.throws(() => readInspection(observation(), 'control-lab.ngspice'));
  const bad = observation(); bad.profile.observation.name = 'control-lab';
  assert.throws(() => readInspection(bad, target));
  const chemistry = observation();
  chemistry.method = 'lcms2yield.inference';
  chemistry.profile.observation.name = 'lcms2yield';
  chemistry.requirements.method = 'lcms2yield.inference';
  assert.equal(readInspection(chemistry, 'lcms2yield.inference').method, 'lcms2yield.inference');
  const virtualCell = observation();
  virtualCell.method = 'virtual-cell.comparison';
  virtualCell.profile.observation.name = 'virtual-cell';
  virtualCell.profile.observation.packages = {};
  virtualCell.requirements = { method: 'virtual-cell.comparison', required: [{kind:'python',major:3,minor:12,patch:null}], preferred: [] };
  assert.equal(readInspection(virtualCell, 'virtual-cell.comparison').matched, true);
});
test('does not silently convert malformed evidence to a match', () => {
  for (const [key, value] of [['schema', 'wrong'], ['scope', 'running-process'], ['evidence', 'verified'], ['matched', 'true'], ['observed_at_ms', NaN], ['missing', null]]) {
    const bad = observation(); bad[key] = value; assert.throws(() => readInspection(bad, target), key);
  }
  const bad = observation(false); bad.matched = true; assert.throws(() => readInspection(bad, target));
});
test('rejects unknown requirement kinds and malformed package observations', () => {
  const bad = observation(); bad.requirements.required = [{ kind: 'gpu', count: 1 }]; assert.throws(() => readInspection(bad, target));
  const bad2 = observation(); bad2.profile.observation.packages.torch = 2; assert.throws(() => readInspection(bad2, target));
  const bad3 = observation(); bad3.profile.id = 'latest'; assert.throws(() => readInspection(bad3, target));
});
test('omits unknown outer transport fields from exported observations', () => {
  assert.equal('authorized' in readInspection({ ...observation(), authorized: true }, target), false);
});
test('stale and future observations never appear current', () => {
  assert.equal(observationState(null, 1000), 'unchecked');
  assert.equal(observationState(observation(), 1000), 'matched');
  assert.equal(observationState(observation(false), 1000), 'blocked');
  assert.equal(observationState(observation(), 999), 'stale');
  assert.equal(observationState(observation(), 1000 + OBSERVATION_MAX_AGE_MS), 'matched');
  assert.equal(observationState(observation(), 1001 + OBSERVATION_MAX_AGE_MS), 'stale');
});
test('filter searches method, App and software without broadening scope', () => {
  const all = METHODS.map(x => x.id), records = { [target]: { state: 'observed', report: observation() } };
  assert.equal(filterMethods(all, 'casadi', 'all', records, 1000)[0].id, target);
  assert.equal(filterMethods([target], 'control', 'all', records, 1000).length, 0);
  assert.equal(filterMethods(all, '', 'matched', records, 1000).length, 1);
  assert.equal(filterMethods(all, '', 'unchecked', records, 1000).length, 4);
  assert.equal(filterMethods(all, 'nothing', 'all', records, 1000).length, 0);
});
test('requirement formatting preserves exact constraints', () => {
  for (const [rule, expected] of [
    [{ kind: 'python', major: 3, minor: 12, patch: null }, 'Python 3.12'],
    [{ kind: 'python', major: 3, minor: 12, patch: 11 }, 'Python 3.12.11'],
    [{ kind: 'package', name: 'torch', version: '2.0' }, 'torch == 2.0'],
    [{ kind: 'native', name: 'ngspice', sha256: null }, 'ngspice'],
    [{ kind: 'platform', system: 'Linux', machine: 'x86_64' }, 'Linux / x86_64'],
  ]) assert.equal(requirementText(rule), expected);
});
test('client submits only the method over the existing local Host route', async () => {
  const signal = new AbortController().signal;
  const report = await inspectEnvironment(target, { signal, fetchFn: async (url, options) => {
    assert.equal(url, '/host/environment'); assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.signal, signal); assert.deepEqual(JSON.parse(options.body), { target });
    return response(observation());
  } });
  assert.equal(report.matched, true);
});
test('rejects an unknown target before dispatch', async () => {
  let calls = 0;
  await assert.rejects(inspectEnvironment('gpu', { fetchFn: async () => { calls++; return response({}); } }));
  assert.equal(calls, 0);
});
test('unavailable and denied Host replies never produce fallback data', async () => {
  for (const status of [403, 404, 405, 500, 503]) {
    await assert.rejects(inspectEnvironment(target, { fetchFn: async () => new Response('Unavailable', { status }) }));
  }
});
test('rejects HTML, oversized replies and invalid observations', async () => {
  for (const content of ['<html>Login</html>', 'a'.repeat(131073), '{}']) {
    await assert.rejects(inspectEnvironment(target, { fetchFn: async () => new Response(content) }));
  }
});
test('parallel clicks for one method share a single in-flight check', async () => {
  let calls = 0, resolve;
  const pending = new Promise(r => { resolve = r; });
  const session = createInspectionSession({ inspect: async () => { calls++; return pending; } });
  const a = session.check(target), b = session.check(target);
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(session.records[target].state, 'loading');
  resolve(observation()); await Promise.all([a, b]); assert.equal(session.records[target].state, 'observed');
  session.dispose();
});
test('failed refresh retains the previous observation with its original timestamp', async () => {
  let fail = false;
  const session = createInspectionSession({ inspect: async () => { if (fail) throw new Error('Probe failed'); return observation(); } });
  await session.check(target); assert.equal(session.records[target].report.matched, true);
  fail = true; await session.check(target);
  assert.equal(session.records[target].state, 'error'); assert.equal(session.records[target].report.observed_at_ms, 1000);
  assert.equal(session.records[target].error, 'Probe failed');
  session.dispose();
});
test('late observation after disposal cannot repaint the task or mutate its verdict', async () => {
  let resolve, updates = 0, observedSignal;
  const pending = new Promise(r => { resolve = r; });
  const session = createInspectionSession({ changed: () => updates++, inspect: async (_, { signal }) => { observedSignal = signal; return pending; } });
  const done = session.check(target); await Promise.resolve();
  const count = updates; session.dispose(); assert.equal(observedSignal.aborted, true);
  resolve(observation()); await done; assert.equal(updates, count);
});

test('authorization and removed-source replies revoke the previous observation', async () => {
  for (const status of [401, 403, 404, 410]) {
    let denied = false;
    const session = createInspectionSession({ inspect: (method, {signal}) => inspectEnvironment(method, {signal, fetchFn: async () => denied ? new Response('Access revoked', {status}) : response(observation())}) });
    await session.check(target); assert.ok(session.records[target].report);
    denied = true; await session.check(target);
    assert.equal(session.records[target].state, 'error'); assert.equal(session.records[target].report, undefined);
    session.dispose();
  }
});

test('background recheck retains evidence while pending and replaces it on success', async () => {
  let release;
  let next = Promise.resolve(observation());
  const session = createInspectionSession({inspect: () => next});
  await session.check(target);
  next = new Promise(resolve => {release = resolve;});
  const check = session.check(target);
  assert.equal(session.records[target].state, 'loading');
  assert.equal(session.records[target].report.observed_at_ms, 1000);
  release({...observation(),observed_at_ms:2000}); await check;
  assert.equal(session.records[target].report.observed_at_ms, 2000); session.dispose();
});
