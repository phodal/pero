// Explicit real-provider smoke check, separate from deterministic fixture acceptance.
import { _electron as electron, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(resolve(tmpdir(),'pero-real-desktop-'));
const out=resolve(root,'test-results/real-session');await mkdir(out,{recursive:true});
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_LOCALE:'zh-CN',PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[resolve(root,'desktop')],cwd:root,env});
const errors=[];
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>window.peroDiagnostics,undefined,{timeout:60000});
 const state=()=>page.evaluate(()=>window.peroDiagnostics?JSON.parse(window.peroDiagnostics.snapshot()):{chats:[],agents:[]});
 await expect.poll(async()=>(await state()).agents?.length||0).toBeGreaterThan(0);
 await page.mouse.click(74,267);
 await expect.poll(async()=>(await state()).navigation).toBe(0);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.mouse.click(1430,24);
 await expect.poll(async()=>(await state()).chats?.length).toBe(1);
 await page.mouse.click(1375,1030);
 await expect.poll(async()=>(await state()).chats[0].state,{timeout:60000}).toBe('idle');
 await page.mouse.click(790,1030);
 await expect.poll(async()=>(await state()).modelMenu).toBe(true);
 await page.waitForTimeout(150);
 await page.screenshot({path:resolve(out,'model-picker.png')});
 // Drive the GPUI menu through its keyboard selection, using advertised order.
 const modelIndex=(await state()).chats[0].models.findIndex(([id])=>id==='gpt-5.6-sol');
 expect(modelIndex).toBeGreaterThanOrEqual(0);
 for(let i=0;i<=modelIndex;i++)await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect.poll(async()=>(await state()).chats[0].model).toBe('gpt-5.6-sol');
 await page.mouse.click(950,975);await page.waitForTimeout(150);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.insertText',{text:'Reply exactly PERO_DESKTOP_OK. Do not use any tools or modify files.'});
 await expect.poll(async()=>(await state()).composer).toBe('Reply exactly PERO_DESKTOP_OK. Do not use any tools or modify files.');
 await page.keyboard.press('Enter');
 await expect.poll(async()=>(await state()).chats[0].messages.filter(m=>m.role==='assistant').map(m=>m.text).join(''),{timeout:90000}).toBe('PERO_DESKTOP_OK');
 await expect.poll(async()=>(await state()).chats[0].state).toBe('idle');
 await page.screenshot({path:resolve(out,'codex-reply.png')});
 await page.reload();
 await expect.poll(async()=>(await state()).chats?.[0]?.model,{timeout:30000}).toBe('gpt-5.6-sol');
 await writeFile(resolve(out,'result.json'),JSON.stringify({provider:'codex',model:(await state()).chats[0].model,reply:'PERO_DESKTOP_OK',errors},null,2));
 console.log('Real Electron → Rust Host → codex-acp → streamed PERO_DESKTOP_OK: passed');
 expect(errors).toEqual([]);
}catch(error){const page=await app.firstWindow();console.error({errors,state:await page.evaluate(()=>window.peroDiagnostics?.snapshot())});await page.screenshot({path:resolve(out,'failure.png')});throw error;}finally{await app.close();}
