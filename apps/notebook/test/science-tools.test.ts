import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('scientific tools insert auditable snapshots, refuse stale acceptance and preserve source rows', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    export * from './science-tools'; export * from './science-tools-shared';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export { Editor, Node } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit';
  ` });
  const { React, ui, render, click, dom } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const element = document.createElement('div'); document.body.append(element);
  editor = new ui.Editor({ element, extensions: [ui.StarterKit, ui.Node.create({
    name: 'spreadsheet', group: 'block', atom: true, addAttributes() { return { label: { default: '' }, sheet: { default: {} }, annotations: { default: {} } }; },
    renderHTML() { return ['div', { 'data-sheet': true }]; },
  })], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original notebook' }] }, { type: 'spreadsheet', attrs: { label: 'Sheet1', sheet: { rows: 1, columns: 1, cells: { A1: 'original' } } } }] } });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(ui.NotebookScienceTools, { editor, onInsert: (nodes: unknown[]) => editor.commands.insertContentAt(editor.state.doc.content.size, [...nodes, { type: 'paragraph' }]) })));
  const act = (action: () => void) => React.act(async () => action());
  const button = (label: string) => {
    const node = [...document.querySelectorAll('button')].find(element => element.textContent === label || element.getAttribute('aria-label') === label);
    assert.ok(node, `Missing button ${label}`); return node;
  };
  const control = (label: string) => {
    const node = document.querySelector(`[aria-label="${label}"]`) ?? (() => {
      const caption = [...document.querySelectorAll('label')].find(element => element.textContent === label);
      return caption ? document.getElementById(caption.htmlFor) : null;
    })();
    assert.ok(node, `Missing control ${label}`); return node;
  };
  const fill = async (label: string, value: string) => act(() => {
    const node = control(label), constructor = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : node.tagName === 'SELECT' ? dom.window.HTMLSelectElement : dom.window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(constructor.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const check = async (label: string) => {
    const caption = [...document.querySelectorAll('label')].find(element => element.textContent?.trim() === label);
    const checkbox = caption?.querySelector('[role=checkbox]'); assert.ok(checkbox, `Missing checkbox ${label}`); await click(checkbox);
  };
  const openTool = async (tool: string) => { await click(button('Scientific tools')); await fill('Scientific tools', tool); };
  const snapshots = () => editor.getJSON().content.filter((node: any) => node.type === 'codeBlock').map((node: any) => JSON.parse(node.content[0].text));

  await t.test('sequence computation is inserted once and stale draft changes are refused', async () => {
    await openTool('sequence'); await fill('Sequence (IUPAC, up to 20,000 nt)', 'ATGAAATAA'); await click(button('Calculate')); await click(button('Insert snapshot'));
    assert.equal(snapshots()[0].translation, 'MK*'); assert.equal(snapshots()[0].input, 'ATGAAATAA');
    await click(button('Insert snapshot')); assert.equal(snapshots().length, 1); assert.match(document.body.textContent!, /already been inserted/);
    await fill('Sequence (IUPAC, up to 20,000 nt)', 'ATGGCTTAA'); await click(button('Calculate'));
    await act(() => editor.commands.insertContentAt(1, 'New draft text. '));
    await click(button('Insert snapshot')); assert.equal(snapshots().length, 1); assert.match(document.body.textContent!, /notebook changed/);
    await click(button('Close')); assert.equal(document.querySelector('dialog'), null);
  });

  await t.test('candidate review edits literal text into a fresh uniquely named worksheet', async () => {
    const response = { runResults: [
      { displayName: 'A', modelFamily: 'one', hadError: false, newRows: { Results: [['cell', '1']] } },
      { displayName: 'B', modelFamily: 'two', hadError: false, newRows: { Results: [['cell', '2'], ['extra', '3']] } },
    ] };
    await openTool('review'); await fill('External JSON', JSON.stringify(response)); await click(button('Load and begin review'));
    assert.ok(document.querySelector('.notebook-science-difference'));
    await fill('Row 1 Field 2', '=SUM(A1)');
    await check('I reviewed these candidates and accept them as new content, not verified scientific results.'); await click(button('Insert snapshot'));
    const sheets = editor.getJSON().content.filter((node: any) => node.type === 'spreadsheet');
    assert.equal(sheets.length, 2); assert.equal(sheets[0].attrs.sheet.cells.A1, 'original'); assert.equal(sheets[1].attrs.label, 'Sheet2');
    assert.equal(sheets[1].attrs.sheet.cells.B2, "'=SUM(A1)"); assert.equal(snapshots().at(-1).rows[0][1], '=SUM(A1)');
    await fill('External JSON', '{bad'); await click(button('Load and begin review'));
    assert.equal(document.querySelector('input[aria-label="Row 1 Field 2"]'), null);
    await click(button('Close'));
  });

  await t.test('plate assignments and partial recorded checks remain explicit in their snapshots', async () => {
    await openTool('plate'); await fill('Group name', 'Control'); await click(button('Select range')); await click(button('Assign selected wells')); await click(button('Insert snapshot'));
    const plate = snapshots().at(-1); assert.equal(plate.wells.length, 96); assert.deepEqual(plate.wells[14].groups, ['Control']); assert.deepEqual(plate.selected, ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    await fill('Scientific tools', 'checks'); await fill('External JSON', JSON.stringify({ checkResults: [{ text: 'Confirm provenance' }] })); await click(button('Load and begin review'));
    assert.match(document.body.textContent!, /Partial report/);
    await check('I acknowledge the source and its reported limits.'); await click(button('Insert snapshot'));
    assert.equal(snapshots().at(-1).status, 'partial'); assert.equal(snapshots().at(-1).items[0].acknowledged, false);
    await click(button('Close'));
  });
});
