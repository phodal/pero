import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSelect, expectSelectOptionCount } from './select-control.mjs';

function control(initial = {}) {
  const state = { expanded: 'false', value: '', clicks: [], ...initial };
  const trigger = {
    async getAttribute(name) { return name === 'aria-expanded' ? state.expanded : state.value; },
    async click() { state.clicks.push('button'); state.expanded = 'true'; },
  };
  const option = {
    async click() { state.clicks.push('option'); state.value = 'robust-pid'; state.expanded = 'false'; },
  };
  const scope = {
    getByRole(role) {
      assert.equal(role === 'button' || role === 'listbox', true);
      if (role === 'button') return trigger;
      return { locator(selector) { assert.equal(selector, '[role="option"][data-value="robust-pid"]'); return option; }, getByRole(child) { assert.equal(child, 'option'); return { async count() { return 5; } }; } };
    },
  };
  return { scope, state };
}

test('custom Select is opened from its button and chosen from the listbox option', async () => {
  const { scope, state } = control();
  await chooseSelect(scope, 'Template', 'robust-pid');
  assert.deepEqual(state.clicks, ['button', 'option']);
  assert.equal(state.value, 'robust-pid');
  assert.equal(state.expanded, 'false');
  const open = control({ expanded: 'true' });
  await chooseSelect(open.scope, 'Template', 'robust-pid');
  assert.deepEqual(open.state.clicks, ['option']);
  await expectSelectOptionCount(control().scope, 'Response scenario', 5);
  await assert.rejects(() => chooseSelect(control().scope, 'Template', 'not a value'), /unexpected value/);
});
