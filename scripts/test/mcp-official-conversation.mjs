// Real Workbench/Host/Go ACP and unchanged official MCP server; deterministic local model.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {expect} from '@playwright/test';
import {electron} from '../../tests/e2e/electron.mjs';
import {clickAppShortcut} from '../../tests/e2e/sidebar-controls.mjs';
import {officialConversationProvider,officialConversationPrompt,officialViewMessage,
  officialInitialAnswer,officialFollowupAnswer} from '../../tests/fixtures/mcp-app/conversation-provider.mjs';

const root=resolve(import.meta.dirname,'../..');
const prefix=resolve(process.env.PERO_OFFICIAL_MCP_ROOT||'target/mcp-official-example');
const name='@modelcontextprotocol/server-basic-vanillajs',version='2.0.4';
const directory=join(prefix,'node_modules',name);
assert.equal(JSON.parse(await readFile(join(directory,'package.json'),'utf8')).version,version);
const lock=JSON.parse(await readFile(join(prefix,'package-lock.json'),'utf8'));
const packageReceipt=Object.entries(lock.packages).find(([key])=>key.endsWith(`node_modules/${name}`))?.[1];
assert.equal(packageReceipt?.version,version);
assert.equal(packageReceipt.integrity,'sha512-L+IOxLjfX9oAwvnzLAMGX1pwBsIsXUsc9mB5iOTFuQ7lIaejetsrfYngPKwf9ZPHk9iCNVbHHaI7sj5dqax55Q==');
const home=await realpath(await mkdtemp(join(tmpdir(),'pero-official-conversation-')));
const evidence=resolve('test-results/mcp-apps-conversation');await mkdir(evidence,{recursive:true});
const provider=await officialConversationProvider();
const audit=join(home,'mcp-tools.jsonl'),workspace=join(home,'workspace');await mkdir(workspace);
const settings=join(home,'settings.json'),agents=join(home,'agents.json');
await writeFile(agents,JSON.stringify([{id:'official-conversation',name:'Real harness / local model fixture',command:resolve('target/debug/pero-agent-acp'),args:[
  '--endpoint',provider.endpoint,'--model','fixture','--session-dir',join(home,'sessions'),'--approval','ask','--max-retries','0',
],env:{AGENT_PROVIDER_API_KEY:'loopback-fixture-only'}}]));
await writeFile(settings,JSON.stringify({chat_agent:'official-conversation',local_mcp:{'official-conversation':{revision:1,servers:[{
  name:'Official example',enabled:true,transport:{type:'stdio',command:process.execPath,args:[
    resolve('tests/fixtures/mcp-app/audit-stdio.mjs'),join(directory,'dist/index.js'),audit,
  ]},tool_policy:{default:'deny',tools:{'get-time':'ask'}},
}]}}}));
const businessCalls=async()=>{
  let text;try{text=await readFile(audit,'utf8');}catch(error){if(error.code==='ENOENT')return [];throw error;}
  return text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
};
const logs=[],errors=[];
let desktop,page;
try{
  desktop=await electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve('desktop')],cwd:root,
    env:{...process.env,PERO_DESKTOP_DATA_DIR:join(home,'profile'),PERO_SETTINGS_PATH:settings,
      PERO_HISTORY_PATH:join(home,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'}});
  desktop.process().stderr?.on('data',data=>logs.push(String(data)));
  page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
  await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1400,1050));
  await page.evaluate(()=>{
    window.officialMcpEvents=[];
    window.pero.onEvent(event=>window.officialMcpEvents.push(event));
  });
  await desktop.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);
  await page.evaluate(()=>window.pero.chooseWorkspace());
  await expect.poll(async()=>(await state()).workspace).toBe(workspace);
  await clickAppShortcut(page,'sessions');
  await expect.poll(async()=>{const snapshot=await state();return snapshot.chats[snapshot.activeChat]?.state;},{timeout:30000}).toBe('idle');
  const initial=await state(),thread=initial.chats[initial.activeChat].id;
  const conversation=async()=>(await state()).chats.find(chat=>chat.id===thread);
  const approve=async()=>{
    await expect.poll(async()=>!!(await conversation()).permission).toBe(true);
    const index=(await conversation()).permission.options.findIndex(option=>option.kind==='allow_once');
    assert(index>=0,'The Host must offer allow_once');
    let bounds;
    await expect.poll(async()=>{bounds=(await state()).permissionBounds.find(item=>item.chat===thread&&item.index===index)?.bounds;return !!bounds&&bounds.width>0&&bounds.height>0;}).toBe(true);
    await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await expect.poll(async()=>(await conversation()).permission).toBeNull();
  };
  await page.evaluate(({thread,text})=>window.pero.sessionCommand({action:'prompt',thread_id:thread,text}),{thread,text:officialConversationPrompt});
  await approve();
  await expect.poll(async()=>(await conversation()).messages.filter(message=>message.role==='assistant').map(message=>message.text).join('\n'),{timeout:30000}).toContain(officialInitialAnswer);
  // This frame is created from the tool result, without using the tools/resources picker.
  const outer=page.locator('section[aria-label="Interactive tool result"] > iframe');
  await expect(outer).toHaveCount(1);await expect(outer).toBeVisible();
  await expect(outer).toHaveAttribute('src',/tool_call=official-time-call/);
  const inline=page.frameLocator('section[aria-label="Interactive tool result"] > iframe');
  const app=inline.frameLocator('#view iframe').frameLocator('iframe');
  await expect(app.locator('#server-time')).toHaveText(/^\d{4}-\d{2}-\d{2}T/,{timeout:15000});
  assert.equal((await businessCalls()).length,1,'initial automatic mounting replayed tools/call');
  assert.equal(provider.calls.length,2);
  const resourceFrame=page.frames().find(frame=>URL.canParse(frame.url())&&new URL(frame.url()).pathname==='/resource');
  assert(resourceFrame,'The actual sandbox resource frame must exist');
  assert.equal(await (await page.request.get(resourceFrame.url())).text(),await readFile(join(directory,'dist/mcp-app.html'),'utf8'));
  const originalTime=await app.locator('#server-time').innerText();
  const originalUrl=await outer.getAttribute('src');
  const toggleTool=async()=>{
    const before=await state(),key=`${thread}/official-time-call`;
    const expanded=before.expandedTools.includes(key);
    const bounds=before.toolBounds.find(item=>item.chat===thread&&item.tool==='official-time-call')?.bounds;
    assert(bounds?.width>0&&bounds.height>0,'The real tool disclosure must be painted');
    await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await expect.poll(async()=>(await state()).expandedTools.includes(key)).toBe(!expanded);
  };
  await toggleTool();await expect(outer).toBeHidden();await expect(outer).toHaveCount(1);
  await toggleTool();await expect(outer).toBeVisible();
  assert.equal(await outer.getAttribute('src'),originalUrl,'expanding a tool must retain the View identity');
  assert.equal((await businessCalls()).length,1,'tool disclosure replayed the original MCP call');
  const interactiveResponse=page.waitForResponse(response=>response.url().endsWith('/api')&&response.request().postDataJSON()?.action==='tool');
  await app.getByRole('button',{name:'Get Server Time',exact:true}).click();
  await approve();
  const interactive=await (await interactiveResponse).json();
  await expect(app.locator('#server-time')).toHaveText(interactive.structuredContent.time);
  assert.equal((await businessCalls()).length,2,'explicit official UI interaction must dispatch exactly once');
  assert.equal(provider.calls.length,2,'UI tool interaction must not invoke the model');
  await page.screenshot({path:join(evidence,'official-inline-light.png'),scale:'css'});
  await page.evaluate(()=>window.pero.sessionCommand({method:'settings.workbench',preferences:{...JSON.parse(window.peroDiagnostics.snapshot()).preferences,appearance:'dark'}}));
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,1000));
  await expect(app.locator('html')).toHaveAttribute('data-theme','dark');
  await expect.poll(()=>app.locator('html').evaluate(element=>element.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(evidence,'official-inline-dark-narrow.png'),scale:'css'});

  await inline.getByRole('button',{name:'Close view',exact:true}).click();
  await expect(inline.locator('#view iframe')).toHaveCount(0);
  await inline.getByRole('button',{name:'Open view',exact:true}).click();
  await expect(app.locator('#server-time')).toHaveText(originalTime,{timeout:15000});
  assert.equal((await businessCalls()).length,2,'reopening the recorded result replayed tools/call');
  assert.equal(provider.calls.length,2,'opening a View invoked the model');

  await app.locator('#message-text').fill(officialViewMessage);
  await app.getByRole('button',{name:'Send Message',exact:true}).click();
  await expect.poll(async()=>(await conversation()).messages.filter(message=>message.role==='assistant').map(message=>message.text).join('\n'),{timeout:15000}).toContain(officialFollowupAnswer);
  assert((await conversation()).messages.some(message=>message.role==='user'&&message.text.includes(officialViewMessage)));
  assert.equal(provider.calls.length,3);
  assert.equal((await businessCalls()).length,2,'ui/message must not rerun the original MCP tool');
  await page.screenshot({path:join(evidence,'official-conversation-followup.png'),scale:'css'});
  assert.deepEqual(provider.errors,[]);assert.deepEqual(errors,[]);
  await page.evaluate(thread_id=>window.pero.sessionCommand({action:'close',thread_id}),thread);
  await expect(outer).toHaveCount(0);
  assert.equal((await businessCalls()).length,2);
  const events=await page.evaluate(()=>window.officialMcpEvents);
  assert.equal(events.filter(event=>event.kind==='permission').length,2,'Agent and View calls each require Host ask approval');
  assert.deepEqual((await businessCalls()).map(call=>call.name),['get-time','get-time']);
  await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,package:name,version,integrity:packageReceipt.integrity,unmodifiedUpstream:true,
    actualWorkbench:true,actualElectron:true,actualRustHost:true,actualGoACP:true,realModel:false,model:'deterministic loopback fixture',
    modelRequests:provider.calls.length,expectedBusinessCalls:2,businessCalls:await businessCalls(),permissions:events.filter(event=>event.kind==='permission').length,
    checks:['initial Agent tool call','automatic conversation View mounting without picker','tool collapse/expand retains the same iframe and result','explicit official UI tool interaction','two mandatory ask approvals','close/reopen never repeat tools/call',
      'live dark theme and narrower Workbench','official ui/message becomes a subsequent user prompt','actual subsequent model reply','session close removes the View'],errors},null,2));
  console.log('Official MCP App: actual conversation mounting and ui/message follow-up passed (local model fixture).');
}catch(error){
  if(page){await page.screenshot({path:join(evidence,'failure.png'),scale:'css'}).catch(()=>{});
    await writeFile(join(evidence,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}').catch(()=>'{}'));
    await writeFile(join(evidence,'failure-events.json'),JSON.stringify(await page.evaluate(()=>window.officialMcpEvents||[]).catch(()=>[]),null,2));}
  await writeFile(join(evidence,'failure-log.json'),JSON.stringify({error:String(error),modelRequests:provider.calls.length,providerErrors:provider.errors,errors,logs},null,2));throw error;
}finally{await desktop?.close();await provider.close();await rm(home,{recursive:true,force:true});}
