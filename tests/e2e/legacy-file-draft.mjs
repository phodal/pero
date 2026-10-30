// Cross-version recovery: generate a real file draft with the old build, then
// verify the current read-only reader can preserve and save it on close.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdtemp,realpath,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {once} from 'node:events';
const oldRoot=process.env.PERO_LEGACY_TEST_ROOT;
const root=process.env.PERO_CONTENT_TEST_ROOT;
if(!oldRoot||!root) throw new Error('Set PERO_LEGACY_TEST_ROOT and PERO_CONTENT_TEST_ROOT to isolated builds');
const out=resolve(root,'test-results/legacy-file-draft');await mkdir(out,{recursive:true});
const temp=await realpath(await mkdtemp(resolve(tmpdir(),'pero-legacy-draft-')));
const file=resolve(temp,'source.txt');const original='original source\n';const draft='recovered draft 中文\n';
await writeFile(file,original);await writeFile(resolve(temp,'agents.json'),'[]');
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_LOCALE:'en',PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json')};delete env.ELECTRON_RUN_AS_NODE;
const modifier=process.platform==='darwin'?'Meta':'Control';let app,page;
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const reader=async()=>(await state()).documents[0]?.reader;
async function launch(base){app=await electron.launch({args:['--use-mock-keychain',resolve(base,'desktop')],cwd:base,env});page=await app.firstWindow();await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));}
try {
 await launch(oldRoot);await page.mouse.click(500,300);await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.keyboard.press(`${modifier}+o`);
 await expect.poll(async()=>(await reader())?.bytes).toBe(Buffer.byteLength(original));await expect.poll(async()=>(await reader())?.bounds).toBeTruthy();let r=await reader();await page.mouse.click(r.bounds.x+100,r.bounds.y+16);await expect.poll(async()=>(await reader()).source).toBe(true);r=await reader();await page.mouse.click(r.bounds.x+100,r.bounds.y+80);await page.keyboard.press(`${modifier}+a`);await page.keyboard.insertText(draft);await expect.poll(async()=>(await reader()).dirty).toBe(true);
 await page.evaluate(()=>window.peroWorkspaceCheckpoint(false));const exited=once(app.process(),'exit');app.process().kill('SIGKILL');await exited;app=undefined;
 await launch(root);await expect.poll(async()=>(await reader())?.dirty,{timeout:30000}).toBe(true);r=await reader();expect(r.editable).toBe(false);expect(r.editorBytes).toBe(Buffer.byteLength(draft));
 await page.mouse.click(r.bounds.x+100,r.bounds.y+80);await page.keyboard.insertText('SHOULD NOT EDIT');expect((await reader()).editorBytes).toBe(Buffer.byteLength(draft));
 await page.keyboard.press(`${modifier}+w`);await expect.poll(async()=>(await state()).pendingClose?.prompting).toBe(true);await page.keyboard.press('Escape');await expect.poll(async()=>(await state()).pendingClose).toBe(null);expect((await reader()).dirty).toBe(true);expect(await readFile(file,'utf8')).toBe(original);
 await page.keyboard.press(`${modifier}+w`);await expect.poll(async()=>(await state()).pendingClose?.prompting).toBe(true);await page.keyboard.press('Enter');await expect.poll(()=>readFile(file,'utf8'),{timeout:30000}).toBe(draft);await expect.poll(async()=>(await state()).pendingClose).toBe(null);
 await page.screenshot({scale:'css',path:resolve(out,'saved.png')});await writeFile(resolve(out,'result.json'),JSON.stringify({checks:['old build writes real draft and checkpoints','new build restores draft read-only','Cancel preserves draft','Save on close writes exact draft'],oldRoot,root},null,2));console.log('Verified cross-version read-only draft recovery, Cancel, and Save.');
} catch(error){if(page&&!page.isClosed()){await page.screenshot({scale:'css',path:resolve(out,'failure.png')});await writeFile(resolve(out,'failure.json'),await page.evaluate(()=>window.peroDiagnostics.snapshot()));}throw error;}
finally {if(app){await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await app.close();}}
