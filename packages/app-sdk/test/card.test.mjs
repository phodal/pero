import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('cards preserve native forms, refs and action slots', async (t) => {
  const runtime = await createUiRuntime(t, 'card');
  if (!runtime) return;
  const { React, dom, ui: { Card, CardHeader }, render, click } = runtime;
  const h = React.createElement;

  const formRef = React.createRef();
  let submits = 0;
  let label = null;
  await render(h(Card, {
    asChild: true, unstyled: true, ref: formRef, className: 'extra', id: 'card-form',
    style: { marginTop: '4px' }, 'data-track': 'form',
    onSubmit: event => {
      event.preventDefault();
      submits += 1;
      label = new dom.window.FormData(event.currentTarget).get('label');
    },
  }, h('form', null,
    h('input', { name: 'label', required: true, defaultValue: '' }),
    h('button', { type: 'submit' }, 'Save'),
  )));
  const form = formRef.current;
  assert.equal(form.tagName, 'FORM');
  assert.equal(form.parentElement.id, 'root');
  assert.equal(form.getAttribute('role'), null);
  assert.equal(document.querySelector('[role="region"]'), null);
  assert.ok(form.classList.contains('pero-ui-card') && form.classList.contains('extra'));
  assert.equal(form.getAttribute('data-unstyled'), 'true');
  assert.equal(form.getAttribute('data-track'), 'form');
  assert.equal(form.style.marginTop, '4px');
  assert.equal(form.querySelector('button').type, 'submit');
  await click(form.querySelector('button'));
  assert.equal(submits, 0);
  form.querySelector('input').value = 'hook';
  await click(form.querySelector('button'));
  assert.equal(submits, 1);
  assert.equal(label, 'hook');

  await render(null);
  const articleRef = React.createRef();
  await render(h(Card, { asChild: true, ref: articleRef, title: 'src' }, h('article', null, 'row')));
  assert.equal(articleRef.current.tagName, 'ARTICLE');
  assert.equal(articleRef.current.getAttribute('role'), null);
  assert.equal(articleRef.current.getAttribute('title'), 'src');
  assert.ok(articleRef.current.classList.contains('pero-ui-card'));
  assert.equal(document.querySelector('[role="region"]'), null);

  await render(null);
  await render(h(Card, { 'data-kind': 'plain' }, 'body'));
  const plain = document.querySelector('.pero-ui-card');
  assert.equal(plain.tagName, 'DIV');
  assert.equal(plain.getAttribute('role'), null);
  assert.equal(plain.getAttribute('data-unstyled'), null);
  assert.equal(plain.textContent, 'body');

  await render(null);
  let actions = 0;
  const headerRef = React.createRef();
  await render(h(CardHeader, {
    ref: headerRef, className: 'head', id: 'card-head',
    actions: h('button', { type: 'button', onClick: () => { actions += 1; } }, 'Go'),
  }, h('h2', null, 'Title')));
  const header = headerRef.current;
  assert.equal(header.tagName, 'DIV');
  assert.equal(header.id, 'card-head');
  assert.ok(header.classList.contains('pero-ui-card-header') && header.classList.contains('head'));
  assert.equal(header.querySelector('h2').textContent, 'Title');
  assert.equal(header.querySelector('.pero-ui-card-actions').textContent, 'Go');
  await click(header.querySelector('button'));
  assert.equal(actions, 1);
});

test('card frames keep native disclosure toggling separate from content actions', async t => {
  const runtime = await createUiRuntime(t, 'card');
  if (!runtime) return;
  const { React, ui: { Card }, render, click } = runtime;
  const h = React.createElement;
  let actions = 0;
  await render(h(Card, { asChild: true }, h('details', { open: true },
    h('summary', null, 'Member'),
    h('button', { type: 'button', onClick: () => actions++ }, 'Open session'),
  )));
  const details = document.querySelector('details');
  assert.ok(details.classList.contains('pero-ui-card'));
  assert.equal(details.open, true);
  await click(details.querySelector('button'));
  assert.equal(actions, 1);
  assert.equal(details.open, true);
  await click(details.querySelector('summary'));
  assert.equal(details.open, false);
  assert.equal(actions, 1);
});
