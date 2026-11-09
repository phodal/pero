import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('verified image history survives editor JSON/HTML, Python import, source downloads and undo without false verification labels', async t => {
  let editor: any, dispose = async () => {};
  t.after(() => dispose());
  const { React, ui, render, click, dom } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    import { useEditor, EditorContent } from '@tiptap/react'; import { notebookExtensions } from './editor-extensions';
    export { createAttachment } from './content-blocks'; export { deriveImageAttachment } from '@pero/notebook/attachment';
    export { closeHistory } from '@tiptap/pm/history'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ content, capture }) { const editor = useEditor({extensions:notebookExtensions,content}); capture(editor); return <EditorContent editor={editor}/>; }
  ` });
  dispose = () => React.act(async () => editor?.destroy());
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const original = await ui.createAttachment(new File(['original bytes'], 'original.png', { type: 'image/png' }));
  const output = await ui.createAttachment(new File(['cropped bytes'], 'cropped.png', { type: 'image/png' }));
  const edit = { x: 2, y: 0, width: 2, height: 2, outputWidth: 4, outputHeight: 2, rotation: 90 };
  const derived = ui.deriveImageAttachment(original, output, 4, 2, edit);
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<SubtleCrypto['digest']>) => { await gate; return nativeDigest(...args); } });
  t.after(() => { descriptor ? Object.defineProperty(crypto.subtle, 'digest', descriptor) : delete (crypto.subtle as any).digest; });
  const content = (attrs: any) => ({ type: 'doc', content: [{ type: 'attachment', attrs: { ...attrs, blockId: 'image' } }] });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(ui.Fixture, { content: content(derived), capture: (value: any) => { editor = value; } })));
  const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent?.includes(label))!;
  assert.equal(button('Download file').disabled, true);
  assert.equal(document.querySelector('img'), null);
  assert.doesNotMatch(document.body.textContent!, /Embedded file digests match|Image history/);
  const settled = async (condition: () => boolean) => {
    const until = Date.now() + 5000;
    while (!condition() && Date.now() < until) await React.act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
    assert.ok(condition(), 'Image verification did not finish');
  };
  await React.act(async () => release());
  await settled(() => document.body.textContent!.includes('Embedded file digests match'));
  assert.match(document.body.textContent!, /not independently replayed or externally attested/);
  assert.match(document.body.textContent!, /crop \(2, 0, 2, 2\); resize 4 × 2 px; rotate 90°/);
  assert.equal(button('Download file').disabled, false);
  let downloaded: { name: string; blob: Blob } | null = null;
  const objectURL = URL.createObjectURL.bind(URL);
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = blob => { const url = objectURL(blob); blobs.set(url, blob); return url; };
  t.after(() => { URL.createObjectURL = objectURL; });
  dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = { name: this.download, blob: blobs.get(this.href)! }; };
  await click(button('Download source image 1'));
  assert.equal(downloaded!.name, 'original.png');
  assert.equal(await downloaded!.blob.text(), 'original bytes');
  const snapshot = JSON.parse(JSON.stringify(editor.getJSON()));
  const html = editor.getHTML();
  assert.match(html, /data-notebook-derivation/);
  await React.act(async () => editor.commands.setContent(html));
  assert.deepEqual(editor.getJSON().content[0].attrs.derivation, derived.derivation);
  const documentValue = { schemaVersion: 1, title: 'Image history', content: snapshot };
  const persisted = spawnSync('python3', ['-c', `import json,sys; from document import NotebookDocument; value=json.load(sys.stdin); print(NotebookDocument.parse(value).serialized())`], {
    cwd: resolve(import.meta.dirname, '../backend'), input: JSON.stringify(documentValue), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(persisted.status, 0, persisted.stderr);
  assert.deepEqual(JSON.parse(persisted.stdout), documentValue);
  await React.act(async () => editor.commands.setContent(JSON.parse(persisted.stdout).content));
  await settled(() => document.body.textContent!.includes('Embedded file digests match'));
  await React.act(async () => editor.setEditable(false));
  assert.ok(!button('Edit image'), 'Read-only image must not expose Edit image');
  assert.ok(button('Download source image 1'));
  await React.act(async () => editor.setEditable(true));
  await React.act(async () => editor.commands.setContent(content(original)));
  await React.act(async () => editor.view.dispatch(ui.closeHistory(editor.state.tr).setNodeMarkup(0, undefined,
    { ...editor.state.doc.firstChild.attrs, ...derived })));
  assert.deepEqual(editor.getJSON().content[0].attrs.derivation, derived.derivation);
  await React.act(async () => editor.commands.undo());
  assert.equal(editor.getJSON().content[0].attrs.sha256, original.sha256);
  assert.equal(editor.getJSON().content[0].attrs.derivation, null);
  await React.act(async () => editor.commands.redo());
  await settled(() => document.body.textContent!.includes('Embedded file digests match'));
  assert.deepEqual(editor.getJSON().content[0].attrs.derivation, derived.derivation);
  // Changing only retained source bytes must hide old verification, history and all downloads.
  const corrupt = structuredClone(derived);
  corrupt.derivation.steps[0].source.data = btoa('modified original');
  await React.act(async () => editor.commands.updateAttributes('attachment', { derivation: corrupt.derivation }));
  assert.equal(document.querySelector('img'), null);
  assert.doesNotMatch(document.body.textContent!, /Embedded file digests match|Image history/);
  assert.equal(button('Download file').disabled, true);
  assert.equal(button('Download source image 1'), undefined);
  await settled(() => document.body.textContent!.includes('File integrity could not be verified'));
  assert.doesNotMatch(document.body.textContent!, /Embedded file digests match/);
});
