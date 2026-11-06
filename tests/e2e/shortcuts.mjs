// Actual Host persistence, keyboard dispatch and settings in Electron, isolated from user data.
import {expect} from '@playwright/test';
import {electron,focusPage} from './electron.mjs';
import {clickAppShortcut} from './sidebar-controls.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'test-results/shortcuts');
const data=await mkdtemp(resolve(tmpdir(),'pero-shortcuts-'));
await mkdir(out,{recursive:true});
const settings=resolve(data,'settings.json');
await writeFile(settings,JSON.stringify({workbench:{appearance:'light'}}));
const agents=resolve(data,'agents.json');
await writeFile(agents,JSON.stringify([{id:'fixture',name:'Fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/acp-agent.mjs')]}]));
let app,page;
const errors=[];
const primary=process.platform==='darwin'?'Meta':'Control';
const platform=process.platform==='darwin'?'macos':'other';
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
async function launch(){
 app=await electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env:{...process.env,PERO_DESKTOP_DATA_DIR:resolve(data,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:resolve(data,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'}});
 page=await app.firstWindow();await focusPage(page);
 page.on('pageerror',e=>errors.push(e.message));
 await page.waitForSelector('#loading',{state:'hidden',timeout:60000});
 await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).preferences?.shortcuts,undefined,{timeout:60000});
}
async function save(patch){
 const preferences={...(await state()).preferences,...patch};
 await page.evaluate(preferences=>window.pero.sessionCommand({method:'settings.workbench',preferences}),preferences);
 await expect.poll(async()=>(await state()).preferences).toEqual(preferences);
}
async function capture(name){
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 await page.screenshot({path:resolve(out,`${name}.png`)});
 await writeFile(resolve(out,`${name}.json`),JSON.stringify(await state(),null,2));
}
try {
 await launch();
 await page.keyboard.press(`${primary}+/`);
 await expect.poll(async()=>(await state()).settings?.section).toBe('shortcuts.title');
 await capture('01-light');
 await page.keyboard.press('Escape');
 await expect.poll(async()=>(await state()).settingsOpen).toBe(false);
 await save({shortcuts:{macos:{},other:{},[platform]:{toggle_sidebar:[process.platform==='darwin'?'alt-cmd-b':'ctrl-alt-b'],toggle_chat:[]}}});
 const sidebar=(await state()).sidebarButtonBounds.projects.width;
 await page.keyboard.press(`${primary}+Alt+b`);
 await expect.poll(async()=>(await state()).sidebarButtonBounds.projects.width).not.toBe(sidebar);
 const changed=(await state()).sidebarButtonBounds.projects.width;
 await page.keyboard.press(`${primary}+b`);
 expect((await state()).sidebarButtonBounds.projects.width).toBe(changed);
 await app.close();app=null;
 await launch();
 expect((await state()).preferences.shortcuts[platform].toggle_sidebar).toEqual([process.platform==='darwin'?'alt-cmd-b':'ctrl-alt-b']);
 await page.keyboard.press(`${primary}+/`);
 await expect.poll(async()=>(await state()).settings?.section).toBe('shortcuts.title');
 await save({appearance:'dark'});
 await capture('02-dark');
 await page.keyboard.press('Escape');
 await expect.poll(async()=>(await state()).settingsOpen).toBe(false);
 await clickAppShortcut(page,'insights');
 const frame=page.frameLocator('iframe[src^="pero-app://insights/"]');
 await expect(frame.locator('body')).toBeVisible();
 await frame.locator('body').click({position:{x:20,y:20}});
 // Native Electron input reaches before-input-event, unlike synthetic DOM events.
 await app.evaluate(({BrowserWindow},primary)=>{
   BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({type:'keyDown',keyCode:'/',modifiers:[primary]});
   BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({type:'keyUp',keyCode:'/',modifiers:[primary]});
 },process.platform==='darwin'?'meta':'control');
 await expect.poll(async()=>(await state()).settings?.section).toBe('shortcuts.title');
 await capture('03-app-entry');
 await page.keyboard.press('Escape');
 await expect.poll(async()=>(await state()).settingsOpen).toBe(false);
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('keyboard_shortcuts').click());
 await expect.poll(async()=>(await state()).settings?.section).toBe('shortcuts.title');
 expect(errors).toEqual([]);
 console.log('Shortcut persistence and dispatch passed');
} catch (error) {
 await capture('failure');
 console.error('Shortcut failure', (await state()).activeApp, await page.locator('iframe').evaluateAll(frames=>frames.map(frame=>({title:frame.title,src:frame.src}))));
 throw error;
} finally {
 if(app)await app.close();
 await rm(data,{recursive:true,force:true});
}
