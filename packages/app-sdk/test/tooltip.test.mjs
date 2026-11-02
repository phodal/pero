import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

function box(x, y, width, height) {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() { return { x, y, width, height }; } };
}

function clock(win) {
  const jobs = [];
  let next = 1;
  const set = win.setTimeout.bind(win);
  const clear = win.clearTimeout.bind(win);
  win.setTimeout = (fn, ms = 0) => {
    const id = next++;
    jobs.push({ id, fn, ms });
    return id;
  };
  win.clearTimeout = id => {
    const index = jobs.findIndex(job => job.id === id);
    if (index >= 0) jobs.splice(index, 1);
  };
  return {
    pending: () => jobs.length,
    flush() {
      const due = jobs.splice(0, jobs.length);
      for (const job of due) job.fn();
    },
    restore() {
      win.setTimeout = set;
      win.clearTimeout = clear;
    },
  };
}

test('tooltip anchor contract, triggers, dismissal, and popup geometry', async t => {
  const env = await createUiRuntime(t, 'tooltip');
  if (!env) return;
  const { React, dom, ui, render } = env;
  const { Tooltip } = ui;
  const tip = () => document.querySelector('[role="tooltip"]');
  const enter = node => React.act(async () => {
    node.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
  });
  const leave = node => React.act(async () => {
    node.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true }));
  });
  const focus = node => React.act(async () => {
    node.focus();
  });
  const blur = node => React.act(async () => {
    node.blur();
  });

  await t.test('focus moved away within the same batch (dialog initial focus) leaves a controlled tip hidden', async () => {
    const Owner = () => {
      const [open, setOpen] = React.useState(false);
      return React.createElement(Tooltip, { label: 'Help', open, onOpenChange: setOpen },
        React.createElement('button', { type: 'button', id: 'tip-anchor' }, 'i'));
    };
    await render(React.createElement(Owner));
    await React.act(async () => { document.getElementById('tip-anchor').focus(); document.getElementById('tip-anchor').blur(); });
    assert.equal(tip(), null);
  });

  await t.test('chains handlers and refs and appends aria-describedby only while shown', async () => {
    await render(null);
    const ref = React.createRef();
    const seen = [];
    let reads = 0;
    const child = React.createElement('button', {
      ref, type: 'button', 'aria-describedby': 'hint',
      onMouseEnter: event => { seen.push('enter'); if (event.altKey) event.preventDefault(); },
      onFocus: () => seen.push('focus'),
      onClick: () => seen.push('click'),
    }, 'Go');
    await render(React.createElement(Tooltip, { label: () => { reads += 1; return 'Name'; }, className: 'feature-tip', children: child }));
    const button = document.querySelector('button');
    assert.equal(ref.current, button);
    assert.equal(button.parentElement, document.getElementById('root'));
    assert.equal(button.getAttribute('aria-describedby'), 'hint');
    assert.equal(reads, 0);
    assert.ok(document.getElementById('pero-app-ui-styles'));
    await React.act(async () => button.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, altKey: true })));
    assert.deepEqual(seen, ['enter']);
    assert.equal(tip(), null);
    assert.equal(reads, 0);
    await enter(button);
    assert.equal(tip().textContent, 'Name');
    assert.equal(reads, 1);
    assert.equal(button.getAttribute('aria-describedby'), `hint ${tip().id}`);
    assert.equal(tip().className.includes('pero-ui-tooltip'), true);
    assert.equal(tip().className.includes('feature-tip'), true);
    assert.equal(tip().getAttribute('tabindex'), null);
    await React.act(async () => button.click());
    assert.deepEqual(seen, ['enter', 'enter', 'click']);
    assert.equal(tip(), null);
    assert.equal(button.getAttribute('aria-describedby'), 'hint');
    await enter(button);
    assert.equal(tip(), null, 'a click dismissal stays closed while the pointer is still inside');
    await leave(button);
    await enter(button);
    assert.equal(tip().textContent, 'Name');
    await render(null);
  });

  await t.test('delays hover, cancels the timer, and keeps focus independent of the pointer', async () => {
    await render(null);
    const time = clock(dom.window);
    try {
      await render(React.createElement(Tooltip, {
        label: 'Later', delayMs: 400, side: 'bottom',
        children: React.createElement('button', { type: 'button' }, 'Wait'),
      }));
      const button = document.querySelector('button');
      await focus(button);
      assert.equal(tip().textContent, 'Later');
      assert.equal(time.pending(), 0);
      await leave(button);
      assert.equal(tip().textContent, 'Later');
      await blur(button);
      assert.equal(tip(), null);
      await enter(button);
      assert.equal(tip(), null);
      assert.equal(time.pending(), 1);
      await leave(button);
      assert.equal(time.pending(), 0);
      await React.act(async () => time.flush());
      assert.equal(tip(), null);
      await enter(button);
      await React.act(async () => time.flush());
      assert.equal(tip().textContent, 'Later');
      await focus(button);
      await leave(button);
      assert.ok(tip());
      await blur(button);
      assert.equal(tip(), null);
      await render(null);
      await render(React.createElement(Tooltip, {
        label: 'Gone', delayMs: 400,
        children: React.createElement('button', { type: 'button' }, 'Unmount'),
      }));
      await enter(document.querySelector('button'));
      assert.equal(time.pending(), 1);
      await render(null);
      assert.equal(time.pending(), 0);
      await React.act(async () => time.flush());
      assert.equal(tip(), null);
    } finally {
      time.restore();
    }
  });

  await t.test('text remains hoverable across the gap and leaves without stealing focus', async () => {
    await render(null);
    const time = clock(dom.window);
    try {
      await render(React.createElement(Tooltip, { label: 'Readable text', children: React.createElement('button', null, 'Help') }));
      const button = document.querySelector('button');
      await enter(button); await leave(button);
      assert.ok(tip(), 'the pointer can cross the gap');
      await enter(tip());
      await React.act(async () => time.flush());
      assert.ok(tip(), 'moving onto the text keeps it open');
      const before = document.activeElement;
      await leave(tip());
      await React.act(async () => time.flush());
      assert.equal(tip(), null); assert.equal(document.activeElement, before);
      await render(null);
    } finally { time.restore(); }
  });

  await t.test('escape closes only this tip and disable cancels a pending show', async () => {
    await render(null);
    const time = clock(dom.window);
    const parentKeys = [];
    try {
      await render(React.createElement('div', {
        onKeyDown: event => parentKeys.push(event.key),
      }, React.createElement(Tooltip, {
        label: 'Hint',
        children: React.createElement('button', { type: 'button', onKeyDown: event => { if (event.key === 'Escape' && event.shiftKey) event.preventDefault(); } }, 'Tip'),
      })));
      const button = document.querySelector('button');
      await focus(button);
      assert.ok(tip());
      const nested = new dom.window.KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true, cancelable: true });
      await React.act(async () => button.dispatchEvent(nested));
      assert.equal(nested.defaultPrevented, true);
      assert.ok(tip(), 'a child that owns Escape keeps the tip');
      const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      await React.act(async () => button.dispatchEvent(escape));
      assert.equal(escape.defaultPrevented, true);
      assert.equal(tip(), null);
      assert.equal(document.activeElement, button);
      assert.deepEqual(parentKeys, ['Escape']);
      await enter(button);
      assert.equal(tip(), null);
      await leave(button);
      await blur(button);
      const idle = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      await React.act(async () => button.dispatchEvent(idle));
      assert.equal(idle.defaultPrevented, false);
      assert.deepEqual(parentKeys, ['Escape', 'Escape']);

      await render(React.createElement(Tooltip, {
        label: 'Hold', delayMs: 250, disabled: false,
        children: React.createElement('button', { type: 'button' }, 'Off'),
      }));
      await enter(document.querySelector('button'));
      assert.equal(time.pending(), 1);
      await render(React.createElement(Tooltip, {
        label: 'Hold', delayMs: 250, disabled: true,
        children: React.createElement('button', { type: 'button' }, 'Off'),
      }));
      assert.equal(time.pending(), 0);
      assert.equal(tip(), null);
      await React.act(async () => time.flush());
      assert.equal(tip(), null);
      const pinned = [];
      await render(React.createElement(Tooltip, {
        label: 'Pinned', open: true, onOpenChange: next => pinned.push(next),
        children: React.createElement('button', { type: 'button', onClick: () => pinned.push('click') }, 'Pin'),
      }));
      assert.equal(tip().textContent, 'Pinned');
      await React.act(async () => document.querySelector('button').click());
      assert.deepEqual(pinned, ['click']);
      assert.equal(tip().textContent, 'Pinned');
      await render(null);
    } finally {
      time.restore();
    }
  });

  await t.test('portals into the owning dialog or container, follows theme, and fits the viewport', async () => {
    await render(null);
    const native = dom.window.HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.getAttribute('role') === 'tooltip' ? 80 : 0; } });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.getAttribute('role') === 'tooltip' ? 30 : 0; } });
    dom.window.visualViewport = {
      offsetLeft: 20, offsetTop: 10, width: 200, height: 160,
      addEventListener(type, fn) { this[type] = fn; },
      removeEventListener(type) { this[type] = null; },
    };
    const observed = [];
    let disconnects = 0;
    dom.window.ResizeObserver = class {
      observe(node) { observed.push(node); }
      disconnect() { disconnects += 1; }
    };
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.append(dialog);
    const host = document.createElement('div');
    host.style.setProperty('--pero-tip', 'blue');
    host.style.fontFamily = 'TipFont';
    dialog.append(host);
    const root = document.getElementById('root');
    host.append(root);
    try {
      await render(React.createElement(Tooltip, {
        label: 'In dialog', side: 'right',
        children: React.createElement('button', { type: 'button' }, 'D'),
      }));
      const button = document.querySelector('button');
      button.getBoundingClientRect = () => box(40, 40, 20, 16);
      await focus(button);
      assert.equal(tip().parentElement, dialog);
      assert.equal(tip().ownerDocument, button.ownerDocument);
      const boxHost = document.createElement('div');
      document.body.append(boxHost);
      await render(React.createElement(Tooltip, {
        label: 'Boxed', container: boxHost, side: 'top', align: 'end',
        children: React.createElement('button', { type: 'button' }, 'B'),
      }));
      const boxed = document.querySelector('button');
      boxed.getBoundingClientRect = () => box(100, 20, 50, 16);
      await focus(boxed);
      await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('resize')));
      const bubble = tip();
      assert.equal(bubble.parentElement, boxHost);
      assert.equal(bubble.getAttribute('data-side'), 'bottom');
      assert.equal(Number.parseFloat(bubble.style.left), 70);
      assert.equal(Number.parseFloat(bubble.style.top), 44);
      const themeHost = document.createElement('div');
      themeHost.style.setProperty('--pero-tip', 'blue');
      themeHost.style.fontFamily = 'TipFont';
      document.body.append(themeHost);
      themeHost.append(root);
      await render(React.createElement(Tooltip, {
        label: 'Themed', maxWidth: 48, side: 'left', align: 'start',
        children: React.createElement('button', { type: 'button' }, 'T'),
      }));
      const themed = document.querySelector('button');
      themed.getBoundingClientRect = () => box(160, 40, 24, 16);
      await focus(themed);
      await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('resize')));
      const themedTip = tip();
      assert.equal(themedTip.parentElement, document.body);
      assert.equal(themedTip.style.getPropertyValue('--pero-tip'), 'blue');
      assert.equal(themedTip.style.fontFamily, 'TipFont');
      assert.equal(themedTip.style.maxWidth, '48px');
      await React.act(async () => { themeHost.style.setProperty('--pero-tip', 'red'); });
      assert.equal(themedTip.style.getPropertyValue('--pero-tip'), 'red');
      assert.equal(themedTip.getAttribute('data-side'), 'left');
      assert.ok(Number.parseFloat(themedTip.style.left) >= 20 + 8);
      assert.equal(Number.parseFloat(themedTip.style.top), 40);
      const before = disconnects;
      await render(null);
      assert.ok(disconnects > before);
      assert.equal(dom.window.visualViewport.resize, null);
      assert.ok(observed.length >= 2);
    } finally {
      dom.window.HTMLElement.prototype.getBoundingClientRect = native;
      delete dom.window.HTMLElement.prototype.offsetWidth;
      delete dom.window.HTMLElement.prototype.offsetHeight;
      root.remove();
      document.body.append(root);
      dialog.remove();
    }
  });
});
