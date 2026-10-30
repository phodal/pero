// Real Desktop/Host file editing. Picker return values select an explicit temporary file.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {once} from 'node:events';
const root=resolve(process.env.PERO_CONTENT_TEST_ROOT||resolve(import.meta.dirname,'../..'));
const out=resolve(root,'test-results/workspace-file-references');await mkdir(out,{recursive:true});
const temp=await realpath(await mkdtemp(resolve(tmpdir(),'pero-file-references-')));
const file=resolve(temp,'100k.json'),copy=resolve(temp,'saved-as.json');
const source='[\n'+Array.from({length:100000},(_,i)=>`{"id":${9007199254740993n+BigInt(i)},"label":"中文 row ${i}","amount":1.0000000000000000001,"data":{"ok":true,"text":"${'x'.repeat(25)}"}}`).join(',\n')+'\n]';
await writeFile(file,source);await writeFile(resolve(temp,'agents.json'),'[]');
// A real unavailable optional App store must not block File recovery/checkpoints.
await writeFile(resolve(temp,'apps'),'unavailable App catalog fixture');
const settings=resolve(temp,'settings.json'),recovery=resolve(temp,'settings.workspace');
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_LOCALE:'en',PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json')};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const modifier=process.platform==='darwin'?'Meta':'Control';
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const reader=()=>state().then(state=>state.documents[0]?.reader);
const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
async function launch(){
  app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env});page=await app.firstWindow();
  await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await page.evaluate(()=>{window.__fileReferenceFrames=[];const send=window.peroSessionCommand;window.peroSessionCommand=json=>{const command=JSON.parse(json);window.__fileReferenceFrames.push({method:command.method,action:command.action,bytes:new TextEncoder().encode(json).length});return send(json);};});
}
try {
  await launch();await expect.poll(async()=>(await state()).appError).toBeTruthy();await paint();await page.mouse.click(500,300);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  await page.keyboard.press(`${modifier}+o`);await expect.poll(async()=>(await reader())?.bytes,{timeout:30000}).toBe(Buffer.byteLength(source));
  let bounds=(await reader()).bounds;await page.mouse.click(bounds.x+100,bounds.y+16);
  await expect.poll(async()=>(await reader()).source).toBe(true);
  bounds=(await reader()).bounds;await page.mouse.click(bounds.x+120,bounds.y+75);
  await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');
  await expect.poll(async()=>(await reader()).selection).toEqual({start:0,end:0});
  await page.keyboard.insertText(' ');
  await expect.poll(async()=>(await reader()).dirty).toBe(true);
  const started=Date.now();await page.evaluate(()=>window.peroWorkspaceCheckpoint(false));const checkpointMs=Date.now()-started;
  const checkpoint=JSON.parse(await readFile(resolve(recovery,'session.json'),'utf8'));
  expect(checkpoint.session.documents[0].draft).toBe(null);expect(checkpoint.session.documents[0].draft_ref.version).toBeGreaterThan(0);
  expect((await stat(resolve(recovery,'session.json'))).size).toBeLessThan(4096);
  let journalBytes=0;const pending=[resolve(recovery,'drafts')];while(pending.length){for(const name of await readdir(pending.pop(),{withFileTypes:true})){const path=resolve(name.parentPath,name.name);if(name.isDirectory())pending.push(path);else journalBytes+=(await stat(path)).size;}}
  expect(journalBytes).toBeLessThan(4096);expect(await readFile(file,'utf8')).toBe(source);
  const frames=await page.evaluate(()=>window.__fileReferenceFrames);expect(frames.some(frame=>frame.action==='store_draft')).toBe(true);expect(Math.max(...frames.map(frame=>frame.bytes))).toBeLessThan(4096);
  await page.screenshot({scale:'css',path:resolve(out,'dirty-reference-checkpoint.png')});
  const exited=once(app.process(),'exit');app.process().kill('SIGKILL');await exited;app=undefined;
  await launch();await expect.poll(async()=>(await reader())?.dirty,{timeout:30000}).toBe(true);
  expect((await reader()).editorBytes).toBe(Buffer.byteLength(source)+1);
  await page.evaluate(()=>{window.__fileReferenceFrames=[];});
  bounds=(await reader()).bounds;await page.mouse.click(bounds.x+130,bounds.y+75);await page.keyboard.press(`${modifier}+s`);
  await expect.poll(()=>readFile(file,'utf8'),{timeout:30000}).toBe(' '+source);
  await expect.poll(async()=>(await reader()).dirty).toBe(false);
  expect((await page.evaluate(()=>window.__fileReferenceFrames)).some(frame=>frame.action==='save_draft'&&frame.bytes<4096)).toBe(true);
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},copy);
  await page.keyboard.press(`${modifier}+Shift+s`);
  await expect.poll(async()=>(await state()).activeContent.value.source).toBe(copy);
  expect(await readFile(copy,'utf8')).toBe(' '+source);
  expect((await page.evaluate(()=>window.__fileReferenceFrames)).some(frame=>frame.action==='save_as_reference'&&frame.bytes<4096)).toBe(true);
  expect((await state()).documents.length).toBe(1);expect((await reader()).dirty).toBe(false);
  await page.screenshot({scale:'css',path:resolve(out,'reference-save-as.png')});
  await writeFile(resolve(out,'result.json'),JSON.stringify({sourceBytes:Buffer.byteLength(source),rows:100000,checkpointMs,journalBytes,metadataBytes:(await stat(resolve(recovery,'session.json'))).size,checks:['optional App catalog failure does not block acknowledged File checkpoints','actual 100k-row edit','bounded incremental draft IPC','reference-only checkpoint metadata','actual Host crash/restart draft recovery','save by reference writes exact disk contents','Save As by reference migrates the File view']},null,2));
  console.log('Verified actual 100k-row draft checkpoint/restart/Save/Save As with small reference frames.');
} catch(error){if(page&&!page.isClosed()){await page.screenshot({scale:'css',path:resolve(out,'failure.png')});await writeFile(resolve(out,'failure.json'),await page.evaluate(()=>window.peroDiagnostics.snapshot()));}throw error;}
finally {if(app){await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await app.close();}}
