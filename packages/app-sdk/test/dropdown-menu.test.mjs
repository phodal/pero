import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('dropdown menu keeps item semantics, controlled intent, dismissal and dialog portal', async t => {
  const env = await createUiRuntime(t, 'dropdown-menu'); if (!env) return;
  const { React, dom, ui, render } = env;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => React.act(async () => t.mock.timers.runAll());
  const click = async node => { await React.act(async () => node.click()); await flush(); };
  const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuLabel, DropdownMenuGroup } = ui;
  const key = async (target, value, shiftKey = false) => { await React.act(async () => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))); await flush(); };
  const pointer = element => React.act(async () => element.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' })));
  const menu = () => document.querySelector('[role="menu"]');
  const triggerOf = () => document.querySelector('.pero-ui-dropdown-trigger');

  await t.test('roles, controlled open intent, disabled item and one selection callback', async () => {
    await render(null);
    const opens = [];
    const picks = [];
    const tree = open => React.createElement(DropdownMenu, { open, onOpenChange: value => opens.push(value) },
      React.createElement(DropdownMenuTrigger, { ref: null }, 'Actions'),
      React.createElement(DropdownMenuContent, null,
        React.createElement(DropdownMenuItem, { disabled: true, onSelect: () => assert.fail('disabled item ran') }, 'Unavailable'),
        React.createElement(DropdownMenuItem, { danger: true, onSelect: () => picks.push('open') }, 'Open'),
        React.createElement(DropdownMenuSeparator, null)));
    await render(tree(false));
    const trigger = triggerOf();
    assert.equal(trigger.tagName, 'BUTTON');
    assert.equal(trigger.type, 'button');
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(trigger.classList.contains('pero-ui-dropdown-trigger'), true);
    assert.equal(trigger.hasAttribute('data-unstyled'), false);
    assert.equal(menu(), null);
    await pointer(trigger);
    assert.deepEqual(opens, [true]);
    assert.equal(menu(), null);
    await render(tree(true));
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const popup = menu();
    assert.equal(popup.classList.contains('pero-ui-dropdown-content'), true);
    const [disabled, enabled] = popup.querySelectorAll('[role="menuitem"]');
    assert.equal(disabled.getAttribute('aria-disabled'), 'true');
    assert.equal(disabled.getAttribute('role'), 'menuitem');
    assert.equal(enabled.getAttribute('data-danger'), 'true');
    assert.equal(enabled.classList.contains('pero-ui-dropdown-item'), true);
    assert.equal(popup.querySelector('[role="separator"]').classList.contains('pero-ui-dropdown-separator'), true);
    await click(disabled);
    assert.deepEqual(picks, []);
    assert.equal(menu(), popup);
    await click(enabled);
    assert.deepEqual(picks, ['open']);
    assert.equal(opens.at(-1), false);
    await render(null);
  });

  await t.test('checkbox and radio keep menu roles and report intent without flipping controlled state', async () => {
    await render(null);
    const checks = [];
    const radios = [];
    await render(React.createElement(DropdownMenu, { open: true },
      React.createElement(DropdownMenuTrigger, null, 'View'),
      React.createElement(DropdownMenuContent, { unstyled: true },
        React.createElement(DropdownMenuCheckboxItem, { checked: false, onCheckedChange: value => checks.push(value) }, 'Pinned'),
        React.createElement(DropdownMenuRadioGroup, { value: 'list', onValueChange: value => radios.push(value) },
          React.createElement(DropdownMenuRadioItem, { value: 'list' }, 'List'),
          React.createElement(DropdownMenuRadioItem, { value: 'board' }, 'Board')))));
    const box = document.querySelector('[role="menuitemcheckbox"]');
    const [list, board] = document.querySelectorAll('[role="menuitemradio"]');
    assert.equal(document.querySelector('[role="checkbox"]'), null);
    assert.equal(document.querySelector('[role="radio"]'), null);
    assert.equal(box.getAttribute('aria-checked'), 'false');
    assert.equal(list.getAttribute('aria-checked'), 'true');
    assert.equal(list.textContent, 'List');
    assert.equal(list.querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(board.getAttribute('aria-checked'), 'false');
    assert.equal(menu().getAttribute('data-unstyled'), 'true');
    await click(box);
    assert.deepEqual(checks, [true]);
    assert.equal(box.getAttribute('aria-checked'), 'false');
    await click(board);
    assert.deepEqual(radios, ['board']);
    assert.equal(board.getAttribute('aria-checked'), 'false');
    assert.equal(list.getAttribute('aria-checked'), 'true');
    await render(null);
  });

  await t.test('escape returns focus and an opened native dialog keeps focus', async () => {
    await render(null);
    await render(React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'outside' }, 'Outside'),
      React.createElement(DropdownMenu, { defaultOpen: false },
        React.createElement(DropdownMenuTrigger, null, 'Actions'),
        React.createElement(DropdownMenuContent, null,
          React.createElement(DropdownMenuItem, { disabled: true }, 'Unavailable'),
          React.createElement(DropdownMenuItem, null, 'First'),
          React.createElement(DropdownMenuItem, null, 'Last')))));
    const trigger = triggerOf();
    await key(trigger, 'ArrowDown');
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    assert.ok(document.activeElement === items[1], 'focus reaches the expected control');
    await key(document.activeElement, 'ArrowUp');
    assert.ok(document.activeElement === items[2], 'focus reaches the expected control');
    await key(document.activeElement, 'Home');
    assert.ok(document.activeElement === items[1], 'focus reaches the expected control');
    await key(document.activeElement, 'End');
    assert.ok(document.activeElement === items[2], 'focus reaches the expected control');
    await key(document.activeElement, 'Escape');
    assert.equal(menu(), null);
    assert.ok(document.activeElement === trigger, 'focus reaches the expected control');
    const outside = document.getElementById('outside');
    assert.notEqual(outside.getAttribute('aria-hidden'), 'true');
    assert.equal(document.body.hasAttribute('data-scroll-locked'), false);
    const dialog = document.createElement('dialog');
    const dialogInput = document.createElement('input'); dialog.append(dialogInput);
    document.body.append(dialog);
    let opened = 0;
    await render(React.createElement(DropdownMenu, { defaultOpen: true },
      React.createElement(DropdownMenuTrigger, null, 'Actions'),
      React.createElement(DropdownMenuContent, null,
        React.createElement(DropdownMenuItem, { onSelect: () => { opened += 1; dialog.setAttribute('open', ''); dialogInput.focus(); } }, 'Inspect'))));
    await click(document.querySelector('[role="menuitem"]'));
    assert.equal(opened, 1);
    assert.equal(menu(), null);
    assert.ok(document.activeElement === dialogInput, 'focus reaches the expected control');
    dialog.remove();
    await render(null);
  });

  await t.test('default content portals to an open dialog, otherwise the workbench or body', async () => {
    await render(null);
    const dialogTree = React.createElement('div', { className: 'pero-workbench' },
      React.createElement('dialog', { open: true },
        React.createElement(DropdownMenu, { defaultOpen: true },
          React.createElement(DropdownMenuTrigger, null, 'In dialog'),
          React.createElement(DropdownMenuContent, null, React.createElement(DropdownMenuItem, null, 'Stay')))));
    await render(dialogTree);
    const dialog = document.querySelector('dialog');
    assert.equal(dialog.hasAttribute('open'), true);
    assert.equal(dialog.contains(menu()), true);
    assert.equal(document.body.contains(menu()), true);
    assert.notEqual(menu().parentElement, document.body);
    await render(null);
    await render(React.createElement('div', { className: 'pero-workbench', id: 'bench' },
      React.createElement(DropdownMenu, { defaultOpen: true },
        React.createElement(DropdownMenuTrigger, { style: { '--pero-border': '#123456', color: 'rgb(9, 8, 7)' } }, 'Bench'),
        React.createElement(DropdownMenuContent, null, React.createElement(DropdownMenuItem, null, 'Here')))));
    const bench = document.getElementById('bench');
    assert.equal(bench.contains(menu()), true);
    await render(null);
    const host = document.createElement('div');
    document.body.append(host);
    await render(React.createElement(DropdownMenu, { defaultOpen: true },
      React.createElement(DropdownMenuTrigger, { style: { '--pero-border': '#123456', color: 'rgb(9, 8, 7)' } }, 'Body'),
      React.createElement(DropdownMenuContent, null, React.createElement(DropdownMenuItem, null, 'Portaled'))));
    const popup = menu();
    assert.equal(document.body.contains(popup), true);
    assert.equal(popup.closest('.pero-workbench'), null);
    assert.equal(popup.style.getPropertyValue('--pero-border'), '#123456');
    assert.equal(popup.style.color, 'rgb(9, 8, 7)');
    host.remove();
    await render(null);
    const sink = document.createElement('div');
    document.body.append(sink);
    await render(React.createElement(DropdownMenu, { defaultOpen: true },
      React.createElement(DropdownMenuTrigger, null, 'Override'),
      React.createElement(DropdownMenuContent, { container: sink }, React.createElement(DropdownMenuItem, null, 'Custom'))));
    assert.equal(sink.contains(menu()), true);
    sink.remove();
    await render(null);
  });
  await t.test('body portals follow theme changes while open and retain explicit content styles', async () => {
    await render(null);
    await render(React.createElement('div', { id: 'theme-scope', style: { '--dsw-alias-bg-base': '#101010' } },
      React.createElement(DropdownMenu, { defaultOpen: true },
        React.createElement(DropdownMenuTrigger, null, 'Theme'),
        React.createElement(DropdownMenuContent, { style: { color: 'rgb(1, 2, 3)', fontFamily: 'monospace' } },
          React.createElement(DropdownMenuItem, null, 'Keep')))));
    assert.equal(menu().style.getPropertyValue('--dsw-alias-bg-base'), '#101010');
    await React.act(async () => document.getElementById('theme-scope').style.setProperty('--dsw-alias-bg-base', '#202020'));
    assert.equal(menu().style.getPropertyValue('--dsw-alias-bg-base'), '#202020');
    assert.equal(menu().style.color, 'rgb(1, 2, 3)');
    assert.equal(menu().style.fontFamily, 'monospace');
  });

  await t.test('Tab dismisses into the surrounding native tab order in either direction', async () => {
    await render(null);
    await render(React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'before-menu' }, 'Before'),
      React.createElement(DropdownMenu, null,
        React.createElement(DropdownMenuTrigger, null, 'Tab actions'),
        React.createElement(DropdownMenuContent, null, React.createElement(DropdownMenuItem, null, 'Pick'))),
      React.createElement('div', { style: { display: 'none' } }, React.createElement('button', null, 'Hidden')),
      React.createElement('button', { id: 'after-menu' }, 'After')));
    await key(triggerOf(), 'ArrowDown');
    await key(document.querySelector('[role=menuitem]'), 'Tab');
    assert.equal(menu(), null); assert.equal(document.activeElement.id, 'after-menu');
    await key(triggerOf(), 'ArrowDown');
    await key(document.querySelector('[role=menuitem]'), 'Tab', true);
    assert.equal(menu(), null); assert.equal(document.activeElement.id, 'before-menu');
  });

  await t.test('submenu, label and group keep nested menu roles', async () => {
    await render(null);
    const picks = [];
    await render(React.createElement(DropdownMenu, { open: true },
      React.createElement(DropdownMenuTrigger, null, 'Actions'),
      React.createElement(DropdownMenuContent, null,
        React.createElement(DropdownMenuLabel, null, 'Section'),
        React.createElement(DropdownMenuGroup, null,
          React.createElement(DropdownMenuItem, { onSelect: () => picks.push('solo') }, 'Solo')),
        React.createElement(DropdownMenuSub, { open: true },
          React.createElement(DropdownMenuSubTrigger, null, 'More'),
          React.createElement(DropdownMenuSubContent, null,
            React.createElement(DropdownMenuItem, { onSelect: () => picks.push('nested') }, 'Nested'))))));
    assert.equal(document.querySelector('.pero-ui-dropdown-label')?.textContent, 'Section');
    assert.ok(document.querySelector('.pero-ui-dropdown-sub-trigger'));
    const nested = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent === 'Nested');
    assert.ok(nested);
    await click(nested);
    assert.deepEqual(picks, ['nested']);
    await render(null);
  });

});
