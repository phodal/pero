import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('experiment requests preserve the latest intent and respect unavailable evidence', async t => {
  const { React, ui, render, click } = await createUiRuntime(t, {
    resolveDir: import.meta.dirname,
    contents: "export { default as ControlLab } from '../ui-src/index.tsx'; export { AppSdkProvider } from '@pero/app-sdk'; export { AppApiError } from '@pero/app-sdk/core';",
  });
  const template = { id: 'robust-pid', title: 'PID', engine: 'python-control', defaultCandidateBudget: 6, candidateBudgetMax: 12,
    parameters: [{ name: 'kp', label: 'Gain', value: 2, min: 0, max: 8, step: .1, unit: '' }], criteria: [], scenarios: [] };
  const experiment = (id, title) => ({ id, title, templateId: template.id, createdAt: '', specHash: 'hash', candidateBudget: 6,
    parameters: { kp: 2 }, criteria: {}, searchSpace: { kp: { min: 0, max: 8 } }, status: 'idle', operation: null,
    progress: { completed: 0, total: 0 }, candidates: [], trials: [], scenarios: [], limitations: [], report: null, error: null });
  const a = experiment('a'.repeat(32), 'Experiment A'), b = experiment('b'.repeat(32), 'Experiment B');
  const reads = [], writes = [];
  const host = { capability: () => null, info: { active: true }, api: {
    get: async path => {
      if (path === '/api/templates') return { templates: [template], capabilities: [{ engine: template.engine, available: true }] };
      if (path === '/api/experiments') return { experiments: [a, b] };
      return new Promise((resolve, reject) => reads.push({ path, resolve, reject }));
    },
    post: async path => new Promise((resolve, reject) => writes.push({ path, resolve, reject })),
  } };
  const mount = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.ControlLab)));
  const open = id => React.act(async () => window.dispatchEvent(new window.MessageEvent('message', {
    source: window.parent, data: { type: 'pero:app:location', location: `experiment/${id}` },
  })));
  const refresh = () => React.act(async () => window.dispatchEvent(new Event('pero:app:data-changed')));
  const resolve = (read, value) => React.act(async () => read.resolve(value));
  const reject = (read, error) => React.act(async () => read.reject(error));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);

  await t.test('newer navigation wins and an abandoned load cannot keep the current object busy', async () => {
    await mount();
    await open(a.id); const first = reads.shift();
    await open(b.id); const second = reads.shift();
    await resolve(second, b);
    await resolve(first, a);
    assert.match(document.body.textContent, /Experiment B/);
    assert.doesNotMatch(document.body.textContent, /Experiment A/);
    await open(a.id); const abandoned = reads.shift();
    await open(b.id); const returned = reads.shift();
    await resolve(returned, b);
    await reject(abandoned, new Error('Old request failed'));
    assert.equal(button('New experiment').disabled, false);
    assert.doesNotMatch(document.body.textContent, /Old request failed/);
    await render(null);
  });

  await t.test('same-object refresh success and failure settle only their own request', async () => {
    await mount(); await open(a.id); await resolve(reads.shift(), a);
    const input = document.querySelector('#kp-value'); input.focus();
    await refresh(); const older = reads.shift();
    await refresh(); const latest = reads.shift();
    await resolve(latest, { ...a, title: 'Newest evidence' });
    await reject(older, new Error('Stale failure'));
    assert.match(document.body.textContent, /Newest evidence/);
    assert.doesNotMatch(document.body.textContent, /Stale failure|Updating this experiment/);
    assert.equal(document.querySelector('#kp-value'), input);
    assert.equal(document.activeElement, input);
    await refresh(); const slow = reads.shift();
    await refresh(); const fast = reads.shift();
    await resolve(fast, { ...a, title: 'Still newest' });
    await resolve(slow, a);
    assert.match(document.body.textContent, /Still newest/);
    await render(null);
  });

  await t.test('polling cannot overwrite a newer refresh or a confirmed cancellation', async () => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await mount(); await open(a.id);
    const running = { ...a, status: 'running', operation: 'evaluate' };
    await resolve(reads.shift(), running);
    await React.act(async () => t.mock.timers.tick(300)); const poll = reads.shift();
    assert.ok(poll);
    await refresh(); await resolve(reads.shift(), { ...running, title: 'Latest progress' });
    await resolve(poll, running);
    assert.match(document.body.textContent, /Latest progress/);
    await React.act(async () => t.mock.timers.tick(600)); const oldPoll = reads.shift();
    assert.ok(oldPoll);
    await click(button('Cancel evaluation'));
    const cancel = writes.shift(); assert.ok(cancel.path.endsWith('/cancel'));
    await refresh(); const duringCancel = reads.shift();
    await resolve(cancel, { ...a, title: 'Cancelled result', status: 'cancelled' });
    await resolve(oldPoll, running);
    await resolve(duringCancel, running);
    assert.doesNotMatch(document.body.textContent, /Updating this experiment/);
    assert.match(document.body.textContent, /Cancelled result/);
    assert.equal(button('Cancel evaluation'), undefined);
    await render(null);
    t.mock.timers.reset();
  });

  await t.test('a pending mutation cannot restore evidence after access is revoked', async () => {
    await mount(); await open(a.id);
    await resolve(reads.shift(), { ...a, status: 'running', operation: 'evaluate' });
    await click(button('Cancel evaluation')); const cancel = writes.shift();
    await refresh(); await reject(reads.shift(), new ui.AppApiError(403, 'Access revoked'));
    await resolve(cancel, { ...a, status: 'cancelled' });
    assert.match(document.body.textContent, /This experiment is unavailable/);
    assert.equal(button('Export'), undefined);
    assert.equal(document.querySelector('#kp-value'), null);
    assert.equal(button('New experiment').disabled, false);
    await click(button('Retry loading'));
    await resolve(reads.shift(), a);
    assert.ok(document.querySelector('#kp-value'));
    await render(null);
  });

  for (const operation of ['search', 'create', 'saved-proposal']) {
    async function startMutation() {
      await mount();
      if (operation === 'saved-proposal') {
        await click(button('Run experiment'));
        const create = writes.shift(); assert.equal(create.path, '/api/experiments');
        await resolve(create, a);
      } else {
        await open(a.id); await resolve(reads.shift(), a);
        await click(button(operation === 'create' ? 'Duplicate settings' : 'Run bounded search'));
      }
      const mutation = writes.shift(); assert.ok(mutation);
      return mutation;
    }
    await t.test(`${operation}: refresh cannot release a pending mutation's busy state`, async () => {
      const mutation = await startMutation();
      await refresh(); await resolve(reads.shift(), a);
      assert.equal(button('New experiment').disabled, true);
      assert.equal(button('Run experiment').disabled, true);
      await resolve(mutation, a);
      assert.equal(button('New experiment').disabled, false);
      await click(button('New experiment'));
      assert.equal(document.querySelector('.experiment-heading'), null);
      await render(null);
    });
    for (const status of [401, 403, 404, 410]) await t.test(`${operation}: POST ${status} removes unavailable evidence`, async () => {
      const mutation = await startMutation();
      await reject(mutation, new ui.AppApiError(status, 'Access unavailable'));
      assert.match(document.body.textContent, /This experiment is unavailable/);
      assert.equal(button('Export'), undefined);
      assert.equal(document.querySelector('#kp-value'), null);
      assert.equal(button('New experiment').disabled, false);
      await click(button('Retry loading'));
      const retry = reads.shift(); assert.ok(retry.path.endsWith(a.id));
      await resolve(retry, a);
      assert.ok(button('Export'));
      await render(null);
    });
  }

  for (const status of [401, 403, 404, 410]) await t.test(`HTTP ${status} removes unavailable evidence and retries the same object`, async () => {
    await mount(); await open(a.id); await resolve(reads.shift(), a);
    await refresh(); await reject(reads.shift(), new ui.AppApiError(status, 'Unavailable'));
    assert.match(document.body.textContent, /This experiment is unavailable/);
    assert.equal(document.querySelector('#kp-value'), null);
    assert.equal(button('Export'), undefined);
    assert.doesNotMatch(document.body.textContent, /Showing the last loaded evidence/);
    await click(button('Retry loading'));
    const retry = reads.shift(); assert.ok(retry.path.endsWith(a.id));
    await resolve(retry, a);
    assert.ok(document.querySelector('#kp-value'));
    assert.doesNotMatch(document.body.textContent, /This experiment is unavailable/);
    await render(null);
  });
});
