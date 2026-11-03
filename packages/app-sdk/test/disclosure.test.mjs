import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('disclosure is a native details element with controlled reports and retained drafts', async (t) => {
  const runtime = await createUiRuntime(t, 'disclosure');
  if (!runtime) return;
  const { React, ui, render, click } = runtime;
  const { Disclosure } = ui;
  const { createElement: h, useState } = React;

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => React.act(async () => t.mock.timers.runAll());
  async function activate(summary) {
    await click(summary);
    await flush();
  }

  const detailsRef = React.createRef();
  const summaryRef = React.createRef();
  const toggles = [];
  const opened = [];
  await render(h(Disclosure, {
    ref: detailsRef,
    id: 'notes',
    name: 'notes',
    className: 'extra',
    'data-kind': 'meta',
    summary: 'Notes',
    summaryProps: { id: 'notes-summary', className: 'sum', ref: summaryRef },
    onToggle: () => { toggles.push('toggle'); },
    onOpenChange: (next) => { opened.push(next); },
  }, h('input', { 'aria-label': 'draft' })));
  const details = detailsRef.current;
  assert.equal(details, document.getElementById('notes'));
  assert.equal(details.tagName, 'DETAILS');
  assert.equal(details.open, false);
  assert.equal(details.getAttribute('name'), 'notes');
  assert.equal(details.getAttribute('data-kind'), 'meta');
  assert.equal(details.hasAttribute('data-unstyled'), false);
  assert.ok(details.classList.contains('pero-ui-disclosure'));
  assert.ok(details.classList.contains('extra'));
  const summary = details.firstElementChild;
  assert.equal(summary.tagName, 'SUMMARY');
  assert.ok(summary === summaryRef.current, 'the ref retains the native summary');
  assert.equal(summary.id, 'notes-summary');
  assert.equal(summary.className, 'sum');
  assert.equal(summary.querySelectorAll('svg').length, 1);
  assert.equal(summary.firstElementChild.className, 'pero-ui-disclosure-indicator');
  assert.equal(summary.firstElementChild.getAttribute('aria-hidden'), 'true');
  assert.equal(summary.querySelector('svg').getAttribute('width'), '14');
  assert.equal(summary.textContent, 'Notes');
  assert.equal(summary.hasAttribute('role'), false);
  assert.equal(summary.hasAttribute('aria-expanded'), false);
  assert.equal(document.getElementById('notes-summary'), summary);
  assert.equal(summary.nextElementSibling.tagName, 'INPUT');
  assert.equal(details.childElementCount, 2);
  await activate(summary, opened);
  assert.deepEqual(opened, [true]);
  assert.ok(toggles.length >= 1);
  assert.equal(details.open, true);

  function InitialOnly({ defaultOpen }) {
    return h(Disclosure, { id: 'initial', defaultOpen, summary: 'Initial' }, 'body');
  }
  await render(null);
  await render(h(InitialOnly, { defaultOpen: true }));
  assert.equal(document.getElementById('initial').open, true);
  await render(h(InitialOnly, { defaultOpen: false }));
  assert.equal(document.getElementById('initial').open, true);
  assert.equal(document.getElementById('initial').textContent.includes('body'), true);

  const rejected = [];
  function Rejected() {
    const [open] = useState(false);
    return h(Disclosure, { id: 'reject', open, summary: 'Reject', onOpenChange: (next) => { rejected.push(next); } }, h('p', null, 'panel'));
  }
  await render(null);
  await render(h(Rejected));
  await activate(document.querySelector('#reject summary'), rejected);
  assert.deepEqual(rejected, [true]);
  assert.equal(document.getElementById('reject').open, false);
  assert.equal(document.querySelector('#reject p').isConnected, true);

  const accepted = [];
  function Accepted() {
    const [open, setOpen] = useState(false);
    return h(Disclosure, { id: 'accept', open, summary: 'Accept', onOpenChange: (next) => { accepted.push(next); setOpen(next); } }, 'panel');
  }
  await render(null);
  await render(h(Accepted));
  await activate(document.querySelector('#accept summary'), accepted);
  assert.deepEqual(accepted, [true]);
  assert.equal(document.getElementById('accept').open, true);

  const driven = [];
  function Driven() {
    const [open, setOpen] = useState(false);
    return h(React.Fragment, null,
      h('button', { type: 'button', onClick: () => setOpen(true) }, 'force'),
      h(Disclosure, { id: 'drive', open, summary: 'Drive', onOpenChange: (next) => { driven.push(next); } }, 'panel'));
  }
  await render(null);
  await render(h(Driven));
  await click(document.querySelector('button'));
  assert.deepEqual(driven, []);
  assert.equal(document.getElementById('drive').open, true);

  function Draft() {
    const [value, setValue] = useState('seed');
    return h(Disclosure, { id: 'draft', defaultOpen: true, summary: 'Draft' },
      h('input', { 'aria-label': 'draft', value, onChange: (event) => setValue(event.target.value) }));
  }
  await render(null);
  await render(h(Draft));
  const input = document.querySelector('#draft input');
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'kept');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(input.value, 'kept');
  const draftLog = [];
  await activate(document.querySelector('#draft summary'), draftLog);
  assert.equal(document.getElementById('draft').open, false);
  assert.equal(document.querySelector('#draft input').value, 'kept');
  await activate(document.querySelector('#draft summary'), draftLog);
  assert.equal(document.getElementById('draft').open, true);
  assert.equal(document.querySelector('#draft input').value, 'kept');

  await render(null);
  await render(h(Disclosure, { id: 'plain', unstyled: true, summary: 'Plain' }, 'body'));
  const plain = document.getElementById('plain');
  assert.equal(plain.getAttribute('data-unstyled'), 'true');
  assert.ok(plain.classList.contains('pero-ui-disclosure'));
  assert.equal(plain.firstElementChild.textContent, 'Plain');
  assert.equal(plain.childNodes[1].textContent, 'body');
  assert.equal(plain.childElementCount, 1);
});


test('disclosure indicator slots preserve the summary and can hide the shared marker', async t => {
  const env = await createUiRuntime(t, 'disclosure'); if (!env) return;
  const {React,ui:{Disclosure},render,click} = env;
  const h = React.createElement;
  for (const indicator of [null, false]) {
    await render(h(Disclosure, {summary:'Draft details',indicator,unstyled:true}, 'draft'));
    const summary = document.querySelector('summary');
    assert.equal(summary.textContent, 'Draft details');
    assert.equal(summary.hasAttribute('data-no-indicator'), true);
    assert.equal(summary.querySelector('svg'), null);
    assert.equal(summary.querySelector('.pero-ui-disclosure-indicator'), null);
  }
  const actions = [];
  await render(h(Disclosure, {summary: h('button', {type:'button',onClick:()=>actions.push('inspect')}, 'Inspect draft'), indicator: h('svg', {viewBox:'0 0 16 16'},h('path',{d:'M2 8h12'}))}, 'draft'));
  const summary = document.querySelector('summary');
  assert.equal(summary.querySelectorAll('svg').length, 1);
  assert.equal(summary.querySelector('.pero-ui-disclosure-indicator').getAttribute('aria-hidden'), 'true');
  assert.equal(summary.hasAttribute('data-no-indicator'), false);
  await click(summary.querySelector('button'));
  assert.deepEqual(actions, ['inspect']);
  assert.equal(document.querySelector('details').open, false, 'nested button keeps its own native activation');
});
