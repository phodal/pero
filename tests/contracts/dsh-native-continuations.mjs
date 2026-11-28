// Real ACP server and disposable loopback provider. No real model or tools.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as pause } from 'node:timers/promises';
import { closeLoopback, listenJson, streamCompletion } from '../fixtures/loopback-model.mjs';

const home = await realpath(await mkdtemp(join(tmpdir(), 'pero-dsh-native-')));
const cwd = join(home, 'workspace');
const journal = join(home, 'journal');
await mkdir(cwd);
let enabled = false, serial = 0, scenario;
const errors = [];
const {server, url} = await listenJson((request, response, body) => {
  assert.equal(request.headers.authorization, 'Bearer dsh-fixture');
  const tools = (body.tools ?? []).map(tool => tool.function.name);
  for (const tool of ['subagent', 'subagent_fork'])
    assert.equal(tools.includes(tool), enabled);
  assert.ok(tools.includes('spawn_agent'));
  const last = body.messages.at(-1);
  const answer = content => streamCompletion(response, {id:`reply-${++serial}`, model:body.model, delta:{content}, finish:'stop'});
  if (last.role === 'tool' && scenario && last.tool_call_id === scenario.call) {
    scenario.receipt = JSON.parse(last.content);
    assert.ok(scenario.receipt.sessionId && scenario.receipt.messageId);
    answer('delegation acknowledged');
    return;
  }
  if (String(last.content).includes('independent root')) {
    answer('independent root complete');
    return;
  }
  if (scenario && String(last.content).includes('delegate fixture')) {
    streamCompletion(response, {id:`tool-${++serial}`, model:body.model, delta:{tool_calls:[{
      index:0, id:scenario.call, type:'function', function:{name:scenario.tool, arguments:JSON.stringify({
        name:scenario.name, description:'Inspect the fixture', prompt:`child fixture ${scenario.name}`,
      })},
    }]}, finish:'tool_calls'});
    return;
  }
  if (scenario && String(last.content).includes('child fixture ' + scenario.name)) {
    const sawSeed = body.messages.some(m => String(m.content).includes('durable seed marker'));
    assert.equal(sawSeed, scenario.tool === 'subagent_fork', 'spawn/fork must differ in inherited history');
    assert.equal(scenario.child, undefined);
    scenario.child = () => answer('child proof ' + scenario.name);
    return;
  }
  if (scenario && String(last.content).includes('child proof ' + scenario.name)) {
    scenario.notices++;
    answer('root synthesized ' + scenario.name);
    return;
  }
  assert.match(String(last.content), /durable seed marker|default-off probe/);
  answer('fixture ready');
}, errors);

async function acp(run) {
  const exe = resolve(process.argv[2] ?? 'target/debug/pero-agent-acp');
  const child = spawn(exe, ['--endpoint',url+'/v1','--api-key-env','FIXTURE_KEY','--model','fixture-model',
    '--enable-subagents','--max-retries','0','--workspace',cwd,'--session-dir',journal,
    ...(enabled ? ['--enable-dsh-continuations'] : [])],
  {cwd,env:{PATH:process.env.PATH,HOME:home,USERPROFILE:home,FIXTURE_KEY:'dsh-fixture'},stdio:['pipe','pipe','inherit']});
  const done = once(child,'close');
  const pending = new Map(), replies = [];
  let id = 0;
  createInterface({input:child.stdout}).on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'session/update' && message.params.update.sessionUpdate === 'agent_message_chunk') {
      replies.push([message.params.sessionId, message.params.update.content.text]);
    }
    pending.get(message.id)?.(message);
  });
  function rpc(method, params) {
    return new Promise((res, reject) => {
      const key = ++id;
      const timer = setTimeout(() => reject(Error(`ACP ${method} timed out: ${errors.join('; ')}`)), 12_000);
      pending.set(key, message => {
        clearTimeout(timer);
        pending.delete(key);
        if (message.error) reject(Error(message.error.message));
        else res(message.result);
      });
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');
    });
  }
  try {
    await rpc('initialize',{protocolVersion:1,clientCapabilities:{}});
    const open = () => rpc('session/new',{cwd,mcpServers:[]}).then(({sessionId})=>sessionId);
    const prompt = (sessionId,text) => rpc('session/prompt',{sessionId,prompt:[{type:'text',text}]});
    await run({open,prompt,replies});
  } finally {
    child.stdin.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try { assert.deepEqual(await done,[0,null]); } finally { clearTimeout(kill); }
  }
}

async function rootEnded(id, turn) {
  const data = await readFile(join(journal,id+'.jsonl'),'utf8').catch(()=>'');
  return data.trimEnd().split('\n').some(line => {
    if (!line) return false;
    const {event} = JSON.parse(line);
    return event?.type === 'turn/end' && event.data.turn === turn;
  });
}

try {
  await acp(async ({open,prompt}) => {
    assert.equal((await prompt(await open(),'default-off probe')).stopReason,'end_turn');
  });
  enabled = true;
  await acp(async ({open,prompt,replies}) => {
    for (const [tool,name] of [['subagent','review'],['subagent_fork','verify']]) {
      const root = await open(), other = await open();
      assert.equal((await prompt(root,'durable seed marker')).stopReason,'end_turn');
      scenario = {tool,name,call:`delegate-${name}`,notices:0};
      let settled = false;
      const request = prompt(root,'delegate fixture').finally(()=>{settled=true;});
      request.catch(()=>{});
      try {
        const deadline = Date.now() + 8_000;
        while ((!scenario.receipt || !scenario.child || !await rootEnded(root,2)) && !settled && Date.now()<deadline) await pause(10);
        assert.ok(scenario.receipt && scenario.child && await rootEnded(root,2), errors.join('; '));
        assert.equal(settled,false,'ACP returned before the child finished');
        await assert.rejects(prompt(root,'must not overlap'),/active prompt/);
        assert.equal((await prompt(other,'independent root')).stopReason,'end_turn');
        assert.equal(settled,false,'an unrelated root must not settle this request');
        scenario.child();
        scenario.child = undefined;
        assert.equal((await request).stopReason,'end_turn');
        assert.equal(scenario.notices,1);
        assert.ok(replies.some(([sessionId,text])=>sessionId===root && text===`root synthesized ${name}`));
      } finally {
        scenario.child?.();
        await request.catch(()=>{});
        scenario = undefined;
      }
    }
  });
  assert.deepEqual(errors,[]);
  console.log('ACP default-off, asynchronous spawn/fork, per-root settlement and final synthesis passed');
} finally {
  await closeLoopback(server);
  await rm(home,{recursive:true,force:true});
}
