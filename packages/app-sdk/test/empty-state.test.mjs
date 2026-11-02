import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('paragraph empty state keeps native text, ref, and ARIA without slots', async (t) => {
  const runtime = await createUiRuntime(t, 'empty-state');
  if (!runtime) return;
  const { React, ui: { EmptyState }, render } = runtime;
  const h = React.createElement;
  const ref = React.createRef();
  await render(h(EmptyState, {
    as: 'p', ref, className: 'quiet', id: 'empty-p', role: 'status', 'aria-live': 'polite',
  }, 'Nothing queued'));
  const node = ref.current;
  assert.equal(node.tagName, 'P');
  assert.equal(node.id, 'empty-p');
  assert.equal(node.textContent, 'Nothing queued');
  assert.equal(node.childElementCount, 0);
  assert.equal(node.getAttribute('role'), 'status');
  assert.equal(node.getAttribute('aria-live'), 'polite');
  assert.equal(node.getAttribute('data-unstyled'), null);
  assert.ok(node.classList.contains('pero-ui-empty-state') && node.classList.contains('quiet'));
  assert.equal(node.querySelector('.pero-ui-empty-heading, .pero-ui-empty-icon, .pero-ui-empty-actions'), null);
});

test('composed empty state slots submit through a native form', async (t) => {
  const runtime = await createUiRuntime(t, 'empty-state');
  if (!runtime) return;
  const { React, ui: { EmptyState }, render, click } = runtime;
  const h = React.createElement;
  let submits = 0;
  const ref = React.createRef();
  await render(h('form', {
    onSubmit: event => { event.preventDefault(); submits += 1; },
  }, h(EmptyState, {
    ref,
    icon: h('svg', { 'data-mark': 'mark' }),
    heading: h('h2', null, 'Heading'),
    description: h('p', null, 'Details'),
    actions: h('button', { type: 'submit' }, 'Create'),
  }, 'note')));
  const node = ref.current;
  assert.equal(node.tagName, 'DIV');
  assert.equal(node.getAttribute('role'), null);
  assert.equal(node.getAttribute('aria-live'), null);
  const icon = node.querySelector('.pero-ui-empty-icon');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.querySelector('svg').getAttribute('data-mark'), 'mark');
  assert.equal(node.querySelector('.pero-ui-empty-heading').firstElementChild.tagName, 'H2');
  assert.equal(node.querySelector('.pero-ui-empty-description').firstElementChild.tagName, 'P');
  assert.equal(node.querySelector('.pero-ui-empty-actions > button').type, 'submit');
  assert.equal([...node.childNodes].some(child => child.nodeType === 3 && child.textContent === 'note'), true);
  await click(node.querySelector('button'));
  assert.equal(submits, 1);
});

test('section empty state honors unstyled and hidden, and paragraphs reject slots', async (t) => {
  const runtime = await createUiRuntime(t, 'empty-state');
  if (!runtime) return;
  const { React, ui: { EmptyState }, render } = runtime;
  const h = React.createElement;
  const ref = React.createRef();
  await render(h(EmptyState, { as: 'section', ref, unstyled: true, hidden: true, className: 'sec' }, 'gone'));
  const section = ref.current;
  assert.equal(section.tagName, 'SECTION');
  assert.equal(section.hidden, true);
  assert.equal(section.getAttribute('data-unstyled'), 'true');
  assert.ok(section.classList.contains('pero-ui-empty-state') && section.classList.contains('sec'));
  assert.equal(section.childElementCount, 0);
  assert.equal(section.textContent, 'gone');

  await render(null);
  const original = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(item => String(item?.message || item)).join(' ')); };
  let thrown = null;
  try {
    await render(h(EmptyState, { as: 'p', description: h('span', null, 'nope') }, 'text'));
  } catch (error) {
    thrown = error;
  } finally {
    console.error = original;
  }
  const message = `${thrown?.message || ''}\n${logged.join('\n')}`;
  assert.match(message, /as="p"/);
  assert.equal(document.querySelector('p .pero-ui-empty-description'), null);
  assert.equal(document.querySelector('.pero-ui-empty-state'), null);
});
