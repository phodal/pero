// Real production tools through real Go ACP + Rust Worker; loopback HTTP fixtures.
// Usage: node tests/runtime/go-tools-worker.mjs /absolute/pero-worker /absolute/pero-agent-acp
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { plans } from './go-tools-worker-plan.mjs';

const worker=resolve(process.argv[2]); const agent=resolve(process.argv[3]);
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const binaryHashes={worker:await hash(worker),agent:await hash(agent)};
const listen=async server=>{await new Promise(ok=>server.listen(0,'127.0.0.1',ok));return `http://127.0.0.1:${server.address().port}`};
const body=async req=>{let raw='';for await(const b of req)raw+=b;return raw?JSON.parse(raw):{}};
const send=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))};
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const ownAgentPids=sessions=>execFileSync('/bin/ps',['-eo','pid=,args='],{encoding:'utf8'}).split('\n').filter(line=>line.includes(agent)&&line.includes(sessions)).map(line=>Number(line.trim().split(/\s+/)[0]));
async function cleanupAgents(sessions){for(let n=0;n<20&&ownAgentPids(sessions).length;n++)await wait(50);const forced=ownAgentPids(sessions).length>0;for(const pid of ownAgentPids(sessions)){try{process.kill(pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}};for(let n=0;n<20&&ownAgentPids(sessions).length;n++)await wait(50);for(const pid of ownAgentPids(sessions)){try{process.kill(pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}};for(let n=0;n<20&&ownAgentPids(sessions).length;n++)await wait(50);assert.equal(ownAgentPids(sessions).length,0,'owned runtime survived fixture cleanup');assert(!forced,'Worker left its owned runtime alive; fixture had to force cleanup')}
const expiry=()=>new Date(Date.now()+3000).toISOString();
const stream=(res,delta,finish)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`)};

async function check(plan){
 const root=await mkdtemp(join(tmpdir(),'pero-real-tools-worker-'));
 const workspace=join(root,'workspace'),sessions=join(root,'sessions'),outside=join(root,'outside.txt');
 await mkdir(workspace,{mode:0o700});await mkdir(sessions,{mode:0o700});await mkdir(join(workspace,'nested'),{mode:0o700});
 await writeFile(join(workspace,'source.txt'),'READ_TOOL_OK\nneedle-search-marker\n',{mode:0o600});
 await writeFile(join(workspace,'nested','child.txt'),'nested-file\n',{mode:0o600});
 await writeFile(join(workspace,'existing.txt'),'ORIGINAL_UNCHANGED',{mode:0o600});
 await writeFile(outside,'OUTSIDE_FILE_MUST_NOT_LEAK',{mode:0o600});
 if(plan.name.includes('symlink'))await symlink(plan.name.includes('inside')?join(workspace,'source.txt'):outside,join(workspace,'escape.txt'));
 if(plan.name.includes('oversized'))await writeFile(join(workspace,'large.txt'),'L'.repeat(1024*1024)+'OUTPUT_TAIL_MUST_NOT_LEAK',{mode:0o600});
 if(plan.name==='bounded-read-output')await writeFile(join(workspace,'output.txt'),'O'.repeat(70000)+'OUTPUT_TAIL_MUST_NOT_LEAK',{mode:0o600});
 const state={events:[],requests:[],completes:[],renewals:0,providerClosed:false,toolResult:null};
 const errors=[];const children=new Set();const timers=new Set();
 const call=plan.call({workspace,outside});
 const provider=createServer(async(req,res)=>{try{
  assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer fixture-provider-secret');
  const data=await body(req);state.requests.push(data);
  if(state.requests.length===1){
   if(!plan.enableShell)assert(!data.tools?.some(t=>t.function.name==='shell'),'shell advertised without explicit opt-in');
   assert(data.tools?.some(t=>t.function.name===call.name),`production tool ${call.name} was not advertised`);
   stream(res,{tool_calls:[{index:0,id:'actual-tool-call',type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]},'tool_calls');return;
  }
  assert.equal(state.requests.length,2,'unexpected extra model request');
  state.toolResult=data.messages.findLast(m=>m.role==='tool'&&m.tool_call_id==='actual-tool-call');
  assert(state.toolResult,'actual tool result was not projected');
  await plan.verifyResult?.({result:state.toolResult,state,workspace,outside,root});
  if(plan.cancel){res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();const timer=setTimeout(()=>{timers.delete(timer);if(!res.destroyed)res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'late completion'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')},12000);timers.add(timer);res.on('close',()=>{state.providerClosed=true;clearTimeout(timer);timers.delete(timer)});return;}
  stream(res,{content:'fixture tools checked'},'stop');
 }catch(error){errors.push(String(error.stack||error));if(!res.headersSent)send(res,{error:{message:'fixture assertion failed'}},500);else res.destroy()}});
 const providerURL=await listen(provider);
 const run={id:'tools_run',generation:1,instance_id:'',status:'running',lease_expires_at:expiry(),spec:{title:'Real tools fixture',prompt:'Complete the single fixture tool operation.',workspace_key:'fixture',agent_id:'fixture',acceptance:''}};
 const cloud=createServer(async(req,res)=>{try{
  assert.equal(req.headers.authorization,'Bearer fixture-cloud-secret');const data=await body(req);
  if(req.url.endsWith('/claims')){run.instance_id=data.instance_id;run.lease_expires_at=expiry();return send(res,{run})}
  if(req.url.endsWith('/renew')){state.renewals++;run.lease_expires_at=expiry();return send(res,{lease_expires_at:run.lease_expires_at,cancel_requested:Boolean(plan.cancel&&state.requests.length===2&&state.renewals>=3)})}
  if(req.url.endsWith('/events')){for(const event of data.events)if(!state.events.some(e=>e.seq===event.seq))state.events.push(event);return send(res,{last_seq:state.events.at(-1)?.seq||0})}
  if(req.url.endsWith('/complete')){state.completes.push(data);run.status=data.outcome;return send(res,run)}
  send(res,run);
 }catch(error){errors.push(String(error.stack||error));send(res,{error:'fixture assertion failed'},500)}});
 const cloudURL=await listen(cloud);const config=join(root,'config.json');
 await writeFile(join(root,'agents.json'),JSON.stringify([{id:'fixture',name:'Production real tools',command:agent,args:['--endpoint',providerURL+'/v1','--model','fixture','--session-dir',sessions,'--api-key-env','ACP_FIXTURE_API_KEY','--approval','ask','--workspace',workspace,...(plan.enableShell?['--enable-shell']:[]),...(plan.cliArgs||[])],env:{ACP_FIXTURE_API_KEY:'fixture-provider-secret'}}]),{mode:0o600});
 await writeFile(config,JSON.stringify({workspaces:{fixture:workspace},agents_file:join(root,'agents.json')}),{mode:0o600});
 try{
  const child=spawn(worker,['--once'],{env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:root,TMPDIR:root,LANG:'C.UTF-8',PERO_CLOUD_URL:cloudURL,PERO_WORKER_TOKEN:'fixture-cloud-secret',PERO_WORKER_CONFIG:config,PERO_WORKER_STATE:join(root,'state.json')},stdio:['ignore','pipe','pipe']});children.add(child);let stderr='';child.stderr.on('data',b=>stderr+=b);child.stdout.resume();const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);
  const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('close',ok)});clearTimeout(deadline);children.delete(child);
  assert.deepEqual(errors,[]);assert.equal(code,0,stderr);assert.equal(state.requests.length,2,'one tool step and one final model turn expected');assert.equal(state.completes.at(-1)?.outcome,plan.cancel?'cancelled':'succeeded');
  if(plan.cancel)assert(state.providerClosed,'cancellation did not abort actual provider request');
  await plan.verify?.({state,workspace,outside,root});
  const ready = state.events.find(event => event.kind === 'session_ready');
  const firstTool = state.events.find(event => event.kind === 'session_update' && event.data?.sessionUpdate === 'tool_call');
  const permission = ready?.data?.peroSettings?.options?.find(option => option.id === 'permission');
  assert.equal(permission?.current, 'read-only', 'Worker did not establish read-only before ACP readiness');
  assert(firstTool && ready.seq < firstTool.seq, 'Agent started its tools before the Worker acknowledged readiness');
  const all=JSON.stringify({events:state.events,requests:state.requests});for(const forbidden of ['fixture-provider-secret','fixture-cloud-secret','OUTSIDE_FILE_MUST_NOT_LEAK','OUTPUT_TAIL_MUST_NOT_LEAK'])assert(!all.includes(forbidden),`private/unsupported output leaked: ${forbidden}`);
  return {name:plan.name,passed:true,tool:call.name,toolStatus:state.events.findLast(e=>e.kind==='session_update'&&e.data?.sessionUpdate==='tool_call_update'&&e.data.toolCallId==='actual-tool-call')?.data.status,providerCalls:state.requests.length,initialPermission:permission.current,outcome:state.completes.at(-1).outcome};
 }finally{for(const child of children)child.kill('SIGKILL');for(const timer of timers)clearTimeout(timer);cloud.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(ok=>cloud.close(ok)),new Promise(ok=>provider.close(ok))]);await cleanupAgents(sessions);await rm(root,{recursive:true,force:true})}
}
const results=[];for(const plan of plans){try{const row=await check(plan);results.push(row);console.log(JSON.stringify(row))}catch(error){const row={name:plan.name,passed:false,error:String(error.stack||error)};results.push(row);console.error(JSON.stringify(row))}}
assert.deepEqual({worker:await hash(worker),agent:await hash(agent)},binaryHashes,'binary changed; rerun required');
console.log(JSON.stringify({binaryHashes,results,limits:['Only loopback fake model/control-plane endpoints.','All tools are registered by the production runtime; no test-only no-op tools.','The Go ACP session starts read-only, and attempted writes, edits and shell calls leave no effects.','Cancellation covers a real read followed by an in-flight model turn, not an already executing shell.']},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
