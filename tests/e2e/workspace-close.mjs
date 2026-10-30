// Real Desktop close transactions: native file selection only is stubbed.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdtemp,realpath,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(process.env.PERO_CONTENT_TEST_ROOT||resolve(import.meta.dirname,'../..'));
const out=resolve(root,'test-results/workspace-close');await mkdir(out,{recursive:true});
const temp=await realpath(await mkdtemp(resolve(tmpdir(),'pero-workspace-close-')));
const file=resolve(temp,'first.txt'),second=resolve(temp,'second.txt');
await writeFile(file,'first source\n');await writeFile(second,'second source\n');await writeFile(resolve(temp,'agents.json'),'[]');
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_LOCALE:'en',PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json')};delete env.ELECTRON_RUN_AS_NODE;
const modifier=process.platform==='darwin'?'Meta':'Control';
const app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env});let page;
const leaves=node=>!node?[]:node.kind==='leaf'?[node.view]:[...leaves(node.first),...leaves(node.second)];
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const views=()=>state().then(state=>leaves(state.workspaceNavigation.panes?.root).flatMap(pane=>pane.tabs.items));
const activeReader=async()=>{const snapshot=await state();const leaf=leaves(snapshot.workspaceNavigation.panes?.root).find(pane=>pane.id===snapshot.workspaceNavigation.panes.focused);return snapshot.paneViews.find(view=>(view.view??view.pane)===leaf.tabs.active)?.reader??snapshot.documents.find(doc=>doc.item.value.source===snapshot.activeContent.value.source)?.reader;};
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await page.keyboard.press(`${modifier}+o`);await expect.poll(async()=>(await state()).activeContent?.value?.source).toBe(path);}
async function edit(text){let reader=await activeReader();if(!reader.source){await page.mouse.click(reader.bounds.x+110,reader.bounds.y+16);await expect.poll(async()=>(await activeReader()).source).toBe(true);reader=await activeReader();}await page.mouse.click(reader.bounds.x+100,reader.bounds.y+80);await page.keyboard.press(`${modifier}+a`);await page.keyboard.insertText(text);await expect.poll(async()=>(await activeReader()).dirty).toBe(true);}
async function confirmSave(){await expect.poll(async()=>(await state()).pendingClose?.prompting).toBe(true);await page.keyboard.press('Enter');}
try {
  page=await app.firstWindow();await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await page.mouse.click(500,300);await open(file);await edit('first unsaved 中文\n');
  await page.keyboard.press(`${modifier}+Alt+Shift+ArrowRight`);await expect.poll(async()=>(await views()).length).toBe(2);
  // A clone's close has no discard prompt and keeps the single canonical Undo buffer.
  await page.keyboard.press(`${modifier}+w`);await expect.poll(async()=>(await views()).length).toBe(1);expect((await state()).pendingClose).toBe(null);expect(leaves((await state()).workspaceNavigation.panes?.root).length).toBe(1);expect((await activeReader()).dirty).toBe(true);expect(await readFile(file,'utf8')).toBe('first source\n');
  await page.keyboard.press(`${modifier}+w`);await expect.poll(async()=>(await state()).pendingClose?.prompting).toBe(true);await page.keyboard.press('Escape');await expect.poll(async()=>(await state()).pendingClose).toBe(null);expect((await views()).length).toBe(1);expect((await activeReader()).dirty).toBe(true);
  await page.keyboard.press(`${modifier}+w`);await confirmSave();await expect.poll(async()=>(await views()).length).toBe(0);expect(await readFile(file,'utf8')).toBe('first unsaved 中文\n');expect((await state()).documents.length).toBe(0);
  // Reopen a closed file through its independent closed-item stack.
  await page.keyboard.press(`${modifier}+Shift+t`);await expect.poll(async()=>(await views()).length).toBe(1);await expect.poll(async()=>(await activeReader())?.dirty).toBe(false);
  await edit('first pane draft\n');await open(second);await edit('second pane draft\n');expect((await views()).length).toBe(2);
  // Cancel at the second prompt retains all tabs, including the first saved tab.
  await page.keyboard.press(`${modifier}+Shift+w`);await confirmSave();await expect.poll(()=>readFile(file,'utf8')).toBe('first pane draft\n');await expect.poll(async()=>(await state()).pendingClose?.prompting).toBe(true);await page.keyboard.press('Escape');await expect.poll(async()=>(await state()).pendingClose).toBe(null);expect((await views()).length).toBe(2);expect(await readFile(file,'utf8')).toBe('first pane draft\n');expect(await readFile(second,'utf8')).toBe('second source\n');
  await page.keyboard.press(`${modifier}+Shift+w`);await confirmSave();await expect.poll(async()=>(await views()).length).toBe(0);expect(await readFile(second,'utf8')).toBe('second pane draft\n');
  await page.screenshot({scale:'css',path:resolve(out,'closed-after-save.png')});await writeFile(resolve(out,'result.json'),JSON.stringify({checks:['dirty clone close retains source and Undo owner','last dirty view Cancel preserves tab','last dirty view Save waits for Host ACK','closed-item reopen restores saved source','whole-pane second-source Cancel removes no views','whole-pane Save completes all remaining dirty sources'],profile:temp},null,2));console.log('Verified last-view and whole-pane Save/Cancel close transactions.');
} catch(error){if(page&&!page.isClosed()){await page.screenshot({scale:'css',path:resolve(out,'failure.png')});await writeFile(resolve(out,'failure.json'),await page.evaluate(()=>window.peroDiagnostics.snapshot()));}throw error;}
finally {await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await app.close();}
