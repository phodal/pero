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
  const templateOrigin = { templateId: 'template', revision: 1, instanceId: 'instance', parameterValues: {}, idMap: {} };
  assert.equal(ui.notebookExtensions.filter((extension: { name: string }) => extension.name === 'mystDocument').length, 1);
  const editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [{ type: 'mystDocument', attrs: { blockId: 'myst-1', schemaVersion: 1, source, templateOrigin } }] } });

  const saved = editor.getJSON();
  const reopened = new ui.Editor({ extensions: ui.notebookExtensions, content: saved });

  assert.deepEqual(reopened.getJSON(), saved);
  assert.equal(saved.content[0].attrs.source, source);
  const clipboard = new ui.Editor({ extensions: ui.notebookExtensions, content: editor.getHTML() });

  assert.equal(clipboard.getJSON().content[0].attrs.source, source);
  assert.deepEqual(clipboard.getJSON().content[0].attrs.templateOrigin, templateOrigin);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 2, source }), false);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 1, source, execute: true }), false);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 1, source, plugins: ['remote'] }), false);
  assert.equal(ui.isClipboardWidget('mystDocument', { schemaVersion: 1, source: '界'.repeat(100000) }), false);
  assert.equal(editor.commands.insertContent({ type: 'mystDocument', attrs: { schemaVersion: 1, source: 'new source' } }), true);
  const inserted = editor.getJSON().content.find((node: any) => node.attrs?.source === 'new source');
  assert.match(inserted.attrs.blockId, /^[A-Za-z0-9_-]{1,128}$/);
  clipboard.destroy(); reopened.destroy(); editor.destroy();
});

test('MyST source view is labelled, sandboxed and read-only for history or future schemas', async t => {
  let active: { destroy(): void; getJSON(): any } | null = null;
  const capture = (editor: { destroy(): void; getJSON(): any } | null) => { active = editor; };
  const { React, ui, render } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export { mystExportFormats } from '@pero/notebook/myst-formats';
    export function Fixture({ schemaVersion, editable, capture }) {
      const editor = useEditor({ extensions: notebookExtensions, editable, content: { type: 'doc', content: [{ type: 'mystDocument', attrs: { blockId: 'myst-1', schemaVersion, source: '# Private source\\n\\n<script>alert(1)</script>' } }] } });
      capture(editor); return <EditorContent editor={editor} />;
    }
  ` });
  const downloads: { name: string; blob: Blob }[] = [];
  const anchorPrototype = window.HTMLAnchorElement.prototype;
  const createUrl = URL.createObjectURL, click = anchorPrototype.click;
  let downloadBlob: Blob;
  URL.createObjectURL = (blob: Blob) => { downloadBlob = blob; return 'blob:unit-download'; };
  anchorPrototype.click = function () { downloads.push({ name: this.download, blob: downloadBlob }); };
  t.after(() => { URL.createObjectURL = createUrl; anchorPrototype.click = click; });
  const download = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === label)!;
    await React.act(async () => button.click());
  };
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { schemaVersion: 1, editable: false, key: 'history', capture })));
  assert.equal(document.querySelector('textarea')?.readOnly, true);
  assert.match(document.body.textContent ?? '', /Scientific downloads.*include the full original source, including comments/);
  assert.equal(document.querySelector('textarea')?.getAttribute('aria-label'), 'MyST source');
  assert.equal(document.querySelector('iframe')?.getAttribute('sandbox'), '');
  assert.match(document.querySelector('iframe')?.getAttribute('srcdoc') ?? '', /Content-Security-Policy/);
  assert.equal(document.querySelector('[data-kind="mystDocument"]')?.getAttribute('aria-label'), 'MyST document');
  await React.act(async () => active?.destroy());
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { schemaVersion: 2, editable: true, key: 'future', capture })));
  assert.equal(document.querySelector('textarea')?.readOnly, true);
  assert.match(document.body.textContent ?? '', /unsupported or invalid schema/);
  assert.equal(document.querySelector('iframe'), null);
  await download('Download source');
  assert.equal(await downloads[0].blob.text(), '# Private source\n\n<script>alert(1)</script>');
  assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === 'Download HTML')?.disabled, true);
  await React.act(async () => active?.destroy());
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { schemaVersion: 1, editable: true, key: 'editable', capture })));
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, source);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal((active as any).getJSON().content[0].attrs.source, source);
  assert.equal((active as any).getJSON().content[0].attrs.blockId, 'myst-1');
  for (const [index, label] of ['Download source', 'Download MyST bundle', 'Download HTML'].entries()) {
    await download(label);
    const format = ui.mystExportFormats[index], saved = downloads.at(-1)!;
    assert.equal(saved.name, `document${format.extensions[0]}`);
    assert.equal(saved.blob.type, format.mediaType);
    assert.equal(await saved.blob.text(), format.serialize({ source }));
  }
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
  await choose({ name: 'other.json', size: 10, text: async () => { throw new Error('must not read'); } });
  assert.equal(inserted.length, 2);
  assert.match(document.body.textContent ?? '', /Choose a .md/);
  let finishRead!: (text: string) => void;
  await choose({ name: 'delayed.MD', size: source.length, text: () => new Promise<string>(resolve => { finishRead = resolve; }) });
  editor.isEditable = false;
  await React.act(async () => finishRead(source));
  assert.equal(inserted.length, 2);
  assert.match(document.body.textContent ?? '', /could not be inserted/);
});
