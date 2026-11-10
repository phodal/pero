import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('live formula input preserves source spans, completes at caret, and respects dismissal and read-only', async t => {
  const { React, ui, render, dom, click } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import React from 'react'; import {FormulaInput} from './formula-input';
    export {AppSdkProvider,createAppHost} from '@pero/app-sdk';
    export function Fixture({initial,readonly=false,onComplete}) {
      const [value,setValue]=React.useState(initial);
      return <FormulaInput aria-label="Formula" value={value} readOnly={readonly} onChange={event=>setValue(event.target.value)} onComplete={value=>{setValue(value);onComplete(value);}}/>;
    }
  ` });
  const completed: string[] = [], host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  const show = (initial: string, readonly = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { key: initial, initial, readonly, onComplete: (value: string) => completed.push(value) })));
  const input = () => document.querySelector<HTMLInputElement>('[aria-label=Formula]')!;
  const focusAt = async (caret: number) => React.act(async () => { input().focus(); input().setSelectionRange(caret, caret); input().dispatchEvent(new dom.window.Event('select', { bubbles: true })); });
  const key = async (value: string, options = {}) => React.act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })));
  await show('=IF(TRUE,SU,0)'); await focusAt(11);
  assert.match(document.querySelector('[role=listbox]')!.textContent!, /SUMPRODUCT/);
  assert.equal(document.querySelector('[data-formula-token=Function]')!.textContent, 'IF(');
  assert.equal(document.querySelector('.notebook-formula-highlight')!.textContent, '=IF(TRUE,SU,0)');
  await key('Enter'); assert.equal(input().value, '=IF(TRUE,SUM(),0)'); assert.equal(input().selectionStart, 13);
  assert.deepEqual(completed, ['=IF(TRUE,SUM(),0)']); assert.equal(document.querySelector('[role=listbox]'), null);
  await show('=AV(1,2)'); await focusAt(3); await key('ArrowDown');
  assert.match(document.querySelector('[role=option][aria-selected=true]')!.textContent!, /AVERAGEIF/);
  await key('Tab'); assert.equal(input().value, '=AVERAGEIF(1,2)');
  await show('=SU'); await focusAt(3); await key('Escape');
  assert.equal(input().value, '=SU'); assert.equal(document.querySelector('[role=listbox]'), null);
  await show('=su'); await focusAt(3); await key('Enter', { isComposing: true });
  assert.equal(input().value, '=su', 'IME Enter must not accept a completion');
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(node => node.textContent!.startsWith('SUMPRODUCT'))!;
  await click(option); assert.equal(input().value, '=SUMPRODUCT()');
  await show('="SU"'); await focusAt(4); assert.equal(document.querySelector('[role=listbox]'), null);
  await show('=SU', true); await focusAt(3); await key('Enter');
  assert.equal(document.querySelector('[role=listbox]'), null); assert.equal(input().value, '=SU');
});
