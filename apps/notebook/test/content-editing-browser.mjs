import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Uses actual CodeMirror, Canvas, PNG encoding, WebCrypto and ProseMirror transactions.
test('Content editing runs locally in Chromium with highlighted code and derived image undo', { timeout: 60_000 }, async t => {
  const root = resolve(import.meta.dirname, '../../..');
  const result = await build({ stdin: { loader: 'tsx', resolveDir: resolve(root, 'apps/notebook/ui-src'), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useEditor,EditorContent,ReactNodeViewRenderer} from '@tiptap/react';
    import {Node} from '@tiptap/core'; import {closeHistory} from '@tiptap/pm/history'; import StarterKit from '@tiptap/starter-kit';
    import {AppSdkProvider,createAppHost} from '@pero/app-sdk';
    import {NotebookCodeBlock} from './code-block';
    import {createAttachment,AttachmentView,attachmentDefaults} from './content-blocks';
    import {renderRasterEdit} from './raster-edit';
    window.raster={renderRasterEdit,createAttachment,closeHistory};
    const Attachment=Node.create({name:'attachment',group:'block',atom:true,
      addAttributes(){return Object.fromEntries(Object.entries(attachmentDefaults).map(([key,value])=>[key,{default:value}]));},
      renderHTML(){return ['div'];},addNodeView(){return ReactNodeViewRenderer(AttachmentView);}});
    function Fixture(){const editor=useEditor({extensions:[StarterKit.configure({codeBlock:false,trailingNode:false}),NotebookCodeBlock,Attachment],
      content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'python'},content:[{type:'text',text:'print(1)'}]}]}});
      window.editor=editor;return <EditorContent editor={editor}/>;}
    createRoot(document.getElementById('root')).render(<AppSdkProvider host={createAppHost({name:'notebook',locale:'en'})}><Fixture/></AppSdkProvider>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    alias: { react: resolve(root, 'node_modules/react'), 'react-dom': resolve(root, 'node_modules/react-dom'), '@pero/app-sdk/ui': resolve(root, 'packages/app-sdk/src/ui.tsx'), '@pero/app-sdk': resolve(root, 'packages/app-sdk/src/index.tsx') } });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/script.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/script.js' ? result.outputFiles[0].contents : '<div id="root"></div><script src="/script.js"></script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_EXECUTABLE, headless: true });
  t.after(async () => {
    try {
      const output = resolve(root, 'test-results/notebook'); await mkdir(output, { recursive: true });
      await page.screenshot({ path: resolve(output, 'content-editing-final.png'), fullPage: true });
    } finally { await browser.close(); }
  });
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const code = page.getByLabel('Code source (not executed)');
  await code.waitFor().catch(cause => { throw new Error(`${cause.message}\nBrowser errors: ${pageErrors.join('\n')}`); });
  await code.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.type('# local comment');
  await page.waitForFunction(() => window.editor.getText().includes('# local comment'));
  assert.match(await page.evaluate(() => window.editor.getText()), /print\(1\)\n {4}# local comment/);
  assert.equal(await page.locator('.cm-mermaid-comment').count(), 1);
  await page.getByRole('button', { name: 'Code language' }).click();
  await page.getByRole('option', { name: 'JavaScript', exact: true }).click();
  assert.equal(await page.evaluate(() => window.editor.getJSON().content[0].attrs.language), 'javascript');
  await page.evaluate(() => window.editor.commands.setContent({ type:'doc', content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'const x = 1;'}]}] }));
  await page.waitForFunction(() => document.querySelector('.cm-mermaid-keyword')?.textContent === 'const');
  await page.evaluate(() => window.editor.setEditable(false));
  assert.equal(await code.getAttribute('contenteditable'), 'false');
  assert.equal(await page.getByRole('button', { name: 'Remove code block' }).count(), 0);
  const resultImage = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 2;
    const ctx = canvas.getContext('2d'); ctx.fillStyle='red'; ctx.fillRect(0,0,2,2); ctx.fillStyle='blue'; ctx.fillRect(2,0,2,2);
    const source = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
    const original = await window.raster.createAttachment(new File([source],'original.png',{type:'image/png'}));
    const edited = await window.raster.renderRasterEdit(source, {x:2,y:0,width:2,height:2,outputWidth:4,outputHeight:2,rotation:90});
    const derived = await window.raster.createAttachment(new File([edited],'derived.png',{type:'image/png'}));
    const image = await createImageBitmap(edited); canvas.width=image.width; canvas.height=image.height; ctx.drawImage(image,0,0);
    const pixel = Array.from(ctx.getImageData(0,0,1,1).data); image.close();
    window.editor.setEditable(true); window.editor.commands.setContent({type:'doc',content:[{type:'attachment',attrs:original}]});
    window.editor.view.dispatch(window.raster.closeHistory(window.editor.state.tr).setNodeMarkup(0,undefined,derived));
    const saved = window.editor.getJSON().content[0].attrs.sha256;
    window.editor.commands.undo();
    return {width:canvas.width,height:canvas.height,pixel,original:original.sha256,derived:derived.sha256,saved,
      restored:window.editor.getJSON().content[0]?.attrs?.sha256, mime:derived.mime};
  });
  assert.deepEqual([resultImage.width, resultImage.height], [2, 4]);
  assert.deepEqual(resultImage.pixel, [0, 0, 255, 255]);
  assert.notEqual(resultImage.original, resultImage.derived);
  assert.equal(resultImage.saved, resultImage.derived);
  assert.equal(resultImage.restored, resultImage.original);
  assert.equal(resultImage.mime, 'image/png');
});
