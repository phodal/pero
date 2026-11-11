import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';
const source = readFileSync(new URL('../../../packages/notebook/test/fixtures/ipynb-contract.json', import.meta.url), 'utf8');
test('IPYNB actual editor clipboard/save/reopen retains source and future versions are readonly', async t => {
  let active: {destroy():void} | undefined;
  const capture=(editor: {destroy():void})=>{active=editor};
  const { React, ui, render } = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { notebookExtensions }; export { Editor } from '@tiptap/core';
    export { isClipboardWidget } from './clipboard-block';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({source,schemaVersion,capture}) { const editor=useEditor({extensions:notebookExtensions,content:{type:'doc',content:[{type:'ipynbDocument',attrs:{blockId:'ipynb-1',schemaVersion,source}}]}}); capture(editor); return <EditorContent editor={editor}/>; }
  ` });
  const editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: [{ type: 'ipynbDocument', attrs: { blockId: 'ipynb-1', schemaVersion: 1, source } }] } });
  const saved = editor.getJSON(); const reopened = new ui.Editor({ extensions: ui.notebookExtensions, content: saved });
  assert.deepEqual(reopened.getJSON(), saved); assert.equal(saved.content[0].attrs.source, source);
  const clipboard = new ui.Editor({ extensions: ui.notebookExtensions, content: editor.getHTML() }); assert.equal(clipboard.getJSON().content[0].attrs.source, source);
  assert.equal(ui.isClipboardWidget('ipynbDocument', { schemaVersion: 2, source }), false);
  clipboard.destroy(); reopened.destroy(); editor.destroy();
  const host=ui.createAppHost({name:'Notebook',locale:'en'});
  await render(React.createElement(ui.AppSdkProvider,{host},React.createElement(ui.Fixture,{source,schemaVersion:1,key:'current',capture})));
  assert.equal(document.querySelector('iframe')?.getAttribute('sandbox'),'');
  assert.equal(document.querySelectorAll('textarea').length,3);
  await React.act(async()=>active?.destroy());
  await render(React.createElement(ui.AppSdkProvider,{host},React.createElement(ui.Fixture,{source,schemaVersion:2,key:'future',capture})));
  assert.equal(document.querySelector('textarea')?.readOnly,true); assert.equal(document.querySelector('iframe'),null);
  await React.act(async()=>active?.destroy());
});
