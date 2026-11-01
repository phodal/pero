// Independent acceptance assertions over persisted evidence, not model prose.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function verifyExport(initial, exported) {
  const record = exported.experiment;
  for (const key of ['id', 'created_revision', 'spec_hash', 'objective', 'criteria', 'initial_state', 'max_trials', 'max_steps', 'allowed_operations', 'mode'])
    assert.deepEqual(record[key], initial[key], `Frozen ${key} changed`);
  assert.equal(record.mode, 'simulation');
  assert.equal(record.trials.length, 2);
  assert.deepEqual(record.decisions, [], 'Model must not record UI acceptance');
  const [baseline, revision] = record.trials;
  assert.equal(baseline.parent_trial_id, null);
  assert.equal(revision.parent_trial_id, baseline.id);
  assert.notDeepEqual(revision.protocol, baseline.protocol, 'Revision must change the protocol');
  assert.ok(revision.reason?.trim(), 'Revision must explain observed feedback');
  const errors = [];
  for (const trial of record.trials) {
    assert.equal(trial.status, 'completed');
    assert.deepEqual(trial.initial_state, initial.initial_state);
    assert.equal(trial.events.length, trial.protocol.steps.length);
    assert.ok(trial.events.length > 0);
    for (const [index, event] of trial.events.entries()) {
      assert.equal(event.status, 'completed');
      assert.equal(event.backend.version, '0.2.2');
      assert.equal(event.backend.backend, 'LiquidHandlerChatterboxBackend');
      assert.equal(event.backend.mode, 'simulation');
      assert.deepEqual(event.operation, trial.protocol.steps[index]);
      assert.deepEqual(event.before, index ? trial.events[index - 1].after : initial.initial_state);
      for (const well of event.after.wells)
        assert.ok(Math.abs(event.backend.well_volumes_ul[well.id] - well.volume_ul) < 1e-7);
    }
    assert.deepEqual(trial.final_state, trial.events.at(-1).after);
    assert.equal(trial.observations.length, 1);
    const observation = trial.observations[0];
    assert.equal(observation.origin, 'synthetic');
    assert.match(observation.source, /not a device measurement/);
    const bytes = Buffer.from(exported.assets[observation.sha256], 'base64');
    assert.equal(sha256(bytes), observation.sha256);
    assert.deepEqual(JSON.parse(bytes), observation.measurements);
    const measured = observation.measurements.find(m => m.well === initial.criteria.target_well);
    assert.equal(measured.unit, 'fraction');
    const target = trial.final_state.wells.find(w => w.id === initial.criteria.target_well);
    assert.ok(Math.abs(measured.value - Math.min(1, target.red_fraction + .1)) < 1e-12);
    const error = Math.abs(measured.value - initial.criteria.target_fraction);
    errors.push(error);
    assert.ok(Math.abs(trial.verification.absolute_error - error) < 1e-12);
    assert.ok(trial.verification.evidence.includes(observation.sha256));
    const pass = error <= initial.criteria.tolerance + 1e-12 &&
      Math.abs(target.volume_ul - initial.criteria.target_volume_ul) <= initial.criteria.volume_tolerance_ul + 1e-9;
    assert.equal(trial.verification.verdict, pass ? 'PASS' : 'FAIL');
  }
  assert.ok(Math.abs(exported.comparison.improvement - (errors[0] - errors[1])) < 1e-12);
  return { outcome: errors[1] < errors[0] ? 'improved' : errors[1] > errors[0] ? 'worse' : 'unchanged', verdicts: record.trials.map(t => t.verification.verdict), errors, improvement: errors[0] - errors[1], operations: record.trials.map(t => t.events.length) };
}
