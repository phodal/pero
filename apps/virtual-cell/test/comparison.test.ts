import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonActive, conditionRows, datasetAction, datasetActive, type ComparisonStatus, type DatasetStatus, type ModelResult } from '../ui-src/comparison.ts';

const support = {
  readouts: { status: 'complete', targets_present: 2, targets_expected: 2, targets_missing: [], endpoints_missing: [] },
  design: { status: 'matched', reasons: [] },
};
const model: ModelResult = {
  model: { id: 'external', version: 'v1' }, metric_status: 'incomplete',
  denominator: { attempted: 2, evaluated: 1, failed: 1 },
  coverage: { attempted: 2, target_readouts_complete: 1, batch_matched: 1 },
  delta_mse: { median: 0 }, skill_vs_reference: { median: null, n: 0, excluded: [{ id: 'A+B', reason: 'reference_exact' }] },
  conditions: [
    { id: 'A+B', status: 'evaluated', delta_mse: 0, support },
    { id: 'A+C', status: 'failed', reason: 'prediction_missing', support: {
      readouts: { ...support.readouts, status: 'incomplete', targets_present: 1, targets_missing: ['C'] },
      design: { status: 'unmatched', reasons: ['batch_sets_mismatch'] },
    } },
  ],
};

test('comparison rows retain failed predictions, readout gaps, skill exclusions and external methods', () => {
  const original = structuredClone(model);
  const rows = conditionRows([model], '', '');
  assert.equal(rows.length, model.denominator.attempted);
  assert.equal(rows[0].method, 'external');
  assert.equal(rows[0].delta_mse, 0);
  assert.equal(rows[0].skill_vs_reference, undefined);
  assert.deepEqual(rows[0].reasons, ['reference_exact']);
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[1].delta_mse, undefined);
  assert.deepEqual(rows[1].reasons, ['prediction_missing', 'batch_sets_mismatch', 'target_readout_missing: C']);
  assert.deepEqual(model, original);
});

test('method and condition filters never change the frozen full denominator', () => {
  const baseline = { ...structuredClone(model), model: { id: 'control', version: 'v1' } };
  assert.equal(conditionRows([baseline, model], '', '').length, 4);
  assert.deepEqual(conditionRows([baseline, model], ' a+c ', 'external').map(row => row.method + ':' + row.id), ['external:A+C']);
  assert.equal(conditionRows([baseline, model], 'missing', '').length, 0);
  assert.deepEqual(model.denominator, { attempted: 2, evaluated: 1, failed: 1 });
});

test('only backend active states remain observable as running, including cancellation in progress', () => {
  const states: [ComparisonStatus, boolean][] = [['starting', true], ['running', true], ['cancelling', true], ['succeeded', false], ['failed', false], ['cancelled', false], ['interrupted', false]];
  for (const [status, active] of states) assert.equal(comparisonActive(status), active, status);
});

test('raw download controls distinguish explicit download, cache verification, retry and terminal readiness', () => {
  const states: [DatasetStatus, boolean, ReturnType<typeof datasetAction>][] = [
    ['idle', false, 'download'], ['cached', false, 'verify'], ['downloading', true, null],
    ['verifying', true, null], ['cancelling', true, null], ['cancelled', false, 'retry'],
    ['failed', false, 'retry'], ['interrupted', false, 'retry'], ['ready', false, null],
  ];
  for (const [status, active, action] of states) {
    assert.equal(datasetActive(status), active, status);
    assert.equal(datasetAction(status), action, status);
  }
});
