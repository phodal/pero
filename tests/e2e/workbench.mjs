import { setAppearance } from './sidebar-controls.mjs';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { resolve } from 'node:path';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const root=resolve(import.meta.dirname,'../..');
const packaged=process.env.PERO_PACKAGED_EXECUTABLE;
const out=resolve(root,packaged?'test-results/package/workbench':'test-results/workbench');await mkdir(out,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'pero-session-'));
const agents=resolve(temp,'agents.json');await writeFile(agents,JSON.stringify([{id:'fixture',name:'ACP test fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/acp-agent.mjs')]}]));
await writeFile(resolve(temp,'settings.json'),JSON.stringify({chat_agent:'fixture'}));
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_LOCALE:'zh-CN',PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_AGENTS_FILE:agents};delete env.ELECTRON_RUN_AS_NODE;
// No real credentials in this fixture; macOS must not prompt for the user's keychain.
const args=[...(process.platform==='darwin'?['--use-mock-keychain']:[]),...(packaged?[]:[resolve(root,'desktop')])];
const app=await electron.launch({...(packaged?{executablePath:packaged}:{}),args,cwd:packaged?temp:root,env});
const errors=[];
let invalidHostEventErrors=0;
app.on('console',message=>{if(message.type()==='error' && message.text()==='Invalid Host event')invalidHostEventErrors=Math.min(invalidHostEventErrors+1,1000);});
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.waitForFunction(()=>window.peroDiagnostics,undefined,{timeout:60000});
 const state=()=>page.evaluate(()=>window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {chats:[],agents:[],renderStats:[]});
 await page.waitForFunction(()=>!document.getElementById('loading'));
 await expect.poll(async()=>(await state()).agents?.length||0,{timeout:15000}).toBeGreaterThan(2);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:resolve(out,'overview.png')});
 await page.mouse.click(100,28);
 await expect.poll(async()=>(await state()).navigation).toBe(0);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect.poll(async()=>(await state()).chats.length).toBe(1);
 await page.screenshot({path:resolve(out,'chat-empty.png')});
 await expect.poll(async()=>(await state()).chats[0].agent).toBe('fixture');
 await expect.poll(async()=>(await state()).chats[0].state).toBe('idle');
 await page.screenshot({path:resolve(out,'agent-ready.png')});
 const input=async(text)=>{
  await page.mouse.click(950,975);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'nihao',selectionStart:5,selectionEnd:5});
  await cdp.send('Input.insertText',{text});
  await expect.poll(async()=>(await state()).composer).toBe(text);
  await page.keyboard.press('Enter');
 };
 await input('你好，检查流式会话');
 await expect.poll(async()=>(await state()).chats[0].messages.filter(m=>m.role==='assistant').length).toBe(1);
 await expect.poll(async()=>(await state()).chats[0].state).toBe('idle');
 await page.screenshot({path:resolve(out,'chat-stream.png')});
 await input('继续第二轮');
 await expect.poll(async()=>(await state()).chats[0].messages.filter(m=>m.role==='assistant').length).toBe(2);
 await expect.poll(async()=>(await state()).chats[0].state).toBe('idle');
 await input('wait');
 await expect.poll(async()=>(await state()).chats[0].state).toBe('running');
 // Read the rendered Stop button: the composer is centered and width-limited.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect.poll(async()=>{const bounds=(await state()).stopButtonBounds;return !!bounds && bounds.width>0 && bounds.height>0;}).toBe(true);
 const stop=(await state()).stopButtonBounds;
 await page.screenshot({path:resolve(out,'stop-button.png')});
 await page.mouse.click(stop.x+stop.width/2,stop.y+stop.height/2);
 await expect.poll(async()=>(await state()).chats[0].state).toBe('idle');
 await input('permission');
 await expect.poll(async()=>(await state()).chats[0].permission!==null).toBe(true);
 await page.screenshot({path:resolve(out,'permission.png')});
 const permission=(await state()).permissionBounds.find(item=>item.index===0).bounds;
 await page.mouse.click(permission.x+permission.width/2,permission.y+permission.height/2);
 await expect.poll(async()=>(await state()).chats[0].state).toBe('idle');
 await input('longstream');
 await expect.poll(async()=>(await state()).chats[0].messages.at(-1).text.includes('中文片段200'),{intervals:[50],timeout:15000}).toBe(true);
 await expect.poll(async()=>(await state()).scroll.max,{intervals:[50],timeout:15000}).toBeGreaterThan(300);
 // Confirm tail following works before testing that one reader gesture revokes it.
 await expect.poll(async()=>{const {y,max}=(await state()).scroll;return max+y;},{intervals:[50],timeout:15000}).toBeLessThanOrEqual(48);
 await page.mouse.move(1100,500);await page.mouse.wheel(0,-4000);
 await expect.poll(async()=>(await state()).scroll.y,{intervals:[50]}).toBe(0);
 await expect.poll(async()=>(await state()).chats[0].messages.at(-1).text.includes('中文片段700'),{intervals:[50],timeout:15000}).toBe(true);
 expect((await state()).scroll.y).toBe(0);
 await expect.poll(async()=>(await state()).chats[0].state,{timeout:20000}).toBe('idle');
 const streamed=await state();
 const last=streamed.chats[0].messages.at(-1);
 expect(last.text).toBe(Array.from({length:1000},(_,i)=>`中文片段${i} `).join(''));
 await expect.poll(async()=>(await state()).renderedBytes[0].at(-1)).toBe(Buffer.byteLength(last.text));
 const stats=streamed.renderStats[0].at(-1);
 expect(stats[0]).toBe(1000);expect(stats[1]).toBeLessThan(500);
 await page.screenshot({path:resolve(out,'long-stream.png')});
 const count=streamed.chats[0].messages.length;
 const restoredThread=streamed.chats[0];
 // Hold the first actual Host replay after reload so a user can open an empty
 // draft before history arrives. History must not replace that explicit route.
 await app.evaluate(({BrowserWindow})=>{
  const contents=BrowserWindow.getAllWindows()[0].webContents;
  const send=contents.send.bind(contents);
  globalThis.workspaceReplayStartedAt=performance.now();
  const trace=globalThis.workspaceReplayTrace={counts:{agents:0,workspace:0,local_roadmap:0,replay:0},firstMs:{agents:null,workspace:null,local_roadmap:null,replay:null},rendererReadyMs:null,releasedMs:null};
  contents.send=(channel,...args)=>{
   const kind=args[0]?.kind;
   if(channel==='pero:event' && Object.hasOwn(trace.counts,kind)){
    trace.counts[kind]=Math.min(trace.counts[kind]+1,1000);
    trace.firstMs[kind]??=performance.now()-globalThis.workspaceReplayStartedAt;
   }
   if(channel==='pero:event' && args[0]?.kind==='replay'){
    globalThis.releaseWorkspaceReplay=()=>{trace.releasedMs=performance.now()-globalThis.workspaceReplayStartedAt;contents.send=send;send(channel,...args);};
    return;
   }
   send(channel,...args);
  };
 });
 await page.reload();
 // Bootstrap requests replay only after async WASM/GPUI initialization. Keep
 // its existing readiness barrier outside the separate replay-arrival budget.
 await page.waitForFunction(()=>window.peroDiagnostics && !document.getElementById('loading'));
 await app.evaluate(()=>{globalThis.workspaceReplayTrace.rendererReadyMs=performance.now()-globalThis.workspaceReplayStartedAt;});
 await expect.poll(()=>app.evaluate(()=>typeof globalThis.releaseWorkspaceReplay)).toBe('function');
 await page.mouse.click(100,28);
 await expect.poll(async()=>(await state()).activeContent?.kind).toBe('conversation');
 const draftItem=(await state()).activeContent;
 await app.evaluate(()=>{globalThis.releaseWorkspaceReplay();delete globalThis.releaseWorkspaceReplay;});
 await expect.poll(async()=>(await state()).chats?.find(chat=>chat.id===restoredThread.id)?.messages.length,{timeout:30000}).toBe(count);
 await expect.poll(async()=>{const snapshot=await state();return snapshot.chats[snapshot.activeChat]?.id;}).toBe(draftItem.value);
 expect((await state()).activeContent).toEqual(draftItem);
 await page.screenshot({path:resolve(out,'history-retained-draft.png')});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // Shared sidebar geometry: 8px inset + three 32px controls and 4px gaps,
 // then the 32px project header. Select the first 26px session row, not its project.
 const firstHistoryRowY=8+3*(32+4)+32+26/2;
 await page.mouse.click(100,firstHistoryRowY);
 // Selecting retained long history schedules real GPUI layout/paint before observations.
 const historyPaintStarted=performance.now();
 let historyPaintTimer;
 let historyPaintReady=false;
 try {
  await Promise.race([
   page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),
   new Promise((_,reject)=>{historyPaintTimer=setTimeout(()=>reject(new Error('Retained-history renderer did not produce two frames within 15000ms')),15000);}),
  ]);
  historyPaintReady=true;
 } finally {
  clearTimeout(historyPaintTimer);
  console.log(JSON.stringify({historyPaint:{thread:restoredThread.id,ready:historyPaintReady,elapsedMs:performance.now()-historyPaintStarted,budgetMs:15000}}));
 }
 await expect.poll(async()=>(await state()).navigation).toBe(0);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect.poll(async()=>(await state()).activeContent).toEqual({kind:'conversation',value:restoredThread.id});
 await expect.poll(async()=>{const snapshot=await state();return snapshot.chats[snapshot.activeChat]?.id;}).toBe(restoredThread.id);
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('locale-en').click());
 await expect.poll(async()=>(await state()).locale).toBe('en');
 await page.screenshot({path:resolve(out,'english.png')});
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
 await setAppearance(page,'dark');
 await expect.poll(async()=>(await state()).dark).toBe(true);
 await page.screenshot({path:resolve(out,'dark.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,788));
 await page.screenshot({path:resolve(out,'narrow.png')});
 console.log(JSON.stringify({checks:'stream,followup,cancel,permission,long-stream,scroll-up,reload,history-retained-draft,locale,dark,narrow',streamStats:stats,errors}));
 await writeFile(resolve(out,'result.json'),JSON.stringify({state:await state(),errors},null,2));
 expect(errors).toEqual([]);
}catch(error){const page=await app.firstWindow();console.error({errors,state:await page.evaluate(()=>window.peroDiagnostics?.snapshot()).catch(e=>`snapshot unavailable: ${e.message}`)});await page.screenshot({path:resolve(out,'failure.png')});throw error;}finally{
 const trace=await app.evaluate(()=>globalThis.workspaceReplayTrace??null).catch(()=>null);
 console.log(JSON.stringify({workspaceReplayTrace:trace,invalidHostEventErrors}));
 await app.close();
}
