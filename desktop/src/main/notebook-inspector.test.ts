import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {DesktopAppUse} from './app-use-mcp.ts';
import {AppWriteRoutes} from './app-write-routes.ts';
import {NotebookInspector} from './notebook-inspector.ts';
import {McpHost} from './mcp-host.ts';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

test('saved Notebook Inspector uses real revisions, MCP resources and the existing Host route', {timeout:30000}, async t => {
  const home=await mkdtemp(join(tmpdir(),'pero-notebook-inspector-'));
  const backend=spawn(process.env.PERO_APP_PYTHON||'python3',['-u','apps/notebook/backend/server.py'],{
    env:{...process.env,PERO_APP_DATA:home,PERO_APP_TOKEN:'isolated-notebook-token'},stdio:['ignore','pipe','pipe'],
  });
  let stderr='';backend.stderr.on('data',chunk=>{stderr+=chunk;});
  const lines=createInterface({input:backend.stdout});
  t.after(async()=>{lines.close();if(backend.exitCode===null){const exited=once(backend,'exit');backend.kill();await exited;}await rm(home,{recursive:true,force:true});});
  const ready=await new Promise<{port:number}>((done,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Notebook did not start: ${stderr}`)),15000);
    lines.once('line',line=>{clearTimeout(timer);done(JSON.parse(line));});
    backend.once('exit',()=>{clearTimeout(timer);reject(new Error(`Notebook exited: ${stderr}`));});
  });
  const url=`http://127.0.0.1:${ready.port}`;
  const request=async(path:string,body:object)=>{
    const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pero-App-Token':'isolated-notebook-token'},body:JSON.stringify(body)});
    const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
  };
  const document={schemaVersion:1,title:'Enzyme assay · 酶活性',content:{type:'doc',content:[
    {type:'heading',attrs:{blockId:'title',level:2},content:[{type:'text',text:'Saved observations'}]},
    {type:'paragraph',attrs:{blockId:'observations'},content:[{type:'text',text:'Sample A: 12.5 U/mL. Review pending.'}]},
  ]}};
  const entry=await request('/api/entries',{document});
  const manifest=JSON.parse(await readFile('apps/notebook/app.json','utf8'));
  let enabled=true,selected='notebook';
  const routes=new AppWriteRoutes(async <T>(action:string)=>{
    if(action==='list')return [{name:'notebook',enabled,version:manifest.version,panels:[{id:'main'}],writes:manifest.contributes.writes}] as T;
    if(action==='resolve')return {backend:{url,token:'isolated-notebook-token'}} as T;
    throw new Error(`Unexpected Host action ${action}`);
  },()=>{},fetch);
  const desktop=new DesktopAppUse({selectedThread:async()=>selected,page:async()=>{throw new Error('No DOM access');},
    capture:async()=>{throw new Error('No capture');},presence:()=>{}},()=>{},home,
    {describe:()=>routes.describe(),apply:(write,signal)=>routes.apply(write,signal)},undefined,undefined,
    new NotebookInspector(resolve('desktop/dist')));
  t.after(()=>desktop.close());
  const env=await desktop.start();
  desktop.accept({kind:'session_created',thread_id:'notebook',data:{scope:{app:'notebook',panel:'main'}}});
  const client=new Client({name:'Notebook product acceptance',version:'1'},{capabilities:{extensions:{'io.modelcontextprotocol/ui':{mimeTypes:['text/html;profile=mcp-app']}}}});
  t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(env.PERO_APP_USE_URL),{requestInit:{headers:{Authorization:`Bearer ${env.PERO_APP_USE_TOKEN}`,'X-Pero-Thread':'notebook'}}}));
  const tools=await client.listTools();
  assert.deepEqual(tools.tools.find(tool=>tool.name===NotebookInspector.tool)?._meta?.ui,{resourceUri:NotebookInspector.uri});
  assert.deepEqual(tools.tools.find(tool=>tool.name==='app_write')?._meta?.ui,{visibility:['model']});
  assert.equal((await client.listResources()).resources[0].uri,NotebookInspector.uri);
  const resource=(await client.readResource({uri:NotebookInspector.uri})).contents[0];
  assert('text' in resource);assert.match(resource.text,/Notebook Inspector/);
  await assert.rejects(client.readResource({uri:'ui://foreign/resource'}));
  desktop.accept({kind:'turn_started',thread_id:'notebook'});
  desktop.accept({kind:'turn_finished',thread_id:'notebook'});
  const initial=await client.callTool({name:NotebookInspector.tool,arguments:{entryId:entry.id}}) as CallToolResult;
  assert.equal(initial.isError,false);
  assert.equal((initial.structuredContent?.result as {revision:number}).revision,1);
  await request('/api/agent-apply',{entryId:entry.id,baseRevision:1,operations:[{op:'replace_text',blockId:'observations',match:'12.5',replacement:'13.0'}]});
  const pinned=await client.callTool({name:NotebookInspector.tool,arguments:{entryId:entry.id,revision:1,blockId:'observations'}}) as CallToolResult;
  assert.match(JSON.stringify(pinned.structuredContent),/12.5/);
  const current=await client.callTool({name:NotebookInspector.tool,arguments:{entryId:entry.id}}) as CallToolResult;
  assert.equal((current.structuredContent?.result as {revision:number}).revision,2);
  // Idle inspection grants no idle write permission.
  const denied=await client.callTool({name:'app__notebook__apply-edits',arguments:{entryId:entry.id,baseRevision:2,operations:[{op:'insert_text_block',kind:'paragraph',text:'Must not be saved'}]}}) as CallToolResult;
  assert.equal(denied.isError,true);
  selected='other';assert.equal((await client.callTool({name:NotebookInspector.tool,arguments:{entryId:entry.id}})).isError,true);
  selected='notebook';
  enabled=false;
  assert.equal((await client.listResources()).resources.length,0);
  await assert.rejects(client.readResource({uri:NotebookInspector.uri}));
  enabled=true;

  if(process.env.PERO_MCP_BROWSER==='1'){
    const {chromium,_electron,expect}=await import('@playwright/test');
    const host=new McpHost(join(home,'mcp.json'),resolve('desktop/dist'));
    t.after(()=>host.close());
    await host.start();const panel=new URL(host.open('notebook'));
    const secretKey='PERO_NOTEBOOK_TEST_AUTH',threadKey='PERO_NOTEBOOK_TEST_THREAD';
    process.env[secretKey]=`Bearer ${env.PERO_APP_USE_TOKEN}`;process.env[threadKey]='notebook';
    t.after(()=>{delete process.env[secretKey];delete process.env[threadKey];});
    await host.sources.command({action:'configure',config:{id:'notebook',title:'Notebook',transport:'http',url:env.PERO_APP_USE_URL,
      header_env:{Authorization:secretKey,'X-Pero-Thread':threadKey}}});
    await host.sources.command({action:'connect',server:'notebook'});
    const electronMode=process.env.PERO_MCP_RENDERER==='electron';
    const entrypoint=join(home,'electron.cjs');
    if(electronMode)await writeFile(entrypoint,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.loadURL('about:blank');});`);
    const electronEnv:Record<string,string>={};
    for(const [key,value] of Object.entries(process.env))if(key!=='ELECTRON_RUN_AS_NODE'&&value!==undefined)electronEnv[key]=value;
    const browser=electronMode?await _electron.launch({args:[entrypoint],timeout:15000,env:electronEnv}):await chromium.launch({headless:true});
    t.after(()=>browser.close());
    const page='firstWindow' in browser?await browser.firstWindow():await browser.newPage({viewport:{width:1200,height:900}});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(panel.href);
    await page.getByRole('button',{name:'Notebook Inspector',exact:true}).click();
    await page.getByLabel('entryId',{exact:true}).fill(entry.id);
    await page.getByLabel('revision',{exact:true}).fill('1');
    await page.getByRole('button',{name:'Open view',exact:true}).click();
    const app=page.frameLocator('#view > iframe').frameLocator('iframe');
    try { await expect(app.getByRole('heading',{name:document.title,exact:true})).toBeVisible(); }
    catch(error){ console.error({errors,frames:await Promise.all(page.frames().map(async frame=>({url:frame.url(),text:await frame.locator('body').innerText().catch(()=>'' )})))});throw error; }
    await expect(app.getByText('Sample A: 12.5 U/mL. Review pending.',{exact:true})).toBeVisible();
    const binding=new URL((await page.locator('#view > iframe').getAttribute('src'))!).searchParams.get('binding')!;
    await assert.rejects(host.sources.command({action:'tool',binding,name:'app_write',arguments:{}}),/not available/);
    await app.getByRole('button',{name:'Browse blocks',exact:true}).click();
    await expect(app.getByRole('button',{name:'Read observations',exact:true})).toBeVisible();
    await app.getByRole('button',{name:'Read observations',exact:true}).click();
    await expect(app.getByText('Sample A: 12.5 U/mL. Review pending.',{exact:true})).toBeVisible();
    const evidence=resolve('test-results/notebook-mcp-app',electronMode?'electron':'chromium');await mkdir(evidence,{recursive:true});
    await page.screenshot({path:join(evidence,'light.png')});
    await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:560,height:820});
    await expect(app.locator('html')).toHaveAttribute('data-theme','dark');
    await expect.poll(()=>app.locator('html').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:join(evidence,'dark-narrow.png')});
    // An iframe cannot read its Host or reach an undeclared network destination.
    assert.equal(await app.locator('body').evaluate(()=>{try{void window.top!.document;return true;}catch{return false;}}),false);
    await page.getByRole('button',{name:'Close view',exact:true}).click();
    await expect(page.locator('#view iframe')).toHaveCount(0);
    assert.deepEqual(errors,[]);
  }
  desktop.command({action:'close',thread_id:'notebook'});
  await assert.rejects(client.readResource({uri:NotebookInspector.uri}));
  assert.equal((await client.callTool({name:NotebookInspector.tool,arguments:{entryId:entry.id}})).isError,true);
});
