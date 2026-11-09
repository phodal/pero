import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('direct worksheet gestures preview without edits, commit once, retain anchors, and cancel safely', async t => {
  let editor: any;
  let act: any;
  t.after(() => act ? act(async () => editor?.destroy()) : editor?.destroy());
  const { React, ui, render, dom } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    export { Editor } from '@tiptap/core'; export { EditorContent } from '@tiptap/react';
    export { notebookExtensions } from './editor-extensions'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
  ` });
  act = React.act;
  let updates = 0;
  editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [
    { type: 'spreadsheet', attrs: { blockId: 'data', label: 'Data', sheet: { rows: 3, columns: 3, cells: { A1: '2', A2: '3', C3: 'tail' } }, annotations: { A1: { unit: 'mL', evidenceIds: [] } } } },
    { type: 'spreadsheet', attrs: { blockId: 'other', label: 'Other', sheet: { rows: 1, columns: 1, cells: { A1: '=Data!A1*2' } } } },
  ] }, onUpdate: () => { updates++; } });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.EditorContent, { editor })));
  const root = () => document.querySelector('[data-kind=spreadsheet]')!;
  const button = (label: string) => root().querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  const source = () => root().querySelector<HTMLInputElement>('[aria-label="Cell formula or value"]')!;
  const attrs = () => editor.getJSON().content.filter((node: any) => node.type === 'spreadsheet').map((node: any) => node.attrs);
  const keyboard = async (node: HTMLElement, key: string, options = {}) => React.act(async () => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })));
  const pointer = async (node: HTMLElement, type: string, x: number, y: number) => React.act(async () => {
    const event = new dom.window.MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: 1 }); node.dispatchEvent(event);
  });
  // Browser capture and geometry are the shell seam; the actual editor, controls,
  // domain transitions and history execute unchanged.
  const captured = new WeakSet<Element>();
  dom.window.HTMLElement.prototype.setPointerCapture = function () { captured.add(this); };
  dom.window.HTMLElement.prototype.hasPointerCapture = function () { return captured.has(this); };
  dom.window.HTMLElement.prototype.releasePointerCapture = function () { captured.delete(this); };
  const measure = () => {
    for (const header of root().querySelectorAll<HTMLElement>('th[data-grid-axis]')) {
      const index = Number(header.dataset.gridIndex), row = header.dataset.gridAxis === 'row';
      header.getBoundingClientRect = () => ({ top: row ? index * 32 : 0, bottom: row ? (index + 1) * 32 : 32,
        left: row ? 0 : index * 120, right: row ? 44 : (index + 1) * 120, width: row ? 44 : 120, height: 32 } as DOMRect);
    }
  };
  const scroller = root().querySelector<HTMLElement>('.notebook-grid-scroll')!;
  scroller.scrollLeft = 180;
  await React.act(async () => scroller.dispatchEvent(new dom.window.Event('scroll', { bubbles: false })));
  const resize = button('Resize column A');
  await pointer(resize, 'pointerdown', 120, 10); await pointer(resize, 'pointermove', 170, 10);
  assert.equal(updates, 0); assert.equal(resize.getAttribute('aria-valuenow'), '170');
  await pointer(resize, 'pointerup', 170, 10);
  assert.equal(updates, 1); assert.equal(attrs()[0].columnWidths['0'], 170); assert.equal(scroller.scrollLeft, 180);
  await keyboard(resize, 'ArrowRight', { shiftKey: true });
  assert.equal(attrs()[0].columnWidths['0'], 180); assert.equal(updates, 2);
  await pointer(resize, 'pointerdown', 180, 10); await pointer(resize, 'pointermove', 220, 10); await keyboard(resize, 'Escape');
  await pointer(resize, 'pointerup', 220, 10); assert.equal(updates, 2); assert.equal(attrs()[0].columnWidths['0'], 180);
  await pointer(resize, 'pointerdown', 180, 10); await pointer(resize, 'pointermove', 220, 10); await pointer(resize, 'pointercancel', 220, 10);
  assert.equal(updates, 2);
  await React.act(async () => root().querySelector<HTMLInputElement>('[data-cell=A1]')!.focus());
  measure();
  const move = button('Move row 1');
  await pointer(move, 'pointerdown', 20, 16); await pointer(move, 'pointermove', 20, 80);
  assert.equal(updates, 2); await pointer(move, 'pointerup', 20, 80);
  assert.equal(updates, 3); assert.equal(attrs()[0].sheet.cells.A3, '2'); assert.equal(attrs()[0].annotations.A3.unit, 'mL');
  assert.equal(attrs()[1].sheet.cells.A1, '=Data!A3*2'); assert.equal(source().value, '2');
  assert.equal(root().querySelector('output')!.textContent, 'A3');
  await React.act(async () => editor.commands.undo());
  assert.equal(attrs()[0].sheet.cells.A1, '2'); assert.equal(attrs()[1].sheet.cells.A1, '=Data!A1*2');
  assert.equal(attrs()[0].columnWidths['0'], 180, 'undoing a move retains the earlier resize');
  await React.act(async () => editor.commands.redo());
  assert.equal(attrs()[0].sheet.cells.A3, '2');
  await keyboard(button('Move row 3'), 'ArrowUp');
  assert.equal(attrs()[0].sheet.cells.A2, '2'); assert.equal(attrs()[1].sheet.cells.A1, '=Data!A2*2');
  // Read-only reached during a drag must cancel before a release can commit.
  const before = updates, readOnlyEdge = button('Resize row 1');
  await pointer(readOnlyEdge, 'pointerdown', 10, 32); await pointer(readOnlyEdge, 'pointermove', 10, 72);
  await React.act(async () => editor.setEditable(false, false)); await pointer(readOnlyEdge, 'pointerup', 10, 72);
  assert.equal(updates, before); assert.equal(root().querySelector('[role=separator]'), null);
});
