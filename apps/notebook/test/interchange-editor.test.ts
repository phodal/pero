import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';
import { persistedBlockTypes, protectUnknownNodes } from '../../../packages/notebook/src/interchange.ts';

const experiment = 'a'.repeat(32);
const report = 'b'.repeat(64);

test('the document parser and interchange block list name the same blocks', () => {
  const result = spawnSync('python3', ['-c', 'import scientific_block; from document import BLOCKS; from block_registry import extension_type_names; print("\\n".join(sorted(set(BLOCKS) | set(extension_type_names()))))'], {
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

test('a note card renders through its editor adapter and survives the document parser', async t => {
  let editor: { getJSON(): { content: { type: string; attrs: { text?: string } }[] }; destroy(): void } | undefined;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    import { isClipboardWidget } from './clipboard-block';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export { isClipboardWidget };
    export function Fixture({ content, capture }) {
      const editor = useEditor({ extensions: notebookExtensions, content });
      capture(editor);
      return <EditorContent editor={editor} />;
    }
  ` });
  const { React, ui, render } = runtime;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, {
    content: { type: 'doc', content: [
      { type: 'noteCard', attrs: { blockId: 'note-1', schemaVersion: 1, text: 'Keep this note' } },
    ] },
    capture: (value: { getJSON(): { content: { type: string; attrs: { text?: string } }[] }; destroy(): void }) => { editor = value; },
  })));
  assert.match(document.body.textContent ?? '', /Keep this note/);
  assert.equal(editor?.getJSON().content[0].type, 'noteCard');
  assert.equal(editor?.getJSON().content[0].attrs.text, 'Keep this note');
  assert.equal(ui.isClipboardWidget('noteCard', { schemaVersion: 1, text: 'Keep this note' }), true);
  assert.equal(ui.isClipboardWidget('noteCard', { schemaVersion: 1, text: 'x'.repeat(4001) }), false);
  const saved = { schemaVersion: 1, title: 'Note', content: editor?.getJSON() };
  const result = spawnSync('python3', ['-c', 'import json,sys; import scientific_block; from document import NotebookDocument; print(NotebookDocument.parse(json.load(sys.stdin)).serialized())'], {
    cwd: fileURLToPath(new URL('../backend', import.meta.url)), input: JSON.stringify(saved), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).content.content[0].attrs.text, 'Keep this note');
});

test('an axis span renders, pastes, and reopens without joining the product block list', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent, NodeViewWrapper } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    import { documentBlockNode } from './document-block-node';
    import { defineDocumentBlock, registerDocumentBlock, unregisterDocumentBlock } from '@pero/notebook/scientific-block';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    const axisSpan = defineDocumentBlock({
      type: 'axisSpan',
      defaults: { low: 0, high: 1, unit: '' },
      versionOne(attrs) {
        if (!Number.isInteger(attrs.low) || !Number.isInteger(attrs.high) || attrs.low >= attrs.high) throw new Error('Invalid axis span order.');
        if (attrs.unit.length > 32) throw new Error('Invalid axis span unit.');
      },
    });
    registerDocumentBlock(axisSpan);
    function AxisSpanView(view) {
      const { low, high, unit } = view.node.attrs;
      return <NodeViewWrapper data-axis-span="">{low}–{high} {unit}</NodeViewWrapper>;
    }
    const extension = documentBlockNode(axisSpan, AxisSpanView);
    export function Fixture({ content, capture }) {
      const editor = useEditor({ extensions: [...notebookExtensions, extension], content });
      capture(editor);
      return <EditorContent editor={editor} />;
    }
    export { unregisterDocumentBlock };
  ` });
  const { React, ui, render } = runtime;
  t.after(() => ui.unregisterDocumentBlock('axisSpan'));
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  const content = { type: 'doc', content: [
    { type: 'noteCard', attrs: { blockId: 'note-1', schemaVersion: 1, text: 'Keep this note' } },
    { type: 'axisSpan', attrs: { blockId: 'axis-1', schemaVersion: 1, low: 2, high: 9, unit: 'mm' } },
  ] };
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, {
    content, capture: (value: any) => { editor = value; },
  })));
  assert.match(document.body.textContent ?? '', /Keep this note/);
  assert.match(document.querySelector('[data-axis-span]')?.textContent ?? '', /2–9 mm/);
  const html = editor.view.serializeForClipboard(editor.state.doc.slice(0)).dom.innerHTML;
  assert.match(html, /data-notebook-block="noteCard"/);
  assert.match(html, /data-notebook-block="axisSpan"/);
  assert.match(html, /data-notebook-unit="&quot;mm&quot;"/);
  assert.match(html, /data-notebook-low="2"/);
  editor.commands.selectAll();
  editor.commands.deleteSelection();
  const paste = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : '', types: ['text/html'], files: [], items: [] } });
  editor.view.dom.dispatchEvent(paste);
  const pasted = editor.getJSON().content;
  assert.equal(pasted[0].type, 'noteCard');
  assert.equal(pasted[0].attrs.text, 'Keep this note');
  assert.equal(pasted[1].type, 'axisSpan');
  assert.deepEqual({ low: pasted[1].attrs.low, high: pasted[1].attrs.high, unit: pasted[1].attrs.unit }, { low: 2, high: 9, unit: 'mm' });
  const saved = { schemaVersion: 1, title: 'Span', content: editor.getJSON() };
  const script = `
import json, sys, tempfile
sys.path.insert(0, sys.argv[1])
import scientific_block
from document_block_fixture import register_axis_span
from document import BLOCKS, NotebookDocument
from store import EntryStore
assert "axisSpan" not in BLOCKS and "noteCard" not in BLOCKS
register_axis_span()
document = json.load(sys.stdin)
with tempfile.TemporaryDirectory() as directory:
    store = EntryStore(directory)
    created = store.create(NotebookDocument.parse(document))
    store.commit(created.identity, 1, lambda current: NotebookDocument.parse({**current.wire(), "title": "Reopened"}))
    print(store.read(created.identity).document.serialized())
`;
  const result = spawnSync('python3', ['-c', script, fileURLToPath(new URL('.', import.meta.url))], {
    cwd: fileURLToPath(new URL('../backend', import.meta.url)), input: JSON.stringify(saved), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const reopened = JSON.parse(result.stdout);
  assert.equal(reopened.title, 'Reopened');
  await React.act(async () => { editor.commands.setContent(reopened.content); });
  assert.match(document.querySelector('[data-axis-span]')?.textContent ?? '', /2–9 mm/);
  assert.match(document.body.textContent ?? '', /Keep this note/);
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
  const result = spawnSync('python3', ['-c', 'import json,sys; import scientific_block; from document import NotebookDocument; print(NotebookDocument.parse(json.load(sys.stdin)).serialized())'], {
    cwd: fileURLToPath(new URL('../backend', import.meta.url)), input: JSON.stringify(saved), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).content.content[0].attrs.payload.attrs.reading, 'kept exactly');
});

test('blocked notebooks hide mutation controls and retain read-only tools', async t => {
  t.after(() => React.act(() => (document.querySelector('.tiptap') as HTMLElement & { editor?: { destroy(): void } })?.editor?.destroy()));
  const { React, ui, render } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { NotebookEditor } from './editor'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async () => new Response('{}') });
  const content = { type: 'doc', content: [{ type: 'instrumentReading', attrs: { blob: 'x'.repeat(70_000) } }] };
  assert.ok(protectUnknownNodes(content).errors.length);
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookEditor, {
    entryId: 'blocked', revision: 1, content, chrome: { status: 'Blocked', onSave: () => assert.fail('blocked save') }, document: { schemaVersion: 1, title: 'Blocked notebook', content },
    historyControls: { canUndo: true, canRedo: true, undo: () => assert.fail('blocked undo'), redo: () => assert.fail('blocked redo') },
  })));
  assert.match(document.body.textContent ?? '', /This notebook was not opened/);
  assert.equal(document.querySelector('.notebook-commandbar'), null);
  assert.equal(document.querySelector('.notebook-editor-surface'), null);
  assert.equal(document.querySelector<HTMLButtonElement>('.notebook-save')?.disabled, true);
  assert.equal(document.querySelector('.notebook-title input, input.notebook-title'), null);
  assert.equal(document.querySelector('.notebook-prose')?.getAttribute('contenteditable'), 'false');
  const buttons = [...document.querySelectorAll('button')].map(button => button.textContent?.trim());
  assert.ok(buttons.includes('Keyboard shortcuts'));
  assert.ok(buttons.includes('Export current JSON'));
  assert.ok(!buttons.includes('Document actions'));
});

test('reference reviews prefer current proposals, clear reviewed controls and ignore old loads', async t => {
  t.after(() => React.act(() => (document.querySelector('.tiptap') as HTMLElement & { editor?: { destroy(): void } })?.editor?.destroy()));
  const { React, ui, render, click } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `
      import { useEditor, EditorContent } from '@tiptap/react';
      import { notebookExtensions } from './editor-extensions';
      import { NotebookContextProvider } from './notebook-context';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
      export function Fixture({ context, content }) {
        const editor = useEditor({ extensions: notebookExtensions, content });
        return <NotebookContextProvider value={context}><EditorContent editor={editor} /></NotebookContextProvider>;
      }
    `,
  });
  const source = { app: 'control-lab', kind: 'verification-report', id: experiment, version: report, locator: '' };
  const proposal = (proposalId: string, baseRevision: number) => ({ proposalId, baseRevision, blockId: 'block-1', decision: 'pending', label: proposalId, source, revision: baseRevision });
  let loads = 0;
  const reviews: { proposalId: string; decision: string }[] = [];
  let resolveOld: ((value: Response) => void) | undefined;
  const response = (proposals: unknown[]) => new Response(JSON.stringify({ proposals }));
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (path: string, init: RequestInit) => {
    if (init.method === 'POST') {
      const review = JSON.parse(init.body as string); reviews.push(review);
      return new Response(JSON.stringify({ entry: { id: 'entry', revision: 3 }, proposal: { decision: review.decision, revision: 3 } }));
    }
    loads++;
    if (path.includes('/old/')) return new Promise<Response>(resolve => { resolveOld = resolve; });
    return response([proposal('stale', 1), proposal('current', 2), proposal('next', 2)]);
  } });
  const content = { type: 'doc', content: [{ type: 'evidence', attrs: { blockId: 'block-1', label: 'Receipt', source, snapshot: null } }] };
  const mount = (entryId = 'entry', dirty = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, {
    content, context: { entryId, revision: 2, readonly: false, dirty, document: { schemaVersion: 1, title: 'Review', content }, getDocument: () => ({ content }) },
  })));
  const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name);
  await mount();
  assert.match(document.body.textContent ?? '', /Proposal wording: current/);
  const initialLoads = loads;
  await mount('entry', true);
  await mount();
  assert.equal(loads, initialLoads, 'new context objects must not refetch proposals');
  await click(button('Reject proposal'));
  assert.match(document.body.textContent ?? '', /Rejected. This revision was not changed./);
  assert.match(document.body.textContent ?? '', /Proposal wording: next/);
  await click(button('Accept proposal'));
  assert.match(document.body.textContent ?? '', /Accepted as revision 3/);
  assert.match(document.body.textContent ?? '', /Proposal wording: stale/);
  assert.equal(button('Accept proposal')?.disabled, true);
  await click(button('Reject proposal'));
  assert.equal(button('Accept proposal'), undefined);
  assert.match(document.body.textContent ?? '', /Rejected. This revision was not changed./);
  assert.deepEqual(reviews.map(value => [value.proposalId, value.decision]), [['current', 'reject'], ['next', 'accept'], ['stale', 'reject']]);
  await mount('old');
  assert.ok(resolveOld);
  await mount('new');
  assert.match(document.body.textContent ?? '', /Proposal wording: current/);
  await React.act(async () => resolveOld!(response([proposal('wrong-entry', 2)])));
  assert.doesNotMatch(document.body.textContent ?? '', /wrong-entry/);
  assert.match(document.body.textContent ?? '', /Proposal wording: current/);
});
