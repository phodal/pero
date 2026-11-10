import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('typed external formulas stay visible but unstored, while ordinary formulas, paste and reopen keep their values', async t => {
  let editor: any;
  let act: any;
  t.after(() => act ? act(async () => editor?.destroy()) : editor?.destroy());
  const { React, ui, render, dom } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    export { Editor } from '@tiptap/core'; export { EditorContent } from '@tiptap/react';
    export { notebookExtensions } from './editor-extensions'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
  ` });
  act = React.act;
  const sheet = { rows: 3, columns: 3, cells: { A1: '2' } };
  const mount = async (content: unknown) => {
    if (editor) await React.act(async () => editor.destroy());
    editor = new ui.Editor({ extensions: ui.notebookExtensions, content });
    await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.EditorContent, { editor })));
  };
  await mount({ type: 'doc', content: [{ type: 'spreadsheet', attrs: { blockId: 'data', label: 'Data', sheet } }] });
  const root = () => document.querySelector('[data-kind=spreadsheet]')!;
  const cell = (address: string) => root().querySelector<HTMLInputElement>(`[data-cell=${address}]`)!;
  const stored = () => editor.getJSON().content[0].attrs.sheet.cells;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  const typeInto = async (input: HTMLInputElement, text: string) => {
    let value = input.value;
    for (const character of text) {
      value += character;
      await React.act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      value = input.value;
    }
  };
  await React.act(async () => cell('C1').focus());
  await typeInto(cell('C1'), '=PY("1")');
  assert.equal(cell('C1').value, '=PY("1")', 'the rejected characters stay in the focused input');
  assert.equal(stored().C1, undefined);
  assert.equal(stored().A1, '2');
  assert.match(root().textContent ?? '', /will not store it/);
  await React.act(async () => cell('C1').blur());
  assert.equal(stored().C1, undefined);
  assert.equal(cell('C1').value, '', 'leaving the cell drops the rejected formula');
  const saved = editor.getJSON();
  await mount(saved);
  assert.equal(stored().C1, undefined);
  assert.equal(stored().A1, '2');

  await React.act(async () => cell('B1').focus());
  await typeInto(cell('B1'), '=A1*6');
  assert.equal(stored().B1, '=A1*6');
  await React.act(async () => cell('B1').blur());
  assert.equal(cell('B1').value, '12');
  const calculated = editor.getJSON();
  await mount(calculated);
  assert.equal(stored().B1, '=A1*6');
  assert.equal(cell('B1').value, '12');

  const paste = async (address: string, text: string) => {
    const target = cell(address);
    await React.act(async () => target.focus());
    const data = { getData: (type: string) => type === 'text/plain' ? text : '', types: ['text/plain'] };
    const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    await React.act(async () => target.dispatchEvent(event));
  };
  await paste('C1', '=PYTHON("print(1)")\t1');
  assert.equal(stored().C1, undefined);
  assert.equal(stored().B1, '=A1*6');
  assert.match(root().textContent ?? '', /will not store it/);
  await paste('A2', '4\t=A2*3');
  assert.equal(stored().A2, '4');
  assert.equal(stored().B2, '=A2*3');
  await React.act(async () => cell('B2').blur());
  assert.equal(cell('B2').value, '12');
});
