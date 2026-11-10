import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('Background, code and reference mentions preserve semantic document content and reject unsafe HTML', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const { ui, React, render, click, dom } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export * from './text-tools'; export * from './code-block'; export * from './reference-mention';
      export * from './raster-edit'; export { Editor, Node } from '@tiptap/core';
      export { default as StarterKit } from '@tiptap/starter-kit';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const source = { app: 'paper-agent', kind: 'report', id: 'real-local-report', version: 'revision-3', locator: '' };
  const reference = { label: 'Observed evidence', source };
  const Evidence = ui.Node.create({ name: 'evidence', group: 'block', atom: true,
    addAttributes() { return { label: { default: '' }, source: { default: null } }; }, renderHTML() { return ['div']; } });
  editor = new ui.Editor({ extensions: [ui.StarterKit.configure({ codeBlock: false, trailingNode: false }),
    ui.NotebookCodeBlock, ui.NotebookTextColor, ui.NotebookTextBackground, ui.ReferenceMention, Evidence], content: '<p>Observed</p>' });
  editor.commands.setTextSelection({ from: 1, to: 9 });
  editor.commands.setMark('textBackground', { tone: 'amber' });
  assert.match(editor.getHTML(), /data-notebook-text-background="amber"/);
  editor.commands.setContent(editor.getHTML());
  assert.equal(editor.getJSON().content[0].content[0].marks[0].attrs.tone, 'amber');
  editor.commands.setContent('<p><span data-notebook-text-background="url(bad)">unsafe</span><span style="background:red">plain</span></p>');
  assert.ok(editor.getJSON().content[0].content.every((item: any) => !item.marks));
  editor.commands.setContent('<pre><code class="language-python">print(1)\n</code></pre>');
  assert.equal(editor.getJSON().content[0].attrs.language, 'python');
  assert.equal(editor.getText(), 'print(1)\n');
  editor.commands.setContent('<pre><code class="language-unknown">retained</code></pre>');
  assert.equal(editor.getJSON().content[0].attrs.language, 'plaintext');
  assert.equal(editor.getText(), 'retained');
  assert.equal(ui.isReferenceMention(reference), true);
  for (const invalid of [{ ...reference, source: { ...source, version: '' } },
    { ...reference, source: { ...source, id: 'a\nb' } }, { ...reference, source: { ...source, extra: 'bad' } },
    { ...reference, label: '' }, { ...reference, label: 'a'.repeat(201) }, { ...reference, href: 'javascript:bad' }]) {
    assert.equal(ui.isReferenceMention(invalid), false);
  }
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'referenceMention', attrs: reference }] }] });
  const html = editor.getHTML();
  editor.commands.setContent(html);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON().content[0].content[0].attrs)), reference);
  editor.commands.setContent('<p></p>');
  editor.commands.setTextSelection(1);
  editor.view.pasteHTML(html, new dom.window.Event('paste'));
  assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON().content[0].content[0].attrs)), reference);
  editor.commands.setContent('<p></p>');
  editor.view.pasteHTML('<p><span data-notebook-text-background="green" tone="url(bad)">safe</span></p>', new dom.window.Event('paste'));
  assert.equal(editor.getJSON().content[0].content[0].marks[0].attrs.tone, 'green');
  editor.commands.setContent('<p><span data-notebook-reference="{}">fallback</span></p>');
  assert.equal(editor.getText(), 'fallback');
  assert.equal(editor.getJSON().content[0].content[0].type, 'text');
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'evidence', attrs: reference }] });
  editor.commands.setTextSelection(1);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'notebook', locale: 'en' }) },
    React.createElement(ui.NotebookReferenceMentionPicker, { editor })));
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Mention reference'));
  await click([...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Observed evidence · revision-3'));
  assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON().content[0].content[0].attrs)), reference);
  await React.act(async () => editor.setEditable(false));
  assert.equal(document.querySelector('#root')!.textContent, '');

  const crop = { x: 1, y: 0, width: 2, height: 2, outputWidth: 4, outputHeight: 2, rotation: 90 };
  assert.equal(ui.rasterEditPlan(4, 2, crop).canvasWidth, 2);
  assert.equal(ui.rasterEditPlan(4, 2, crop).canvasHeight, 4);
  for (const edit of [{ ...crop, x: 3 }, { ...crop, rotation: 45 }, { ...crop, outputWidth: 8193 },
    { ...crop, width: -1 }, { ...crop, x: NaN }, { ...crop, outputWidth: 8192, outputHeight: 8192 }]) {
    assert.throws(() => ui.rasterEditPlan(4, 2, edit));
  }
});

test('Code blocks follow live read-only changes without replacing their document node', async t => {
  let editor: any;
  t.after(async () => { await React.act(async () => editor?.destroy()); });
  const { ui, React, render } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `import React from 'react';
      import { useEditor, EditorContent } from '@tiptap/react';
      import StarterKit from '@tiptap/starter-kit';
      import { NotebookCodeBlock } from './code-block';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
      export function Fixture({ capture }) {
        const editor = useEditor({ extensions: [StarterKit.configure({ codeBlock: false, trailingNode: false }), NotebookCodeBlock],
          content: '<pre><code class="language-python">print(1)</code></pre>' });
        capture(editor); return <EditorContent editor={editor}/>;
      }`,
  });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'notebook', locale: 'en' }) },
    React.createElement(ui.Fixture, { capture: (value: any) => { editor = value; } })));
  const source = () => document.querySelector('[aria-label="Code"]')!;
  const language = () => document.querySelector<HTMLButtonElement>('button[aria-label="Code language"]')!;
  const remove = () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Remove code block');
  const node = editor.state.doc.firstChild;
  assert.equal(source().getAttribute('contenteditable'), 'true');
  assert.equal(language().disabled, false);
  assert.ok(remove());
  await React.act(async () => editor.setEditable(false));
  assert.equal(editor.state.doc.firstChild, node);
  assert.equal(source().getAttribute('contenteditable'), 'false');
  assert.equal(language().disabled, true);
  assert.equal(remove(), undefined);
  assert.equal(editor.getText(), 'print(1)');
  await React.act(async () => editor.setEditable(true));
  assert.equal(editor.state.doc.firstChild, node);
  assert.equal(source().getAttribute('contenteditable'), 'true');
  assert.equal(language().disabled, false);
  assert.ok(remove());
});
