// Real Rust Host, real Go ACP, and a deterministic loopback model.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter,once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with {type:'json'};
import {closeLoopback,listenJson,streamCompletion} from '../fixtures/loopback-model.mjs';

const [host,agent]=process.argv.slice(2).map(path=>resolve(path));
assert.ok(host && agent,'supply the built pero-host and pero-agent-acp');
const root=await mkdtemp(join(tmpdir(),'pero-team-board-'));
let serial=0;
const modelErrors=[];
const {server,url}=await listenJson((_req,res,body)=>{
  const last=body.messages.at(-1);
  const id='team-fixture-'+(++serial);
  if(last.role==='user'){
    assert.ok(body.tools?.some(tool=>tool.function.name==='team_task_create'));
    streamCompletion(res,{id,model:body.model,finish:'tool_calls',delta:{tool_calls:[{
      index:0,id,type:'function',function:{name:'team_task_create',
        arguments:JSON.stringify({subject:last.content,description:'not exposed to Host'})},
    }]}});
  }else{
    assert.equal(last.role,'tool');
    streamCompletion(res,{id,model:body.model,finish:'stop',delta:{content:'task recorded'}});
  }
},modelErrors);
const registry=join(root,'agents.json');
await writeFile(registry,JSON.stringify([{id:'team-fixture',name:'Team fixture',command:agent,
  args:['--endpoint',url+'/v1','--model','fixture-model','--api-key-env','FIXTURE_KEY',
    '--enable-subagents','--enable-team','--session-dir',join(root,'acp'),'--max-retries','0'],
  env:{FIXTURE_KEY:'team-fixture'},
}]));
const peer=spawn(host,['--stdio'],{cwd:root,env:{...process.env,PERO_AGENTS_FILE:registry,
  PERO_SETTINGS_PATH:join(root,'settings.json'),PERO_HISTORY_PATH:join(root,'history.jsonl')},
  stdio:['pipe','pipe','pipe']});
let stderr='';
peer.stderr.on('data',data=>{stderr+=data});
const events=[];
const signal=new EventEmitter();
createInterface({input:peer.stdout}).on('line',line=>{
  const event=JSON.parse(line);
  events.push(event);
  signal.emit('event',event);
});
const exit=once(peer,'exit');
const send=value=>peer.stdin.write(JSON.stringify(value)+'\n');
function waitFor(label,predicate,after=0){
  const existing=events.slice(after).find(predicate);
  if(existing)return Promise.resolve(existing);
  return new Promise((done,reject)=>{
    const receive=event=>{if(predicate(event)){clearTimeout(timer);signal.off('event',receive);done(event);}};
    const timer=setTimeout(()=>{
      signal.off('event',receive);
      reject(Error(`waiting for ${label}: ${stderr}\n${JSON.stringify(events.slice(-7))}`));
    },12_000);
    signal.on('event',receive);
  });
}
const waitKind=(thread,kind,after=0)=>waitFor(thread+': '+kind,
  event=>event.thread_id===thread && event.kind===kind,after);
const ajv=new Ajv2020({strict:true,strictTypes:false}).addSchema(schema);
async function read(thread,incarnation,kind='team_board'){
  const request_id='board-'+(++serial);
  send({action:'read_team_board',thread_id:thread,incarnation,request_id});
  const event=await waitFor(request_id,e=>e.request_id===request_id);
  assert.equal(event.kind,kind,JSON.stringify(event));
  assert.equal(event.thread_id,thread);
  assert.equal(event.data.incarnation,incarnation);
  const name=kind==='team_board'?'TeamBoardEvent':'TeamBoardErrorEvent';
  const validate=ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  assert.ok(validate(event),JSON.stringify(validate.errors));
  return event.data.board ?? event.data.reason;
}
async function configure(thread,value){
  const after=events.length;
  send({action:'configure',thread_id:thread,config_id:'team',value});
  await waitKind(thread,'configuration_changed',after);
}
try{
  await waitFor('Host ready',e=>e.kind==='ready');
  for(const thread of ['team-a','team-b'])send({action:'new_session',thread_id:thread,agent_id:'team-fixture'});
  const a=(await waitKind('team-a','session_ready')).data.peroTeamBoard.incarnation;
  const b=(await waitKind('team-b','session_ready')).data.peroTeamBoard.incarnation;
  assert.notEqual(a,b);
  assert.deepEqual(await read('team-a',a),{revision:0,enabled:false,tasks:[]});
  assert.equal(await read('team-b',a,'team_board_error'),'stale');
  assert.equal(serial,2,'reads of a board cannot cause model inference');
  for(const thread of ['team-a','team-b']){
    await configure(thread,'on');
    const after=events.length;
    send({action:'prompt',thread_id:thread,text:`Task from ${thread}`});
    await waitKind(thread,'turn_finished',after);
  }
  const first=await read('team-a',a);
  const second=await read('team-b',b);
  assert.equal(first.tasks[0].id,second.tasks[0].id,'equal task ids are scoped to separate roots');
  assert.equal(first.tasks[0].subject,'Task from team-a');
  assert.equal(second.tasks[0].subject,'Task from team-b');
  assert.ok(!('description' in first.tasks[0]));
  await configure('team-a','off');
  assert.deepEqual((await read('team-a',a)).tasks,[]);
  await configure('team-a','on');
  assert.deepEqual((await read('team-a',a)).tasks,first.tasks);
  const closed=events.length;
  send({action:'close',thread_id:'team-a'});
  await waitKind('team-a','session_closed',closed);
  assert.equal(await read('team-a',a,'team_board_error'),'unavailable');
  assert.deepEqual(await read('team-b',b),second);
  const resumed=events.length;
  send({action:'reconnect_session',thread_id:'team-a'});
  const rebound=(await waitKind('team-a','session_ready',resumed)).data.peroTeamBoard.incarnation;
  assert.notEqual(a,rebound);
  assert.equal(await read('team-a',a,'team_board_error'),'stale');
  assert.deepEqual((await read('team-a',rebound)).tasks,first.tasks);
  assert.deepEqual(modelErrors,[]);
  console.log('Host Team board: overlap-safe roots, off/on persistence, close and exact reconnect passed');
} finally {
  peer.stdin.end();
  const kill=setTimeout(()=>peer.kill(),5000);
  await exit;
  clearTimeout(kill);
  await closeLoopback(server);
  await rm(root,{recursive:true,force:true});
}
