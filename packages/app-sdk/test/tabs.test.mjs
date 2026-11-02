import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('tabs keep a unique panel association, controlled intent, and hidden inactive content', async t => {
  const env = await createUiRuntime(t, 'tabs'); if (!env) return;
  const { React, dom, ui, render } = env;
  const { Tabs, TabsList, TabsTrigger, TabsContent } = ui;
  const pointer = element => React.act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: false }));
  });
  const keydown = (element, key) => React.act(async () => {
    element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
  });
  const focus = element => React.act(async () => { element.focus(); });
  const tabs = ({ value, defaultValue, onValueChange, activationMode, orientation, dir, disabled, forceMount, unstyled, rootRef, listRef, triggerRef, contentRef } = {}) => React.createElement(Tabs, {
    ref: rootRef, value, defaultValue, onValueChange, activationMode, orientation, dir, unstyled,
  }, React.createElement(TabsList, { ref: listRef, unstyled, 'aria-label': 'Sections' },
    React.createElement(TabsTrigger, { ref: triggerRef, unstyled, value: 'one' }, 'One'),
    React.createElement(TabsTrigger, { unstyled, value: 'two', disabled }, 'Two'),
    React.createElement(TabsTrigger, { unstyled, value: 'three' }, 'Three')),
  React.createElement(TabsContent, { ref: contentRef, unstyled, value: 'one', forceMount }, 'Panel one'),
  React.createElement(TabsContent, { unstyled, value: 'two', forceMount }, 'Panel two'),
  React.createElement(TabsContent, { unstyled, value: 'three', forceMount }, 'Panel three'));

  await t.test('each tab controls one labelled panel and the tablist is named', async () => {
    await render(null);
    await render(tabs({ defaultValue: 'one' }));
    const list = document.querySelector('[role=tablist]');
    const triggers = [...list.querySelectorAll('[role=tab]')];
    assert.equal(list.getAttribute('aria-label'), 'Sections');
    assert.equal(triggers.length, 3);
    assert.equal(document.querySelectorAll('[role=tablist]').length, 1);
    const controls = triggers.map(tab => tab.getAttribute('aria-controls'));
    assert.equal(new Set(controls).size, triggers.length);
    assert.equal(new Set(triggers.map(tab => tab.id)).size, triggers.length);
    for (const tab of triggers) {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      assert.equal(panel.getAttribute('role'), 'tabpanel');
      assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
      assert.equal(panel.getAttribute('data-state'), tab.getAttribute('aria-selected') === 'true' ? 'active' : 'inactive');
    }
    assert.equal(document.querySelector('.pero-ui-tabs').getAttribute('data-orientation'), 'horizontal');
    assert.equal(document.querySelectorAll('#pero-app-ui-styles').length, 1);
  });

  await t.test('controlled activation reports intent without changing the selected panel', async () => {
    await render(null);
    const changes = [];
    const tree = value => tabs({ value, onValueChange: next => changes.push(next) });
    await render(tree('one'));
    const triggers = () => [...document.querySelectorAll('[role=tab]')];
    await pointer(triggers()[2]);
    assert.ok(changes.length >= 1);
    assert.deepEqual([...new Set(changes)], ['three']);
    assert.equal(triggers()[0].getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById(triggers()[0].getAttribute('aria-controls')).hidden, false);
    assert.equal(document.getElementById(triggers()[2].getAttribute('aria-controls')).hidden, true);
    await render(tree('three'));
    assert.equal(triggers()[2].getAttribute('aria-selected'), 'true');
    const selected = document.getElementById(triggers()[2].getAttribute('aria-controls'));
    const previous = document.getElementById(triggers()[0].getAttribute('aria-controls'));
    assert.equal(selected.hidden, false);
    assert.equal(selected.textContent, 'Panel three');
    assert.equal(previous.hidden, true);
    assert.equal(previous.textContent, '');
  });

  await t.test('uncontrolled focus selects the panel and hides the previous one', async () => {
    await render(null);
    await render(tabs({ defaultValue: 'one' }));
    const third = [...document.querySelectorAll('[role=tab]')][2];
    await focus(third);
    assert.equal(third.getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById(third.getAttribute('aria-controls')).textContent, 'Panel three');
    const hidden = [...document.querySelectorAll('[role=tabpanel]')].filter(panel => panel.hidden);
    assert.equal(hidden.length, 2);
    assert.deepEqual(hidden.map(panel => panel.textContent), ['', '']);
    assert.equal([...document.querySelectorAll('[role=tabpanel]')].filter(panel => !panel.hidden).length, 1);
  });

  await t.test('forceMount keeps inactive panel content mounted and hidden', async () => {
    await render(null);
    await render(tabs({ value: 'one', forceMount: true }));
    const panels = [...document.querySelectorAll('[role=tabpanel]')];
    const visible = panels.filter(panel => !panel.hidden);
    const inactive = panels.filter(panel => panel.getAttribute('data-state') === 'inactive');
    assert.deepEqual(visible.map(panel => panel.textContent), ['Panel one']);
    assert.equal(inactive.length, 2);
    for (const panel of inactive) {
      assert.equal(panel.hidden, true);
      assert.equal(panel.getAttribute('data-state'), 'inactive');
      assert.ok(panel.textContent.length > 0);
    }
    assert.deepEqual(inactive.map(panel => panel.textContent).sort(), ['Panel three', 'Panel two']);
  });

  await t.test('manual activation focuses without selecting; a disabled tab stays out of the sequence', async sub => {
    await render(null);
    sub.mock.timers.enable({ apis: ['setTimeout'] });
    const changes = [];
    await render(tabs({ value: 'one', activationMode: 'manual', disabled: true, onValueChange: next => changes.push(next) }));
    const [one, two, three] = document.querySelectorAll('[role=tab]');
    await focus(document.querySelector('[role=tablist]'));
    assert.equal(document.activeElement, one);
    assert.equal(one.tabIndex, 0);
    assert.equal(two.disabled, true);
    assert.equal(two.tabIndex, -1);
    assert.equal(two.getAttribute('data-disabled'), '');
    assert.equal(three.tabIndex, -1);
    await pointer(two);
    await React.act(async () => {
      one.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      sub.mock.timers.runAll();
    });
    assert.equal(document.activeElement, three);
    assert.deepEqual(changes, []);
    assert.equal(one.getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById(one.getAttribute('aria-controls')).textContent, 'Panel one');
    await keydown(three, 'Enter');
    assert.deepEqual(changes, ['three']);
    assert.equal(one.getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById(three.getAttribute('aria-controls')).hidden, true);
  });

  await t.test('orientation, direction, unstyled classes and refs follow the mounted nodes', async () => {
    await render(null);
    const rootRef = React.createRef(), listRef = React.createRef(), triggerRef = React.createRef(), contentRef = React.createRef();
    await render(tabs({ defaultValue: 'one', orientation: 'vertical', dir: 'rtl', unstyled: true, rootRef, listRef, triggerRef, contentRef }));
    assert.equal(rootRef.current, document.querySelector('.pero-ui-tabs'));
    assert.equal(rootRef.current.getAttribute('data-orientation'), 'vertical');
    assert.equal(rootRef.current.getAttribute('dir'), 'rtl');
    assert.equal(rootRef.current.getAttribute('data-unstyled'), 'true');
    assert.equal(listRef.current, document.querySelector('[role=tablist]'));
    assert.equal(listRef.current.classList.contains('pero-ui-tabs-list'), true);
    assert.equal(listRef.current.getAttribute('aria-orientation'), 'vertical');
    assert.equal(listRef.current.getAttribute('data-unstyled'), 'true');
    assert.equal(triggerRef.current, document.querySelector('[role=tab]'));
    assert.equal(triggerRef.current.classList.contains('pero-ui-tabs-trigger'), true);
    assert.equal(triggerRef.current.getAttribute('data-unstyled'), 'true');
    assert.equal(contentRef.current, document.querySelector('[role=tabpanel]'));
    assert.equal(contentRef.current.classList.contains('pero-ui-tabs-content'), true);
    assert.equal(contentRef.current.getAttribute('data-unstyled'), 'true');
    await render(null);
    assert.equal(rootRef.current, null);
    assert.equal(listRef.current, null);
    assert.equal(triggerRef.current, null);
    assert.equal(contentRef.current, null);
  });
});
