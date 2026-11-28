// Real ACP server and native control tools driven by a disposable loopback provider.
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
let enabled = false, serial = 0, scenario, control, cold;
const errors = [];
const {server, url} = await listenJson(async (request, response, body) => {
  assert.equal(request.headers.authorization, 'Bearer dsh-fixture');
  const tools = (body.tools ?? []).map(tool => tool.function.name);
  for (const tool of ['subagent', 'subagent_fork', 'send_message', 'interrupt_agent'])
    assert.equal(tools.includes(tool), enabled);
  assert.ok(tools.includes('spawn_agent'));
  const last = body.messages.at(-1);
  const answer = content => streamCompletion(response, {id:`reply-${++serial}`, model:body.model, delta:{content}, finish:'stop'});
  const call = (id, name, args) => streamCompletion(response, {id:`tool-${++serial}`,
    model:body.model, delta:{tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},
    finish:'tool_calls'});
  if (cold) {
    const content = String(last.content);
    const byCall = id => body.messages.find(m=>m.role==='tool' && m.tool_call_id===id);
    const result = byCall('cold-seed-leaf');
    if (result && !cold.leaf) {
      cold.leaf = JSON.parse(result.content).sessionId;
      return answer('creator finished original work');
    }
    const offline = byCall('cold-identify-offline');
    if (offline && !cold.offlineChecked) {
      assert.match(String(offline.content),/creator is not live/);
      cold.offlineChecked = true;
      return answer('creator is offline');
    }
    const creatorWake = byCall('cold-wake-creator');
    if (creatorWake && !cold.creatorWake) {
      cold.creatorWake = JSON.parse(creatorWake.content).messageId;
      await cold.creatorReady;
      return call('cold-wake-leaf','send_message',{agent:'branch/checker',message:'cross-level cold relay'});
    }
    const leafWake = byCall('cold-wake-leaf');
    if (leafWake && !cold.leafWake) {
      cold.leafWake = JSON.parse(leafWake.content).messageId;
      return answer('cross-level wake accepted');
    }
    if (content.includes('seed cross-level fixture'))
      return call('cold-seed-creator','subagent',{name:'branch',description:'Creator probe',prompt:'seed creator fixture'});
    if (content.includes('seed creator fixture'))
      return call('cold-seed-leaf','subagent',{name:'checker',description:'Leaf probe',prompt:'seed leaf fixture'});
    if (content.includes('seed leaf fixture'))
      return answer('leaf saved baseline');
    if (content.includes('check offline creator fixture'))
      return call('cold-identify-offline','send_message',{agent:'branch/checker',message:'must not start leaf'});
    if (content.includes('restore cross-level fixture'))
      return call('cold-wake-creator','send_message',{agent:'branch',message:'rejoin creator fixture'});
    if (content.includes('rejoin creator fixture')) {
      cold.creatorJoined();
      await cold.leafReady;
      return answer('creator observed materialized leaf');
    }
    if (content.includes('cross-level cold relay')) {
      const messages = body.messages.flatMap(m=>[String(m.content)]);
      assert.ok(messages.includes('leaf saved baseline'),'resumed leaf kept its original model history');
      cold.leafResumes++;
      cold.leafJoined();
      return answer('leaf accepted cross-level input');
    }
    return answer('cross-level fixture settled');
  }
  if (control) {
    const stop = body.messages.find(m=>m.role==='tool' && m.tool_call_id==='stop-target');
    if (stop && !control.accepted) {
      assert.deepEqual(JSON.parse(stop.content),{accepted:true});
      control.accepted = true;
      return answer('root received interrupt receipt');
    }
    const wake = body.messages.find(m=>m.role==='tool' && m.tool_call_id==='resume-target');
    if (wake && !control.wakeMessageId) {
      control.wakeMessageId = JSON.parse(wake.content).messageId;
      return answer('root received wake receipt');
    }
    if (last.role === 'tool') {
      switch (last.tool_call_id) {
        case 'control-target':
          control.target = JSON.parse(last.content).sessionId;
          return call('control-relay','subagent',{name:'relay',description:'Relay probe',prompt:'relay control fixture'});
        case 'control-relay':
          control.relay = JSON.parse(last.content).sessionId;
          return control.delivered.then(()=>call('stop-target','interrupt_agent',{agent:'receiver'}));
        case 'wrong-interrupt':
          assert.match(String(last.content),/another ancestor or parent/);
          return call('relay-send','send_message',{agent:'receiver',message:'sibling delivery marker'});
        case 'relay-send':
          control.messageId = JSON.parse(last.content).messageId;
          assert.ok(control.messageId);
          control.finishDelivery();
          return answer('relay returned');
      }
    }
    if (String(last.content).includes('begin control fixture'))
      return call('control-target','subagent',{name:'receiver',description:'Receive probe',prompt:'receiver control fixture'});
    if (String(last.content).includes('continue control fixture'))
      return call('resume-target','send_message',{agent:'receiver',message:'root wakes parked receiver'});
    if (body.messages.some(m=>String(m.content).includes('receiver control fixture')) && control.resuming) {
      const text = body.messages.filter(m=>m.role==='user').map(m=>String(m.content));
      assert.equal(text.filter(s=>s.includes('sibling delivery marker')).length,1);
      assert.equal(text.filter(s=>s.includes('root wakes parked receiver')).length,1);
      control.resumed++;
      return answer('receiver resumed');
    }
    if (String(last.content).includes('receiver control fixture')) {
      assert.equal(control.targetStarted, undefined);
      control.targetStarted = true;
      response.once('close',()=>{control.targetCancelled = true;});
      control.startTarget();
      return;
    }
    if (String(last.content).includes('relay control fixture')) {
      await control.targetReady;
      return call('wrong-interrupt','interrupt_agent',{agent:'receiver'});
    }
    return answer('control fixture settled');
  }
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
    const load = sessionId => rpc('session/load',{sessionId,cwd,mcpServers:[]});
    await run({open,load,prompt,replies});
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
    const root = await open();
    const target = Promise.withResolvers(), delivery = Promise.withResolvers();
    control = {targetReady:target.promise,startTarget:target.resolve,delivered:delivery.promise,finishDelivery:delivery.resolve};
    assert.equal((await prompt(root,'begin control fixture')).stopReason,'end_turn');
    assert.ok(control.target && control.relay && control.messageId && control.accepted && control.targetCancelled,
      JSON.stringify({...control,errors}));
    const events = (await readFile(join(journal,control.target+'.jsonl'),'utf8')).trimEnd().split('\n')
      .map(line=>JSON.parse(line).event).filter(Boolean);
    const splices = events.filter(event=>event.type==='agent/inbox/spliced' && event.data.target==='next-step');
    const deliveries = splices.flatMap(({data})=>data.inserted ?? []).filter(m=>m.id===control.messageId);
    assert.equal(deliveries.length,1,'sibling input was stored once even when the live target is interrupted');
    assert.equal(deliveries[0].source.senderSessionId,control.relay,'journal attributes delivery to the actual sender');
    const pending = [];
    for (const {data} of splices) pending.splice(data.start,data.removedCount ?? 0,...(data.inserted ?? []));
    assert.deepEqual(pending.map(m=>m.id),[control.messageId],'interrupt parks, rather than claims or deletes, the pending input');
    control.resuming = true;
    control.resumed = 0;
    assert.equal((await prompt(root,'continue control fixture')).stopReason,'end_turn');
    assert.ok(control.wakeMessageId);
    assert.equal(control.resumed,1,'later send wakes the original child and drains the parked input once');
  });
  control = undefined;
  const creator = Promise.withResolvers(), leaf = Promise.withResolvers();
  cold = {creatorReady:creator.promise,creatorJoined:creator.resolve,leafReady:leaf.promise,leafJoined:leaf.resolve,leafResumes:0};
  let originalRoot;
  await acp(async ({open,prompt}) => {
    originalRoot = await open();
    assert.equal((await prompt(originalRoot,'seed cross-level fixture')).stopReason,'end_turn');
    assert.ok(cold.leaf);
  });
  await acp(async ({load,prompt}) => {
    await load(originalRoot);
    assert.equal((await prompt(originalRoot,'check offline creator fixture')).stopReason,'end_turn');
    assert.equal(cold.offlineChecked,true);
    assert.equal(cold.leafResumes,0);
    assert.equal((await prompt(originalRoot,'restore cross-level fixture')).stopReason,'end_turn');
    assert.ok(cold.creatorWake && cold.leafWake,JSON.stringify({errors,cold}));
    assert.equal(cold.leafResumes,1);
    const journalLines = (await readFile(join(journal,cold.leaf+'.jsonl'),'utf8')).trimEnd().split('\n').map(JSON.parse);
    const messages = journalLines.flatMap(line=>line.event?.data?.inserted ?? []).filter(m=>m.id===cold.leafWake);
    assert.equal(messages.length,1);
    assert.equal(messages[0].source.senderSessionId,originalRoot);
  });
  assert.deepEqual(errors,[]);
  console.log('ACP default-off, asynchronous spawn/fork, per-root settlement, sibling send, ancestor interrupt, and cold cross-level delivery with live creator passed');
} finally {
  await closeLoopback(server);
  await rm(home,{recursive:true,force:true});
}
