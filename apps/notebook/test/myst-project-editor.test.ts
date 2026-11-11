import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const snapshot = JSON.stringify({ format: 'pero-myst-project', version: 1, entry: 'pages/article.md', files: [
  { path: 'pages/article.md', text: '---\ntitle: Project article\n---\n# Results\n\nSee @Study.\n' },
  { path: 'myst.yml', text: 'version: 1\nproject:\n  authors:\n    - name: Project Researcher\n  bibliography: refs.bib\n' },
  { path: 'refs.bib', text: '@article{Study, title={Original reference}, author={Doe, Jane}, year={2024}}' },
] });

test('project editor retains exact snapshot and identity on reopen and clipboard, rejects future clipboard', async t => {
  const { ui } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    export { Editor } from '@tiptap/core';
    export { notebookExtensions } from './editor-extensions';
    export { isClipboardWidget } from './clipboard-block';
  ` });
  const editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [{ type: 'mystProject', attrs: { blockId: 'project-1', schemaVersion: 1, snapshot } }] } });
  const saved = editor.getJSON();
  const reopened = new ui.Editor({ extensions: ui.notebookExtensions, content: saved });
  const clipboard = new ui.Editor({ extensions: ui.notebookExtensions, content: editor.getHTML() });
  assert.deepEqual(reopened.getJSON(), saved);
  assert.equal(clipboard.getJSON().content[0].attrs.snapshot, snapshot);
  assert.equal(saved.content[0].attrs.blockId, 'project-1');
  assert.equal(ui.isClipboardWidget('mystProject', { schemaVersion: 2, snapshot }), false);
  assert.equal(ui.isClipboardWidget('mystProject', { schemaVersion: 1, snapshot: snapshot.replace('"version":1', '"version":99') }), false);
  assert.equal(ui.isClipboardWidget('mystProject', { schemaVersion: 1, snapshot, execute: true }), false);
  const binarySnapshot = JSON.stringify({ ...JSON.parse(snapshot), version: 2, assets: [{ path: 'retained.svg', mediaType: 'image/svg+xml', base64: btoa('<svg><script>never()</script></svg>') }] });
  const binary = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [{ type: 'mystProject', attrs: { blockId: 'binary-1', schemaVersion: 1, snapshot: binarySnapshot } }] } });
  const binaryClipboard = new ui.Editor({ extensions: ui.notebookExtensions, content: binary.getHTML() });
  assert.equal(binaryClipboard.getJSON().content[0].attrs.snapshot, binarySnapshot);
  assert.equal(ui.isClipboardWidget('mystProject', { schemaVersion: 1, snapshot: binarySnapshot }), true);
  binaryClipboard.destroy(); binary.destroy();
  clipboard.destroy(); reopened.destroy(); editor.destroy();
});

test('project view edits a resource, resolves metadata and keeps readonly/future snapshots recoverable', async t => {
  let active: any;
  const { React, ui, render } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ snapshot, schemaVersion, editable, capture }) {
      const editor = useEditor({ extensions: notebookExtensions, editable, content: { type: 'doc', content: [{ type: 'mystProject', attrs: { blockId: 'project-1', schemaVersion, snapshot } }] } });
      capture(editor); return <EditorContent editor={editor} />;
    }
  ` });
  // jsdom has no layout/scroll implementation; browser acceptance covers geometry.
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const downloads: Blob[] = [];
  const anchorPrototype = window.HTMLAnchorElement.prototype;
  const createUrl = URL.createObjectURL, click = anchorPrototype.click;
  URL.createObjectURL = (blob: Blob) => { downloads.push(blob); return 'blob:project-test'; };
  anchorPrototype.click = () => {};
  t.after(() => { URL.createObjectURL = createUrl; anchorPrototype.click = click; });
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  const show = async (key: string, editable: boolean, schemaVersion: number, raw = snapshot) => {
    if (active) await React.act(async () => active.destroy());
    await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { key, editable, schemaVersion, snapshot: raw, capture: (value: any) => { active = value; } })));
  };
  await show('editable', true, 1);
  assert.equal(document.querySelector('iframe')?.getAttribute('sandbox'), '');
  assert.match(document.querySelector('iframe')?.getAttribute('srcdoc') ?? '', /Project Researcher/);
  assert.match(document.querySelector('iframe')?.getAttribute('srcdoc') ?? '', /Original reference/);
  const trigger = document.querySelector('button[aria-label="Project resource"]') as HTMLButtonElement;
  trigger.getBoundingClientRect = () => ({ x: 10, y: 10, top: 10, bottom: 40, left: 10, right: 210, width: 200, height: 30, toJSON() { return this; } });
  await React.act(async () => trigger.click());
  await React.act(async () => (document.querySelector('[role="option"][data-value="refs.bib"]') as HTMLElement).click());
  const textarea = document.querySelector('textarea')!;
  assert.match(textarea.value, /Original reference/);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '@article{Study, title={Revised reference}, author={Doe, Jane}, year={2025}}');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.match(document.querySelector('iframe')?.getAttribute('srcdoc') ?? '', /Revised reference/);
  assert.equal(active.getJSON().content[0].attrs.blockId, 'project-1');
  assert.match(JSON.parse(active.getJSON().content[0].attrs.snapshot).files[2].text, /Revised reference/);
  await show('history', false, 1);
  assert.equal(document.querySelector('textarea')?.readOnly, true);
  const future = snapshot.replace('"version":1', '"version":99');
  await show('future-envelope', true, 1, future);
  assert.equal(document.querySelector('textarea')?.readOnly, true);
  assert.equal(document.querySelector('textarea')?.value, future);
  assert.equal(document.querySelector('iframe'), null);
  assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === 'Download project HTML')?.disabled, true);
  await React.act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Download project snapshot')!.click());
  assert.equal(await downloads.at(-1)!.text(), future);
  await show('invalid-envelope', true, 1, '{bad JSON');
  assert.equal(document.querySelector('iframe'), null);
  assert.equal(document.querySelector('textarea')?.readOnly, true);
  assert.equal(document.querySelector('textarea')?.value, '{bad JSON');
  await show('future-block', true, 2);
  assert.equal(document.querySelector('iframe'), null);
  assert.equal(document.querySelector('textarea')?.value, snapshot);
  await React.act(async () => active.destroy());
});

test('project file picker appends a draft, rejects future snapshots and ignores stale file reads', async t => {
  const { React, ui, render } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    export { NotebookMystTools } from './myst-document';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
  ` });
  const inserted: any[] = [];
  const editor = { isEditable: true, isDestroyed: false };
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookMystTools, { editor, onInsert: (nodes: unknown[]) => { inserted.push(...nodes); return true; } })));
  const choose = async (text: () => Promise<string>) => {
    const input = document.querySelector('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'study.myst-project.json', size: snapshot.length, text }] });
    await React.act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  };
  await choose(async () => snapshot);
  assert.equal(inserted[0].type, 'mystProject');
  assert.deepEqual(JSON.parse(inserted[0].attrs.snapshot), JSON.parse(snapshot));
  await choose(async () => snapshot.replace('"version":1', '"version":99'));
  assert.equal(inserted.length, 1);
  let finishRead!: (text: string) => void;
  await choose(() => new Promise(resolve => { finishRead = resolve; }));
  editor.isEditable = false;
  await React.act(async () => finishRead(snapshot));
  assert.equal(inserted.length, 1);
  assert.match(document.body.textContent ?? '', /could not be inserted/);
});
