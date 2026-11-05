import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

// These deliberately small observations test presentation, not a scientific engine.
test('result transitions keep empty, running, failed and partial evidence distinct', async t => {
  const { React, ui, render, click } = await createUiRuntime(t, { resolveDir: import.meta.dirname, contents: "export { Results, Evidence } from '../ui-src/results.tsx';" });
  const experiment = { id: 'local', templateId: 'robust-pid', title: 'Test', createdAt: '', specHash: 'test-hash', candidateBudget: 6,
    parameters: { kp: 2 }, criteria: {}, searchSpace: { kp: { min: 0, max: 8 } }, status: 'idle', operation: null,
    progress: { completed: 0, total: 0 }, error: null, candidates: [], lockedCandidateId: null, trials: [], report: null, limitations: [],
    scenarios: [{ id: 'a', label: 'Nominal', role: 'search', parameters: {} }, { id: 'b', label: 'Disturbed', role: 'search', parameters: {} }, { id: 'final', label: 'Held out', role: 'verification', parameters: {} }] };
  const show = current => render(React.createElement(ui.Results, { experiment: current, selectedId: 'candidate', draft: { kp: 2 }, onDraft() {}, onSelect() {} }));
  await show(experiment);
  assert.match(document.body.textContent, /Ready for the first response/);
  assert.equal(document.querySelector('.verify-list'), null);
  assert.equal(document.querySelector('.curve-legend'), null);
  assert.equal(document.querySelector('[aria-label="Response scenario"]'), null);
  assert.doesNotMatch(document.body.textContent, /Not available|NOT_RUN/);
  await show({ ...experiment, status: 'running' });
  assert.match(document.body.textContent, /Simulation running/);
  assert.equal(document.querySelector('.curve-legend'), null);
  const failed = { id: 'trial-1', candidateId: 'candidate', scenarioId: 'a', phase: 'search', status: 'failed', error: 'Solver stopped before output', observation: null, report: null };
  const current = { ...experiment, status: 'failed', candidates: [{ id: 'candidate', label: 'A', parameters: { kp: 2 }, score: null, verdict: 'NOT_RUN' }], trials: [failed] };
  await show(current);
  assert.match(document.querySelector('[role=alert]').textContent, /Solver stopped/);
  assert.equal(document.querySelector('.verdict-header').classList.contains('INCONCLUSIVE'), false);
  const observed = { ...failed, status: 'completed', error: null, observation: { id: 'observation', engine: 'test', engineVersion: '1', series: [{ name: 'reference', unit: '', x: [0, 1], y: [0, 1] }], diagnostics: [] }, report: { verdict: 'PASS', checks: [{ name: 'Target overshoot', verdict: 'PASS', actual: 0, limit: .1, message: 'Nominal only' }] } };
  await show({ ...current, status: 'completed', trials: [observed] });
  assert.equal(document.querySelectorAll('[role=tab]').length, 1);
  assert.match(document.querySelector('.verdict-header').textContent, /Evidence inconclusive/);
  await render(React.createElement(ui.Evidence, { experiment: current }));
  assert.equal(document.querySelectorAll('details').length, 0);
  assert.match(document.querySelector('[role=alert]').textContent, /Solver stopped/);
  assert.ok(document.querySelector('[aria-label="Execution evidence"]'));
  assert.match(document.body.textContent, /No check report/);
});
