import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

const follows = (earlier, later) => (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) === Node.DOCUMENT_POSITION_FOLLOWING;

test('action bar renders scope, utilities, ghost commands, then one primary', async t => {
  const { React, ui: { AppBar, AppFrame }, render } = await createUiRuntime(t, 'layout');
  const h = React.createElement;
  await render(h(AppBar, {
    title: 'Context',
    scope: h('nav', null, 'Views'),
    utilities: h('button', { type: 'button', 'aria-label': 'Refresh' }, 'Refresh'),
    commands: h(React.Fragment, null,
      h('button', { type: 'button' }, 'More'),
      h('button', { type: 'button', 'data-variant': 'ghost' }, 'Add'),
    ),
    primary: h('button', { type: 'button', 'data-variant': 'primary' }, 'Open'),
  }));
  const slots = [...document.querySelectorAll('[data-slot]')].map(node => node.getAttribute('data-slot'));
  assert.deepEqual(slots, ['scope', 'title', 'utilities', 'commands', 'primary']);
  const [scope, utilities, commands, primary] = ['scope', 'utilities', 'commands', 'primary'].map(slot => document.querySelector(`[data-slot="${slot}"]`));
  assert.ok(follows(scope, utilities) && follows(utilities, commands) && follows(commands, primary));
  assert.deepEqual([...commands.querySelectorAll('button')].map(button => button.textContent), ['More', 'Add']);
  assert.equal(commands.querySelector('[data-variant="ghost"]').textContent, 'Add');
  assert.equal(primary.querySelectorAll('button').length, 1);
  assert.equal(primary.querySelector('button').textContent, 'Open');
  assert.equal(primary.querySelector('button').getAttribute('data-variant'), 'primary');
  assert.equal(document.querySelector('.pero-app-bar h1'), null);
  assert.equal(document.querySelector('.pero-app-bar-context').textContent, 'Context');
  assert.equal(utilities.querySelector('button').getAttribute('aria-label'), 'Refresh');

  await render(h(AppBar, {
    title: 'Kept',
    tools: h('span', null, 'Tool'),
    actions: h('button', { type: 'button' }, 'Act'),
    primary: h('button', { type: 'button' }, 'Go'),
  }));
  const tools = document.querySelector('.pero-app-bar-tools');
  const actions = document.querySelector('.pero-app-bar-actions');
  assert.equal(document.querySelector('.pero-app-bar h1'), null);
  assert.equal(document.querySelector('.pero-app-bar-context').textContent, 'Kept');
  assert.ok(tools.textContent.includes('Tool'));
  assert.equal(actions.querySelector('button').textContent, 'Act');
  assert.ok(follows(actions.querySelector('button'), document.querySelector('[data-slot="primary"]')));

  await render(h(AppFrame, { label: 'Data', scope: h('span', null, 'Scope'), primary: h('button', { type: 'button' }, 'Create') }, 'body'));
  assert.equal(document.querySelector('main').getAttribute('aria-label'), 'Data');
  assert.deepEqual([...document.querySelectorAll('[data-slot]')].map(node => node.getAttribute('data-slot')), ['scope', 'primary']);
  assert.equal(document.querySelector('[data-slot="primary"] button').textContent, 'Create');
});
