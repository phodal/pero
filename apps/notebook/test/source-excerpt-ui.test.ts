import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const source = (text = '\ufeffA🧪e\u0301\r\n终\rLast', mime = 'text/plain') => ({ type: 'attachment', attrs: {
  blockId: 'source-file', filename: 'original.txt', mime, data: Buffer.from(text).toString('base64'), caption: '', sha256: createHash('sha256').update(text).digest('hex'),
} });
const excerpt = (text = 'A🧪B') => {
  const file = source(text), digest = file.attrs.sha256;
  return { source: { blockId: file.attrs.blockId, filename: file.attrs.filename, mime: file.attrs.mime, sha256: digest }, version: digest, text, start: 1, end: 2, quote: '🧪' };
};

function observeDigests(React: any, t: { after(callback: () => void): void }) {
  // WebCrypto is real and may finish after act() under concurrent suite load.
  // Await its actual completion before assertions that need verified source UI.
  const digest = crypto.subtle.digest.bind(crypto.subtle), descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
  const hashes: Promise<ArrayBuffer>[] = [];
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: (...args: Parameters<SubtleCrypto['digest']>) => { const result = digest(...args); hashes.push(result); return result; } });
  t.after(() => { if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor); else delete (crypto.subtle as any).digest; });
  return async () => { while (hashes.length) await React.act(async () => { await Promise.all(hashes.splice(0)); }); };
}

test('source excerpts select real attachments, retain bytes, cancel drafts, reject stale sources and remain readable without sources', async t => {
  let editor: any, dispose = async () => {};
  t.after(() => dispose());
  const { React, ui, render, click, dom } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    import { NotebookSourceExcerptTools } from './source-excerpt';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export { isClipboardWidget } from './clipboard-block';
    export function Fixture({ content, capture, readonly }) {
      const editor = useEditor({ extensions: notebookExtensions, content, editable: !readonly }); capture(editor);
      return <><EditorContent editor={editor}/>{editor && <NotebookSourceExcerptTools editor={editor} onInsert={nodes => editor.commands.insertContentAt(editor.state.doc.content.size, nodes)}/>}</>;
    }
  ` });
  dispose = () => React.act(async () => editor?.destroy());
  const checked = observeDigests(React, t);

  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 20, y: 20, left: 20, top: 20, right: 320, bottom: 52, width: 300, height: 32, toJSON() {} }; };
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' }); let mounts = 0;
  const mount = (content: unknown, readonly = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { key: ++mounts, content, readonly, capture: (value: any) => { editor = value; } })));
  const button = (text: string, scope: ParentNode = document) => { const node = [...scope.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(node, `Missing button ${text}`); return node; };
  const control = (label: string) => { const caption = [...document.querySelectorAll('label')].find(node => node.textContent === label); const node = caption ? document.getElementById(caption.htmlFor) : document.querySelector(`[aria-label="${label}"]`); assert.ok(node, `Missing control ${label}`); return node as HTMLInputElement; };
  const fill = async (label: string, value: string) => React.act(async () => { const node = control(label); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  const select = async () => {
    await click(button('Choose an attachment'));
    const option = [...document.querySelectorAll('[role=option]')].find(node => node.textContent?.includes('original.txt')); assert.ok(option); await click(option); await checked();
  };
  const range = async (start: string, end: string) => { await checked(); await fill('Start offset (codepoints, inclusive)', start); await fill('End offset (codepoints, exclusive)', end); };
  const data = () => JSON.parse(JSON.stringify(editor.getJSON().content.filter((node: any) => node.type === 'sourceExcerpt')));
  const open = async () => { await click(button('Insert source excerpt')); await select(); };
  const original = source();
  await mount({ type: 'doc', content: [{ type: 'paragraph' }, original] });
  await open();
  const preview = control('Source text (read-only)') as unknown as HTMLTextAreaElement;
  assert.equal(preview.readOnly, true); assert.equal(preview.value, '\ufeffA🧪e\u0301\n终\nLast');
  preview.setSelectionRange(2, 8); await click(button('Use highlighted text'));
  assert.equal(control('Start offset (codepoints, inclusive)').value, '2'); assert.equal(control('End offset (codepoints, exclusive)').value, '8');
  await fill('Excerpt label', 'Pinned observation');
  await click(button('Cancel')); assert.equal(data().length, 0);
  await open(); await range('2', '8'); await fill('Excerpt label', 'Pinned observation');
  await click(button('Insert source excerpt', document.querySelector('dialog')!)); await checked();
  assert.equal(data().length, 1); assert.equal(data()[0].attrs.excerpt.quote, '🧪e\u0301\r\n终');
  assert.deepEqual({ ...editor.getJSON().content.find((node: any) => node.type === 'attachment').attrs }, { ...original.attrs, templateOrigin: null, derivation: null });
  assert.match(document.body.textContent!, /Retained text integrity verified/);
  assert.match(document.body.textContent!, /Original attachment is available and unchanged/);
  const pinned = structuredClone(data()[0].attrs);
  await click(button('Update excerpt')); await range('1', '2'); await click(button('Cancel'));
  assert.deepEqual(data()[0].attrs, pinned);
  await click(button('Update excerpt')); await range('1', '2'); await click(button('Update excerpt', document.querySelector('dialog')!));
  assert.equal(data()[0].attrs.excerpt.quote, 'A');
  await click(button('Update excerpt')); await range('2', '8');
  await React.act(async () => { editor.state.doc.descendants((node: any, position: number) => {
    if (node.type.name === 'sourceExcerpt') editor.commands.command(({ tr }: any) => { tr.setNodeMarkup(position, undefined, { ...node.attrs, label: 'Newer excerpt label' }); return true; });
  }); });
  await click(button('Update excerpt', document.querySelector('dialog')!));
  assert.match(document.querySelector('dialog')!.textContent!, /This excerpt changed while you were editing/);
  await click(button('Cancel')); assert.equal(data()[0].attrs.label, 'Newer excerpt label'); assert.equal(data()[0].attrs.excerpt.quote, 'A');
  // A source replacement after selection cannot be inserted under the old digest.
  await open(); await range('2', '8');
  await React.act(async () => {
    editor.state.doc.descendants((node: any, position: number) => { if (node.type.name === 'attachment') editor.commands.command(({ tr }: any) => { tr.setNodeMarkup(position, undefined, source('Replacement').attrs); return true; }); });
  });
  assert.equal((button('Insert source excerpt', document.querySelector('dialog')!) as HTMLButtonElement).disabled, true);
  assert.match(document.querySelector('dialog')!.textContent!, /source attachment changed or was removed/);
  await click(button('Cancel')); assert.equal(data().length, 1);
  assert.match(document.body.textContent!, /Original attachment changed/);
  await React.act(async () => editor.commands.setContent({ type: 'doc', content: data() })); await checked();
  assert.match(document.body.textContent!, /Original attachment is not in this editor section/);
  assert.equal((button('Download retained source') as HTMLButtonElement).disabled, false);
  const retained = editor.getJSON();
  const html = editor.getHTML(); assert.match(html, /data-notebook-block="sourceExcerpt"/);
  await React.act(async () => editor.commands.setContent(html));
  assert.deepEqual(data()[0].attrs.excerpt, retained.content[0].attrs.excerpt);
  assert.equal(ui.isClipboardWidget('sourceExcerpt', { label: '', excerpt: excerpt() }), true);
  assert.equal(ui.isClipboardWidget('sourceExcerpt', { label: '', excerpt: { ...excerpt(), quote: 'forged' } }), false);
  await mount(retained, true); await checked();
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === 'Update excerpt' || node.textContent === 'Insert source excerpt'), false);
  assert.equal((button('Download retained source') as HTMLButtonElement).disabled, false);
  await mount({ type: 'doc', content: [{ type: 'sourceExcerpt', attrs: { label: '', excerpt: null } }] });
  await click(button('Configure source excerpt'));
  assert.match(document.querySelector('dialog')!.textContent!, /Attach a UTF-8 text file/);
  await click(button('Cancel')); assert.equal(data()[0].attrs.excerpt, null);
});

test('unverified clipboard snapshots never enable downloads and cancelled async source reads do not insert', async t => {
  let editor: any, dispose = async () => {};
  t.after(() => dispose());
  const { React, ui, render, click, dom } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent } from '@tiptap/react'; import { notebookExtensions } from './editor-extensions';
    import { NotebookSourceExcerptTools } from './source-excerpt'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ content, capture }) { const editor = useEditor({ extensions: notebookExtensions, content }); capture(editor); return <><EditorContent editor={editor}/>{editor && <NotebookSourceExcerptTools editor={editor} onInsert={nodes => editor.commands.insertContentAt(editor.state.doc.content.size, nodes)}/>}</>; }
  ` });
  dispose = () => React.act(async () => editor?.destroy());
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 20, y: 20, left: 20, top: 20, right: 320, bottom: 52, width: 300, height: 32, toJSON() {} }; };
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle), descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
  t.after(() => { if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor); else delete (crypto.subtle as any).digest; });
  let releases: (() => void)[] = []; const hashing: Promise<ArrayBuffer>[] = [];
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: (...args: Parameters<SubtleCrypto['digest']>) => { const result = new Promise<void>(resolve => releases.push(resolve)).then(() => originalDigest(...args)); hashing.push(result); return result; } });
  const forged = excerpt(); forged.version = 'a'.repeat(64); forged.source.sha256 = forged.version;
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.Fixture, {
    content: { type: 'doc', content: [source(), { type: 'sourceExcerpt', attrs: { label: 'Unverified', excerpt: forged } }] }, capture: (value: any) => { editor = value; },
  })));
  const button = (text: string) => { const node = [...document.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(node, `Missing ${text}`); return node as HTMLButtonElement; };
  assert.match(document.body.textContent!, /Source digest unverified/); assert.equal(button('Download retained source').disabled, true);
  await React.act(async () => { const pending = releases; releases = []; pending.forEach(release => release()); await Promise.all(hashing); });
  assert.match(document.body.textContent!, /Retained source integrity failed/); assert.equal(button('Download retained source').disabled, true);
  await click(button('Insert source excerpt')); await click(button('Choose an attachment'));
  const option = [...document.querySelectorAll('[role=option]')].find(node => node.textContent?.includes('original.txt')); assert.ok(option); await click(option);
  assert.match(document.querySelector('dialog')!.textContent!, /Checking source attachment/);
  await click(button('Cancel'));
  await React.act(async () => { const pending = releases; releases = []; pending.forEach(release => release()); await Promise.all(hashing); });
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(editor.getJSON().content.filter((node: any) => node.type === 'sourceExcerpt').length, 1);
  await click(button('Insert source excerpt')); await click(button('Choose an attachment'));
  await click([...document.querySelectorAll('[role=option]')].find(node => node.textContent?.includes('original.txt'))!);
  await React.act(async () => { editor.state.doc.descendants((node: any, position: number) => {
    if (node.type.name === 'attachment') editor.commands.command(({ tr }: any) => { tr.setNodeMarkup(position, undefined, source('New bytes').attrs); return true; });
  }); });
  await React.act(async () => { const pending = releases; releases = []; pending.forEach(release => release()); await Promise.all(hashing); });
  assert.match(document.querySelector('dialog')!.textContent!, /source attachment changed or was removed/);
  assert.equal(document.querySelector('dialog textarea'), null, 'stale async source reads must not populate the selection preview');
  await click(button('Cancel'));
});

test('whole-notebook sources work across Notes and real procedure editors, navigation, copy and stale edits', async t => {
  let dispose = async () => {}; t.after(() => dispose());
  const { React, ui, render, click, dom } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useState } from 'react'; import { NotebookEditor } from './editor';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk'; export { Fragment, Slice } from '@tiptap/pm/model';
    export function Fixture({ initial, capture }) {
      const [document, setDocument] = useState(initial); capture({ document, setDocument });
      return <NotebookEditor document={document} content={document.content} entryId="cross-root" revision={1}
        onChange={content => setDocument(current => ({...current, content}))}
        onDocumentChange={partial => setDocument(current => ({...current, ...partial}))}/>;
    }
  ` });
  const checked = observeDigests(React, t);
  dom.window.scrollBy = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 20, y: 20, left: 20, top: 20, right: 320, bottom: 52, width: 300, height: 32, toJSON() {} }; };
  dispose = () => React.act(async () => { for (const element of document.querySelectorAll('.tiptap')) (element as any).editor?.destroy(); });
  const rich = (...content: unknown[]) => ({ type: 'doc', content });
  const attachment = (id: string, filename: string) => ({ ...source(), attrs: { ...source().attrs, blockId: id, filename } });
  const initial = { schemaVersion: 1, title: 'Cross-root sources', content: rich(attachment('source-file', 'original.txt'), { type: 'paragraph', attrs: { blockId: 'notes-tail' } }), procedures: [{
    id: 'method', title: 'Method', description: '', introduction: rich({ type: 'sourceExcerpt', attrs: { blockId: 'intro-excerpt', label: '', excerpt: null } }),
    materials: [{ id: 'material', name: 'Buffer', quantity: '', children: [{ id: 'nested', name: 'Stock', quantity: '', content: rich(attachment('material-source', 'material.txt')) }] }],
    steps: [{ id: 'step', text: '', kind: 'description', level: 'step', critical: false, pause: false, minutes: null, completed: false, content: rich(attachment('step-source', 'step.txt')) }],
  }] };
  let state: any;
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.Fixture, { initial, capture: (value: any) => { state = value; } })));
  await checked();
  const button = (text: string, scope: ParentNode = document) => { const node = [...scope.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text); assert.ok(node, `Missing button ${text}`); return node as HTMLButtonElement; };
  const tab = (name: string) => { const node = [...document.querySelectorAll('[role=tab]')].find(node => node.textContent === name); assert.ok(node); return node; };
  const control = (label: string) => { const caption = [...document.querySelectorAll('label')].find(node => node.textContent === label); const node = caption && document.getElementById(caption.htmlFor); assert.ok(node, `Missing control ${label}`); return node as HTMLInputElement; };
  const fill = async (label: string, value: string) => React.act(async () => { const node = control(label); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await click(tab('Procedures')); await checked();
  assert.ok(document.querySelector('.notebook-procedure-content .tiptap'), 'the actual ProcedureRichEditor is mounted');
  await click(button('Configure source excerpt')); await click(button('Source attachment'));
  const options = [...document.querySelectorAll('[role=option]')];
  assert.deepEqual(options.map(node => node.textContent), ['original.txt · text/plain', 'material.txt · text/plain', 'step.txt · text/plain']);
  await click(options[0]); await checked();
  await fill('Start offset (codepoints, inclusive)', '2'); await fill('End offset (codepoints, exclusive)', '8');
  await click(button('Insert source excerpt', document.querySelector('dialog')!)); await checked();
  const intro = () => state.document.procedures[0].introduction.content.find((node: any) => node.type === 'sourceExcerpt');
  assert.equal(intro().attrs.excerpt.source.blockId, 'source-file');
  assert.equal(intro().attrs.excerpt.quote, '🧪e\u0301\r\n终');
  let excerptView = document.querySelector('[data-notebook-block-id="intro-excerpt"]')!;
  assert.match(excerptView.textContent!, /Original attachment is available and unchanged/);
  assert.doesNotMatch(excerptView.textContent!, /no longer|Other notebook sections/);
  const richEditor = (document.querySelector('#notebook-target-method .notebook-procedure-content .tiptap') as any).editor;
  const excerptNode = richEditor.state.doc.firstChild;
  const html = richEditor.view.serializeForClipboard(new ui.Slice(ui.Fragment.from(excerptNode), 0, 0)).dom.innerHTML;
  // The shared hash navigation switches tabs and focuses the original attachment.
  await React.act(async () => { const navigated = new Promise(resolve => dom.window.addEventListener('hashchange', resolve, { once: true })); button('Locate original attachment', excerptView).click(); await navigated; });
  assert.equal(document.querySelector('[role=tab][data-state=active]')!.textContent, 'Notes');
  assert.equal(dom.window.location.hash, '#notebook-entry=cross-root&notebook-target=source-file');
  const notesEditor = (document.querySelector('.notebook-editor .tiptap') as any).editor;
  assert.equal(notesEditor.state.selection.node.attrs.blockId, 'source-file');
  await click(tab('Procedures')); await checked();
  await click(button('Locate original attachment', document.querySelector('[data-notebook-block-id="intro-excerpt"]')!));
  assert.equal(document.querySelector('[role=tab][data-state=active]')!.textContent, 'Notes', 'repeated navigation to the same hash still reveals the source');
  await React.act(async () => { notesEditor.commands.setTextSelection(notesEditor.state.doc.content.size - 1); const paste = new dom.window.Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : '', types: ['text/html'], files: [], items: [] } }); notesEditor.view.dom.dispatchEvent(paste); });
  await checked();
  const copied = state.document.content.content.find((node: any) => node.type === 'sourceExcerpt');
  assert.ok(copied); assert.notEqual(copied.attrs.blockId, 'intro-excerpt');
  assert.equal(copied.attrs.excerpt.source.blockId, 'source-file');
  assert.match(document.querySelector(`[data-notebook-block-id="${copied.attrs.blockId}"]`)!.textContent!, /Original attachment is available and unchanged/);
  // An edit in Notes invalidates a prepared introduction selection via getDocument().
  await click(tab('Procedures')); await checked(); excerptView = document.querySelector('[data-notebook-block-id="intro-excerpt"]')!;
  await click(button('Update excerpt', excerptView)); await checked();
  const originalPinned = structuredClone(intro().attrs.excerpt);
  await React.act(async () => state.setDocument((current: any) => ({ ...current, content: rich({ ...source('New source bytes'), attrs: { ...source('New source bytes').attrs, templateOrigin: null } }, ...current.content.content.filter((node: any) => node.type !== 'attachment')) })));
  assert.equal(button('Update excerpt', document.querySelector('dialog')!).disabled, true);
  assert.match(document.querySelector('dialog')!.textContent!, /source attachment changed or was removed/);
  await click(button('Cancel')); await checked();
  assert.deepEqual(intro().attrs.excerpt, originalPinned);
  assert.match(excerptView.textContent!, /Original attachment changed/);
  await React.act(async () => state.setDocument((current: any) => ({ ...current, content: rich(...current.content.content.filter((node: any) => node.type !== 'attachment')) })));
  await checked();
  assert.match(excerptView.textContent!, /Original attachment is no longer in this notebook/);
  assert.equal(button('Download retained source', excerptView).disabled, false);
});
