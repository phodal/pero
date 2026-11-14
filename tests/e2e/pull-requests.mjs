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
await writeFile(resolve(out,'prompts.jsonl'),'');
await writeFile(resolve(out,'environment.txt'),temp+'\n');
await writeFile(resolve(bin,'gh'),`#!/bin/sh\nexport PERO_PR_WEB_URL='${webUrl}' PERO_PR_FAIL='${temp}/fail' PERO_PR_CALLS='${out}/calls.jsonl' PERO_PR_DISCUSSIONS='${temp}/discussions.json' PERO_PR_DISCUSSION_FAIL='${temp}/discussion-fail'\nexec '${process.execPath}' '${root}/tests/fixtures/gh-pr.mjs' "$@"\n`);await chmod(resolve(bin,'gh'),0o755);
await writeFile(resolve(temp,'agents.json'),JSON.stringify([{id:'fixture',name:'PR review fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/acp-agent.mjs'),'--composer',`--capture=${out}/prompts.jsonl`]}]));
await writeFile(resolve(temp,'settings.json'),JSON.stringify({chat_agent:'fixture'}));
const env={...process.env,PATH:`${bin}:${process.env.PATH}`,PERO_LOCALE:'en',PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json'),PERO_PR_FAIL:resolve(temp,'fail'),PERO_PR_CALLS:resolve(out,'calls.jsonl'),PERO_PR_DISCUSSIONS:resolve(temp,'discussions.json'),PERO_PR_DISCUSSION_FAIL:resolve(temp,'discussion-fail')};
let app,page;const errors=[],logs=[];
const state=()=>{if(errors.length)throw new Error(errors[0]);return page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));};
const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const screenshot=name=>page.screenshot({path:resolve(out,`${name}.png`)});
const pr={kind:'pull_request',value:'https://github.com/phodal/pero/pull/164'};
async function launch(){app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env});app.process().stderr.on("data",data=>logs.push(data.toString()));page=await app.firstWindow();page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});let consoleErrors=0;page.on('console',message=>{if(message.type()==='error'&&consoleErrors++<5)console.error(message.text());});await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));await paint();}
async function control(key){
 let b;const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 await expect.poll(async()=>{
  b=(await state()).prControls?.[key];
  if(b?.width>0&&b?.height>0&&b.y>=0&&b.y+b.height<viewport.height)return true;
  await page.mouse.move(Math.min(viewport.width-80,Math.max(360,b?.x??500)),Math.round(viewport.height*.6));
  await page.mouse.wheel(0,b&&b.y<0?-350:350);await paint();return false;
 },{timeout:15000}).toBe(true);
 await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await paint();
}
async function selectPR(){
 const snapshot=await state();
 if(snapshot.activeContent.kind==='web'){
  // Web's address bar replaces the tab strip. Reopen the visible PR reference
  // in the retained conversation dock (observed in the fixed-size capture).
  await page.mouse.click(1135,140);
  await expect.poll(async()=>(await state()).activeContent).toEqual(pr);
  // Opening a PR reference requests a fresh snapshot. Wait for that observable
  // refresh before exercising the replacement Markdown content.
  await expect.poll(async()=>(await state()).pullRequests[0].pending).toBeNull();
  // Host navigation precedes Electron hiding the native child WebContentsView.
  await expect.poll(()=>app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].contentView.children.some(view=>view.webContents?.getURL()===url&&view.getVisible()),snapshot.activeContent.value)).toBe(false);
  await paint();return;
 }
 const leaves=node=>node.kind==='leaf'?[node.view]:[...leaves(node.first),...leaves(node.second)];
 const leaf=leaves(snapshot.workspaceNavigation.panes.root).find(leaf=>leaf.tabs.items.some(item=>item.route.value?.kind==='pull_request'));
 const id=leaf.tabs.items.find(item=>item.route.value?.kind==='pull_request').id;
 const tab=snapshot.paneTabs.flatMap(p=>p.tabs).find(t=>t.view===id);
 await page.mouse.click((tab.left+tab.right)/2,(tab.top+tab.bottom)/2);
 await expect.poll(async()=>(await state()).activeContent).toEqual(pr);
}

try{
 await launch();await setAppearance(page,'light');await clickNewChat(page);
 await expect.poll(async()=>(await state()).composerBounds.input?.width,{timeout:15000}).toBeGreaterThan(0);
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
 const discussion=()=>state().then(s=>s.pullRequests[0].snapshot.discussions.items.find(item=>item.id==='PRRT_current'));
 expect((await discussion()).comments).toHaveLength(2); // Nested comment pages are read too.
 await control('discussion-PRRT_current-reply');await page.keyboard.type('Keep this reply after a failed publish.');
 await writeFile(resolve(temp,'discussion-fail'),'mutation');await control('discussion-PRRT_current-send');
 await expect.poll(async()=>JSON.stringify((await state()).pullRequests)).toContain('unavailable');
 expect((await discussion()).comments).toHaveLength(2);await screenshot('discussion-reply-failed');
 await rm(resolve(temp,'discussion-fail'));await control('discussion-PRRT_current-send');
 await expect.poll(async()=>(await discussion()).comments.length).toBe(3);
 expect((await discussion()).comments.at(-1).body).toBe('Keep this reply after a failed publish.');
 await control('discussion-PRRT_current-resolve');await expect.poll(async()=>(await discussion()).resolved).toBe(true);
 await control('discussion-PRRT_current-resolve');await expect.poll(async()=>(await discussion()).resolved).toBe(false);
 await screenshot('discussion-reply-and-resolve');
 // This real button prepares a frozen ordinary Composer draft, never auto-sends.
 const retained=(await state()).composerBounds;const retainedInput=retained.input??retained;
 await page.mouse.click(retainedInput.x+retainedInput.width/2,retainedInput.y+retainedInput.height/2);
 await page.keyboard.type('Existing repair note. ');
 await control('discussion-PRRT_current-fix');
 await expect.poll(async()=>(await state()).composer).toContain('PR #164');
 const composed=await state();expect(composed.composer).toContain('Fix');
 expect(composed.composer).toContain('Existing repair note.');
 const draftBounds=composed.composerBounds.input??composed.composerBounds;
 await page.mouse.click(draftBounds.x+draftBounds.width/2,draftBounds.y+draftBounds.height/2);
 await screenshot('discussion-fix-composer');await page.keyboard.press('Enter');
 await expect.poll(async()=>{
  const lines=(await readFile(resolve(out,'prompts.jsonl'),'utf8')).trim().split('\n');
  return lines.at(-1);
 }).toContain('Keep the conversation when opening this PR.');
 const prompts=(await readFile(resolve(out,'prompts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 const repair=JSON.stringify(prompts.at(-1));
 for(const evidence of ['abcdef0123456789','src/workspace.rs','Original review diff','Keep this reply after a failed publish.'])expect(repair).toContain(evidence);
 // GitHub resolution is unchanged by sending the repair prompt.
 expect((await discussion()).resolved).toBe(false);await selectPR();
 // A link inside PR Markdown uses the same typed dispatcher as Chat/documents.
 await control('pr.description');await page.mouse.click(320,180);
 await expect.poll(async()=>(await state()).activeContent).toEqual({kind:'web',value:webUrl});
 await expect.poll(async()=>(await state()).webDocuments[0]?.observation.load.kind).toBe('ready');
 const webEngine=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url).id,webUrl);
 expect(await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('typeof window.pero+":"+typeof require'),webEngine)).toBe('undefined:undefined');
 await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value="retained evidence"'),webEngine);
 await selectPR();await control('pr.description');await page.mouse.click(320,180);
 await expect.poll(async()=>(await state()).activeContent.kind).toBe('web');expect((await state()).webDocuments).toHaveLength(1);
 expect(await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value'),webEngine)).toBe('retained evidence');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,800));await paint();
 await expect.poll(async()=>app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.id===id)?.getVisible(),webEngine)).toBe(true);
 await screenshot('linked-web-narrow');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
 await page.keyboard.press(process.platform==='darwin'?'Meta+w':'Control+w');await selectPR();
 await control('pr.changes');await writeFile(resolve(temp,'fail'),'offline');await control('refresh');await expect.poll(async()=>(await state()).pullRequests[0].error).toContain('unavailable');expect((await state()).pullRequests[0].snapshot.files.items).toHaveLength(2);await screenshot('refresh-failed');await rm(resolve(temp,'fail'));await control('refresh');await expect.poll(async()=>(await state()).pullRequests[0].pending).toBeNull();await expect.poll(async()=>(await state()).pullRequests[0].error).toBeNull();
 await setAppearance(page,'dark');await screenshot('changes-dark');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,800));
 const narrowWidth=await page.evaluate(()=>innerWidth);let previousCard,stableCard=0;
 await expect.poll(async()=>{
  const card=(await state()).prControls?.['discussion-PRRT_outdated'];
  const geometry=JSON.stringify(card);
  stableCard=card?.width>0&&card.x+card.width<=narrowWidth&&geometry===previousCard?stableCard+1:0;
  previousCard=geometry;return stableCard>=1;
 }).toBe(true);
 await paint();await screenshot('changes-narrow');
 await app.close();await launch();await expect.poll(async()=>(await state()).activeContent,{timeout:15000}).toEqual(pr);await expect.poll(async()=>(await state()).pullRequests[0]?.snapshot?.status,{timeout:15000}).toBe('merged');await screenshot('restored');
 expect(errors).toEqual([]);console.log('PR workbench passed: inline discussion reply/error recovery, resolve/reopen, preserved Composer draft and frozen Agent context, background discovery, five tabs, retained Web engines, refresh failure recovery, themes, narrow window and restart.');
}catch(error){if(page){await screenshot('failure');await writeFile(resolve(out,'failure.json'),JSON.stringify(errors.length?{errors}:await state(),null,2));}throw error;}finally{if(app){if(errors.length)app.process().kill('SIGKILL');else await app.close();}await new Promise(done=>server.close(done));await writeFile(resolve(out,'environment.txt'),temp+'\n');await writeFile(resolve(out,'main.log'),logs.join(''));}
