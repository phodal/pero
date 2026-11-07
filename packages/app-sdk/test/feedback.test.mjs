import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('feedback keeps recovery details inside the named alert after HTML parsing', async t => {
  const env = await createUiRuntime(t, 'feedback');
  if (!env) return;
  const { React, dom, ui, render } = env;
  await render(React.createElement(ui.Feedback, { kind: 'error', variant: 'block', 'aria-label': 'Import failed' },
    'Source unavailable', React.createElement('details', null, React.createElement('summary', null, 'Details'), 'Original source error'),
    React.createElement('button', null, 'Retry')));
  const parsed = new dom.window.DOMParser().parseFromString(document.body.innerHTML, 'text/html');
  const alert = parsed.querySelector('[role=alert]');
  assert.equal(alert.getAttribute('aria-label'), 'Import failed');
  assert.equal(alert.querySelector('details').textContent, 'DetailsOriginal source error');
  assert.equal(alert.querySelector('button').textContent, 'Retry');
  await render(React.createElement(ui.Feedback, { kind: 'empty' }, 'No data'));
  assert.equal(document.querySelector('.pero-ui-feedback').getAttribute('role'), null);
});
