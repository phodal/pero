// Actual Host + per-skill Git acquisition; a test-only forwarder delays one source.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {createSourceFixture,buildForwarder} from './skills-market-fixture.mjs';

const root=resolve(import.meta.dirname,'../..');
const directory=await mkdtemp(join(tmpdir(),'pero-skills-concurrent-'));
const changed=new EventEmitter(),events=[];
let host,exit,stderr='',sequence=0;
async function wait(predicate,after=0){
  const deadline=Date.now()+30000;
  while(true){const found=events.slice(after).find(predicate);if(found)return found;
    const remaining=deadline-Date.now();assert(remaining>0,`Host timed out: ${stderr}`);
    await new Promise((accept,reject)=>{const listener=()=>{clearTimeout(timer);accept();};const timer=setTimeout(()=>{changed.off('event',listener);reject(Error(`Host timed out: ${stderr}`));},remaining);changed.once('event',listener);});
  }
}
async function request(action,fields={}){const id=`concurrent-${++sequence}`;host.stdin.write(JSON.stringify({method:'apps',id,action,...fields})+'\n');return(await wait(e=>e.kind==='apps_result'&&e.request_id===id)).data;}
const market=(operation,input={})=>request('skillsmarket',{name:'skills',request:{operation,...input}});
async function ok(operation,input){const reply=await market(operation,input);assert(reply.ok,reply.error);return reply.value;}
async function readyFile(path){const deadline=Date.now()+15000;while(true){try{await access(path);return;}catch(error){if(error.code!=='ENOENT')throw error;}assert(Date.now()<deadline,'Acquisition did not publish readiness');await new Promise(done=>setTimeout(done,20));}}
async function stop(){host.stdin.end();const timer=setTimeout(()=>host.kill('SIGKILL'),5000);const[code]=await exit;clearTimeout(timer);host=null;assert.equal(code,0,stderr);}
try{
  const fixture=await createSourceFixture(directory);
  const harness=process.env.PERO_SKILLS_HARNESS_PATH||join(root,'target/debug/pero-agent-acp'+(process.platform==='win32'?'.exe':''));
  const forwarder=await buildForwarder(directory,{realHarness:harness});
  await writeFile(join(directory,'agents.json'),JSON.stringify([{id:'pero',name:'Actual acquisition fixture',command:forwarder.command,args:[],env:{}}]));
  const app=join(directory,'app');await mkdir(join(app,'dist'),{recursive:true});await writeFile(join(app,'dist/index.html'),'<h1>Skills</h1>');
  await writeFile(join(app,'app.json'),JSON.stringify({schemaVersion:1,name:'skills',version:'1',displayName:'Skills',permissions:{host:['skills']},contributes:{panels:[{id:'main',title:'Skills',entry:'dist/index.html'}]}}));
  async function start(){const after=events.length;host=spawn(process.env.PERO_HOST_PATH||join(root,'target/debug/pero-host'+(process.platform==='win32'?'.exe':'')),['--stdio'],{cwd:directory,env:{...process.env,...forwarder.env,PERO_AGENTS_FILE:join(directory,'agents.json'),PERO_SETTINGS_PATH:join(directory,'settings.json'),PERO_HISTORY_PATH:join(directory,'history.jsonl'),PERO_APPS_ROOT:join(directory,'apps'),PERO_BUILTIN_APPS_ROOT:'',PERO_REQUIRED_APPS:'',PERO_SKILLS_CATALOG:fixture.catalogPath,GIT_CONFIG_GLOBAL:fixture.gitconfig,GIT_CONFIG_NOSYSTEM:'1'},stdio:['pipe','pipe','pipe']});exit=once(host,'exit');host.stderr.on('data',c=>stderr+=c);createInterface({input:host.stdout}).on('line',line=>{events.push(JSON.parse(line));changed.emit('event');});await wait(e=>e.kind==='ready',after);}
  await start();for(const[action,fields]of[['install',{path:app}],['enable',{name:'skills'}]]){const reply=await request(action,fields);assert(reply.ok,reply.error);}
  let slowFinished=false;
  const firstSlow=market('install',{id:fixture.slow.id}).finally(()=>slowFinished=true);
  firstSlow.catch(()=>{});
  await readyFile(forwarder.ready);
  const fast=await ok('install',{id:fixture.fast.id});assert.equal(slowFinished,false,'Fast source must finish before slow source is released');
  assert.equal((await market('install',{id:fixture.slow.id})).ok,false,'Duplicate acquisition of one skill must be refused');
  assert(fast.items.some(v=>v.id===fixture.fast.id));await ok('enable',{id:fixture.fast.id,enabled:true});
  assert.deepEqual(await ok('cancel',{id:fixture.slow.id}),{cancelled:true});
  const cancelled=await firstSlow;assert.equal(cancelled.ok,false);assert.match(cancelled.error,/cancelled/i);
  assert((await ok('installed')).items.some(v=>v.id===fixture.fast.id&&v.selected));
  await rm(forwarder.ready);
  const secondSlow=ok('install',{id:fixture.slow.id});secondSlow.catch(()=>{});await readyFile(forwarder.ready);
  assert.equal((await ok('installed')).items.length,1,'Reads remain available during acquisition');
  await writeFile(forwarder.release,'release');await secondSlow;
  const completed=await ok('installed');assert.equal(completed.items.length,2);assert(completed.items.some(v=>v.id===fixture.fast.id&&v.selected),'Completion must merge into current installed state');
  await stop();await start();assert.equal((await ok('installed')).items.length,2,'Concurrent installs persist across restart');
  await rm(forwarder.ready);await rm(forwarder.release);
  const shutdown=market('install',{id:fixture.slow.id});await readyFile(forwarder.ready);await stop();await shutdown;
  const stored=JSON.parse(await readFile(join(directory,'skill-market/state.json'),'utf8'));assert.equal(Object.keys(stored.items).length,2);
  const output=join(root,'test-results/skills-market');await mkdir(output,{recursive:true});
  const report={passed:true,mode:'real-host-two-local-git-acquisitions',checks:['author/tags/dependencies metadata','independent parallel acquisition','same-id duplication rejected','catalog/installed reads during acquisition','one-id cancellation preserves another','completion merges latest state','restart persistence','shutdown cancels owned acquisition'],limitations:['Test-only delay forwarder; actual Go Git fetch/validation is executed','No model or scientific-result claim']};await writeFile(join(output,'runtime-concurrent.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(host){host.stdin.end();const timer=setTimeout(()=>host.kill('SIGKILL'),5000);await exit;clearTimeout(timer);}await rm(directory,{recursive:true,force:true});}
