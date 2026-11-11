import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const source = '---\ntitle: Study\npero:\n  bibliography:\n    - id: study\n      title: Local study\n---\n# Study\n\n$x^2$\n\n```{unknown-directive}\nkept exactly\n```\n';

test('MyST editor retains source and identity through reopen and clipboard; invalid clipboard is refused', async t => {
  const { ui } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    export { Editor } from '@tiptap/core';
    export { notebookExtensions } from './editor-extensions';
    export { isClipboardWidget } from './clipboard-block';
  ` });
  const editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [{ type: 'mystDocument', attrs: { blockId: 'myst-1', schemaVersion: 1, source } }] } });

  const saved = editor.getJSON();
  const reopened = new ui.Editor({ extensions: ui.notebookExtensions, content: saved });

  assert.deepEqual(reopened.getJSON(), saved);
  assert.equal(saved.content[0].attrs.source, source);
  const clipboard = new ui.Editor({ extensions: ui.notebookExtensions, content: editor.getHTML() });

  assert.equal(clipboard.getJSON().content[0].attrs.source, source);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 2, source }), false);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 1, source, execute: true }), false);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 1, source, plugins: ['remote'] }), false);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 1, source: '界'.repeat(100000) }), false);
  clipboard.destroy(); reopened.destroy(); editor.destroy();
});

test('MyST source view is labelled, sandboxed and read-only for history or future schemas', async t => {
  let active: { destroy(): void; getJSON(): any } | null = null;
  const capture = (editor: { destroy(): void; getJSON(): any } | null) => { active = editor; };
  const { React, ui, render } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ schemaVersion, editable, capture }) {
      const editor = useEditor({ extensions: notebookExtensions, editable, content: { type: 'doc', content: [{ type: 'mystDocument', attrs: { blockId: 'myst-1', schemaVersion, source: '# Private source\\n\\n<script>alert(1)</script>' } }] } });
      capture(editor); return <EditorContent editor={editor} />;
    }
  ` });
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { schemaVersion: 1, editable: false, key: 'history', capture })));
  assert.equal(document.querySelector('textarea')?.readOnly, true);
  assert.equal(document.querySelector('textarea')?.getAttribute('aria-label'), 'MyST source');
  assert.equal(document.querySelector('iframe')?.getAttribute('sandbox'), '');
  assert.match(document.querySelector('iframe')?.getAttribute('srcdoc') ?? '', /Content-Security-Policy/);
  assert.equal(document.querySelector('[data-kind="mystDocument"]')?.getAttribute('aria-label'), 'MyST document');
  await React.act(async () => active?.destroy());
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { schemaVersion: 2, editable: true, key: 'future', capture })));
  assert.equal(document.querySelector('textarea')?.readOnly, true);
  assert.match(document.body.textContent ?? '', /unsupported or invalid schema/);
  assert.equal(document.querySelector('iframe'), null);
  await React.act(async () => active?.destroy());
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { schemaVersion: 1, editable: true, key: 'editable', capture })));
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, source);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal((active as any).getJSON().content[0].attrs.source, source);
  assert.equal((active as any).getJSON().content[0].attrs.blockId, 'myst-1');
  await React.act(async () => active?.destroy());
});

test('MyST file picker imports into a new block, resets, and rejects large or future files without insertion', async t => {
  const { React, ui, render } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    export { NotebookMystTools } from './myst-document';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
  ` });
  const inserted: unknown[] = [];
  const editor = { isEditable: true, isDestroyed: false };
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookMystTools, { editor, onInsert: (nodes: unknown[]) => { inserted.push(...nodes); return true; } })));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const choose = async (file: object) => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await React.act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(input.value, '');
  };
  await choose({ name: 'study.myst', size: source.length, text: async () => source });
  assert.deepEqual(inserted, [{ type: 'mystDocument', attrs: { schemaVersion: 1, source } }]);
  assert.match(document.body.textContent ?? '', /document inserted/);
  await choose({ name: 'large.md', size: 262145, text: async () => { throw new Error('must not read'); } });
  assert.equal(inserted.length, 1);
  assert.match(document.body.textContent ?? '', /too large/);
  await choose({ name: 'future.myst.json', size: 100, text: async () => JSON.stringify({ format: 'pero-myst', version: 2, source }) });
  assert.equal(inserted.length, 1);
  assert.match(document.body.textContent ?? '', /Unsupported MyST bundle/);
  await choose({ name: 'study.myst.json', size: 100, text: async () => JSON.stringify({ format: 'pero-myst', version: 1, source }) });
  assert.equal(inserted.length, 2);
});
