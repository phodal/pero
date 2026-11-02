import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('Progress keeps a named determinate bar', async t => {
  const env = await createUiRuntime(t, 'progress'); if (!env) return;
  const { React, ui, render } = env;
  const { Progress } = ui;
  await render(React.createElement(Progress, { value: 3, max: 10, label: 'Recording progress' }));
  const bar = document.querySelector('progress.pero-ui-progress');
  assert.ok(bar);
  assert.equal(bar.getAttribute('aria-label'), 'Recording progress');
  assert.equal(bar.value, 3);
  assert.equal(bar.max, 10);
  await render(null);
});
