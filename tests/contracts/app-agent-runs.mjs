// Real Rust Host/stdio, repository-owned synthetic manifests and ACP fixture.
// No external SDK, private source or provider.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createScopedApi } from '../../packages/app-sdk/src/core.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(resolve(tmpdir(),'pero-agent-runs-'));
const capture=resolve(temp,'acp.jsonl'),registry=resolve(temp,'agents.json');
await writeFile(registry,JSON.stringify([{id:'fixture',name:'Synthetic compatibility fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/scientific-agent.mjs'),`--capture=${capture}`]}]));
const processes=[];let host,desktop;
async function launch(){
 const child=spawn(process.env.PERO_HOST_EXECUTABLE??resolve(root,'target/debug/pero-host'),['--stdio'],{cwd:temp,env:{...process.env,PERO_APPS_ROOT:resolve(temp,'apps'),PERO_BUILTIN_APPS_ROOT:'',PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:registry,PERO_NODE_BINARY:process.execPath},stdio:['pipe','pipe','inherit']});processes.push(child);
 const pending=new Map(),events=[];const ended=new Promise(done=>child.once('exit',done));
 createInterface({input:child.stdout}).on('line',line=>{const event=JSON.parse(line);events.push(event);desktop?.accept(event);if(event.kind==='apps_result')pending.get(event.request_id)?.(event.data);});
 return {events,write:command=>child.stdin.write(JSON.stringify(command)+'\n'),async request(action,fields={}) {const id=randomUUID();return new Promise((done,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Host timeout: '+action));},20000);pending.set(id,value=>{pending.delete(id);clearTimeout(timer);done(value);});child.stdin.write(JSON.stringify({method:'apps',action,id,...fields})+'\n');});},async close(){child.stdin.end();await ended;}};
}
const until=async(observe,accept)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const value=await observe();if(accept(value))return value;await delay(20);}throw new Error('Pero Agent condition timed out');};
const turns=async()=>{try{return(await readFile(capture,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return[];throw error;}};
try{
 host=await launch();
 for(const name of ['scientific-viewer','welcome','grantless']){
  const source=resolve(temp,'sources',name);await mkdir(resolve(source,'dist'),{recursive:true});
  await writeFile(resolve(source,'dist/index.html'),'<h1>Synthetic permission fixture</h1>');
  await writeFile(resolve(source,'app.json'),JSON.stringify({schemaVersion:1,name,version:'0.1.0',displayName:name,
   permissions:{host:name==='grantless'?[]:['agent']},contributes:{panels:[{id:'main',title:name,entry:'dist/index.html'}]}}));
  const installed=await host.request('install',{path:source});assert.equal(installed.ok,true,installed.error);
  assert.equal((await host.request('enable',{name})).ok,true);
 }
 const request=async operation=>{const reply=await host.request('agentrun',{name:'scientific-viewer',request:operation});assert.equal(reply.ok,true,reply.error);return reply.value;};
 const catalog=await host.request('agentcatalog',{name:'scientific-viewer',path:'/api/workspaces'});assert.equal(catalog.ok,true,catalog.error);
 const scope={workspaceId:catalog.value.items[0].workspaceId};assert.equal(catalog.value.items[0].path,await import('node:fs/promises').then(fs=>fs.realpath(temp)));
 const preparedSource=resolve(temp,'prepared-source');await mkdir(resolve(preparedSource,'dist'),{recursive:true});
 await writeFile(resolve(preparedSource,'dist/index.html'),'<h1>Prepared App fixture</h1>');
 await writeFile(resolve(preparedSource,'server.mjs'),`import {createServer} from 'node:http';
const server=createServer(async(req,res)=>{if(req.headers['x-pero-app-token']!==process.env.PERO_APP_TOKEN){res.writeHead(403).end();return;}let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(input.target==='bad-output'?{wrong:true}:{source:input.target}));});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`);
 const inputSchema={type:'object',properties:{target:{type:'string',minLength:1}},required:['target'],additionalProperties:false};
 const contextSchema={type:'object',properties:{source:{type:'string',minLength:1}},required:['source'],additionalProperties:false};
 await writeFile(resolve(preparedSource,'app.json'),JSON.stringify({schemaVersion:1,name:'prepared-agent',version:'1',displayName:'Prepared Agent',permissions:{host:['agent','agent-plugin'],api:['/api/prepare','/api/apps/prepared-agent/inputs']},backend:{type:'node',entry:'server.mjs'},contributes:{panels:[{id:'main',title:'Prepared',entry:'dist/index.html'}],writes:[{name:'prepare',description:'Freeze source',path:'/api/prepare',schema:inputSchema},{name:'save',description:'Save result',path:'/api/save',schema:contextSchema}],agentPlugin:{schema:'pero.app-agent-plugin.v1',instructions:'Inspect frozen source',tools:['save'],maxCalls:3,prepareTool:'prepare',contextSchema}}}));
 const installedPrepared=await host.request('install',{path:preparedSource});assert.equal(installedPrepared.ok,true,installedPrepared.error);
 assert.equal((await host.request('enable',{name:'prepared-agent'})).ok,true);
 const prepare=async input=>host.request('agentrun',{name:'prepared-agent',request:{operation:'prepare',scope,input}});
 assert.equal((await host.request('apiaccess',{name:'prepared-agent',path:'/api/prepare'})).ok,true);
 assert.equal((await host.request('apiaccess',{name:'prepared-agent',path:'/api/prepare/child'})).ok,true);
 assert.equal((await host.request('apiaccess',{name:'prepared-agent',path:'/api/private'})).ok,false);
 assert.equal((await host.request('apiaccess',{name:'prepared-agent',path:'/api/prepare-other'})).ok,false);
 const prepared=await prepare({target:'PAYMENT'});assert.equal(prepared.ok,true,prepared.error);assert.deepEqual(prepared.value.context,{source:'PAYMENT'});
 for(const input of [{target:''},{unexpected:true},{target:'bad-output'}]) assert.equal((await prepare(input)).ok,false);
 const foreignPrepare=await host.request('agentrun',{name:'prepared-agent',request:{operation:'prepare',scope:{workspaceId:'foreign'},input:{target:'PAYMENT'}}});assert.equal(foreignPrepare.ok,false);
 await build({stdin:{contents:"export {DesktopApps} from './desktop/src/main/apps.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:resolve(temp,'desktop.mjs'),plugins:[{name:'app-network',setup(builder){builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'app-network'}));builder.onLoad({filter:/.*/,namespace:'app-network'},()=>({contents:'export const net = {fetch:globalThis.fetch};'}));}}]});
 const {DesktopApps}=await import(resolve(temp,'desktop.mjs'));
 desktop=new DesktopApps(command=>host.write(command),()=>{},async()=>undefined,async(app,token)=>{assert.equal(app,'prepared-agent');assert.equal(token,'a'.repeat(64));return{data:Buffer.from('frozen input'),name:'source.txt',mediaType:'text/plain'};});
 const appFetch=(path,init)=>desktop.serve(new Request('pero-app://prepared-agent'+path,init));
 const sdkInfo=await (await appFetch('/host/sdk')).json();assert.equal(sdkInfo.name,'prepared-agent');assert.deepEqual(sdkInfo.slots,['conversation']);assert(!JSON.stringify(sdkInfo).includes('token'));
 const api=createScopedApi({appName:'prepared-agent',allowedApiPaths:sdkInfo.permissions.api,fetch:appFetch});
 assert.deepEqual(await api.post('/api/prepare',{target:'ACCOUNTS'}),{source:'ACCOUNTS'});
 const frozen=await api.readFile('/api/apps/prepared-agent/inputs/'+'a'.repeat(64));assert.equal(new TextDecoder().decode(frozen),'frozen input');
 assert.equal((await appFetch('/api/private')).ok,false);
 const capability=await appFetch('/host/capability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capability:'agent',operation:'prepare',input:{scope,input:{target:'SAVINGS'}}})});
 assert.equal(capability.ok,true,await capability.clone().text());assert.deepEqual(await capability.json(),{source:'SAVINGS'});
 const noContext=await host.request('agentrun',{name:'prepared-agent',request:{operation:'start',scope,requestId:randomUUID(),harnessId:'fixture',text:'Inspect source'}});assert.equal(noContext.ok,false);assert.match(noContext.error,/Prepare App context/);
 const metadata=await host.request('sdkcontext',{name:'prepared-agent'});assert.equal(metadata.ok,true);assert.equal(metadata.value.name,'prepared-agent');assert.deepEqual(metadata.value.permissions.host,['agent','agent-plugin']);assert(!JSON.stringify(metadata.value).includes('token'));
 const start={operation:'start',scope,requestId:randomUUID(),harnessId:'fixture',text:'science-wait'};
 const run=await request(start);assert.equal(run.scope.workspaceId,scope.workspaceId);
 await until(turns,events=>events.some(event=>event.method==='session/prompt'));
 assert.deepEqual(await request({operation:'terminal',scope,runId:run.id}),{terminals:[]});
 assert.equal((await host.request('agentrun',{name:'welcome',request:{operation:'terminal',scope,runId:run.id}})).ok,false);
 const duplicate=await request(start);assert.equal(duplicate.id,run.id);assert.equal((await turns()).filter(event=>event.method==='session/prompt').length,1);
 assert.equal((await host.request('agentrun',{name:'scientific-viewer',request:{...start,text:'changed input'}})).ok,false);
 assert.equal((await host.request('agentrun',{name:'welcome',request:{operation:'cancel',scope,runId:run.id}})).ok,false);
 assert.equal((await host.request('agentrun',{name:'scientific-viewer',request:{operation:'status',scope:{workspaceId:'another'},runId:run.id}})).ok,false);
 const read={operation:'events',scope,runId:run.id};
 for(const operation of [{operation:'events',sessionId:run.sessionId,after:0},{operation:'cancel',sessionId:run.sessionId}]) {
  const denied=await host.request('agent',{name:'scientific-viewer',request:operation});assert.equal(denied.ok,false);assert.match(denied.error,/belong/);
 }
 for(const action of ['agentrun','agentcatalog']) {
  const denied=await host.request(action,{name:'grantless',...(action==='agentrun'?{request:{...start,requestId:randomUUID()}}:{path:'/api/workspaces'})});assert.equal(denied.ok,false);
 }
 await request({operation:'cancel',scope,runId:run.id});
 await until(()=>request(read),reply=>reply.run.status==='cancelled');
 const next=await request({operation:'retry',scope,runId:run.id,requestId:randomUUID(),text:'Checked structured output'});assert.equal(next.attempt,2);
 const completed=await until(()=>request(read),reply=>reply.run.status==='completed');assert.equal(completed.events.filter(event=>event.type==='assistant/message').length,1);
 await request({operation:'open',sessionId:run.sessionId});
 await until(async()=>host.events,events=>events.some(event=>event.kind==='app_agent_session_open'&&event.data.sessionId===run.sessionId));
 const promptCount=(await turns()).filter(event=>event.method==='session/prompt').length;
 await host.close();host=await launch();
 const found=await request({operation:'lookup',scope,requestId:start.requestId});assert.equal(found.run.id,run.id);assert.equal(found.run.attempt,2);assert.equal(found.run.status,'completed');
 await request(start);assert.equal((await turns()).filter(event=>event.method==='session/prompt').length,promptCount);
 const third={operation:'retry',scope,runId:run.id,requestId:randomUUID(),text:'Explicitly resume the same Session'};
 await request(third);await until(()=>request(read),reply=>reply.run.status==='completed'&&reply.run.attempt===3);
 const calls=await turns();assert.equal(calls.filter(event=>event.method==='session/new').length,1);assert.equal(calls.filter(event=>event.method==='session/load').length,1);
 await request(third);assert.equal((await turns()).filter(event=>event.method==='session/prompt').length,promptCount+1);
 await host.close();host=undefined;
 const declarationPath=resolve(temp,'apps/scientific-viewer/app.json');
 const declaration=JSON.parse(await readFile(declarationPath,'utf8'));
 const boundOperations=()=>[start,{operation:'lookup',scope,requestId:start.requestId},read,{operation:'status',scope,runId:run.id},
  {operation:'cancel',scope,runId:run.id},{operation:'retry',scope,runId:run.id,requestId:randomUUID(),text:'Must not run'},{operation:'open',sessionId:run.sessionId}];
 async function rejectChangedBinding(){for(const operation of boundOperations()){
  const reply=await host.request('agentrun',{name:'scientific-viewer',request:operation});assert.equal(reply.ok,false,operation.operation);assert.match(reply.error,/declaration/);
 }}
 for(const changedDeclaration of [{...declaration,version:'0.2.0'},{...declaration,contributes:{panels:[{...declaration.contributes.panels[0],id:'changed-panel'}]}}]){
  await writeFile(declarationPath,JSON.stringify(changedDeclaration));host=await launch();await rejectChangedBinding();await host.close();host=undefined;
 }
 await writeFile(declarationPath,JSON.stringify(declaration));
 const historyPath=resolve(temp,'history.jsonl'),originalHistory=await readFile(historyPath,'utf8');let modifiedBindings=0;
 const oldHistory=originalHistory.trim().split('\n').map(line=>{const event=JSON.parse(line);if(event.thread_id===run.sessionId&&event.kind==='session_created'&&event.data?.appBinding?.run){delete event.data.appBinding.run.appRevision;modifiedBindings++;}return JSON.stringify(event);}).join('\n')+'\n';
 assert.ok(modifiedBindings>0,'must modify a real persisted binding');await writeFile(historyPath,oldHistory);host=await launch();await rejectChangedBinding();await host.close();host=undefined;
 await writeFile(historyPath,originalHistory);assert.equal((await turns()).filter(event=>event.method==='session/prompt').length,promptCount+1);
 const changed=JSON.parse(await readFile(registry,'utf8'));changed[0].args.push('--changed-configuration');await writeFile(registry,JSON.stringify(changed));
 host=await launch();
 const rejected=await host.request('agentrun',{name:'scientific-viewer',request:{operation:'retry',scope,runId:run.id,requestId:randomUUID(),text:'Should not execute'}});
 assert.equal(rejected.ok,false);assert.match(rejected.error,/Harness configuration changed/);
 assert.equal((await turns()).filter(event=>event.method==='session/load').length,1);
 assert.equal((await host.request('disable',{name:'scientific-viewer'})).ok,true);
 assert.equal((await host.request('agentcatalog',{name:'scientific-viewer',path:'/api/workspaces'})).ok,false);
 for(const operation of boundOperations())assert.equal((await host.request('agentrun',{name:'scientific-viewer',request:operation})).ok,false,operation.operation);
 for(const operation of [{operation:'events',sessionId:run.sessionId,after:0},{operation:'cancel',sessionId:run.sessionId}])assert.equal((await host.request('agent',{name:'scientific-viewer',request:operation})).ok,false);
 console.log('Pero SDK transport, preparation, binary grants, API admission; Agent: ownership, scopes, frozen requests, cancellation, retries, aggregate events, exact-session selection, journal recovery, explicit ACP load, declaration/grant binding and legacy-route isolation passed.');
}finally{desktop?.close();if(host)await host.close();for(const child of processes)if(child.exitCode===null)child.kill();await rm(temp,{recursive:true,force:true});}
