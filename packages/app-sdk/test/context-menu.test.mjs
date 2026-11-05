import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('context menu keeps item semantics, pointer open, Escape and dialog focus', async t => {
  const env = await createUiRuntime(t, 'context-menu'); if (!env) return;
  const { React, dom, ui, render } = env;
  // Floating UI (Radix context content) constructs DOMRect; Node/JSDOM may omit the global.
  if (typeof globalThis.DOMRect !== 'function') {
    globalThis.DOMRect = class DOMRect {
      constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = x; this.y = y; this.width = width; this.height = height;
        this.top = y; this.left = x; this.bottom = y + height; this.right = x + width;
      }
      static fromRect(rect = {}) { return new DOMRect(rect.x ?? 0, rect.y ?? 0, rect.width ?? 0, rect.height ?? 0); }
      toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.top, left: this.left, bottom: this.bottom, right: this.right }; }
    };
  }
  const rect = { x: 0, y: 0, width: 80, height: 24, top: 0, left: 0, bottom: 24, right: 80, toJSON() { return this; } };
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return rect; };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => React.act(async () => t.mock.timers.runAll());
  const click = async node => { await React.act(async () => node.click()); await flush(); };
  const { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } = ui;
  const key = async (target, value) => { await React.act(async () => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); await flush(); };
  const context = element => React.act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60, button: 2 }));
  });
  const menu = () => document.querySelector('[role="menu"]');

  await t.test('roles, controlled open intent, disabled item and one selection callback', async () => {
    await render(null);
    const opens = [];
    const picks = [];
    const tree = open => React.createElement(ContextMenu, { open, onOpenChange: value => opens.push(value) },
      React.createElement(ContextMenuTrigger, { unstyled: true }, 'Region'),
      React.createElement(ContextMenuContent, null,
        React.createElement(ContextMenuItem, { disabled: true, onSelect: () => assert.fail('disabled item ran') }, 'Unavailable'),
        React.createElement(ContextMenuItem, { danger: true, onSelect: () => picks.push('open') }, 'Open'),
        React.createElement(ContextMenuSeparator, null)));
    await render(tree(false));
    const trigger = document.querySelector('.pero-ui-context-trigger');
    assert.equal(trigger.getAttribute('data-state'), 'closed');
    assert.equal(menu(), null);
    await context(trigger);
    assert.deepEqual(opens, [true]);
    await render(tree(true));
    const popup = menu();
    assert.ok(popup);
    assert.equal(popup.classList.contains('pero-ui-context-content'), true);
    const [disabled, enabled] = popup.querySelectorAll('[role="menuitem"]');
    assert.equal(disabled.getAttribute('aria-disabled'), 'true');
    assert.equal(enabled.getAttribute('data-danger'), 'true');
    await click(disabled);
    assert.deepEqual(picks, []);
    await click(enabled);
    assert.deepEqual(picks, ['open']);
    assert.equal(opens.at(-1), false);
    await render(null);
  });

  await t.test('body portal retains semantic theme and follows an open scope change', async () => {
    await render(null);
    await render(React.createElement('div', { id: 'context-theme', style: { '--pero-surface': '#112233', '--pero-text': '#eeeeee', '--pero-surface-hover': '#223344', '--pero-font-body': '18px' } },
      React.createElement(ContextMenu, { open: true },
        React.createElement(ContextMenuTrigger, { unstyled: true }, 'Region'),
        React.createElement(ContextMenuContent, { style: { '--pero-text': '#ffffff' } },
          React.createElement(ContextMenuItem, null, 'Inspect')))));
    assert.equal(menu().style.getPropertyValue('--pero-surface'), '#112233');
    assert.equal(menu().style.getPropertyValue('--pero-surface-hover'), '#223344');
    assert.equal(menu().style.getPropertyValue('--pero-font-body'), '18px');
    assert.equal(menu().style.getPropertyValue('--pero-text'), '#ffffff');
    await React.act(async () => {
      document.getElementById('context-theme').style.setProperty('--pero-surface', '#445566');
      document.getElementById('context-theme').style.setProperty('--pero-text', '#000000');
    });
    assert.equal(menu().style.getPropertyValue('--pero-surface'), '#445566');
    assert.equal(menu().style.getPropertyValue('--pero-text'), '#ffffff');
    await render(null);
  });

  await t.test('escape dismisses and an opened native dialog keeps focus', async () => {
    await render(null);
    const opens = [];
    const tree = open => React.createElement(ContextMenu, { open, onOpenChange: value => opens.push(value) },
      React.createElement(ContextMenuTrigger, { unstyled: true }, 'Region'),
      React.createElement(ContextMenuContent, null,
        React.createElement(ContextMenuItem, null, 'First'),
        React.createElement(ContextMenuItem, null, 'Last')));
    await render(tree(true));
    assert.ok(menu());
    await key(menu().querySelector('[role="menuitem"]') || menu(), 'Escape');
    await flush();
    assert.equal(opens.at(-1), false);
    await render(tree(false));
    assert.equal(menu(), null);

    const dialog = document.createElement('dialog');
    const dialogInput = document.createElement('input');
    dialog.append(dialogInput);
    document.body.append(dialog);
    let opened = 0;
    const inspect = open => React.createElement(ContextMenu, { open, onOpenChange: () => {} },
      React.createElement(ContextMenuTrigger, { unstyled: true }, 'Region'),
      React.createElement(ContextMenuContent, null,
        React.createElement(ContextMenuItem, { onSelect: () => { opened += 1; dialog.setAttribute('open', ''); dialogInput.focus(); } }, 'Inspect')));
    await render(inspect(true));
    const item = document.querySelector('[role="menuitem"]');
    assert.ok(item);
    await click(item);
    assert.equal(opened, 1);
    assert.equal(document.activeElement, dialogInput);
    dialog.remove();
    await render(null);
  });
});
