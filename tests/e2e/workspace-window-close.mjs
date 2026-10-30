// Real OS window-close/reload requests, actual File saves and Host-acknowledged restart.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdtemp,realpath,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {once} from 'node:events';
const root=resolve(process.env.PERO_CONTENT_TEST_ROOT||resolve(import.meta.dirname,'../..'));
const out=resolve(root,'test-results/workspace-window-close');await mkdir(out,{recursive:true});
const temp=await realpath(await mkdtemp(resolve(tmpdir(),'pero-window-close-')));
const first=resolve(temp,'first.txt'),second=resolve(temp,'second.txt');
await writeFile(first,'first original\n');await writeFile(second,'second original\n');await writeFile(resolve(temp,'agents.json'),'[]');
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_LOCALE:'en',PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json')};delete env.ELECTRON_RUN_AS_NODE;
const modifier=process.platform==='darwin'?'Meta':'Control';let app,page;
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const leaves=node=>!node?[]:node.kind==='leaf'?[node.view]:[...leaves(node.first),...leaves(node.second)];
const views=()=>state().then(state=>leaves(state.workspaceNavigation.panes?.root).flatMap(leaf=>leaf.tabs.items));
const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
async function launch(){app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env});page=await app.firstWindow();await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await page.keyboard.press(`${modifier}+o`);await expect.poll(async()=>(await state()).activeContent?.value?.source).toBe(path);}
async function reader(){const snapshot=await state(),focused=snapshot.workspaceNavigation.panes.focused,leaf=leaves(snapshot.workspaceNavigation.panes.root).find(leaf=>leaf.id===focused);return snapshot.paneViews.find(view=>view.view===leaf.tabs.active)?.reader??snapshot.documents.find(doc=>doc.item.value.source===snapshot.activeContent.value.source)?.reader;}
async function edit(text){let view=await reader();if(!view.source){await page.mouse.click(view.bounds.x+110,view.bounds.y+16);await expect.poll(async()=>(await reader()).source).toBe(true);view=await reader();}await page.mouse.click(view.bounds.x+120,view.bounds.y+75);await page.keyboard.press(`${modifier}+a`);await page.keyboard.insertText(text);await expect.poll(async()=>(await reader()).dirty).toBe(true);}
async function prompt(){await expect.poll(async()=>(await state()).pendingClose?.window&&(await state()).pendingClose?.prompting).toBe(true);await paint();}
async function osClose(){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await prompt();}
try {
  await launch();await page.mouse.click(500,300);await open(first);await edit('first window draft 中文\n');await open(second);await edit('second window draft\n');
  await osClose();await page.keyboard.press('Enter');await expect.poll(()=>readFile(first,'utf8')).toBe('first window draft 中文\n');await prompt();await page.keyboard.press('Escape');await expect.poll(async()=>(await state()).pendingClose).toBe(null);expect((await views()).length).toBe(2);expect(await readFile(second,'utf8')).toBe('second original\n');
  await page.screenshot({scale:'css',path:resolve(out,'cancel-preserves-window.png')});
  const exited=once(app.process(),'exit');await osClose();await page.keyboard.press('Enter');await exited;app=undefined;expect(await readFile(second,'utf8')).toBe('second window draft\n');
  await launch();await expect.poll(async()=>(await views()).length).toBe(2);await expect.poll(async()=>(await reader())?.dirty).toBe(false);
  // A reload uses the same preflight instead of letting beforeunload discard edits.
  await edit('reload draft\n');await page.evaluate(()=>{window.__closeBootToken='same renderer';});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.reload());await prompt();await page.keyboard.press('Escape');await expect.poll(async()=>(await state()).pendingClose).toBe(null);expect(await page.evaluate(()=>window.__closeBootToken)).toBe('same renderer');expect((await reader()).dirty).toBe(true);
  const reloaded=page.waitForEvent('load');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.reload());await prompt();await page.keyboard.press('Enter');await reloaded;await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'));expect(await readFile(second,'utf8')).toBe('reload draft\n');await expect.poll(async()=>(await views()).length).toBe(2);
  // Conflict aborts the window close and retains all source views and unsaved text.
  await edit('keep conflicting draft\n');await writeFile(second,'external disk change\n');await osClose();await page.keyboard.press('Enter');await expect.poll(async()=>(await state()).pendingClose).toBe(null);await expect.poll(async()=>(await reader()).fileError).toBe('content.conflict');expect((await views()).length).toBe(2);expect((await reader()).dirty).toBe(true);expect(await readFile(second,'utf8')).toBe('external disk change\n');
  await page.screenshot({scale:'css',path:resolve(out,'conflict-preserves-window.png')});await writeFile(resolve(out,'result.json'),JSON.stringify({profile:temp,checks:['actual OS close Save then Cancel preserves all tabs','window destruction waits for File Save and metadata Host ACK','restart restores saved pane tabs','reload Cancel preserves renderer and draft','reload Save persists exact File text','external disk conflict cancels window close and preserves draft']},null,2));console.log('Verified OS window close/reload Save/Cancel, acknowledged restart and conflict recovery.');
} catch(error){if(page&&!page.isClosed()){await page.screenshot({scale:'css',path:resolve(out,'failure.png')});await writeFile(resolve(out,'failure.json'),await page.evaluate(()=>window.peroDiagnostics.snapshot()));}throw error;}
finally {if(app&&app.process().exitCode===null){const exited=once(app.process(),'exit');app.process().kill('SIGKILL');await exited;}}
