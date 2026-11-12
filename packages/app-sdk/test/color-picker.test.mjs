import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('color picker exposes presets, hex entry and clear', async t => {
  const env = await createUiRuntime(t, {
    contents: "export { ColorPicker, normalizeHexColor } from './components/color-picker';",
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
  });
  if (!env) return;
  const { React, dom, ui, render, click } = env;
  const { ColorPicker, normalizeHexColor } = ui;
  assert.equal(normalizeHexColor('#abc'), '#aabbcc');
  assert.equal(normalizeHexColor('#AABBCC'), '#aabbcc');
  assert.equal(normalizeHexColor('url(bad)'), null);

  const picks = [];
  await render(React.createElement(ColorPicker, {
    label: 'Ink', value: 'blue',
    presets: [{ value: 'blue', label: 'Blue', color: '#3366ff' }, { value: 'green', label: 'Green', color: '#228844' }],
    onChange: next => picks.push(next),
  }));
  const trigger = document.querySelector('button[aria-label="Ink"]');
  assert.ok(trigger);
  trigger.getBoundingClientRect = () => ({ x: 10, y: 10, width: 40, height: 30, top: 10, left: 10, right: 50, bottom: 40, toJSON() { return this; } });
  await click(trigger);
  await click([...document.querySelectorAll('.pero-ui-color-picker-option')].find(item => item.textContent.includes('Green')));
  assert.deepEqual(picks, ['green']);

  await render(React.createElement(ColorPicker, {
    label: 'Ink', value: '#112233',
    presets: [{ value: 'blue', label: 'Blue', color: '#3366ff' }],
    onChange: next => picks.push(next),
  }));
  document.querySelector('button[aria-label="Ink"]').getBoundingClientRect = () => ({ x: 10, y: 10, width: 40, height: 30, top: 10, left: 10, right: 50, bottom: 40, toJSON() { return this; } });
  await click(document.querySelector('button[aria-label="Ink"]'));
  const hex = document.querySelector('.pero-ui-color-picker-hex input');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(hex, '#cede01');
    hex.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    hex.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  assert.equal(picks.at(-1), '#cede01');
  document.querySelector('button[aria-label="Ink"]').getBoundingClientRect = () => ({ x: 10, y: 10, width: 40, height: 30, top: 10, left: 10, right: 50, bottom: 40, toJSON() { return this; } });
  await click(document.querySelector('button[aria-label="Ink"]'));
  await click([...document.querySelectorAll('.pero-ui-color-picker-option')].find(item => item.textContent.includes('Default')));
  assert.equal(picks.at(-1), null);
});
