import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('Notebook sections preserve child editing and attachment bytes stay bounded and verified', async t => {
  let editor: any;
  let dispose = async () => {};
  t.after(() => dispose());
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `
      import { Node } from '@tiptap/core';
      import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
      import StarterKit from '@tiptap/starter-kit';
      import { Section, AttachmentView, attachmentDefaults } from './content-blocks';
      import { NotebookIdentity } from './block-identity';
      export * from './content-blocks';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
      const Attachment = Node.create({ name:'attachment', group:'block', atom:true,
        addAttributes() { return Object.fromEntries(Object.entries(attachmentDefaults).map(([key,value])=>[key,{default:value}])); },
        renderHTML() { return ['div',{'data-notebook-block':'attachment'}]; },
        addNodeView() { return ReactNodeViewRenderer(AttachmentView); },
      });
      export function Fixture({ content, readonly, capture }) {
        const editor = useEditor({ extensions:[StarterKit.configure({link:false,trailingNode:false}), Section, Attachment,
          NotebookIdentity.configure({attributeName:'blockId',types:['paragraph','section','attachment']})],
          content, editable:!readonly });
        capture(editor);
        return <EditorContent editor={editor} />;
      }
    `,
  });
  const { React, ui, render, click, dom } = runtime;
  dispose = () => React.act(async () => editor?.destroy());
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  let epoch = 0;
  const mount = async (content: unknown, readonly = false) => render(React.createElement(ui.AppSdkProvider, {
    host: ui.createAppHost({ name: 'Notebook', locale: 'en' }),
  }, React.createElement(ui.Fixture, { key: ++epoch, content, readonly, capture: (value: any) => { editor = value; } })));
  const act = (operation: () => void | Promise<void>) => React.act(async () => { await operation(); });
  const button = (label: string) => {
    const node = document.querySelector(`button[aria-label="${label}"]`);
    assert.ok(node, `Missing button: ${label}`);
    return node;
  };
  const menuAction = async (label: string) => {
    await act(() => button('Block actions').dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse',
    })));
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent === label);
    assert.ok(item, `Missing menu action: ${label}`);
    await click(item);
  };
  const settled = async (predicate: () => boolean) => {
    const end = Date.now() + 5000;
    while (!predicate() && Date.now() < end) {
      await act(() => new Promise<void>(resolve => setImmediate(resolve)));
    }
    assert.ok(predicate(), 'File verification did not settle');
  };

  await t.test('section collapse and reveal are local; children, attributes and read-only survive', async () => {
    await mount({ type: 'doc', content: [{ type: 'section', attrs: { blockId: 'section-a', label: 'Day 1', date: '2026-11-09' },
      content: [{ type: 'paragraph', attrs: { blockId: 'notes-a' }, content: [{ type: 'text', text: 'Observation' }] }] }] });
    const section = () => document.querySelector('.notebook-section')!;
    const child = () => section().querySelector('[data-node-view-content]')!;
    assert.ok(child().textContent?.includes('Observation'));
    const before = JSON.stringify(editor.getJSON());
    await click(button('Collapse section'));
    assert.equal(child().hasAttribute('hidden'), true);
    assert.equal(JSON.stringify(editor.getJSON()), before);
    await act(() => child().dispatchEvent(new dom.window.CustomEvent('notebook-reveal', { bubbles: true })));
    assert.equal(child().hasAttribute('hidden'), false);
    assert.equal(JSON.stringify(editor.getJSON()), before);
    await act(() => { editor.commands.setTextSelection(2); editor.commands.insertContent('New '); });
    assert.equal(editor.getJSON().content[0].content[0].content[0].text, 'New Observation');
    const html = editor.getHTML();
    assert.match(html, /data-notebook-date="2026-11-09"/);
    await act(() => editor.commands.setContent(html));
    assert.equal(editor.getJSON().content[0].attrs.label, 'Day 1');
    assert.equal(editor.getJSON().content[0].attrs.date, '2026-11-09');
    const snapshot = editor.getJSON();
    await mount(snapshot, true);
    assert.equal(document.querySelector('input[aria-label="Section title"]'), null);
    assert.equal(document.querySelector('input[type="date"]'), null);
    await click(button('Collapse section'));
    assert.equal(JSON.stringify(editor.getJSON()), JSON.stringify(snapshot));
  });

  await t.test('section copy reports denied clipboard, then copies children as HTML without flattening', async () => {
    let copied: any;
    const previousItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    t.after(() => {
      previousItem ? Object.defineProperty(globalThis, 'ClipboardItem', previousItem) : delete (globalThis as any).ClipboardItem;
      previousClipboard ? Object.defineProperty(navigator, 'clipboard', previousClipboard) : delete (navigator as any).clipboard;
    });
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class { data: any; constructor(data: any) { this.data = data; } } });
    const clipboard = { write: async (items: any[]) => { copied = items; }, writeText: async () => { throw new Error('denied'); } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    await menuAction('Copy section link');
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /Could not copy/);
    assert.doesNotMatch(document.body.textContent!, /Link copied/);
    await menuAction('Copy section');
    assert.ok(copied?.length === 1);
    const html = await copied[0].data['text/html'].text();
    assert.match(html, /<section/);
    assert.match(html, /<p[^>]*>New Observation<\/p>/);
    assert.match(document.body.textContent!, /Section copied with its blocks/);
    await mount({ type: 'doc', content: [{ type: 'paragraph' }] });
    const paste = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'New Observation' : '' } });
    await act(() => { editor.commands.setTextSelection(1); editor.view.dom.dispatchEvent(paste); });
    const inserted = editor.getJSON().content.find((node: any) => node.type === 'section');
    assert.ok(inserted, 'Section was flattened by clipboard paste');
    assert.equal(inserted.attrs.label, 'Day 1');
    assert.equal(inserted.attrs.date, '2026-11-09');
    assert.notEqual(inserted.attrs.blockId, 'section-a');
    assert.notEqual(inserted.content[0].attrs.blockId, 'notes-a');
    assert.equal(inserted.content[0].content[0].text, 'New Observation');
    await act(() => editor.commands.undo());
    assert.equal(editor.getJSON().content.some((node: any) => node.type === 'section'), false);
    await act(() => editor.commands.redo());
    assert.deepEqual(editor.getJSON().content.find((node: any) => node.type === 'section'), inserted);
  });

  await t.test('file import retains bytes and hashes, rejects oversize and unsupported image types', async () => {
    const attrs = await ui.createAttachment(new File(['abc'], 'observations.txt', { type: 'text/plain' }));
    assert.equal(attrs.data, 'YWJj');
    assert.equal(attrs.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await assert.rejects(ui.createAttachment(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' })), /PNG, JPEG or WebP/);
    await assert.rejects(ui.createAttachment(new File(['a'.repeat(512 * 1024 + 1)], 'large.txt')), /512 KiB/);
    await assert.rejects(ui.createAttachment(new File(['a'], '../private.txt')), /file name/);
    await mount({ type: 'doc', content: [{ type: 'attachment', attrs: { ...attrs, blockId: 'file-a' } }] });
    await settled(() => !!document.querySelector('[data-kind="attachment"]') && !document.body.textContent!.includes('Checking file integrity'));
    assert.equal(document.querySelector('img'), null);
    assert.equal([...document.querySelectorAll('button')].find(node => node.textContent?.includes('Download file'))!.disabled, false);
    assert.match(document.body.textContent!, /512 KiB per file/);
    await act(() => editor.commands.updateAttributes('attachment', { data: 'YWJk' }));
    await settled(() => document.body.textContent!.includes('File integrity could not be verified'));
    assert.equal([...document.querySelectorAll('button')].find(node => node.textContent?.includes('Download file'))!.disabled, true);
    assert.equal(document.querySelector('img'), null);
    const image = await ui.createAttachment(new File([Uint8Array.of(137, 80, 78, 71)], 'scan.png', { type: 'image/png' }));
    await mount({ type: 'doc', content: [{ type: 'attachment', attrs: { ...image, blockId: 'image-a' } }] }, true);
    await settled(() => !!document.querySelector('img'));
    assert.match(document.querySelector('img')!.src, /^blob:/);
    assert.equal(document.querySelector('textarea'), null);
  });
});
