import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('toolbar is a named layout row without control coercion or key handling', async (t) => {
  const runtime = await createUiRuntime(t, 'toolbar');
  if (!runtime) return;
  const { React, dom, ui: { Toolbar }, render } = runtime;
  const h = React.createElement;
  const ref = React.createRef();
  let keys = 0;
  await render(h(Toolbar, {
    ref, className: 'row', id: 'tools', role: 'group', 'aria-label': 'Filters',
    onKeyDown: () => { keys += 1; },
  },
    h('input', { type: 'search', name: 'q', defaultValue: 'a' }),
    h('button', { type: 'submit' }, 'Apply'),
    h('button', null, 'Reset'),
  ));
  const bar = ref.current;
  assert.equal(bar.tagName, 'DIV');
  assert.equal(bar.id, 'tools');
  assert.equal(bar.getAttribute('role'), 'group');
  assert.equal(bar.getAttribute('aria-label'), 'Filters');
  assert.equal(document.querySelector('[role="toolbar"]'), null);
  assert.ok(bar.classList.contains('pero-ui-toolbar') && bar.classList.contains('row'));
  assert.equal(bar.getAttribute('data-unstyled'), null);
  assert.equal(bar.childElementCount, 3);
  assert.equal(bar.children[0].tagName, 'INPUT');
  assert.equal(bar.children[0].type, 'search');
  assert.equal(bar.children[1].type, 'submit');
  assert.equal(bar.children[2].type, 'submit');
  const input = bar.children[0];
  await React.act(async () => { input.focus(); });
  await React.act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  assert.equal(keys, 1);
  assert.equal(document.activeElement, input);
});

test('toolbar asChild keeps the native form and does not add a node', async (t) => {
  const runtime = await createUiRuntime(t, 'toolbar');
  if (!runtime) return;
  const { React, dom, ui: { Toolbar }, render, click } = runtime;
  const h = React.createElement;
  const formRef = React.createRef();
  let submits = 0;
  let query = null;
  await render(h(Toolbar, {
    asChild: true, ref: formRef, className: 'filters', id: 'filter-form',
    onSubmit: event => {
      event.preventDefault();
      submits += 1;
      query = new dom.window.FormData(event.currentTarget).get('q');
    },
  }, h('form', null,
    h('input', { name: 'q', required: true, defaultValue: '' }),
    h('button', { type: 'submit' }, 'Go'),
  )));
  const form = formRef.current;
  assert.equal(form.tagName, 'FORM');
  assert.equal(form.parentElement.id, 'root');
  assert.equal(form.childElementCount, 2);
  assert.equal(form.querySelector('.pero-ui-toolbar-actions'), null);
  assert.ok(form.classList.contains('pero-ui-toolbar') && form.classList.contains('filters'));
  assert.equal(form.querySelector('button').type, 'submit');
  await click(form.querySelector('button'));
  assert.equal(submits, 0);
  form.querySelector('input').value = 'north';
  await click(form.querySelector('button'));
  assert.equal(submits, 1);
  assert.equal(query, 'north');

  await render(null);
  const navRef = React.createRef();
  let clicks = 0;
  await render(h(Toolbar, { asChild: true, ref: navRef }, h('nav', { onClick: () => { clicks += 1; } }, h('a', { href: '#next' }, 'Next'))));
  assert.equal(navRef.current.tagName, 'NAV');
  assert.equal(navRef.current.childElementCount, 1);
  assert.equal(navRef.current.getAttribute('role'), null);
  await click(navRef.current);
  assert.equal(clicks, 1);

  await render(null);
  await assert.rejects(async () => await render(h(Toolbar, { asChild: true, actions: h('span', null, 'x') }, h('header', null, 'H'))));
});

test('toolbar actions and unstyled children stay in one tree', async (t) => {
  const runtime = await createUiRuntime(t, 'toolbar');
  if (!runtime) return;
  const { React, ui: { Toolbar }, render, click } = runtime;
  const h = React.createElement;
  const ref = React.createRef();
  let actions = 0;
  await render(h(Toolbar, {
    ref, unstyled: true, className: 'bar',
    actions: h('button', { type: 'button', onClick: () => { actions += 1; } }, 'More'),
  }, h('input', { type: 'text', name: 'term' })));
  const bar = ref.current;
  assert.equal(bar.childElementCount, 2);
  assert.equal(bar.children[0].tagName, 'INPUT');
  assert.equal(bar.children[0].type, 'text');
  assert.equal(bar.children[1].className, 'pero-ui-toolbar-actions');
  assert.equal(bar.getAttribute('data-unstyled'), 'true');
  assert.equal(bar.children[1].getAttribute('data-unstyled'), 'true');
  assert.equal(bar.children[1].textContent, 'More');
  await click(bar.querySelector('button'));
  assert.equal(actions, 1);

  await render(null);
  await render(h(Toolbar, null, h('span', null, 'Only')));
  const plain = document.querySelector('.pero-ui-toolbar');
  assert.equal(plain.childElementCount, 1);
  assert.equal(plain.textContent, 'Only');
  assert.equal(plain.querySelector('.pero-ui-toolbar-actions'), null);
  assert.equal(plain.getAttribute('data-unstyled'), null);
});
