import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createUiRuntime } from './ui-test-runtime.mjs';

function box(x, y, width, height) {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() { return { x, y, width, height }; } };
}

test('popover roles, dismissal, menu keys, and portal containers', async t => {
  const env = await createUiRuntime(t, { contents: "export * from './components/popover'; export * from './components/select';", resolveDir: resolve(import.meta.dirname, '../src') }); if (!env) return;
  const { React, dom, ui, render, click } = env;
  const { Popover, Select } = ui;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const anchorBox = () => box(10, 10, 100, 30);
  const nativeBox = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList.contains('pero-ui-popover-trigger') ? anchorBox() : nativeBox.call(this); };
  const stubAnchor = () => {
    const button = document.querySelector('.pero-ui-popover-trigger');
    if (button) button.getBoundingClientRect = anchorBox;
    return button;
  };
  const key = (target, value, shiftKey = false) => React.act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
  });
  const panel = () => document.querySelector('.pero-ui-popover-panel');

  await t.test('native dialog semantics, ref, and one controlled callback', async () => {
    await render(null);
    const changes = [];
    const ref = React.createRef();
    await render(React.createElement(Popover, {
      ref, label: 'Tools', trigger: 'T', triggerTitle: 'Open tools', triggerVariant: 'ghost', className: 'feature-popover', contentClassName: 'feature-body',
      open: false, onOpenChange: next => changes.push(next), children: () => 'Body',
    }));
    const button = stubAnchor();
    assert.equal(ref.current, button);
    assert.equal(button.type, 'button');
    assert.equal(button.getAttribute('data-variant'), 'ghost');
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-label'), 'Tools');
    assert.equal(button.getAttribute('title'), 'Open tools');
    assert.equal(button.className.includes('pero-ui-popover-trigger'), true);
    assert.equal(panel(), null);
    await click(button);
    assert.deepEqual(changes, [true]);
    assert.equal(panel(), null);
    await render(React.createElement(Popover, {
      ref, label: 'Tools', trigger: 'T', className: 'feature-popover', contentClassName: 'feature-body', align: 'start',
      open: true, onOpenChange: next => changes.push(next), children: close => React.createElement('button', { type: 'button', onClick: () => close() }, 'Done'),
    }));
    stubAnchor();
    const openPanel = panel();
    assert.equal(openPanel.getAttribute('role'), 'dialog');
    assert.equal(openPanel.getAttribute('aria-label'), 'Tools');
    assert.equal(openPanel.id, document.querySelector('.pero-ui-popover-trigger').getAttribute('aria-controls'));
    assert.equal(openPanel.className.includes('feature-popover'), true);
    assert.equal(openPanel.className.includes('feature-body'), true);
    assert.equal(openPanel.getAttribute('data-align'), 'start');
    assert.ok(Number.parseFloat(openPanel.style.left) >= 8);
    assert.ok(Number.parseFloat(openPanel.style.top) >= 8);
    assert.ok(Number.parseFloat(openPanel.style.maxWidth) > 0);
    assert.ok(Number.parseFloat(openPanel.style.maxHeight) >= 0);
    await click(openPanel.querySelector('button'));
    assert.deepEqual(changes, [true, false]);
    await click(openPanel.querySelector('button'));
    assert.deepEqual(changes, [true, false, false], 'a refused controlled close can be requested again');
    assert.equal(panel().getAttribute('role'), 'dialog');
    await render(React.createElement(Popover, {
      ref, label: 'Tools', trigger: 'T', open: false, onOpenChange: next => changes.push(next), children: () => 'Body',
    }));
    assert.equal(panel(), null);
    await render(null);
    await render(React.createElement(Popover, {
      label: 'Plain', trigger: 'P', popupRole: false, defaultOpen: true, children: () => 'Note',
    }));
    stubAnchor();
    assert.equal(document.querySelector('.pero-ui-popover-trigger').getAttribute('aria-haspopup'), 'false');
    assert.equal(panel().hasAttribute('role'), false);
    await render(React.createElement(Popover, { label: 'Off', trigger: 'X', disabled: true, children: () => 'No' }));
    await click(stubAnchor());
    assert.equal(stubAnchor().disabled, true);
    assert.equal(panel(), null);
    await render(null);
  });

  await t.test('escape refocuses, nested prevention stays, and menu skips disabled', async () => {
    await render(null);
    await render(React.createElement(Popover, {
      label: 'Name', trigger: 'N', defaultOpen: true,
      children: () => React.createElement('input', { 'aria-label': 'Name' }),
    }));
    const button = stubAnchor();
    const field = panel().querySelector('input');
    field.focus();
    await key(field, 'Escape');
    assert.equal(panel(), null);
    assert.equal(document.activeElement, button);
    const closedEscape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await React.act(async () => button.dispatchEvent(closedEscape));
    assert.equal(closedEscape.defaultPrevented, false, 'a closed popup leaves Escape to its parent Dialog');

    await render(null);
    await render(React.createElement(Popover, {
      label: 'Nested', trigger: 'N', defaultOpen: true,
      children: () => React.createElement('input', {
        'aria-label': 'Inner',
        onKeyDown: event => { if (event.key === 'Escape') event.preventDefault(); },
      }),
    }));
    stubAnchor();
    const inner = panel().querySelector('input');
    inner.focus();
    await key(inner, 'Escape');
    assert.ok(panel());
    assert.equal(document.activeElement, inner);

    await render(null);
    await render(React.createElement(Popover, {
      label: 'Actions', trigger: 'A', popupRole: true, defaultOpen: true,
      children: () => React.createElement(React.Fragment, null,
        React.createElement('button', { type: 'button', role: 'menuitem' }, 'One'),
        React.createElement('button', { type: 'button', role: 'menuitem', disabled: true }, 'Skip'),
        React.createElement('button', { type: 'button', role: 'menuitem' }, 'Two')),
    }));
    stubAnchor();
    const menu = panel();
    assert.equal(menu.getAttribute('role'), 'menu');
    assert.equal(document.activeElement.textContent, 'One');
    await key(document.activeElement, 'ArrowDown');
    assert.equal(document.activeElement.textContent, 'Two');
    await key(document.activeElement, 'Home');
    assert.equal(document.activeElement.textContent, 'One');
    await key(document.activeElement, 'End');
    assert.equal(document.activeElement.textContent, 'Two');
    await key(document.activeElement, 'ArrowUp');
    assert.equal(document.activeElement.textContent, 'One');
    const after = document.createElement('button');
    after.type = 'button';
    after.textContent = 'After';
    document.body.appendChild(after);
    await React.act(async () => document.querySelector('.pero-ui-popover-trigger').focus());
    await key(document.querySelector('.pero-ui-popover-trigger'), 'Tab');
    assert.equal(document.activeElement.textContent, 'One');
    // Native Tab advances within content in a browser; JSDOM has no keyboard default action.
    await React.act(async () => menu.querySelectorAll('button')[2].focus());
    await key(document.activeElement, 'Tab');
    assert.equal(panel(), null);
    assert.equal(document.activeElement, after);
    after.remove();
    await render(null);
  });

  await t.test('a nested Select stays in its owning popup and consumes only its own Escape', async () => {
    await render(null);
    const values = [];
    await render(React.createElement(Popover, {
      label: 'Choices', trigger: 'C', defaultOpen: true,
      children: () => React.createElement(Select, { label: 'Choice', value: 'a', onChange: value => values.push(value), options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true }, { value: 'c', label: 'Gamma' }] }),
    }));
    const trigger = stubAnchor();
    const choice = panel().querySelector('button');
    choice.getBoundingClientRect = () => box(20, 50, 100, 30);
    await key(choice, 'ArrowDown');
    const list = document.querySelector('[role="listbox"]');
    assert.ok(panel().contains(list), 'child portals share the popup focus boundary');
    assert.equal(document.activeElement, list);
    await key(list, 'ArrowDown');
    await key(list, 'Enter');
    assert.deepEqual(values, ['c']);
    assert.ok(panel());
    await key(choice, 'ArrowDown');
    await key(document.querySelector('[role="listbox"]'), 'Escape');
    assert.ok(panel(), 'the first Escape closes only the selection popup');
    assert.equal(document.querySelector('[role="listbox"]'), null);
    assert.equal(document.activeElement, choice);
    await key(choice, 'Escape');
    assert.equal(panel(), null);
    assert.equal(document.activeElement, trigger);
    await render(null);
  });

  await t.test('outside dismissal and dialog containers follow an open move', async () => {
    await render(null);
    const outside = document.createElement('button');
    outside.type = 'button';
    document.body.appendChild(outside);
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, second);
    const boxProps = { label: 'Box', trigger: 'B', defaultOpen: true, children: () => 'Inside' };
    await render(React.createElement(Popover, { ...boxProps, container: first }));
    stubAnchor();
    assert.equal(panel().parentElement, first);
    await render(React.createElement(Popover, { ...boxProps, container: second }));
    stubAnchor();
    assert.equal(panel().parentElement, second);
    const trigger = document.querySelector('.pero-ui-popover-trigger');
    trigger.focus();
    await React.act(async () => { outside.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); });
    assert.equal(panel(), null);
    assert.equal(document.activeElement, trigger);
    await render(null);
    await render(React.createElement(Popover, { ...boxProps, container: second }));
    stubAnchor();
    await React.act(async () => outside.focus());
    assert.equal(panel(), null);
    assert.equal(document.activeElement, outside);

    const dialog = document.createElement('dialog');
    dialog.setAttribute('open','');
    const keeper = document.createElement('button');
    keeper.type = 'button';
    dialog.append(keeper);
    document.body.append(dialog);
    const root = document.getElementById('root');
    dialog.append(root);
    await render(null);
    await render(React.createElement(Popover, {
      label: 'In dialog', trigger: 'D', defaultOpen: true,
      children: close => React.createElement('button', { type: 'button', id: 'pick', onClick: () => { keeper.focus(); close(); } }, 'Pick'),
    }));
    stubAnchor();
    assert.equal(panel().parentElement, dialog);
    await click(document.getElementById('pick'));
    assert.equal(panel(), null);
    assert.equal(document.activeElement, keeper);
    document.body.append(root);
    dialog.remove();
    first.remove();
    second.remove();
    outside.remove();
    await render(null);
  });

  await t.test('theme and feature tokens follow their closest scope and clear removed values', async () => {
    await render(null);
    const theme = document.createElement('div');
    theme.dataset.theme = 'day';
    theme.style.setProperty('--pero-accent-color', 'rgb(1, 2, 3)');
    theme.style.setProperty('--dsw-alias-bg-base', 'rgb(4, 5, 6)');
    theme.style.setProperty('--feature-ink', 'rgb(7, 8, 9)');
    theme.style.fontFamily = 'Georgia';
    document.body.append(theme);
    const root = document.getElementById('root');
    theme.append(root);
    await render(React.createElement(Popover, { label: 'Theme', trigger: 'C', defaultOpen: true, children: () => 'Swatch' }));
    stubAnchor();
    assert.equal(panel().style.getPropertyValue('--pero-accent-color'), 'rgb(1, 2, 3)');
    assert.equal(panel().style.getPropertyValue('--dsw-alias-bg-base'), 'rgb(4, 5, 6)');
    assert.equal(panel().style.getPropertyValue('--feature-ink'), 'rgb(7, 8, 9)');
    assert.equal(panel().style.fontFamily, 'Georgia');
    await React.act(async () => { theme.style.setProperty('--pero-accent-color', 'rgb(9, 8, 7)'); });
    assert.equal(panel().style.getPropertyValue('--pero-accent-color'), 'rgb(9, 8, 7)');
    await React.act(async () => { theme.style.removeProperty('--feature-ink'); });
    assert.equal(panel().style.getPropertyValue('--feature-ink'), '', 'removed theme values do not stay in the portal');
    document.body.append(root);
    theme.remove();
    await render(null);
  });
});
