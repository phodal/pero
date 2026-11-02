import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('suggestion list keeps the hint on the name row and scrolls the keyboard selection into view', async t => {
  const env = await createUiRuntime(t, 'suggestion-list');
  if (!env) return;
  const { React, ui, render, dom } = env;
  const options = Array.from({ length: 24 }, (_, index) => ({ id: `p${index}`, label: `@PROG${index}`, hint: index % 2 ? '段落' : '程序' }));
  const scrolled = [];
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  t.after(() => {
    if (typeof HTMLElement !== 'undefined') HTMLElement.prototype.scrollIntoView = previous;
  });
  await render(React.createElement(ui.SuggestionList, {
    options, activeIndex: 0, label: 'Suggestions', onActiveIndex() {}, onSelect() {},
  }));
  const row = document.querySelector('[role="option"]');
  assert.equal(getComputedStyle(row).flexDirection, 'row');
  assert.equal(row.querySelector('.pero-ui-suggestion-label').textContent, '@PROG0');
  assert.equal(row.querySelector('.pero-ui-suggestion-hint').textContent, '程序');
  await render(React.createElement(ui.SuggestionList, {
    options, activeIndex: 23, label: 'Suggestions', onActiveIndex() {}, onSelect() {},
  }));
  assert.ok(scrolled.includes(document.querySelector('[aria-selected="true"]').id));
  void dom;
});

test('suggestion list multiple mode exposes selected options and confirms with Enter', async t => {
  const env = await createUiRuntime(t, 'suggestion-list');
  if (!env) return;
  const { React, ui, render, dom } = env;
  HTMLElement.prototype.scrollIntoView ??= function () {};
  const options = [
    { id: 'a', label: '@A', hint: '文件' },
    { id: 'b', label: '@B', hint: '程序' },
  ];
  const toggled = [];
  let confirmed = [];
  await render(React.createElement(ui.SuggestionList, {
    options, activeIndex: 0, selectedIds: ['a'], selectionMode: 'multiple', label: 'Mentions',
    onActiveIndex() {}, onSelect() {},
    onToggle: option => toggled.push(option.id),
    onConfirm: values => { confirmed = values.map(option => option.id); },
  }));
  const rows = [...document.querySelectorAll('[role="option"]')];
  assert.equal(rows[0].getAttribute('aria-selected'), 'true');
  assert.equal(rows[1].getAttribute('aria-selected'), 'false');
  await React.act(async () => {
    rows[1].dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(toggled, ['b']);
  const event = { key: 'Enter', preventDefault() { this.defaultPrevented = true; } };
  assert.equal(ui.suggestionListKey(event, {
    count: options.length, index: 0, setIndex() {},
    selectionMode: 'multiple', toggle() {}, confirm() { confirmed = ['a']; }, select() {}, close() {},
  }), true);
  assert.deepEqual(confirmed, ['a']);
  assert.equal(event.defaultPrevented, true);
});
