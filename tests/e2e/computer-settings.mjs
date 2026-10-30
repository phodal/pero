// Actual Electron/Host settings, keyboard controls and recovery, isolated profile.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { computerEvidenceDirectory } from '../fixtures/computer-app.mjs';
import { openSettings } from './sidebar-controls.mjs';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(resolve(tmpdir(),'pero-computer-ui-')),out=computerEvidenceDirectory(root);
await mkdir(out,{recursive:true});await mkdir(resolve(temp,'config'));
const settings=resolve(temp,'config/settings.json');
await writeFile(settings,JSON.stringify({computer_use:{enabled:false},other:{preserve:true},workbench:{appearance:'light',projects:[]}}));
let app,page;
const errors=[];
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const computer=()=>page.evaluate(()=>window.computerEvents.at(-1));
const frames=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const capture=async name=>{await frames();await page.screenshot({path:resolve(out,name+'.png')});};
async function launch(){
 app=await electron.launch({args:['--use-mock-keychain',resolve(process.env.PERO_COMPUTER_TEST_ROOT||root,'desktop')],cwd:root,env:{...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_LOCALE:'en'}});
 page=await app.firstWindow();await focusPage(page);page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected,undefined,{timeout:60000});
 await page.evaluate(async()=>{window.computerEvents=[];window.pero.onEvent(event=>{if(event.kind==='computer_state')window.computerEvents.push(event.data);});await window.pero.computerCommand({action:'computer_get'});});
}
async function open(){
 await openSettings(page);await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
 await expect.poll(async()=>(await state()).settingsOpen).toBe(true);
 await expect.poll(async()=>(await state()).settings.bounds.width).toBeGreaterThan(600);
 await page.keyboard.press(process.platform==='darwin'?'Meta+f':'Control+f');await frames();await page.keyboard.type('Computer');
 await expect.poll(async()=>(await state()).settings.matches).toEqual(['computer.title']);await frames();
}
async function toggle(){const box=(await state()).settings.scroll.anchors[0];await page.mouse.click(box.x+7,box.y+44);}
try {
 await launch();await expect.poll(async()=>(await computer())?.enabled).toBe(false);await open();await capture('settings-light-disabled');
 if(!(await computer()).status.available) {
   expect((await computer()).status.available).toBe(false);
   expect((await computer()).status.accessibility).toBe('unsupported');
   await toggle();expect((await computer()).enabled).toBe(false);
   await capture('settings-unsupported');
 } else {
 await toggle();await expect.poll(async()=>(await computer()).enabled).toBe(true);
 const saved=JSON.parse(await readFile(settings,'utf8'));expect(saved.computer_use.enabled).toBe(true);expect(saved.other).toEqual({preserve:true});
 // Pointer activation preserves focus; reach the checkbox from search via Tab.
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Space');await expect.poll(async()=>(await computer()).enabled).toBe(false);
 await page.evaluate(async()=>{const preferences=JSON.parse(window.peroDiagnostics.snapshot()).preferences;await window.pero.sessionCommand({method:'settings.workbench',preferences:{...preferences,appearance:'dark'}});});
 await expect.poll(async()=>(await state()).preferences.appearance).toBe('dark');await capture('settings-dark-disabled');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680));await frames();await capture('settings-narrow');
 // Make only the temporary settings directory unavailable, then recover it.
 await rename(resolve(temp,'config'),resolve(temp,'saved-config'));await writeFile(resolve(temp,'config'),'blocked config directory');
 await toggle();await expect.poll(async()=>(await computer()).error).toContain('Could not save');expect((await computer()).enabled).toBe(false);await capture('settings-save-error');
 await rm(resolve(temp,'config'));await rename(resolve(temp,'saved-config'),resolve(temp,'config'));
 await page.evaluate(()=>window.pero.computerCommand({action:'computer_get'}));await toggle();await expect.poll(async()=>(await computer()).enabled).toBe(true);
 await page.evaluate(()=>window.pero.computerCommand({action:'computer_stop'}));expect((await computer()).running).toBe(false);expect((await computer()).enabled).toBe(false);
 await page.evaluate(()=>window.pero.computerCommand({action:'computer_set',enabled:true}));
 await app.close();app=undefined;
 await launch();await expect.poll(async()=>(await computer()).enabled).toBe(true);await open();await capture('settings-restored');
 await page.evaluate(()=>window.pero.computerCommand({action:'computer_set',enabled:false}));await expect.poll(async()=>(await computer()).enabled).toBe(false);
 }
 expect(errors).toEqual([]);await writeFile(resolve(out,'settings-result.json'),JSON.stringify({passed:true,checks:!(await computer()).status.available?['unsupported native platform disables enable control']:['Host persisted enable','preserved unrelated settings','keyboard Space toggled','light and dark','narrow window','write failure and recovery','stop','restart restoration'],errors},null,2));
 await rm(resolve(out,'settings-failure.json'),{force:true});
 console.log('Computer Use Settings passed: actual Host persistence, checkbox keyboard input, light/dark/narrow UI, save error/recovery, stop and restart.');
} catch(error) {if(page){await capture('settings-failure');await writeFile(resolve(out,'settings-failure.json'),JSON.stringify({error:String(error),state:await state(),computer:await computer(),errors},null,2));}throw error;}
finally {await app?.close();await rm(temp,{recursive:true,force:true});}
