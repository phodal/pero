// Workbench and standalone Products share the same MCP authority and App RPC.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(resolve(tmpdir(),'pero-app-use-workbench-'));
const output=resolve(root,'test-results/app-use-workbench');
await mkdir(output,{recursive:true});
const agents=resolve(temp,'agents.json');
await writeFile(agents,JSON.stringify(['codex','claude','copilot','grok'].map(id=>({id,name:`App Use ${id}`,command:process.execPath,args:[resolve(root,'tests/fixtures/app-use-agent.mjs')],env:{PERO_APP_USE_FIXTURE_OUTPUT:output}}))));
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'};
delete env.ELECTRON_RUN_AS_NODE;delete env.PERO_APPS_ROOT;
const errors=[];const checks=[];let app;
try{
 app=await electron.launch({requiresNativeWindow:true,args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env});
 const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
 await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
 await expect.poll(async()=>(await state()).apps?.some(a=>a.name==='virtual-cell')).toBe(true);
 await page.mouse.click(80,await page.evaluate(()=>innerHeight-76));
 await expect.poll(async()=>(await state()).navigation).toBe(7);
 await expect.poll(async()=>(await state()).appsLoading).toBe(false);
 await page.mouse.click(1305,110+79*(await state()).apps.findIndex(a=>a.name==='virtual-cell'));
 const frame=page.frameLocator('iframe[title="virtual-cell"]');
 await expect(frame.getByLabel('Find gene',{exact:true})).toBeVisible({timeout:20000});
 await frame.locator('body').evaluate(()=>parent.postMessage({type:'pero:app:chat',text:'app-use:full'},'*'));
 await expect.poll(async()=>(await state()).composer).toBe('app-use:full');
 const left=await page.locator('#pero-app-surface').evaluate(element=>element.getBoundingClientRect().right);
 await page.mouse.click(left+150,await page.evaluate(()=>innerHeight-70));await page.keyboard.press('Enter');
 const active=async()=>{const s=await state();return s.chats[s.activeChat];};
 await expect.poll(async()=>(await active()).messages.filter(m=>m.role==='assistant').at(-1)?.text||'',{timeout:30000}).toContain('APP_USE_RESULT:');
 await expect.poll(async()=>(await active()).state).toBe('idle');
 const text=(await active()).messages.filter(m=>m.role==='assistant').at(-1).text;
 const result=JSON.parse(text.slice(text.indexOf('APP_USE_RESULT:')+'APP_USE_RESULT:'.length));
 expect(result.error).toBeUndefined();expect((await active()).permission).toBeNull();
 expect(new Set(result.steps.map(s=>s.action))).toEqual(new Set(['inventory','start','describe','observe','capture','act','wait','verify','stop','runPlan']));
 await expect(frame.getByLabel('Find gene',{exact:true})).toHaveValue('MS4A1');
 await expect(frame.locator('.vc-gene-list').getByRole('button',{name:'MS4A1',exact:true})).toHaveAttribute('aria-pressed','true');
 checks.push('Workbench scoped Chat: actual ACP MCP tool, automatic approval, 10 verbs, semantic and DOM effects, screenshot evidence and verification');
 await page.screenshot({path:resolve(output,'operated.png')});
 // Complete a real semantic response after the person switches conversations.
 const original=(await active()).id;
 await page.evaluate(()=>{const original=window.peroAppUse;window.peroAppUse=input=>{if(input.request.action==='semantic'){window.contextWaiting=true;return new Promise(resolve=>{window.releaseContext=async()=>{window.peroAppUse=original;resolve(await original(input));};});}return original(input);};});
 await frame.getByRole('button',{name:'Discuss context',exact:true}).click();
 await page.waitForFunction(()=>window.contextWaiting);
 await page.mouse.click(100,28);await expect.poll(async()=>(await active()).scope).toBeNull();
 await page.evaluate(()=>window.releaseContext());
 await expect.poll(async()=>(await state()).attachments.length).toBe(0);
 await frame.locator('body').evaluate(()=>parent.postMessage({type:'pero:app:chat',text:''},'*'));
 await expect.poll(async()=>(await active()).id).toBe(original);
 await expect.poll(async()=>(await state()).attachments.length).toBe(1);
 await page.screenshot({path:resolve(output,'original-draft.png')});
 checks.push('An asynchronous App object response returns to its original draft after a conversation switch; the other draft stays empty');
 // Ordinary conversations also discover mounted Apps; hidden panels remain read-only.
 await page.mouse.click(100,28);
 await expect.poll(async()=>(await state()).navigation).toBe(0);
 await expect.poll(async()=>(await active()).scope).toBeNull();
 await page.mouse.click(900,await page.evaluate(()=>innerHeight-70));
 await page.keyboard.insertText('app-use:hidden');await page.keyboard.press('Enter');
 await expect.poll(async()=>(await active()).messages.filter(m=>m.role==='assistant').at(-1)?.text||'',{timeout:30000}).toContain('APP_USE_RESULT:');
 await expect.poll(async()=>(await active()).state).toBe('idle');
 const ordinaryText=(await active()).messages.filter(m=>m.role==='assistant').at(-1).text;
 const ordinary=JSON.parse(ordinaryText.slice(ordinaryText.indexOf('APP_USE_RESULT:')+'APP_USE_RESULT:'.length));
 expect(ordinary.error).toBeUndefined();expect(ordinary.scenario).toBe('hidden');
 expect(ordinary.steps.filter(step=>step.error==='APP_SURFACE_HIDDEN')).toHaveLength(2);
 checks.push('Ordinary unscoped Chat discovers mounted App, reads hidden semantic state, refuses hidden capture and operation');
 await page.screenshot({path:resolve(output,'ordinary-hidden.png')});

 expect(errors).toEqual([]);
 await writeFile(resolve(output,'result.json'),JSON.stringify({checks,errors,result,ordinary,state:await state()},null,2));
}catch(error){
 if(app){const page=await app.firstWindow();await page.screenshot({path:resolve(output,'failure.png')});await writeFile(resolve(output,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}'));}
 throw error;
}finally{if(app)await app.close();await rm(temp,{recursive:true,force:true});}
