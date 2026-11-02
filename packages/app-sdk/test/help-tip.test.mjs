import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

/** Flush owner-window timers synchronously. Hover delay must not wait on the wall clock. */
function installFakeTimers(dom) {
  const tasks = new Map();
  let next = 1;
  const setTimeout = (fn, _delay, ...args) => {
    const id = next++;
    tasks.set(id, () => fn(...args));
    return id;
  };
  const clearTimeout = id => { tasks.delete(id); };
  const previous = Object.getOwnPropertyDescriptor(dom.window, 'setTimeout');
  const previousClear = Object.getOwnPropertyDescriptor(dom.window, 'clearTimeout');
  Object.defineProperty(dom.window, 'setTimeout', { configurable: true, writable: true, value: setTimeout });
  Object.defineProperty(dom.window, 'clearTimeout', { configurable: true, writable: true, value: clearTimeout });
  return {
    flush() {
      for (const id of [...tasks.keys()]) {
        const fn = tasks.get(id);
        tasks.delete(id);
        fn?.();
      }
    },
    restore() {
      if (previous) Object.defineProperty(dom.window, 'setTimeout', previous);
      if (previousClear) Object.defineProperty(dom.window, 'clearTimeout', previousClear);
    },
  };
}

test('info tip pins, describes, and dismisses without taking the parent Escape', async t => {
  const env = await createUiRuntime(t, 'help-tip');
  if (!env) return;
  const { React, dom, ui, render, click } = env;
  const { InfoTip } = ui;
  const timers = installFakeTimers(dom);
  t.after(() => timers.restore());

  const show = async button => {
    await React.act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
      button.focus();
      timers.flush();
    });
  };
  const escape = async target => {
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await React.act(async () => { target.dispatchEvent(event); timers.flush(); });
    return event;
  };
  const tip = () => document.querySelector('[role="tooltip"]');
  const button = () => document.querySelector('.pero-ui-help-tip-button');

  await t.test('hover and focus show text; click pins and unpins', async () => {
    await render(React.createElement(InfoTip, { label: 'Details', text: 'A short explanation', align: 'start', className: 'feature-tip', buttonClassName: 'feature-button' }));
    const trigger = button();
    assert.equal(trigger.getAttribute('aria-label'), 'Details');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(trigger.type, 'button');
    const root = document.querySelector('.pero-ui-help-tip');
    assert.equal(root.getAttribute('data-align'), 'start');
    assert.equal(root.className.includes('feature-tip'), true);
    assert.equal(trigger.className.includes('pero-ui-help-tip-button'), true);
    assert.equal(trigger.className.includes('feature-button'), true);
    await show(trigger);
    const open = tip();
    assert.ok(open);
    assert.equal(open.textContent, 'A short explanation');
    assert.equal(trigger.getAttribute('aria-describedby').split(/\s+/).includes(open.id), true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'hover is not the pinned state');
    await click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(root.getAttribute('data-open'), 'true');
    assert.equal(tip().textContent, 'A short explanation');
    await React.act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true }));
      timers.flush();
    });
    assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'leaving the button keeps a pin');
    await click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(root.hasAttribute('data-open'), false);
    await render(null);
  });

  await t.test('outside pointer closes the pin and still moves focus', async () => {
    await render(React.createElement(InfoTip, { label: 'Details', text: 'Read me' }));
    const trigger = button();
    await click(trigger);
    const outside = document.createElement('button');
    outside.type = 'button';
    outside.textContent = 'Outside';
    let focused = 0;
    outside.addEventListener('focus', () => { focused += 1; });
    document.body.appendChild(outside);
    const event = new dom.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    await React.act(async () => {
      outside.dispatchEvent(event);
      outside.focus();
    });
    assert.equal(event.defaultPrevented, false);
    assert.equal(focused, 1);
    assert.equal(document.activeElement, outside);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    outside.remove();
    await render(null);
  });

  await t.test('pointer on a second tip does not unpin that instance', async () => {
    await render(React.createElement(React.Fragment, null,
      React.createElement(InfoTip, { label: 'First', text: 'One' }),
      React.createElement(InfoTip, { label: 'Second', text: 'Two' }),
    ));
    const [first, second] = document.querySelectorAll('.pero-ui-help-tip-button');
    await click(first);
    await click(second);
    assert.equal(first.getAttribute('aria-expanded'), 'true');
    assert.equal(second.getAttribute('aria-expanded'), 'true');
    await React.act(async () => {
      second.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    assert.equal(first.getAttribute('aria-expanded'), 'false');
    assert.equal(second.getAttribute('aria-expanded'), 'true');
    await render(null);
  });

  await t.test('pinned Escape stops before the parent and the next Escape does not', async () => {
    let parentEscapes = 0;
    await render(React.createElement('div', {
      onKeyDown: event => { if (event.key === 'Escape') parentEscapes += 1; },
    }, React.createElement(InfoTip, { label: 'Details', text: 'A short explanation' })));
    const trigger = button();
    await click(trigger);
    const consumed = await escape(trigger);
    assert.equal(consumed.defaultPrevented, true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(parentEscapes, 0);
    const released = await escape(trigger);
    assert.equal(released.defaultPrevented, false);
    assert.equal(parentEscapes, 1);
    await render(null);
  });

  await t.test('ref, label fallback, existing description ids, and container', async () => {
    const ref = React.createRef();
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    await render(React.createElement(InfoTip, {
      ref, text: 'Fallback copy', 'aria-describedby': 'existing-note', container: slot, title: 'More',
    }));
    const trigger = button();
    assert.equal(ref.current, trigger);
    assert.equal(trigger.getAttribute('aria-label'), 'Fallback copy');
    assert.equal(trigger.getAttribute('title'), 'More');
    const described = trigger.getAttribute('aria-describedby').split(/\s+/);
    assert.equal(described.includes('existing-note'), true);
    assert.equal(described.some(id => id.startsWith('existing-note')), true);
    await show(trigger);
    const open = tip();
    assert.ok(open);
    assert.equal(open.textContent, 'Fallback copy');
    assert.equal(slot.contains(open), true);
    await click(trigger);
    assert.equal(slot.contains(tip()), true);
    assert.equal(document.querySelector('.pero-ui-help-tip').getAttribute('data-align'), 'center');
    slot.remove();
    await render(null);
  });
});
