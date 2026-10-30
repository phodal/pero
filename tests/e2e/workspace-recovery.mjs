// Real Host checkpoints and Desktop restart; only native file selection is stubbed.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {once} from 'node:events';
const root=resolve(process.env.PERO_CONTENT_TEST_ROOT||resolve(import.meta.dirname,'../..'));
const out=resolve(root,'test-results/workspace-recovery');await mkdir(out,{recursive:true});
const temp=await realpath(await mkdtemp(resolve(tmpdir(),'pero-workspace-recovery-')));
const file=resolve(temp,'guide.md'),second=resolve(temp,'data.json');
const original='# Recovery source\n\nOriginal 中文 source.\n',draft='# Unsaved draft\n\nKeep exact 中文 and 9007199254740993.\n';
await writeFile(file,original);await writeFile(second,'[{"n":9007199254740993}]');await writeFile(resolve(temp,'agents.json'),'[]');
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_LOCALE:'en',PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json')};
let app,page;const modifier=process.platform==='darwin'?'Meta':'Control';
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const screen=name=>page.screenshot({scale:'css',path:resolve(out,name+'.png')});
async function launch(){
  app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env});page=await app.firstWindow();
  await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
}
async function open(path){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path);await page.keyboard.press(`${modifier}+o`);}
try {
  await launch();await page.mouse.click(500,300);await open(file);
  await expect.poll(async()=>(await state()).documents.length).toBe(1);
  let b=(await state()).documents[0].reader.bounds;
  await page.mouse.click(b.x+100,b.y+16);await expect.poll(async()=>(await state()).documents[0].reader.source).toBe(true);
  await page.mouse.click(b.x+160,b.y+100);await page.keyboard.press(`${modifier}+a`);await page.keyboard.insertText(draft);
  await expect.poll(async()=>(await state()).documents[0].reader.dirty).toBe(true);
  await page.keyboard.press(`${modifier}+f`);await page.keyboard.insertText('draft');
  await expect.poll(async()=>(await state()).documents[0].reader.search?.query).toBe('draft');
  await page.keyboard.press('Escape');await open(second);
  await expect.poll(async()=>(await state()).documents.length).toBe(2);
  await page.keyboard.press(`${modifier}+Alt+ArrowRight`);
  await expect.poll(async()=>(await state()).workspaceNavigation.other?.kind).toBe('content');await paint();
  const navigation=(await state()).workspaceNavigation;
  expect(navigation.route.value.value.source).toBe(second);expect(navigation.other.value.value.source).toBe(file);
  await screen('two-document-workspace');
  // The promise resolves only after Host has synced metadata and source blobs.
  await page.evaluate(()=>window.peroWorkspaceCheckpoint(false));
  expect(await readFile(file,'utf8')).toBe(original);
  const exited=once(app.process(),'exit');app.process().kill('SIGKILL');await exited;app=undefined;
  await writeFile(file,'# External edit\n');
  await launch();
  await expect.poll(async()=>(await state()).documents.length,{timeout:30000}).toBe(2);
  await expect.poll(async()=>(await state()).workspaceNavigation.other?.kind).toBe('content');
  let restored=(await state()).documents.find(doc=>doc.item.value.source===file).reader;
  expect(restored.dirty).toBe(true);expect(restored.source).toBe(true);expect(restored.editorBytes).toBe(Buffer.byteLength(draft));expect(restored.search.query).toBe('draft');expect(restored.fileError).toBe('content.conflict');
  expect(await readFile(file,'utf8')).toBe('# External edit\n');
  await screen('restored-draft-and-panes');
  // Focusing the right reader updates the single workspace navigation owner.
  b=restored.bounds;await page.mouse.click(b.x+150,b.y+110);await page.keyboard.press(`${modifier}+s`);
  await expect.poll(async()=>(await state()).documents.find(doc=>doc.item.value.source===file).reader.fileError).toBe('content.conflict');
  expect(await readFile(file,'utf8')).toBe('# External edit\n');
  await page.keyboard.press('Alt+ArrowLeft');await paint();expect((await state()).activeContent.value.source).toBe(second);
  await page.keyboard.press('Alt+ArrowRight');await paint();expect((await state()).activeContent.value.source).toBe(file);
  // Keep Editing leaves both the renderer and draft intact during a requested reload.
  await app.evaluate(({dialog,BrowserWindow})=>{globalThis.__recoveryPrompts=0;dialog.showMessageBoxSync=()=>{globalThis.__recoveryPrompts++;return 0;};BrowserWindow.getAllWindows()[0].webContents.reload();});
  await expect.poll(()=>app.evaluate(()=>globalThis.__recoveryPrompts)).toBe(1);
  expect((await state()).documents.find(doc=>doc.item.value.source===file).reader.dirty).toBe(true);
  // Normal quit checkpoints the explicit discard decision before stopping Host.
  await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;});await app.close();app=undefined;
  await launch();await expect.poll(async()=>(await state()).documents.length).toBe(2);
  restored=(await state()).documents.find(doc=>doc.item.value.source===file).reader;
  expect(restored.dirty).toBe(false);expect(await readFile(file,'utf8')).toBe('# External edit\n');
  await screen('normal-quit-discard-restored');
  await writeFile(resolve(out,'result.json'),JSON.stringify({checks:['Host acknowledged checkpoint before crash','two distinct document panes and focused route restored','unsaved UTF-8 draft and search restored without file write','external disk change remains conflict','workspace back and forward','reload keep editing','normal quit flushes explicit discard'],profile:temp},null,2));
  console.log('Verified workspace checkpoint, crash recovery, navigation, panes and normal quit.');
} catch(error) {
  if(page&&!page.isClosed()){await screen('failure');await writeFile(resolve(out,'failure.json'),await page.evaluate(()=>window.peroDiagnostics.snapshot()));}throw error;
} finally {if(app){await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await app.close();}}
