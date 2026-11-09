import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const component = { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { NamedReferenceTools, DatedSectionTools, NotebookReplacementTools, NotebookStatusBar } from './notebook-reference-controls'; export { rememberWidgetFocus } from './block-order'; export { notebookExtensions } from './editor-extensions'; export { Editor } from '@tiptap/core'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` };

test('named cards and dated sections use required fields, cancel without edits, and serialize through actual schema', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const { React, ui, dom, render, click } = await createUiRuntime(t, component);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const host = ui.createAppHost({ name: 'notebook', allowedApiPaths: ['/api'], fetch: async () => assert.fail('Local insertion does not call an external source') });
  editor = new ui.Editor({ extensions: ui.notebookExtensions, content: '<p>Original</p>' });
  let inserts = 0;
  const onInsert = (nodes: unknown[]) => { inserts++; editor.commands.insertContentAt(editor.state.doc.content.size, nodes); };
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(React.Fragment, {}, React.createElement(ui.NamedReferenceTools, { onInsert }), React.createElement(ui.DatedSectionTools, { onInsert }))));
  const button = (label: string, scope = document) => { const target = [...scope.querySelectorAll('button')].find(button => button.textContent === label); assert.ok(target, label); return target; };
  const fill = async (selector: string, value: string) => React.act(async () => {
    const input = document.querySelector(selector)! as HTMLInputElement;
    Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await click(button('Add named reference'));
  assert.ok(button('Apply reference').disabled);
  await fill('dialog input', 'Calibration checklist'); assert.ok(button('Apply reference').disabled);
  await fill('dialog textarea', 'Measure a blank first.'); assert.equal(button('Apply reference').disabled, false);
  await click(button('Apply reference')); assert.equal(inserts, 1);
  const card = editor.getJSON().content.find((node: any) => node.type === 'namedReference');
  assert.equal(card.attrs.kind, 'entry'); assert.equal(card.attrs.name, 'Calibration checklist'); assert.ok(card.attrs.blockId);
  const html = editor.getHTML(); const roundtrip = new ui.Editor({ extensions: ui.notebookExtensions, content: html });
  assert.equal(roundtrip.getJSON().content.find((node: any) => node.type === 'namedReference').attrs.notes, 'Measure a blank first.'); roundtrip.destroy();
  await click(button('Add named reference')); await click(button('Cancel')); assert.equal(inserts, 1);
  await click(button('Insert dated section')); assert.ok(document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.disabled);
  await fill('dialog input[type=date]', '2026-11-09'); await fill('dialog input:not([type=date])', 'Calibration');
  await click(document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!); assert.equal(inserts, 2);
  assert.equal(editor.getJSON().content.find((node: any) => node.type === 'section').attrs.date, '2026-11-09');
});

test('replacement rejects invalid and stale files, resets picker, cancels restore and ignores an unmounted late request', async t => {
  const { React, ui, dom, render, click } = await createUiRuntime(t, component);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let current: any = { schemaVersion: 1, title: 'Original', content: { type: 'doc', content: [{ type: 'paragraph' }] } }, replaced = 0, calls = 0;
  let release: ((value: Response) => void) | undefined;
  const host = ui.createAppHost({ name: 'notebook', allowedApiPaths: ['/api'], fetch: async (url: string) => { assert.match(String(url), /\/api\/document\/validate$/); calls++; return new Promise<Response>(resolve => { release = resolve; }); } });
  const mount = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookReplacementTools, { getDocument: () => current, onReplace: (value: any) => { current = value; replaced++; } })));
  const button = (label: string) => { const target = [...document.querySelectorAll('button')].find(button => button.textContent === label); assert.ok(target, label); return target; };
  const choose = async (text: string) => React.act(async () => { const picker = document.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(picker, 'files', { configurable: true, value: [{ name: 'entry.json', size: text.length, text: async () => text }] }); picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await mount(); await choose('{bad'); assert.equal(calls, 0); assert.equal(replaced, 0); assert.match(document.body.textContent!, /JSON/);
  await choose(JSON.stringify(current)); assert.equal(calls, 1); current = { ...current, title: 'Edited while reading' };
  await React.act(async () => release!(Response.json({ document: { ...current, title: 'Imported' } })));
  assert.equal(replaced, 0); assert.match(document.body.textContent!, /draft changed/);
  await choose(JSON.stringify(current)); await React.act(async () => release!(Response.json({ document: { ...current, title: 'Imported' } })));
  assert.equal(replaced, 1); assert.equal(current.title, 'Imported'); assert.equal(document.querySelector<HTMLInputElement>('input[type=file]')!.value, '');
  await click(button('Restore Pero example')); await click(button('Cancel')); assert.equal(replaced, 1);
  await choose(JSON.stringify(current)); await render(null); await React.act(async () => release!(Response.json({ document: { ...current, title: 'Late' } })));
  assert.equal(replaced, 1); assert.equal(current.title, 'Imported');
});


test('status reports list nesting and section count and targets only the active worksheet inspector', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const { React, ui, dom, render, click } = await createUiRuntime(t, component);
  const host = ui.createAppHost({ name: 'notebook', allowedApiPaths: ['/api'], fetch: async () => assert.fail('Status is local') });
  editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Observation' }] }] }] },
    { type: 'section', attrs: { label: 'Day', date: '2026-11-09' }, content: [{ type: 'paragraph' }] },
    { type: 'spreadsheet', attrs: { blockId: 'active-sheet' } },
  ] } });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookStatusBar, { editor })));
  await React.act(async () => editor.commands.setTextSelection(3));
  assert.match(document.querySelector('output')!.textContent!, /Sections: 1.*bulletList.*Indent: 1/);
  await click(document.querySelector('button')!); assert.match(document.body.textContent!, /Select a worksheet cell first./);
  let target = '';
  editor.view.dom.addEventListener('pero:notebook-formula-inspector', (event: any) => { target = event.detail; });
  ui.rememberWidgetFocus(editor, 'active-sheet');
  await click(document.querySelector('button')!); assert.equal(target, 'active-sheet');
});

test('workspace empty states render their labels and guidance in the active view', async t => {
  let editor: any; t.after(() => editor?.destroy());
  const { React, ui, dom, render, click } = await createUiRuntime(t, { ...component,
    contents: component.contents + ` export { NotebookWorkspace } from './workspace-views';`,
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const content = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'notes' } }] };
  editor = new ui.Editor({ extensions: ui.notebookExtensions, content });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'notebook', locale: 'en' }) },
    React.createElement(ui.NotebookWorkspace, { editor, entryId: 'empty', revision: 1, document: { schemaVersion: 1, title: 'Empty', content }, readonly: false, onChange() {} })));
  for (const [tab, heading, guidance] of [
    ['Procedures', 'No procedures yet', 'Add a procedure to record materials and step-by-step instructions.'],
    ['Relevant items', 'No relevant items yet', 'Add a named entry reference here'],
  ]) {
    const trigger = [...document.querySelectorAll<HTMLElement>('[role=tab]')].find(node => node.textContent === tab)!;
    await React.act(async () => trigger.focus());
    const panel = document.querySelector('[role=tabpanel][data-state=active]')!;
    assert.equal(panel.querySelector('.pero-ui-empty-heading')?.textContent, heading);
    assert.ok(panel.querySelector('.pero-ui-empty-description')?.textContent?.includes(guidance));
  }
  await click(document.querySelector('button[aria-label="Search and outline"]')!);
  assert.equal(document.querySelector('dialog .pero-ui-empty-heading')?.textContent, 'No outline entries yet');
  const search = document.querySelector('dialog input')!;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(search, 'unmatched');
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelector('dialog .pero-ui-empty-heading')?.textContent, 'No matching blocks');
});
