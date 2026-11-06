import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('experiment refresh retains one workbench, draft, focus and evidence; object switch resets the draft', async t => {
  const { React, ui, render, click } = await createUiRuntime(t, { resolveDir: import.meta.dirname, contents: "export { default as ControlLab } from '../ui-src/index.tsx'; export { AppSdkProvider } from '@pero/app-sdk';" });
  const template = { id: 'robust-pid', title: 'PID', engine: 'python-control', defaultCandidateBudget: 6, candidateBudgetMax: 12,
    parameters: [{ name: 'kp', label: 'Proportional gain', value: 2, min: 0, max: 8, step: .1, unit: '' }], criteria: [], scenarios: [{ id: 'nominal', label: 'Nominal', role: 'search', parameters: {} }] };
  let current = { id: 'a'.repeat(32), title: 'PID', templateId: template.id, createdAt: '', specHash: 'hash', candidateBudget: 6,
    parameters: { kp: 2 }, criteria: {}, searchSpace: { kp: { min: 0, max: 8 } }, status: 'idle', operation: null,
    progress: { completed: 0, total: 0 }, candidates: [], trials: [], scenarios: template.scenarios, limitations: [], report: null, error: null };
  let failRead = false;
  const host = { capability: () => null, info: { active: true }, api: {
    get: async path => {
      if (path === '/api/templates') return { templates: [template], capabilities: [{ engine: template.engine, available: true, version: "test" }] };
      if (path === '/api/experiments') return { experiments: [current] };
      if (failRead) throw new Error('Read interrupted');
      return structuredClone(current);
    },
    post: async path => {
      if (path.endsWith('/propose')) current = { ...current, status: 'running', operation: 'evaluate', candidates: [
        { id: 'baseline', label: 'Baseline', parameters: { kp: 5 }, verdict: 'NOT_RUN' },
        { id: 'proposal', label: 'New proposal', parameters: { kp: 5 }, verdict: 'NOT_RUN' },
      ] };
      return structuredClone(current);
    },
  } };
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.ControlLab)));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  await click(button('Freeze specification'));
  const refresh = () => React.act(async () => window.dispatchEvent(new Event('pero:app:data-changed')));
  const input = document.querySelector('#kp-value');
  input.focus();
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '3');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(input.value, '3');
  for (let index = 0; index < 3; index++) {
    await refresh();
    assert.equal(document.querySelectorAll('.workbench').length, 1);
    assert.equal(document.querySelectorAll('#kp-value').length, 1);
    assert.equal(document.querySelector('#kp-value'), input);
    assert.equal(input.value, '3');
    assert.equal(document.activeElement, input);
  }
  failRead = true;
  await refresh();
  assert.match(document.body.textContent, /Showing the last loaded evidence/);
  assert.equal(input.value, '3');
  failRead = false;
  await click(button('Retry refresh'));
  assert.doesNotMatch(document.body.textContent, /Showing the last loaded evidence/);
  assert.equal(input.value, '3');
  current = { ...current, id: 'b'.repeat(32), parameters: { kp: 5 } };
  await React.act(async () => window.dispatchEvent(new window.MessageEvent('message', { source: window.parent, data: { type: 'pero:app:location', location: `experiment/${current.id}` } })));
  assert.equal(document.querySelectorAll('.workbench').length, 1);
  assert.equal(document.querySelector('#kp-value').value, '5');
  await click(button('Run experiment'));
  assert.equal(document.querySelectorAll('.workbench').length, 1);
  await click(button('Cancel evaluation'));
  assert.ok(button('Cancelling…').disabled);
  current = { ...current, status: 'cancelled', operation: null, trials: [{ id: 'trial', candidateId: 'proposal', scenarioId: 'nominal', phase: 'search', status: 'cancelled', error: null, observation: null, report: null }] };
  await refresh();
  assert.equal(button('Cancelling…'), undefined);
  assert.equal(document.querySelectorAll('.workbench').length, 1);
  assert.equal(document.querySelector('[aria-label="Selected candidate"] [data-state="checked"]').closest('label').textContent, 'New proposal');
  assert.match(document.body.textContent, /Simulation cancelled/);
});
