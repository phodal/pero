import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('ToggleGroup keeps exclusive pressed state and ignores empty clear', async t => {
  const env = await createUiRuntime(t, 'toggle-group'); if (!env) return;
  const { React, ui, render } = env;
  const { ToggleGroup, ToggleGroupItem } = ui;
  const picks = [];
  await render(React.createElement(ToggleGroup, {
    type: 'single', value: 'pending', onValueChange: value => { if (value) picks.push(value); },
    'aria-label': 'Review filter',
  },
    React.createElement(ToggleGroupItem, { value: 'pending' }, 'Pending'),
    React.createElement(ToggleGroupItem, { value: 'all' }, 'All')));
  const group = document.querySelector('.pero-ui-toggle-group') || document.querySelector('[role="group"],[role="radiogroup"]');
  assert.ok(group);
  const buttons = [...group.querySelectorAll('button')];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute('data-state'), 'on');
  assert.equal(buttons[1].getAttribute('data-state'), 'off');
  await React.act(async () => buttons[1].click());
  assert.deepEqual(picks, ['all']);
  await render(null);
});
