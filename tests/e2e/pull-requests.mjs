// Real GPUI workbench and pointer gestures; GitHub/ACP use shared process fixtures.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickNewChat,setAppearance} from './sidebar-controls.mjs';
import {mkdtemp,mkdir,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'test-results/pull-requests');
const server=createServer((_,response)=>{response.setHeader('X-Frame-Options','DENY');response.end('<title>Supporting evidence</title><h1>Supporting evidence</h1><input id="draft">');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const webUrl=`http://127.0.0.1:${server.address().port}/evidence`;
const temp=await mkdtemp(resolve(tmpdir(),'pero-pr-e2e-')),bin=resolve(temp,'bin');await mkdir(bin);await mkdir(out,{recursive:true});
await writeFile(resolve(bin,'gh'),`#!/bin/sh\nexport PERO_PR_WEB_URL='${webUrl}' PERO_PR_FAIL='${temp}/fail' PERO_PR_CALLS='${out}/calls.jsonl'\nexec '${process.execPath}' '${root}/tests/fixtures/gh-pr.mjs' "$@"\n`);await chmod(resolve(bin,'gh'),0o755);
await writeFile(resolve(temp,'agents.json'),JSON.stringify([{id:'fixture',name:'PR review fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/acp-agent.mjs'),'--composer']}]));
await writeFile(resolve(temp,'settings.json'),JSON.stringify({chat_agent:'fixture'}));
const env={...process.env,PATH:`${bin}:${process.env.PATH}`,PERO_LOCALE:'en',PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json'),PERO_PR_FAIL:resolve(temp,'fail'),PERO_PR_CALLS:resolve(out,'calls.jsonl')};
let app,page;const errors=[],logs=[];
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const screenshot=name=>page.screenshot({path:resolve(out,`${name}.png`)});
const pr={kind:'pull_request',value:'https://github.com/phodal/pero/pull/164'};
async function launch(){app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env});app.process().stderr.on("data",data=>logs.push(data.toString()));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));await paint();}
async function control(key){let b;await expect.poll(async()=>{b=(await state()).prControls?.[key];return b?.width>0&&b?.height>0;}).toBe(true);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await paint();}
async function selectPR(){
 const snapshot=await state();
 const leaves=node=>node.kind==='leaf'?[node.view]:[...leaves(node.first),...leaves(node.second)];
 const leaf=leaves(snapshot.workspaceNavigation.panes.root).find(leaf=>leaf.tabs.items.some(item=>item.route.value?.kind==='pull_request'));
 const id=leaf.tabs.items.find(item=>item.route.value?.kind==='pull_request').id;
 const tab=snapshot.paneTabs.flatMap(p=>p.tabs).find(t=>t.view===id);
 await page.mouse.click((tab.left+tab.right)/2,(tab.top+tab.bottom)/2);
 await expect.poll(async()=>(await state()).activeContent).toEqual(pr);
}

try{
 await launch();await setAppearance(page,'light');await clickNewChat(page);
 let s=await state();const b=s.composerBounds.input??s.composerBounds;await writeFile(resolve(out,'initial.json'),JSON.stringify(s,null,2));
 // Chat composer sits at the bottom of the active conversation.
 const size=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await page.keyboard.type('pull-request-view');await expect.poll(async()=>(await state()).composer).toBe('pull-request-view');await page.keyboard.press('Enter');
 await expect.poll(async()=>(await state()).pullRequests?.[0]?.snapshot?.status,{timeout:20000}).toBe('merged');
 // Branch discovery materializes a background tab without stealing the conversation.
 expect((await state()).activeContent.kind).toBe('conversation');await screenshot('conversation-link');// Coordinates observed in conversation-link.png at the fixed 1488px viewport.
 await page.mouse.click(680,140);await expect.poll(async()=>(await state()).activeContent).toEqual(pr);
 expect((await state()).contentTabs.filter(item=>item.kind==='pull_request')).toHaveLength(1);
 await screenshot('changes-light');
 await page.mouse.click(1135,140);expect((await state()).contentTabs.filter(item=>item.kind==='pull_request')).toHaveLength(1);
 await page.keyboard.press(process.platform==='darwin'?'Meta+w':'Control+w');
 await expect.poll(async()=>(await state()).activeContent.kind).toBe('conversation');
 expect((await state()).chats).toHaveLength(1);
 await page.mouse.click(680,140);await expect.poll(async()=>(await state()).activeContent).toEqual(pr);

 for(const tab of ['description','commits','checks','reviews']){await control(`pr.${tab}`);await expect.poll(async()=>(await state()).pullRequests[0].tab).toBe(tab);await screenshot(`${tab}-light`);}
 // A link inside PR Markdown uses the same typed dispatcher as Chat/documents.
 await control('pr.description');await page.mouse.click(320,220);
 await expect.poll(async()=>(await state()).activeContent).toEqual({kind:'web',value:webUrl});
 await expect.poll(async()=>(await state()).webDocuments[0]?.observation.load.kind).toBe('ready');
 const webEngine=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url).id,webUrl);
 expect(await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('typeof window.pero+":"+typeof require'),webEngine)).toBe('undefined:undefined');
 await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value="retained evidence"'),webEngine);
 await selectPR();await control('pr.description');await page.mouse.click(320,220);
 await expect.poll(async()=>(await state()).activeContent.kind).toBe('web');expect((await state()).webDocuments).toHaveLength(1);
 expect(await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value'),webEngine)).toBe('retained evidence');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,800));await paint();
 await expect.poll(async()=>app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.id===id)?.getVisible(),webEngine)).toBe(true);
 await screenshot('linked-web-narrow');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
 await page.keyboard.press(process.platform==='darwin'?'Meta+w':'Control+w');await selectPR();
 await control('pr.changes');await writeFile(resolve(temp,'fail'),'offline');await control('refresh');await expect.poll(async()=>(await state()).pullRequests[0].error).toContain('unavailable');expect((await state()).pullRequests[0].snapshot.files.items).toHaveLength(2);await screenshot('refresh-failed');await rm(resolve(temp,'fail'));await control('refresh');await expect.poll(async()=>(await state()).pullRequests[0].pending).toBeNull();await expect.poll(async()=>(await state()).pullRequests[0].error).toBeNull();
 await setAppearance(page,'dark');await screenshot('changes-dark');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,800));await paint();await expect.poll(async()=>(await state()).prControls?.['pr.changes']?.width>0).toBe(true);await screenshot('changes-narrow');
 await app.close();await launch();await expect.poll(async()=>(await state()).activeContent,{timeout:15000}).toEqual(pr);await expect.poll(async()=>(await state()).pullRequests[0]?.snapshot?.status,{timeout:15000}).toBe('merged');await screenshot('restored');
 expect(errors).toEqual([]);console.log('PR workbench passed: background discovery, Markdown link routing/reuse, close/reopen, five tabs, typed Web links with retained isolated engines, retained refresh failures, themes, narrow window and restart.');
}catch(error){if(page){await screenshot('failure');await writeFile(resolve(out,'failure.json'),JSON.stringify(await state(),null,2));}throw error;}finally{if(app)await app.close();await new Promise(done=>server.close(done));await writeFile(resolve(out,'environment.txt'),temp+'\n');await writeFile(resolve(out,'main.log'),logs.join(''));}
