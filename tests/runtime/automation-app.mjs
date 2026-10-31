// Original Point REST shapes through the real App grant, SQLite and local ACP owner.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(resolve(tmpdir(),'pero-automation-app-'));
const capture=resolve(temp,'prompts.jsonl');
await writeFile(capture,'');
await writeFile(resolve(temp,'agents.json'),JSON.stringify([
  ...['codex','claude','copilot','grok','qoder','opencode'].map(id=>({id,name:id,command:resolve(temp,'unavailable'),args:[]})),
  {id:'pero',name:'Local ACP fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/automation-acp.mjs')],env:{AUTOMATION_FIXTURE_LOG:capture}},
]));
let child,exited,serial=0;
async function launch(){
  const events=[],signal=new EventEmitter();
  child=spawn(resolve(root,'target/debug/pero-host'),['--stdio'],{cwd:temp,env:{...process.env,
    PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),
    PERO_AGENTS_FILE:resolve(temp,'agents.json'),PERO_APPS_ROOT:resolve(temp,'installed'),
    PERO_BUILTIN_APPS_ROOT:resolve(root,'apps'),PERO_POINT_RUNTIME_ROOT:resolve(root,'packages/point-app/dist'),
  },stdio:['pipe','pipe','inherit']});
  exited=new Promise(done=>child.once('exit',done));
  createInterface({input:child.stdout}).on('line',line=>{const event=JSON.parse(line);events.push(event);signal.emit('event',event);});
  const wait=predicate=>events.find(predicate)||new Promise((done,reject)=>{
    const timer=setTimeout(()=>{signal.off('event',receive);reject(new Error('Host event deadline'));},10000);
    const receive=event=>{if(predicate(event)){clearTimeout(timer);signal.off('event',receive);done(event);}};
    signal.on('event',receive);
  });
  await wait(event=>event.kind==='ready');
  return {
    async api(method,path,body,name='automations'){
      const id=`app-test-${++serial}`;
      child.stdin.write(JSON.stringify({method:'apps',action:'automation',id,name,request:{method,path,body:body??null}})+'\n');
      const result=(await wait(event=>event.request_id===id)).data;
      if(!result.ok)throw new Error(result.error);
      return result.value;
    },
    wait,
    async close(){child.stdin.end();await exited;child=undefined;},
  };
}
let host;
try{
  host=await launch();
  await assert.rejects(host.api('GET','/api/automations',null,'control-lab'),/cannot call/i);
  assert.deepEqual((await host.api('GET','/api/automations')).body,{items:[]});
  const created=await host.api('POST','/api/automations',{name:'Daily research',prompt:'Inspect only the local fixture.',rule:'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',timezone:'Asia/Shanghai',target:{kind:'local'}});
  assert.equal(created.status,201,JSON.stringify(created));
  const id=created.body.id,path=`/api/automations/${id}`;
  assert(created.body.next);
  assert.equal((await host.api('GET',path)).body.name,'Daily research');
  const paused=await host.api('PUT',path,{enabled:false});
  assert.equal(paused.body.enabled,false);assert.equal(paused.body.next,null);
  assert.equal((await host.api('PUT',path,{enabled:true})).body.enabled,true);
  const run=await host.api('POST',`${path}/run`);assert.equal(run.status,200);
  const finished=await host.wait(event=>event.kind==='turn_finished'&&event.thread_id?.startsWith('automation-'));
  assert(finished.thread_id);
  const prompt=JSON.parse((await readFile(capture,'utf8')).trim());
  assert(prompt.text.startsWith('Inspect only the local fixture.'));
  let record=(await host.api('GET',path)).body;
  const deadline=performance.now()+10000;
  while(record.runs[0].state!=='succeeded' && performance.now()<deadline) record=(await host.api('GET',path)).body;
  assert.equal(record.runs[0].state,'succeeded');assert.equal(record.runs[0].session_id,finished.thread_id);
  assert.equal(record.next,created.body.next,'manual run must keep the scheduled cursor');
  assert.equal((await host.api('POST','/api/automations',{name:'Invalid',prompt:'test',rule:'not-a-rule'})).status,400);
  assert.equal((await host.api('POST','/api/automations',{name:'Cloud',prompt:'test',target:{kind:'cloud'}})).status,501);
  await host.api('PUT',path,{enabled:false});
  await host.close();host=await launch();
  record=(await host.api('GET',path)).body;assert.equal(record.enabled,false);assert.equal(record.runs[0].state,'succeeded');
  assert.equal((await host.api('DELETE',path)).status,204);
  assert.deepEqual((await host.api('GET','/api/automations')).body.items,[]);
  console.log('PASS: App grant, calendar CRUD, pause/resume, real local ACP run, history, cursor, error, restart and deletion');
}finally{if(child){child.stdin.end();await exited;}await rm(temp,{recursive:true,force:true});}
