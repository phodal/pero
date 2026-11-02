// Real Pero App grant, SQLite and local ACP owner; no UI build or provider.
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
// Minimal installed assets prove Host contracts, not production UI rendering.
const builtins=resolve(temp,'builtins');
for(const name of ['automations','control-lab']) {
  const directory=resolve(builtins,name);await mkdir(resolve(directory,'dist'),{recursive:true});
  const declaration=name==='automations'?JSON.parse(await readFile(resolve(root,'apps/automations/app.json'),'utf8')):
    {schemaVersion:1,name,version:'0.1.0',displayName:'Grantless fixture',contributes:{panels:[{id:'main',title:'Fixture',entry:'dist/index.html'}]}};
  await writeFile(resolve(directory,'app.json'),JSON.stringify(declaration));
  await writeFile(resolve(directory,'dist/index.html'),'<title>Host contract fixture</title>');
}
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
    PERO_BUILTIN_APPS_ROOT:builtins,
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
  const newsProgram={sources:[
    {id:'coding-agent-news',provider:'search',query:'Coding Agent Codex Claude Code Cursor Antigravity Kiro engineering news'},
    {id:'harness-news',provider:'search',query:'AI software engineering agent harness platform engineering technical report'},
    {id:'agent-tools-news',provider:'search',query:'Cursor Kiro Antigravity coding agents developer tools news'},
    {id:'engineering-practice-news',provider:'search',query:'AI assisted software engineering agent security evaluation engineering practice'},
  ],filter:{keywords:[],regex:''},goal:'对 AI 软件工程、Coding Agent、Harness、团队上下文、协同工作与可信交付有价值的近期资讯',output:'pulse',locale:'zh'};
  const news=await host.api('POST','/api/automations',{name:'AI 软件工程新闻',prompt:'搜索授权的公开技术主题，优先原始发布。',rule:'FREQ=DAILY;BYHOUR=8;BYMINUTE=20',timezone:'Asia/Shanghai',target:{kind:'local'},program:newsProgram});
  assert.equal(news.status,201,JSON.stringify(news));
  assert.equal(news.body.program.output,'pulse');
  assert.equal(news.body.program.sources.length,4);
  assert.equal((await host.api('GET',`/api/automations/${news.body.id}`)).body.program.locale,'zh');
  assert.equal((await host.api('POST','/api/automations',{name:'Broken source',prompt:'test',program:{sources:[],filter:{},goal:'x',output:'pulse'}})).status,400);
  await host.api('PUT',path,{enabled:false});
  await host.close();host=await launch();
  record=(await host.api('GET',path)).body;assert.equal(record.enabled,false);assert.equal(record.runs[0].state,'succeeded');
  const restored=(await host.api('GET',`/api/automations/${news.body.id}`)).body;
  assert.equal(restored.program.sources.length,4);assert.equal(restored.scheduled,true);
  assert.equal((await host.api('DELETE',path)).status,204);
  assert.equal((await host.api('DELETE',`/api/automations/${news.body.id}`)).status,204);
  assert.deepEqual((await host.api('GET','/api/automations')).body.items,[]);
  console.log('PASS: App grant, calendar CRUD, pause/resume, real local ACP run, history, cursor, error, restart and deletion');
}finally{if(child){child.stdin.end();await exited;}await rm(temp,{recursive:true,force:true});}
