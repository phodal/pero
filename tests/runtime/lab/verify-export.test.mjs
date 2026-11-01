import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256, verifyExport } from './verify-export.mjs';

// Small constructed evidence tests the acceptance oracle, not the Lab engine.
function fixture(target = .5, revised = target - .1) {
  const initial = { id: 'experiment', created_revision: 1, spec_hash: 'frozen', mode: 'simulation',
    criteria: { target_well: 'B1', target_fraction: target, tolerance: .01, target_volume_ul: 100, volume_tolerance_ul: 1 },
    initial_state: { wells: [{ id: 'B1', volume_ul: 0, red_fraction: 0 }] } };
  const assets = {};
  const trials = [target, revised].map((red, index) => {
    const operation = { op: 'dispense', resource: 'B1', volume_ul: 100, fixtureRed: red };
    const final = { wells: [{ id: 'B1', volume_ul: 100, red_fraction: red }] };
    const measurements = [{ well: 'B1', value: red + .1, unit: 'fraction' }];
    const bytes = JSON.stringify(measurements), digest = sha256(bytes);
    assets[digest] = Buffer.from(bytes).toString('base64');
    return { id: 'trial-' + index, parent_trial_id: index ? 'trial-0' : null, reason: index ? 'Revise observed discrepancy' : 'Baseline',
      protocol: { steps: [operation] }, status: 'completed', initial_state: initial.initial_state, final_state: final,
      events: [{ status: 'completed', operation, before: initial.initial_state, after: final,
        backend: { backend: 'LiquidHandlerChatterboxBackend', version: '0.2.2', mode: 'simulation', well_volumes_ul: { B1: 100 } } }],
      observations: [{ origin: 'synthetic', source: 'Fixture; not a device measurement', sha256: digest, measurements }],
      verification: { verdict: Math.abs(red + .1 - target) <= .01 ? 'PASS' : 'FAIL', absolute_error: Math.abs(red + .1 - target), evidence: [digest] } };
  });
  return { initial, exported: { experiment: { ...initial, trials, decisions: [] }, assets, comparison: { improvement: trials[0].verification.absolute_error - trials[1].verification.absolute_error } } };
}

test('acceptance requires independently checked linked trials with immutable evidence', () => {
  const { initial, exported } = fixture();
  assert.deepEqual(verifyExport(initial, exported).verdicts, ['FAIL', 'PASS']);
  const mutations = [
    value => { value.experiment.criteria.target_fraction = .6; },
    value => { value.experiment.trials[1].parent_trial_id = 'foreign'; },
    value => { value.experiment.trials[1].verification.verdict = 'FAIL'; },
    value => { value.experiment.trials[1].events[0].backend.version = 'fake'; },
    value => { value.experiment.decisions.push({ decision: 'accepted' }); },
    value => { value.comparison.improvement = 1; },
    value => { value.assets[Object.keys(value.assets)[0]] = Buffer.from('[]').toString('base64'); },
    value => { value.experiment.trials[1].protocol = value.experiment.trials[0].protocol; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(exported); mutate(changed);
    assert.throws(() => verifyExport(initial, changed));
  }
});


test('different frozen targets and worse revisions retain actual outcomes', () => {
  for (const target of [.3, .7]) {
    const { initial, exported } = fixture(target);
    assert.equal(verifyExport(initial, exported).outcome, 'improved');
  }
  const { initial, exported } = fixture(.5, .6);
  assert.equal(verifyExport(initial, exported).outcome, 'worse');
  assert.deepEqual(verifyExport(initial, exported).verdicts, ['FAIL', 'FAIL']);
});
