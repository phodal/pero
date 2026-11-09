import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const resolveDir = fileURLToPath(new URL('../ui-src', import.meta.url));
function controls(runtime: any) {
  const { React, dom } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const button = (text: string) => { const target = [...document.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text); assert.ok(target, text); return target; };
  const field = (text: string) => { const label = [...document.querySelectorAll('label')].find(node => node.textContent === text); const target = label && (document.getElementById(label.htmlFor) ?? label.querySelector('input')); assert.ok(target, text); return target as HTMLInputElement; };
  const fill = async (text: string, value: string) => React.act(async () => { const target = field(text), type = target.tagName === 'SELECT' ? dom.window.HTMLSelectElement : target.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype, 'value')!.set!.call(target, value); target.dispatchEvent(new dom.window.Event(target.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  return { button, field, fill };
}

test('research example recomputes with real owners, inserts explicit snapshots and compares pinned evidence', async t => {
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './research-tools'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click } = runtime, { button, fill } = controls(runtime);
  const snapshots: any[] = [], inserted: any[] = [];
  const sheets = [{ name: 'Data', sheet: { rows: 2, columns: 2, cells: { A1: '=2+2', B1: '4' } } }];
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookResearchTools, { worksheets: sheets, onSnapshot: (...args: any[]) => snapshots.push(args), onInsertExample: (example: any) => inserted.push(example) })));
  await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Master-mix'))!);
  assert.match(document.body.textContent!, /1760 µL/);
  await click(button('Set 100 reactions / 设为 100')); assert.match(document.body.textContent!, /2200 µL/);
  await click(button('Insert editable worksheet and recipe / 插入可编辑工作表与配方'));
  assert.equal(inserted[0].total, 2200); assert.deepEqual(inserted[0].mixture.records, []);
  await click(button('Insert example snapshot / 插入示例快照')); assert.equal(snapshots[0][1].input.reactions, 100);
  await fill('Reaction count / 反应数', '0'); assert.match(document.body.textContent!, /Use 1–10,000 reactions/);
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === 'Insert editable worksheet and recipe / 插入可编辑工作表与配方'), false);
  await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Compare formula'))!);
  await click(button('Pin baseline / 固定基准')); await click(button('Insert comparison snapshot / 插入比较快照'));
  assert.equal(snapshots[1][1].comparison.sameResult, true); assert.equal(snapshots[1][1].comparison.sameSource, false);
  await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Technical dependencies'))!);
  await fill('Search Pero dependencies and sources / 搜索 Pero 依赖与来源', 'fast-formula-parser'); assert.match(document.body.textContent!, /1.0.19/);
  await fill('Search Pero dependencies and sources / 搜索 Pero 依赖与来源', 'nonexistent-private-path'); assert.match(document.body.textContent!, /No matching Pero sources/);
});

test('print preview preserves cross-section calculations, filters real output and persists settings before actual print invocation', async t => {
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './notebook-print'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click, dom } = runtime, { button, field, fill } = controls(runtime);
  const documentValue = { schemaVersion: 1, title: 'Print <script>never execute</script>', content: { type: 'doc', content: [
    { type: 'section', attrs: { blockId: 'inputs', label: 'Inputs' }, content: [{ type: 'spreadsheet', attrs: { blockId: 'data', label: 'Data', sheet: { rows: 1, columns: 1, cells: { A1: '7' } } } }] },
    { type: 'section', attrs: { blockId: 'results', label: 'Results' }, content: [{ type: 'spreadsheet', attrs: { blockId: 'result', label: 'Result', sheet: { rows: 1, columns: 1, cells: { A1: '=Data!A1*3' } } } }] },
  ] }, procedures: [{ id: 'procedure', title: 'Hidden procedure tab', description: 'Print this without switching tabs', materials: [], steps: [] }] };
  let printed = 0; dom.window.print = () => { printed++; assert.match(document.querySelector('.notebook-print-output')!.textContent!, /21/); };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookPrintTools, { document: documentValue, entryId: 'entry', revision: 2, dirty: true })));
  await click(button('Print options / 打印设置'));
  const output = () => document.querySelector('.notebook-print-output')!;
  assert.match(output().textContent!, /UNSAVED DRAFT/); assert.match(output().textContent!, /Hidden procedure tab/);
  assert.equal(output().querySelector('button, input, textarea, script'), null);
  await click(field('Inputs')); assert.equal(output().querySelectorAll('figure').length, 1); assert.match(output().textContent!, /21/);
  await fill('Paper / 纸张', 'Letter'); await fill('Orientation / 方向', 'landscape'); await fill('Margins (mm, 5–40) / 页边距', '12');
  await click(field('Show formulas under calculated values / 计算值下显示公式'));
  assert.match(output().textContent!, /=Data!A1\*3/); assert.match(output().querySelector('style')!.textContent!, /size: Letter landscape; margin: 12mm/);
  await click(button('Save print preferences / 保存打印偏好')); await click(button('Print / 打印')); assert.equal(printed, 1);
  await click(button('Close print options / 关闭打印设置')); assert.equal(document.querySelector('.notebook-print-output'), null);
  await click(button('Print options / 打印设置')); assert.equal(field('Orientation / 方向').value, 'landscape'); assert.equal(field('Inputs').checked, false);
  await fill('Margins (mm, 5–40) / 页边距', '0'); assert.equal(document.querySelector('.notebook-print-output'), null); assert.equal((button('Print / 打印') as HTMLButtonElement).disabled, true);
  await click(button('Close print options / 关闭打印设置'));
  await React.act(async () => window.dispatchEvent(new dom.window.CustomEvent(ui.NOTEBOOK_PRINT_OPEN_EVENT, { detail: { entryId: 'other' } }))); assert.equal(document.querySelector('dialog'), null);
});

test('scoped commands preserve widget/native/IME/modal keys and symbol command uses existing text picker', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './notebook-commands'; export * from './text-tools'; export { Editor } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, dom, click } = runtime, { button } = controls(runtime);
  const scope = document.createElement('div'); scope.dataset.notebookEntryId = 'entry'; scope.innerHTML = '<div class="notebook-editor"><div id="editing"></div><input id="widget"></div>';
  document.body.append(scope);
  editor = new ui.Editor({ element: scope.querySelector('#editing'), extensions: [ui.StarterKit, ui.NotebookSubscript, ui.NotebookSuperscript, ui.NotebookTextColor, ui.NotebookTextBackground], content: '<p>text</p>' });
  const calls: string[] = [];
  const handlers = { save: () => { calls.push('save'); }, export: () => { calls.push('export'); }, print: () => { calls.push('print'); }, section: () => { calls.push('section'); }, symbols: () => editor.view.dom.dispatchEvent(new dom.window.Event(ui.NOTEBOOK_SYMBOLS_EVENT)) };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(React.Fragment, null, React.createElement(ui.NotebookCommandTools, { entryId: 'entry', handlers }), React.createElement(ui.NotebookTextTools, { editor }))));
  const press = async (target: Element, key: string, extra = {}) => { let event: any; await React.act(async () => { event = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key, ...extra }); target.dispatchEvent(event); }); return event.defaultPrevented; };
  assert.equal(await press(editor.view.dom, '\\'), true); assert.deepEqual(calls, ['section']);
  assert.equal(await press(scope.querySelector('#widget')!, '\\'), false); assert.equal(await press(editor.view.dom, '\\', { isComposing: true }), false);
  assert.equal(await press(editor.view.dom, 's'), true); assert.equal(await press(editor.view.dom, 's', { shiftKey: true }), true); assert.equal(await press(editor.view.dom, 'p'), true);
  assert.deepEqual(calls, ['section', 'save', 'print']);
  await React.act(async () => editor.commands.setTextSelection(3));
  assert.equal(await press(editor.view.dom, ';'), true); assert.match(document.querySelector('dialog')!.textContent!, /Insert symbol/);
  await click(button('Insert α (alpha)')); assert.equal(editor.getText(), 'teαxt');
  await click(button('Keyboard shortcuts / 快捷键')); const dialog = document.querySelector('dialog')!;
  assert.equal(await press(dialog, 's'), false); await click(button('Close shortcuts / 关闭快捷键'));
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookCommandTools, { entryId: 'entry', readonly: true, handlers })));
  assert.equal(await press(editor.view.dom, '\\'), false); assert.equal(await press(editor.view.dom, 's'), false); assert.equal(await press(editor.view.dom, 'p'), true);
});

test('science-tool insertion uses real notebook identities and unique recipe references, blocks duplicates and stale edits', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './science-tools'; export { notebookExtensions } from './editor-extensions'; export { Editor } from '@tiptap/core'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click, dom } = runtime, { button, fill } = controls(runtime);
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'original' }, content: [{ type: 'text', text: 'Original experiment' }] }] } });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookScienceTools, { editor, onInsert: (nodes: any[]) => editor.commands.insertContentAt(editor.state.doc.content.size, nodes) })));
  const open = async () => { await click(button('Scientific tools')); await fill('Scientific tools', 'formula'); await click([...document.querySelectorAll('summary')].find(node => node.textContent!.includes('Master-mix'))!); };
  const sheets = () => editor.getJSON().content.filter((node: any) => node.type === 'spreadsheet');
  const recipes = () => editor.getJSON().content.filter((node: any) => node.type === 'mixturePrep');
  await open(); await click(button('Insert editable worksheet and recipe / 插入可编辑工作表与配方'));
  assert.equal(sheets().length, 1, document.body.textContent!.slice(0,500)); assert.equal(recipes().length, 1);
  const firstIds = [sheets()[0].attrs.blockId, recipes()[0].attrs.blockId]; assert.equal(new Set(firstIds).size, 2); assert.ok(firstIds.every(Boolean));
  await click(button('Insert editable worksheet and recipe / 插入可编辑工作表与配方')); assert.equal(sheets().length, 1); assert.match(document.body.textContent!, /already been inserted/);
  await click(button('Set 100 reactions / 设为 100')); await click(button('Insert editable worksheet and recipe / 插入可编辑工作表与配方'));
  assert.equal(sheets().length, 2); assert.equal(sheets()[1].attrs.label, 'Master mix 2');
  for (const recipe of [recipes()[1].attrs.mixture.draft, recipes()[1].attrs.mixture.recipes[0].recipe]) assert.equal(recipe.ingredients[0].source, 'Master mix 2!C4');
  assert.ok(!firstIds.includes(sheets()[1].attrs.blockId)); assert.deepEqual(recipes()[1].attrs.mixture.records, []);
  await React.act(async () => editor.commands.insertContentAt(1, 'Intervening edit. '));
  await click(button('Reset example / 重置示例')); await click(button('Insert editable worksheet and recipe / 插入可编辑工作表与配方'));
  assert.equal(sheets().length, 2); assert.match(document.body.textContent!, /notebook changed/);
  await click(button('Close')); assert.equal(document.querySelector('dialog'), null);
});

test('printed duplicate-name worksheets retain each block calculation and match the editor', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const { React, ui, render } = await createUiRuntime(t, { resolveDir, contents: "export * from './notebook-print-content'; export * from './worksheet-model'; export { notebookExtensions } from './editor-extensions'; export { Editor } from '@tiptap/core';" });
  for (const secondName of ['Data', 'data']) {
    const content = { type: 'doc', content: [
      { type: 'spreadsheet', attrs: { blockId: 'first', label: 'Data', sheet: { rows: 1, columns: 2, cells: { A1: '2', B1: '=A1*3' } } } },
      { type: 'spreadsheet', attrs: { blockId: 'second', label: secondName, sheet: { rows: 1, columns: 2, cells: { A1: '9', B1: '=A1*3' } } } },
    ] };
    editor?.destroy(); editor = new ui.Editor({ extensions: ui.notebookExtensions, content });
    await render(React.createElement(ui.NotebookPrintContent, { document: { schemaVersion: 1, title: 'Repeated names', content }, entryId: 'entry', revision: 1, dirty: false, preparedAt: '2026-11-09T00:00:00Z', settings: { version: 1, orientation: 'portrait', paper: 'A4', marginMm: 15, includeMetadata: false, includeInputs: false, sections: ['notes'] } }));
    const printed = [...document.querySelectorAll('figure')].map(figure => [...figure.querySelectorAll('tbody td')].map(cell => cell.textContent));
    assert.deepEqual(printed, [['2', '6'], ['9', '27']]);
    assert.deepEqual(printed, ['first', 'second'].map(id => Object.values(ui.worksheetCalculation(editor.state.doc, id).values).map(String)));
    assert.equal(document.querySelectorAll('figure p').length, 2);
  }
});
