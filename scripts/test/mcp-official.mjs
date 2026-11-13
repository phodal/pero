// Published upstream example, unchanged. Network installation is explicit.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {McpSessionRpc} from '../../desktop/src/main/mcp-session-rpc.ts';
import {McpSessionPanels} from '../../desktop/src/main/mcp-session-panels.ts';
await import('../build/mcp.mjs');
const name='@modelcontextprotocol/server-basic-vanillajs',version='2.0.4';
const prefix=resolve(process.env.PERO_OFFICIAL_MCP_ROOT||'target/mcp-official-example');
if(process.argv.includes('--install')){
  const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',prefix,'--save-exact','--ignore-scripts','--no-audit','--no-fund',`${name}@${version}`],{stdio:'inherit'});
  if(result.error)throw result.error;assert.equal(result.status,0);
}
const directory=join(prefix,'node_modules',name);
const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
assert.equal(manifest.version,version);
const home=await mkdtemp(join(tmpdir(),'pero-official-app-'));
const model=createServer((_,response)=>{modelRequests++;response.writeHead(503).end();});
let modelRequests=0,permissions=0,stderr='';
await new Promise(done=>model.listen(0,'127.0.0.1',done));
const settings=join(home,'settings.json'),agents=join(home,'agents.json');
await writeFile(settings,'{}');
await writeFile(agents,JSON.stringify([{id:'official-test',name:'Pero Agent',command:resolve('target/debug/pero-agent-acp'),args:[
  '--endpoint',`http://127.0.0.1:${model.address().port}/v1`,'--model','fixture','--session-dir',join(home,'sessions'),
  '--api-key-env','PERO_OFFICIAL_TEST_KEY','--approval','ask',
]}]));
const env={...process.env,PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:join(home,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_OFFICIAL_TEST_KEY:'local-test'};
delete env.PERO_MCP_EXTERNAL;
const host=spawn(resolve('target/debug/pero-host'),['--stdio'],{cwd:home,env});
host.stderr.on('data',chunk=>{stderr+=chunk;});
const send=value=>host.stdin.write(JSON.stringify(value)+'\n');
const rpc=new McpSessionRpc(send,15000),panels=new McpSessionPanels(rpc,resolve('desktop/dist'));
const events=[],waiters=new Set(),lines=createInterface({input:host.stdout});
lines.on('line',line=>{
  const event=JSON.parse(line);rpc.accept(event);panels.observe(event);events.push(event);
  if(event.kind==='permission'){
    permissions++;const option=event.data.options.find(option=>option.kind==='allow_once');assert(option);
    send({action:'permission',thread_id:event.thread_id,request_id:event.data.permission_id,option_id:option.optionId});
  }
  for(const check of waiters)check();
});
function next(kind,predicate=()=>true){return new Promise((done,reject)=>{
  const check=()=>{const found=events.find(event=>event.kind===kind&&predicate(event));if(found){clearTimeout(timer);waiters.delete(check);done(found);}};
  const timer=setTimeout(()=>{waiters.delete(check);reject(new Error(`Waiting for ${kind}: ${stderr}`));},20000);waiters.add(check);check();
});}
let browser;
try{
  await next('ready');send({method:'settings.mcp.get',request_id:'get',agent_id:'official-test'});
  const current=(await next('mcp_settings',event=>event.request_id==='get')).data;
  send({method:'settings.mcp.set',request_id:'set',agent_id:'official-test',revision:current.revision,servers:[{
    name:'Official example',enabled:true,transport:{type:'stdio',command:process.execPath,args:[join(directory,'dist/index.js'),'--stdio']},
    tool_policy:{default:'deny',tools:{'get-time':'ask'}},
  }]});
  await next('mcp_settings',event=>event.request_id==='set');
  send({action:'new_session',thread_id:'official-example',agent_id:'official-test'});
  await next('session_ready',event=>event.thread_id==='official-example');
  const snapshot=(await next('mcp_runtime',event=>event.thread_id==='official-example'&&event.data.servers.some(server=>server.server==='Official example'&&server.status==='connected'))).data;
  const panel=new URL(await panels.open({thread_id:snapshot.thread_id,incarnation:snapshot.incarnation,revision:snapshot.revision}));
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:800}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(panel.href);
  await page.getByRole('button',{name:/^(Get Time|get-time)$/,exact:true}).click();
  const initial=page.waitForResponse(response=>response.url().endsWith('/api')&&response.request().postDataJSON()?.action==='execute');
  await page.getByRole('button',{name:'Open view',exact:true}).click();
  assert.equal((await (await initial).json()).html,await readFile(join(directory,'dist/mcp-app.html'),'utf8'));
  const app=page.frameLocator('#view iframe').frameLocator('iframe');
  await expect(app.locator('#server-time')).toHaveText(/^\d{4}-\d{2}-\d{2}T/);
  const response=page.waitForResponse(response=>response.url().endsWith('/api')&&response.request().postDataJSON()?.action==='tool');
  await app.getByRole('button',{name:'Get Server Time',exact:true}).click();
  const result=await (await response).json();
  await expect(app.locator('#server-time')).toHaveText(result.structuredContent.time);
  const evidence=resolve('test-results/mcp-apps-official');await mkdir(evidence,{recursive:true});
  await page.screenshot({path:join(evidence,'vanilla-light.png')});
  await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:560,height:820});
  await expect.poll(()=>app.locator('html').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(evidence,'vanilla-dark-narrow.png')});
  assert.equal(await app.locator('body').evaluate(()=>{try{void window.top.document;return true;}catch{return false;}}),false);
  await page.getByRole('button',{name:'Close view',exact:true}).click();await expect(page.locator('#view iframe')).toHaveCount(0);
  assert.deepEqual(errors,[]);assert.equal(permissions,2);assert.equal(modelRequests,0);
  const lock=JSON.parse(await readFile(join(prefix,'package-lock.json'),'utf8'));
  const receipt=Object.entries(lock.packages).find(([key])=>key.endsWith(`node_modules/${name}`))?.[1];
  assert.equal(receipt?.version,version);
  assert.equal(receipt.integrity,'sha512-L+IOxLjfX9oAwvnzLAMGX1pwBsIsXUsc9mB5iOTFuQ7lIaejetsrfYngPKwf9ZPHk9iCNVbHHaI7sj5dqax55Q==');
  await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,package:name,version,integrity:receipt.integrity,
    unmodifiedUpstream:true,actualRustHost:true,actualGoACP:true,permissions,modelRequests,transport:'stdio',hostSdk:'ext-apps 1.7.5',checks:['standard resource discovery','official View initialization','initial structured result','interactive server tool','different origin','close removes frame','light/dark narrow rendering'],limitations:['ui/message and ui/update-model-context not advertised','isolated resource surface, not an inline conversation integration']},null,2));
  console.log(`Official ${name}@${version}: discovery, rendering, interaction and teardown passed.`);
}finally{
  await browser?.close();await panels.close();rpc.close();
  if(host.exitCode===null){const exited=once(host,'exit');const timer=setTimeout(()=>host.kill('SIGKILL'),5000);host.stdin.end();await exited;clearTimeout(timer);}
  lines.close();model.closeAllConnections();await new Promise(done=>model.close(done));await rm(home,{recursive:true,force:true});
}
