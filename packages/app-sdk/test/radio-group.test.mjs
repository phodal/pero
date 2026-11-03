import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('radio group keeps one choice, form value and a single tab stop', async t => {
  const env = await createUiRuntime(t, 'radio-group');
  if (!env) return;
  const { React, dom, ui, render, click } = env;
  const { RadioGroup, RadioGroupItem } = ui;
  const item = (value, props) => React.createElement(RadioGroupItem, { value, 'aria-label': value, ...props });
  const radios = () => [...document.querySelectorAll('[role="radio"]')];
  const keydown = (node, key) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event;
  };

  await t.test('controlled intent does not change the selection until the owner updates value', async () => {
    await render(null);
    const values = [];
    const tree = value => React.createElement(RadioGroup, { value, 'aria-label': 'Level', onValueChange: next => values.push(next) }, item('off'), item('brief'));
    await render(tree('off'));
    assert.equal(radios()[0].type, 'button');
    assert.equal(radios()[0].getAttribute('aria-checked'), 'true');
    assert.equal(radios()[1].getAttribute('aria-checked'), 'false');
    assert.equal(radios()[0].querySelector('.pero-ui-radio-indicator')?.getAttribute('aria-hidden'), 'true');
    assert.equal(radios()[0].querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(radios()[0].textContent, '');
    assert.equal(radios()[1].querySelector('.pero-ui-radio-indicator'), null);
    await click(radios()[1]);
    assert.deepEqual(values, ['brief']);
    assert.deepEqual(radios().map(radio => radio.getAttribute('aria-checked')), ['true', 'false']);
    await render(tree('brief'));
    assert.deepEqual(radios().map(radio => radio.getAttribute('aria-checked')), ['false', 'true']);
    assert.equal(document.querySelectorAll('[role="radio"][aria-checked="true"]').length, 1);
    await click(radios()[1]);
    assert.deepEqual(values, ['brief']);
    assert.equal(document.querySelectorAll('#pero-app-ui-styles').length, 1);
    await render(null);
    values.length = 0;
    await render(React.createElement(RadioGroup, { value: 'a', orientation: 'horizontal', 'aria-label': 'Controlled arrows', onValueChange: next => values.push(next) }, item('a'), item('b')));
    await React.act(async () => {
      radios()[0].focus();
      keydown(radios()[0], 'ArrowDown');
      keydown(radios()[0], 'ArrowRight');
      radios()[1].dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });
    assert.deepEqual(values, ['b']);
    assert.deepEqual(radios().map(radio => radio.getAttribute('aria-checked')), ['true', 'false']);
  });

  await t.test('default value selects one item and custom content replaces the indicator', async () => {
    await render(null);
    const groupRef = React.createRef();
    const itemRef = React.createRef();
    await render(React.createElement(RadioGroup, { ref: groupRef, defaultValue: 'b', 'aria-label': 'Letters', orientation: 'horizontal', dir: 'rtl' },
      item('a'),
      React.createElement(RadioGroupItem, { ref: itemRef, unstyled: true, value: 'b' }, React.createElement('strong', null, 'Bee')),
      item('c')));
    const group = document.querySelector('[role="radiogroup"]');
    assert.equal(groupRef.current, group);
    assert.equal(group.classList.contains('pero-ui-radio-group'), true);
    assert.equal(group.getAttribute('aria-orientation'), 'horizontal');
    assert.equal(group.getAttribute('dir'), 'rtl');
    assert.equal(itemRef.current, radios()[1]);
    assert.equal(radios()[1].textContent, 'Bee');
    assert.equal(radios()[1].querySelector('.pero-ui-radio-indicator'), null);
    assert.equal(radios()[1].getAttribute('data-unstyled'), 'true');
    assert.deepEqual(radios().map(radio => radio.getAttribute('aria-checked')), ['false', 'true', 'false']);
    await click(radios()[2]);
    assert.deepEqual(radios().map(radio => radio.getAttribute('aria-checked')), ['false', 'false', 'true']);
    assert.equal(document.querySelectorAll('[role="radio"][aria-checked="true"]').length, 1);
    await render(null);
    assert.equal(groupRef.current, null);
    assert.equal(itemRef.current, null);
  });

  await t.test('roving focus keeps one tab stop and skips a disabled item', async () => {
    await render(null);
    await render(React.createElement(RadioGroup, { defaultValue: 'a', orientation: 'horizontal', 'aria-label': 'Focus' },
      item('a'), item('b', { disabled: true }), item('c')));
    const group = document.querySelector('[role="radiogroup"]');
    assert.equal(group.tabIndex, 0);
    assert.deepEqual(radios().map(radio => radio.tabIndex), [-1, -1, -1]);
    await React.act(async () => { group.focus(); });
    assert.equal(document.activeElement, radios()[0]);
    assert.deepEqual(radios().map(radio => radio.tabIndex), [0, -1, -1]);
    assert.equal(radios()[1].disabled, true);
    await React.act(async () => {
      assert.equal(keydown(radios()[0], 'ArrowDown').defaultPrevented, false);
      assert.equal(keydown(radios()[0], 'ArrowRight').defaultPrevented, true);
      radios()[2].dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });
    assert.equal(document.activeElement, radios()[2]);
    assert.deepEqual(radios().map(radio => radio.getAttribute('aria-checked')), ['false', 'false', 'true']);
    await React.act(async () => { keydown(radios()[2], 'ArrowRight'); });
    assert.equal(document.activeElement, radios()[0]);
    assert.deepEqual(radios().map(radio => radio.getAttribute('aria-checked')), ['true', 'false', 'false']);
    await render(null);
    await render(React.createElement(RadioGroup, { defaultValue: 'a', orientation: 'horizontal', dir: 'rtl', loop: false, 'aria-label': 'RTL' }, item('a'), item('b')));
    await React.act(async () => { radios()[0].focus(); keydown(radios()[0], 'ArrowLeft'); });
    assert.equal(document.activeElement, radios()[1]);
    assert.equal(radios()[1].getAttribute('aria-checked'), 'true');
    await React.act(async () => { keydown(radios()[1], 'ArrowLeft'); });
    assert.equal(document.activeElement, radios()[1]);
    await React.act(async () => { keydown(radios()[1], 'ArrowRight'); });
    assert.equal(document.activeElement, radios()[0]);
  });

  await t.test('disabled items and a disabled group ignore selection', async () => {
    await render(null);
    const values = [];
    const tree = disabled => React.createElement(RadioGroup, { defaultValue: 'keep', disabled, 'aria-label': 'Mode', onValueChange: value => values.push(value) },
      item('keep'), item('remove', { disabled: true }));
    await render(tree(false));
    await click(radios()[1]);
    assert.deepEqual(values, []);
    assert.equal(radios()[0].getAttribute('aria-checked'), 'true');
    assert.equal(radios()[1].disabled, true);
    await render(tree(true));
    assert.equal(document.querySelector('[role="radiogroup"]').getAttribute('data-disabled'), '');
    assert.equal(radios().every(radio => radio.disabled), true);
    await click(radios()[0]);
    assert.deepEqual(values, []);
  });

  await t.test('named value is submitted with the form and choosing does not submit', async () => {
    await render(null);
    let submits = 0;
    await render(React.createElement('form', { id: 'choice', onSubmit: event => { event.preventDefault(); submits++; } },
      React.createElement(RadioGroup, { name: 'mode', form: 'choice', required: true, defaultValue: 'keep', 'aria-label': 'Mode' }, item('keep'), item('remove')),
      React.createElement('button', { type: 'submit' }, 'Save')));
    const form = document.querySelector('form');
    assert.equal(form.checkValidity(), true);
    assert.equal(document.querySelector('[role="radiogroup"]').getAttribute('aria-required'), 'true');
    assert.equal(new dom.window.FormData(form).get('mode'), 'keep');
    assert.deepEqual([...document.querySelectorAll('input[name="mode"]')].map(input => [input.value, input.checked, input.getAttribute('aria-hidden'), input.tabIndex]),
      [['keep', true, 'true', -1], ['remove', false, 'true', -1]]);
    await click(radios().find(radio => radio.value === 'remove'));
    assert.equal(submits, 0);
    assert.equal(new dom.window.FormData(form).get('mode'), 'remove');
    assert.equal(document.querySelectorAll('[role="radio"][aria-checked="true"]').length, 1);
    const enter = keydown(radios().find(radio => radio.value === 'remove'), 'Enter');
    assert.equal(enter.defaultPrevented, true);
    assert.equal(submits, 0);
    await click(document.querySelector('button[type="submit"]'));
    assert.equal(submits, 1);
    await render(null);
    await render(React.createElement('form', null, React.createElement(RadioGroup, { name: 'mode', required: true, 'aria-label': 'Empty' }, item('keep'), item('remove'))));
    assert.equal(document.querySelector('form').checkValidity(), false);
  });
});
