import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';
import { persistedBlockTypes, protectUnknownNodes } from '../../../packages/notebook/src/interchange.ts';

const experiment = 'a'.repeat(32);
const report = 'b'.repeat(64);

test('the document parser and interchange block list name the same blocks', () => {
  const result = spawnSync('python3', ['-c', 'from document import BLOCKS; print("\\n".join(sorted(BLOCKS)))'], {
    cwd: fileURLToPath(new URL('../backend', import.meta.url)), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [...persistedBlockTypes].sort());
});

test('evidence shows the editor block id separately from the object version, and a retained block survives the editor', async t => {
  let editor: { getJSON(): unknown; destroy(): void } | undefined;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ content, capture }) {
      const editor = useEditor({ extensions: notebookExtensions, content });
      capture(editor);
      return <EditorContent editor={editor} />;
    }
  ` });
  const { React, ui, render } = runtime;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  const payload = { type: 'instrumentReading', attrs: { blockId: 'inst-1', reading: 'kept' } };
  const protectedContent = protectUnknownNodes({ type: 'doc', content: [payload] }).content;
  const content = {
    type: 'doc',
    content: [
      ...protectedContent.content as unknown[],
      {
        type: 'evidence',
        attrs: {
          blockId: 'block-1', label: 'Control receipt', snapshot: null,
          source: { app: 'control-lab', kind: 'verification-report', id: experiment, version: report, locator: '' },
        },
      },
    ],
  };
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, {
    content, capture: (value: { getJSON(): unknown; destroy(): void }) => { editor = value; },
  })));
  const identity = document.querySelector('[data-editor-block-id="block-1"]') as HTMLElement;
  assert.equal(identity?.dataset.objectVersion, report);
  assert.match(identity.textContent ?? '', /Editor block: block-1/);
  assert.match(identity.textContent ?? '', new RegExp(report));
  assert.equal(document.querySelector('[data-original-type="instrumentReading"]')?.textContent, 'instrumentReading');
  assert.match(document.body.textContent ?? '', /kept exactly/);
  const saved = editor?.getJSON() as { content: { type: string; attrs?: { payload?: { type: string }; blockId?: string } }[] };
  assert.equal(saved.content[0].type, 'retainedBlock');
  assert.equal(saved.content[0].attrs?.payload?.type, 'instrumentReading');
  assert.equal(saved.content[1].attrs?.blockId, 'block-1');
  assert.notEqual(saved.content[1].attrs?.blockId, report);
});

test('cutting and pasting a retained block keeps its payload through the editor and the document parser', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { Editor } from '@tiptap/core';
    import { notebookExtensions } from './editor-extensions';
    import { isClipboardWidget } from './clipboard-block';
    export { Editor, notebookExtensions, isClipboardWidget };
  ` });
  const { ui } = runtime;
  const payload = { type: 'instrumentReading', attrs: { blockId: 'inst-1', reading: 'kept exactly' } };
  editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [
    { type: 'retainedBlock', attrs: { blockId: 'inst-1', originalType: 'instrumentReading', payload } },
  ] } });
  const html = editor.view.serializeForClipboard(editor.state.doc.slice(0)).dom.innerHTML;
  assert.match(html, /data-notebook-payload/);
  assert.match(html, /kept exactly/);
  assert.equal(ui.isClipboardWidget('retainedBlock', { originalType: 'instrumentReading', payload }), true);
  assert.equal(ui.isClipboardWidget('retainedBlock', { originalType: 'paragraph', payload: { type: 'paragraph' } }), false);
  assert.equal(ui.isClipboardWidget('retainedBlock', { originalType: 'instrumentReading', payload: { type: 'instrumentReading', blob: 'x'.repeat(70_000) } }), false);
  editor.commands.selectAll();
  editor.commands.deleteSelection();
  const paste = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : '', types: ['text/html'], files: [], items: [] } });
  editor.view.dom.dispatchEvent(paste);
  const pasted = editor.getJSON().content?.[0];
  assert.equal(pasted.type, 'retainedBlock');
  assert.equal(pasted.attrs.payload.attrs.reading, 'kept exactly');
  assert.equal(pasted.attrs.payload.type, 'instrumentReading');
  assert.equal(pasted.attrs.payload.attrs.blockId, pasted.attrs.blockId);
  const saved = { schemaVersion: 1, title: 'Retained', content: editor.getJSON() };
  const result = spawnSync('python3', ['-c', 'import json,sys; from document import NotebookDocument; print(NotebookDocument.parse(json.load(sys.stdin)).serialized())'], {
    cwd: fileURLToPath(new URL('../backend', import.meta.url)), input: JSON.stringify(saved), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).content.content[0].attrs.payload.attrs.reading, 'kept exactly');
});
