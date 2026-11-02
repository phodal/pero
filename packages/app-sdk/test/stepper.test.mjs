import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('stepper selects a step by click, marks it as current and names its IN/OUT groups', async t => {
  const env = await createUiRuntime(t, 'stepper'); if (!env) return;
  const { React, dom, ui, render } = env;
  const { Stepper } = ui;
  const picks = [];
  const view = value => React.createElement(Stepper, {
    label: 'Stages', value, onValueChange: id => picks.push(id),
    items: [{ id: 'a', title: 'First', status: 'done', tone: 'app' }, { id: 'b', title: 'Second', badge: 'Stops here', status: 'blocked' }],
    start: { tag: 'IN', label: 'Inputs', children: React.createElement('li', null, 'Recording') },
    end: { tag: 'OUT', label: 'Outputs', children: React.createElement('li', null, 'Report') },
  });
  await render(view('a'));
  const list = document.querySelector('ol.pero-ui-stepper');
  assert.equal(list.getAttribute('aria-label'), 'Stages');
  assert.deepEqual([...list.querySelectorAll('[role=group]')].map(group => group.getAttribute('aria-label')), ['Inputs', 'Outputs']);
  const nodes = [...list.querySelectorAll('button')];
  assert.deepEqual(nodes.map(node => node.getAttribute('aria-pressed')), ['true', 'false']);
  assert.equal(nodes[0].getAttribute('aria-current'), 'step');
  assert.equal(nodes[0].getAttribute('data-tone'), 'app');
  assert.equal(nodes[1].getAttribute('data-status'), 'blocked');
  await React.act(async () => { nodes[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(picks, ['b'], 'the caller owns the selection');
  assert.equal(list.querySelectorAll('[aria-pressed=true]').length, 1);
  assert.equal(document.querySelectorAll('#pero-app-ui-styles').length, 1);
});
