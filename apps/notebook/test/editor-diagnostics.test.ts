import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('diagnostics inspect real selections, native paste events, timing and runtime capabilities without altering content', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    export * from './editor-diagnostics'; export * from './editor-inspector';
    export { Editor } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
  ` });
  const { React, ui, render, click, dom } = runtime;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const element = document.createElement('div'); document.body.append(element);
  editor = new ui.Editor({ element, extensions: [ui.StarterKit.configure({ trailingNode: false })], content: '<p>Before <strong>sample</strong> after</p>' });
  const act = (action: () => void) => React.act(async () => action());
  const button = (name: string) => {
    const node = [...document.querySelectorAll('button')].find(item => item.textContent === name);
    assert.ok(node, `Missing button ${name}`); return node;
  };
  const control = (name: string) => {
    const label = [...document.querySelectorAll('label')].find(item => item.textContent === name);
    const node = document.querySelector(`[aria-label="${name}"]`) ?? (label ? document.getElementById(label.htmlFor) : null);
    assert.ok(node, `Missing control ${name}`); return node;
  };
  const fill = async (name: string, value: string) => act(() => {
    const node = control(name), constructor = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement : dom.window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(constructor.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const paste = async (target: Element, text: string, html: string) => act(() => {
    const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain', 'text/html'], files: [], getData(type: string) { return type === 'text/html' ? html : type === 'text/plain' ? text : ''; } } });
    target.dispatchEvent(event);
  });
  await act(() => editor.commands.setTextSelection({ from: 8, to: 14 }));
  const before = editor.getJSON(), snapshot = ui.inspectEditor(editor);
  assert.equal(snapshot.selected.text, 'sample'); assert.equal(snapshot.before.text, 'Before '); assert.equal(snapshot.after.text, ' after');
  assert.equal(snapshot.spans[0].marks[0].type, 'bold'); assert.match(snapshot.selectionHtml.text, /<strong>sample<\/strong>/);
  assert.deepEqual(editor.getJSON(), before);
  assert.equal(ui.diagnosticText('x'.repeat(30000)).text.length, 20000);
  assert.equal(ui.diagnosticText('x'.repeat(30000)).truncated, true);
  assert.equal(ui.timingSummary([]).mean, null);
  assert.deepEqual(ui.timingSummary([{ milliseconds: 2, changed: true }, { milliseconds: 6, changed: false }]), { count: 2, changes: 1, mean: 4, p95: 6, max: 6 });
  const recorded: any[] = []; let now = 10;
  const stop = ui.observeEditor(editor, (sample: any) => recorded.push(sample), () => {}, () => { const previous = now; now += 3; return previous; });
  await act(() => editor.commands.insertContent('actual'));
  stop();
  assert.ok(recorded.some(sample => sample.changed)); assert.equal(recorded[0].milliseconds, 3);
  const count = recorded.length; await act(() => editor.commands.insertContent(' extra')); assert.equal(recorded.length, count);
  const capabilities = ui.notebookCapabilities(editor);
  assert.ok(ui.searchCapabilities(capabilities, 'bold', 'mark').length);
  assert.equal(ui.searchCapabilities(capabilities, 'SUM spreadsheet', 'formula')[0].name, 'SUM');
  assert.deepEqual(ui.searchCapabilities(capabilities, 'secret-source-index'), []);

  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookEditorDiagnostics, { editor })));
  await click(button('Editor diagnostics'));
  await act(() => { editor.commands.setContent('<p>abc</p>'); editor.commands.setTextSelection({ from: 1, to: 4 }); });
  assert.match(control('Selection and HTML').textContent!, /"from": 1/);
  await fill('Inspect', 'paste');
  const priorTray = editor.getJSON();
  await paste(control('Paste here to inspect without changing the notebook'), '<script>test</script>', '<script>window.stolen = true</script><p>tray</p>');
  assert.deepEqual(editor.getJSON(), priorTray);
  assert.equal(document.querySelector('script'), null);
  assert.match(document.querySelector('section')!.textContent!, /"documentChanged": false/);
  assert.match(document.querySelector('section')!.textContent!, /"prevented": true/);
  await paste(editor.view.dom, 'actual paste', '<p><em>actual paste</em></p>');
  assert.equal(editor.getText(), 'actual paste');
  assert.match(document.querySelector('section')!.textContent!, /"documentChanged": true/);
  await click(button('Clear captured events'));
  assert.match(document.body.textContent!, /No paste events captured yet/);
  await fill('Inspect', 'performance'); assert.match(document.body.textContent!, /document changes/);
  await click(button('Reset measurements')); assert.match(document.body.textContent!, /Edit or move the selection/);
  await fill('Inspect', 'capabilities'); await fill('Search capability names, owners and contracts', 'REVERSECOMPLEMENT');
  assert.match(document.querySelector('section')!.textContent!, /REVERSECOMPLEMENT/);
  await fill('Search capability names, owners and contracts', 'not-a-capability'); assert.match(document.body.textContent!, /No matching capabilities/);
  await click(button('Close diagnostics')); await paste(editor.view.dom, 'closed', '<p>closed</p>');
  await click(button('Editor diagnostics')); await fill('Inspect', 'paste'); assert.match(document.body.textContent!, /No paste events captured yet/);
});
