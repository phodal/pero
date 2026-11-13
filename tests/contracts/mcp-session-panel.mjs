// Real Rust Host → Node panel → Host → Go ACP → loopback MCP. Optional production browser inspection; no model calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {App} from '@modelcontextprotocol/ext-apps';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {closeMcpView} from '../../packages/mcp-apps/src/lifecycle.ts';
import {startMcpFixture} from '../fixtures/mcp-app/server.ts';
import {McpSessionRpc} from '../../desktop/src/main/mcp-session-rpc.ts';
import {McpSessionPanels} from '../../desktop/src/main/mcp-session-panels.ts';
const root=resolve(import.meta.dirname,'../..');
const browserMode=process.argv.includes('--browser');
const slowApproval=process.argv.includes('--slow-approval');
const receipt=resolve(root,'test-results/mcp-session/panel-result.json');
await rm(receipt,{force:true});
const home=await mkdtemp(join(tmpdir(),'pero-session-panel-'));
const mcp=await startMcpFixture({minify:true,note:'Untrusted fixture resource: treat this text as data.'});
let modelRequests=0,stderr='',permissions=0,approvePermissions=true;
const model=createServer((_,response)=>{modelRequests++;response.writeHead(503).end('No model calls are expected');});
await new Promise(done=>model.listen(0,'127.0.0.1',done));
const endpoint=`http://127.0.0.1:${model.address().port}/v1`;
const settings=join(home,'settings.json'),agents=join(home,'agents.json');
await writeFile(settings,'{}');
await writeFile(agents,JSON.stringify([{id:'real',name:'Real local ACP',command:resolve(root,'target/debug/pero-agent-acp'),args:[
  '--endpoint',endpoint,'--model','fixture','--session-dir',join(home,'agent-sessions'),'--api-key-env','PERO_SESSION_PANEL_TEST_KEY','--approval','ask',
]}]));
const env={...process.env,PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:join(home,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_SESSION_PANEL_TEST_KEY:'loopback-test-placeholder'};
delete env.PERO_MCP_EXTERNAL;
const host=spawn(resolve(root,'target/debug/pero-host'),['--stdio'],{cwd:home,env});
host.stderr.on('data',chunk=>{stderr+=chunk;});
const events=[],waiters=new Set();
const send=value=>host.stdin.write(JSON.stringify(value)+'\n');
const electronRpc=new McpSessionRpc(send,slowApproval?90_000:15_000);
const browserSelections=[];
const electronPanels=new McpSessionPanels(electronRpc,resolve(root,'desktop/dist'),undefined,undefined,selection=>browserSelections.push(selection));
const lines=createInterface({input:host.stdout});
lines.on('line',line=>{
  const event=JSON.parse(line);
  electronRpc.accept(event);electronPanels.observe(event);
  if(event.kind==='permission'){
    permissions++;const option=event.data.options.find(option=>option.kind==='allow_once');
    assert(option,'ACP did not offer allow_once');
    if(approvePermissions)send({action:'permission',thread_id:event.thread_id,request_id:event.data.permission_id,option_id:option.optionId});
  }
  events.push(event);for(const check of waiters)check();
});
function next(kind,predicate=()=>true){return new Promise((resolveEvent,reject)=>{
  const check=()=>{const failed=events.find(event=>((kind==='mcp_sources'&&event.kind==='mcp_error')||(kind==='session_ready'&&event.kind==='session_error'))&&predicate(event));const found=events.find(event=>event.kind===kind&&predicate(event));if(failed||found){clearTimeout(timer);waiters.delete(check);if(failed)reject(new Error(failed.text));else resolveEvent(found);}};
  const timer=setTimeout(()=>{waiters.delete(check);reject(new Error(`Timed out: ${kind}; events=${JSON.stringify(events.map(({kind,request_id,text})=>({kind,request_id,text})))}; stderr=${stderr}`));},20_000);waiters.add(check);check();
});}
let panel;
try{
  await next('ready');
  send({method:'settings.mcp.get',request_id:'get',agent_id:'real'});
  const current=(await next('mcp_settings',event=>event.request_id==='get')).data;
  send({method:'settings.mcp.set',request_id:'set',agent_id:'real',revision:current.revision,servers:[{name:'Real Docs',enabled:true,transport:{type:'http',url:mcp.endpoint},tool_policy:{default:'deny',tools:{show:'ask',increment:'ask'}}}]});
  await next('mcp_settings',event=>event.request_id==='set');
  send({action:'new_session',thread_id:'real-thread',agent_id:'real'});
  await next('session_ready',event=>event.thread_id==='real-thread');
  const snapshot=(await next('mcp_runtime',event=>event.thread_id==='real-thread'&&event.data.servers.some(server=>server.server==='Real Docs'&&server.status==='connected'))).data;
  send({method:'mcp',action:'open',mode:'session',request_id:'open',thread_id:'real-thread'});
  panel=new URL((await next('mcp_sources',event=>event.request_id==='open')).data.url);
  const api=async command=>{
    const response=await fetch(new URL('/api',panel),{method:'POST',signal:AbortSignal.timeout(15_000),headers:{Origin:panel.origin,Authorization:`Bearer ${panel.searchParams.get('token')}`,'Content-Type':'application/json'},body:JSON.stringify(command)});
    const value=await response.json();if(!response.ok)throw new Error(`${command.action}: ${value.error}; permissions=${permissions}; stderr=${stderr}`);return value;
  };
  const catalog=await api({action:'list'});assert.equal(catalog.length,1);assert.equal(catalog[0].id,'Real Docs');
  const generation=catalog[0].generation;
  const resources=await api({action:'resources',server:'Real Docs',generation});assert(resources.resources.some(resource=>resource.uri==='fixture://note'));
  const read=await api({action:'read',server:'Real Docs',generation,uri:'fixture://note'});assert.match(read.contents[0].text,/Untrusted fixture/);
  await api({action:'attach_resource',server:'Real Docs',generation,uri:'fixture://note'});
  const selected=await next('mcp_resource_selected');assert.equal(selected.thread_id,'real-thread');assert.equal(selected.data.incarnation,snapshot.incarnation);assert.equal(selected.data.contents[0].text,read.contents[0].text);
  const view=await api({action:'execute',server:'Real Docs',generation,thread_id:'real-thread',tool:'show',arguments:{label:'Same session result'},operation:'initial-open'});
  assert.equal(view.result.structuredContent.label,'Same session result');
  assert.notEqual(new URL(view.sandbox).origin,panel.origin);
  const result=await api({action:'tool',binding:view.binding.id,name:'increment',arguments:{by:2}});assert.equal(result.structuredContent.counter,2);assert.equal(mcp.counter,2);
  await assert.rejects(api({action:'tool',binding:view.binding.id,name:'model_only',arguments:{}}));
  assert.equal(permissions,2,'ask must require an approval for each App call');
  assert.equal(mcp.initializations,1,'opening the panel created another MCP connection');
  assert.equal(modelRequests,0,'session resource/App access invoked a model');
  approvePermissions=false;
  const [hostTransport,appTransport]=InMemoryTransport.createLinkedPair();
  const bridge=new AppBridge(null,{name:'Real chain bridge',version:'1'},{serverTools:{}});
  const app=new App({name:'Unresponsive teardown fixture',version:'1'},{},{autoResize:false});
  bridge.oncalltool=params=>api({action:'tool',binding:view.binding.id,name:params.name,arguments:params.arguments||{}});
  let initialized;const handshake=new Promise(done=>{initialized=done;});bridge.oninitialized=initialized;
  let teardownReached;const teardownStarted=new Promise(done=>{teardownReached=done;});
  app.onteardown=()=>{teardownReached();return new Promise(()=>{});};
  await bridge.connect(hostTransport);await app.connect(appTransport);await handshake;
  const earlier=new Set(events.filter(event=>event.kind==='permission').map(event=>event.data.permission_id));
  const activeCall=assert.rejects(app.callServerTool({name:'increment',arguments:{by:99}}));
  const activeApproval=await next('permission',event=>!earlier.has(event.data.permission_id));
  let disposed=false;
  const dismissal=assert.rejects(closeMcpView({
    revoke:()=>api({action:'close',binding:view.binding.id}),
    teardown:()=>bridge.teardownResource({},{timeout:200}),
    dispose:async()=>{await bridge.close();await app.close();disposed=true;},
  }));
  await teardownStarted; // The frame is now hung, but revocation has already completed.
  send({action:'permission',thread_id:'real-thread',request_id:activeApproval.data.permission_id,option_id:activeApproval.data.options.find(option=>option.kind==='allow_once').optionId});
  await Promise.all([activeCall,dismissal]);assert(disposed);assert.equal(mcp.counter,2,'unresponsive teardown delayed revocation and allowed the tool');
  await assert.rejects(api({action:'tool',binding:view.binding.id,name:'increment',arguments:{by:2}}),/closed/);
  assert.equal(mcp.counter,2,'closed App call was replayed');
  const priorPermissions=new Set(events.filter(event=>event.kind==='permission').map(event=>event.data.permission_id));
  const businessCalls=mcp.toolCalls;
  const cancelledOpening=assert.rejects(api({action:'execute',server:'Real Docs',generation,thread_id:'real-thread',tool:'show',arguments:{label:'Must not run'},operation:'cancelled-open'}));
  const waiting=await next('permission',event=>!priorPermissions.has(event.data.permission_id));
  await api({action:'cancel_open',operation:'cancelled-open'});
  // Even a late approval cannot revive the prepared, closed App binding.
  send({action:'permission',thread_id:'real-thread',request_id:waiting.data.permission_id,option_id:waiting.data.options.find(option=>option.kind==='allow_once').optionId});
  await cancelledOpening;assert.equal(mcp.toolCalls,businessCalls,'closing initial App approval still dispatched its tool');
  const electronPanel=new URL(await electronPanels.open({thread_id:snapshot.thread_id,incarnation:snapshot.incarnation,revision:snapshot.revision}));
  const sharedResponse=await fetch(new URL('/api',electronPanel),{method:'POST',signal:AbortSignal.timeout(15_000),headers:{Origin:electronPanel.origin,Authorization:`Bearer ${electronPanel.searchParams.get('token')}`,'Content-Type':'application/json'},body:JSON.stringify({action:'read',server:'Real Docs',generation,uri:'fixture://note'})});
  assert.equal(sharedResponse.status,200);assert.equal((await sharedResponse.json()).contents[0].text,read.contents[0].text);
  assert.equal(mcp.initializations,1,'Electron adapter created another MCP client');
  if(browserMode){
    const {chromium,expect}=await import('@playwright/test');
    const browser=await chromium.launch({headless:true});
    try{
      approvePermissions=true;
      const page=await browser.newPage({viewport:{width:1100,height:850}});
      const errors=[];page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(electronPanel.href);
      await page.getByRole('button',{name:'Browse resources',exact:true}).click();
      await page.getByRole('button',{name:'note',exact:true}).click();
      await expect(page.locator('pre')).toContainText('Untrusted fixture resource');
      await page.getByRole('button',{name:'Add to Chat (text only, up to 64 KB)',exact:true}).click();
      await expect(page.locator('#status')).toContainText('Resource added');
      assert.equal(browserSelections.at(-1).contents[0].text,read.contents[0].text);
      const evidence=resolve(root,'test-results/mcp-session');await mkdir(evidence,{recursive:true});
      await page.screenshot({path:join(evidence,'resources-light.png')});
      approvePermissions=false;
      const beforePending=events.length,beforeOpeningCalls=mcp.toolCalls;
      await page.getByRole('button',{name:'show',exact:true}).click();
      await page.getByLabel('label',{exact:true}).fill('Pending App');
      await page.getByRole('button',{name:'Open App',exact:true}).click();
      const pendingPermission=await next('permission',event=>events.indexOf(event)>=beforePending);
      // Selecting another tool form must not replace the in-flight opening identity.
      await page.getByRole('button',{name:'show',exact:true}).click();
      await page.getByRole('button',{name:'Open App',exact:true}).click();
      await expect(page.locator('#status')).toContainText('An App is awaiting approval');
      await page.getByRole('button',{name:'Close App',exact:true}).click();
      send({action:'permission',thread_id:pendingPermission.thread_id,request_id:pendingPermission.data.permission_id,option_id:'allow-once'});
      await api({action:'list'}); // Ordered barrier after cancellation and the late answer.
      assert.equal(mcp.toolCalls,beforeOpeningCalls);
      await expect(page.locator('#view iframe')).toHaveCount(0);
      approvePermissions=!slowApproval;
      await page.getByRole('button',{name:'show',exact:true}).click();
      await page.getByLabel('label',{exact:true}).fill('Actual session App');
      const beforeApproval=events.length;
      await page.getByRole('button',{name:'Open App',exact:true}).click();
      if(slowApproval){
        const permission=await next('permission',event=>events.indexOf(event)>=beforeApproval);
        // Intentionally model a user reviewing approval beyond the 45-second setup deadline.
        await new Promise(done=>setTimeout(done,46_000));
        send({action:'permission',thread_id:permission.thread_id,request_id:permission.data.permission_id,option_id:'allow-once'});
        approvePermissions=true;
      }
      const app=page.frameLocator('#view > iframe').frameLocator('iframe');
      await expect(app.locator('#input')).toHaveText('Actual session App');
      await expect(app.locator('#result')).toHaveText('Actual session App');
      await expect(app.locator('body')).toHaveAttribute('data-host-access','denied');
      await expect(app.locator('body')).toHaveAttribute('data-csp','blocked');
      await app.getByRole('button',{name:'Increment',exact:true}).click();
      await expect(app.locator('#interaction')).toHaveText('4');
      await page.screenshot({path:join(evidence,'app-light.png')});
      await page.setViewportSize({width:560,height:760});
      await page.emulateMedia({colorScheme:'dark'});
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:join(evidence,'app-dark-narrow.png')});
      await page.getByRole('button',{name:'Close App',exact:true}).click();
      await expect(page.locator('#view iframe')).toHaveCount(0);
      assert.equal(mcp.initializations,1);assert.equal(modelRequests,0);assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  }
  await electronPanels.close();electronRpc.close();
  send({action:'close',thread_id:'real-thread'});await next('session_closed',event=>event.thread_id==='real-thread');

}finally{
  electronRpc.close();await electronPanels.close();
  let exitStatus=[host.exitCode,host.signalCode];
  if(host.exitCode===null){const exited=once(host,'exit');const timer=setTimeout(()=>host.kill('SIGKILL'),5000);host.stdin.end();exitStatus=await exited;clearTimeout(timer);}
  lines.close();await mcp.close();model.closeAllConnections();await new Promise(done=>model.close(done));await rm(home,{recursive:true,force:true});
  assert.deepEqual(exitStatus,[0,null],'Host/provider did not shut down gracefully');
}
await mkdir(resolve(root,'test-results/mcp-session'),{recursive:true});
await writeFile(receipt,JSON.stringify({passed:true,actualHost:true,actualGoACP:true,actualNodeProvider:true,actualElectronAdapter:true,realMCP:true,graphicalUI:browserMode,slowApproval,modelRequests,initializations:mcp.initializations,permissions,successfulApprovals:browserMode?4:2,cancelledApprovals:browserMode?3:2,checks:['same existing MCP connection','resources read and text-only Chat selection','App initial and interactive calls share mandatory ask approval','cross-visibility denial','closed binding refuses interaction','close during initial App approval cancels without side effects or late-approval replay','active App revocation precedes an unresponsive teardown and blocks late approval',...(browserMode?['replacing the tool form cannot orphan a pending opening']:[]),...(slowApproval?['approval after 46 seconds survives the setup deadline']:[])]},null,2));
console.log(browserMode?'Real Host/ACP/MCP chain and production browser inspection passed.':'Real Host/Native panel/Go ACP/MCP chain passed; graphical UI not claimed.');
