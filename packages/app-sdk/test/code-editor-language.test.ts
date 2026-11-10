import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('CodeEditor language selection, indentation and read-only retain caller-owned source', async t => {
  const { React, ui, render, dom } = await createUiRuntime(t, 'code-editor-engine');
  let value = 'if True:\n    print(1)';
  const change = (next: string) => { value = next; };
  await render(React.createElement(ui.CodeEditorEngine, { value, label: 'Source', language: 'python', onChange: change }));
  assert.match(document.querySelector('.cm-content')!.textContent!, /if True:/);
  assert.equal(document.querySelector('.cm-mermaid-keyword')?.textContent, 'if');
  const content = document.querySelector('.cm-content')!;
  await React.act(async () => {
    (content as HTMLElement).focus();
    content.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
  });
  assert.match(value, /^ {4}if True:/);
  await render(React.createElement(ui.CodeEditorEngine, { value: 'const a = 1;', label: 'Source', language: 'javascript', onChange: change }));
  assert.equal(document.querySelector('.cm-mermaid-keyword')?.textContent, 'const');
  await render(React.createElement(ui.CodeEditorEngine, { value: 'const a = 1;', label: 'Source', language: 'plaintext', disabled: true, onChange: change }));
  assert.equal(document.querySelector('.cm-mermaid-keyword'), null);
  assert.equal(content.getAttribute('contenteditable'), 'false');
  assert.equal(content.getAttribute('aria-readonly'), 'true');
  const before = value;
  await React.act(async () => {
    content.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
  });
  assert.equal(value, before);
  await render(React.createElement(ui.CodeEditorEngine, { value: 'flowchart TD', label: 'Source', onChange: change }));
  assert.equal(document.querySelector('.cm-mermaid-keyword')?.textContent, 'flowchart');
});
