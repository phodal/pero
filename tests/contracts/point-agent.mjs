// Real Rust Host/stdio, repository-owned synthetic manifests and ACP fixture.
// No external SDK, private source or provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(resolve(tmpdir(),'pero-point-agent-'));
const capture=resolve(temp,'acp.jsonl'),registry=resolve(temp,'agents.json');
await writeFile(registry,JSON.stringify([{id:'fixture',name:'Synthetic compatibility fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/scientific-agent.mjs'),`--capture=${capture}`]}]));
const processes=[];let host;
async function launch(){
 const child=spawn(process.env.PERO_HOST_EXECUTABLE??resolve(root,'target/debug/pero-host'),['--stdio'],{cwd:temp,env:{...process.env,PERO_APPS_ROOT:resolve(temp,'apps'),PERO_BUILTIN_APPS_ROOT:'',PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:registry},stdio:['pipe','pipe','inherit']});processes.push(child);
 const pending=new Map(),events=[];const ended=new Promise(done=>child.once('exit',done));
 createInterface({input:child.stdout}).on('line',line=>{const event=JSON.parse(line);events.push(event);if(event.kind==='apps_result')pending.get(event.request_id)?.(event.data);});
 return {events,async request(action,fields={}) {const id=randomUUID();return new Promise((done,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Host timeout: '+action));},20000);pending.set(id,value=>{pending.delete(id);clearTimeout(timer);done(value);});child.stdin.write(JSON.stringify({method:'apps',action,id,...fields})+'\n');});},async close(){child.stdin.end();await ended;}};
}
const until=async(observe,accept)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const value=await observe();if(accept(value))return value;await delay(20);}throw new Error('Point Agent condition timed out');};
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
 const request=async operation=>{const reply=await host.request('pointagent',{name:'scientific-viewer',request:operation});assert.equal(reply.ok,true,reply.error);return reply.value;};
 const catalog=await host.request('pointcatalog',{name:'scientific-viewer',path:'/api/workspaces'});assert.equal(catalog.ok,true,catalog.error);
 const scope={workspaceId:catalog.value.items[0].workspaceId};assert.equal(catalog.value.items[0].path,await import('node:fs/promises').then(fs=>fs.realpath(temp)));
 const start={operation:'start',scope,requestId:randomUUID(),harnessId:'fixture',text:'science-wait'};
 const run=await request(start);assert.equal(run.scope.workspaceId,scope.workspaceId);
 await until(turns,events=>events.some(event=>event.method==='session/prompt'));
 const duplicate=await request(start);assert.equal(duplicate.id,run.id);assert.equal((await turns()).filter(event=>event.method==='session/prompt').length,1);
 assert.equal((await host.request('pointagent',{name:'scientific-viewer',request:{...start,text:'changed input'}})).ok,false);
 assert.equal((await host.request('pointagent',{name:'welcome',request:{operation:'cancel',scope,runId:run.id}})).ok,false);
 assert.equal((await host.request('pointagent',{name:'scientific-viewer',request:{operation:'status',scope:{workspaceId:'another'},runId:run.id}})).ok,false);
 const read={operation:'events',scope,runId:run.id};
 for(const operation of [{operation:'events',sessionId:run.sessionId,after:0},{operation:'cancel',sessionId:run.sessionId}]) {
  const denied=await host.request('agent',{name:'scientific-viewer',request:operation});assert.equal(denied.ok,false);assert.match(denied.error,/belong/);
 }
 for(const action of ['pointagent','pointcatalog']) {
  const denied=await host.request(action,{name:'grantless',...(action==='pointagent'?{request:{...start,requestId:randomUUID()}}:{path:'/api/workspaces'})});assert.equal(denied.ok,false);
 }
 await request({operation:'cancel',scope,runId:run.id});
 await until(()=>request(read),reply=>reply.run.status==='cancelled');
 const next=await request({operation:'retry',scope,runId:run.id,requestId:randomUUID(),text:'Checked structured output'});assert.equal(next.attempt,2);
 const completed=await until(()=>request(read),reply=>reply.run.status==='completed');assert.equal(completed.events.filter(event=>event.type==='assistant/message').length,1);
 await request({operation:'open',sessionId:run.sessionId});
 await until(async()=>host.events,events=>events.some(event=>event.kind==='point_app_session_open'&&event.data.sessionId===run.sessionId));
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
  const reply=await host.request('pointagent',{name:'scientific-viewer',request:operation});assert.equal(reply.ok,false,operation.operation);assert.match(reply.error,/declaration/);
 }}
 for(const changedDeclaration of [{...declaration,version:'0.2.0'},{...declaration,contributes:{panels:[{...declaration.contributes.panels[0],id:'changed-panel'}]}}]){
  await writeFile(declarationPath,JSON.stringify(changedDeclaration));host=await launch();await rejectChangedBinding();await host.close();host=undefined;
 }
 await writeFile(declarationPath,JSON.stringify(declaration));
 const historyPath=resolve(temp,'history.jsonl'),originalHistory=await readFile(historyPath,'utf8');let modifiedBindings=0;
 const oldHistory=originalHistory.trim().split('\n').map(line=>{const event=JSON.parse(line);if(event.thread_id===run.sessionId&&event.kind==='session_created'&&event.data?.appBinding?.point){delete event.data.appBinding.point.appRevision;modifiedBindings++;}return JSON.stringify(event);}).join('\n')+'\n';
 assert.ok(modifiedBindings>0,'must modify a real persisted binding');await writeFile(historyPath,oldHistory);host=await launch();await rejectChangedBinding();await host.close();host=undefined;
 await writeFile(historyPath,originalHistory);assert.equal((await turns()).filter(event=>event.method==='session/prompt').length,promptCount+1);
 const changed=JSON.parse(await readFile(registry,'utf8'));changed[0].args.push('--changed-configuration');await writeFile(registry,JSON.stringify(changed));
 host=await launch();
 const rejected=await host.request('pointagent',{name:'scientific-viewer',request:{operation:'retry',scope,runId:run.id,requestId:randomUUID(),text:'Should not execute'}});
 assert.equal(rejected.ok,false);assert.match(rejected.error,/Harness configuration changed/);
 assert.equal((await turns()).filter(event=>event.method==='session/load').length,1);
 assert.equal((await host.request('disable',{name:'scientific-viewer'})).ok,true);
 assert.equal((await host.request('pointcatalog',{name:'scientific-viewer',path:'/api/workspaces'})).ok,false);
 for(const operation of boundOperations())assert.equal((await host.request('pointagent',{name:'scientific-viewer',request:operation})).ok,false,operation.operation);
 for(const operation of [{operation:'events',sessionId:run.sessionId,after:0},{operation:'cancel',sessionId:run.sessionId}])assert.equal((await host.request('agent',{name:'scientific-viewer',request:operation})).ok,false);
 console.log('Point Agent: ownership, scopes, frozen requests, cancellation, retries, aggregate events, exact-session selection, journal recovery, explicit ACP load, declaration/grant binding and legacy-route isolation passed.');
}finally{if(host)await host.close();for(const child of processes)if(child.exitCode===null)child.kill();await rm(temp,{recursive:true,force:true});}
