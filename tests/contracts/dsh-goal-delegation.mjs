// Two real Go ACP processes with exact models and disposable local journals.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { closeLoopback, listenJson, streamCompletion } from '../fixtures/loopback-model.mjs';

const home = await realpath(await mkdtemp(join(tmpdir(), 'pero-goal-delegate-')));
const cwd = join(home, 'workspace');
await mkdir(cwd);
const errors = [], scripts = [];
let count = 0, currentGoal;
const {server, url} = await listenJson((request, response, body) => {
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer goal-fixture');
  const script = scripts.shift();
  assert.ok(script, 'unexpected model request');
  const names = body.tools.map(tool => tool.function.name);
  const last = body.messages.at(-1);
  assert.ok(names.includes('get_goal'));
  assert.equal(names.includes('create_goal'), script.create ?? false, 'create_goal request '+count+' '+JSON.stringify(last));
  assert.equal(names.includes('update_goal'), script.update ?? false, 'update_goal request '+count+' '+JSON.stringify(last));
  if (script.text) assert.match(last.content, script.text);
  const command = script.call?.(last);
  const finish = command ? 'tool_calls' : (script.finish ?? 'stop');
  const delta = command ? {tool_calls: [{index: 0, id: 'call-'+count, type: 'function',
    function: {name: command[0], arguments: JSON.stringify(command[1])}}]} : {content: 'Checked current Goal.'};
  streamCompletion(response, {id:'goal-'+ ++count, model:body.model, delta, finish});
}, errors);

async function acp(run) {
  const exe = resolve(process.argv[2] || 'target/debug/pero-agent-acp');
  const child = spawn(exe, ['--endpoint', url+'/v1', '--model', 'fixture-model', '--api-key-env', 'FIXTURE_KEY',
    '--enable-goal', '--max-retries', '0', '--output-limit-recoveries', '1', '--workspace', cwd, '--session-dir', join(home, 'journal')],
  {cwd, env:{PATH:process.env.PATH, HOME:home, USERPROFILE:home, FIXTURE_KEY:'goal-fixture'}, stdio:['pipe','pipe','inherit']});
  const done = once(child, 'close');
  let id = 0;
  const waiters = new Map();
  const lines = createInterface({input:child.stdout});
  lines.on('line', line => {
    const message = JSON.parse(line);
    waiters.get(message.id)?.(message);
  });
  const rpc = (method, params) => new Promise((ok, fail) => {
    const request = ++id;
    const timer = setTimeout(() => fail(Error('ACP timeout: '+method+'; fixture: '+errors.join('; '))), 10_000);
    waiters.set(request, message => {
      clearTimeout(timer);
      waiters.delete(request);
      if (message.error) fail(Error(JSON.stringify(message.error)+'; fixture: '+errors.join('; ')));
      else ok(message.result);
    });
    child.stdin.write(JSON.stringify({jsonrpc:'2.0', id:request, method, params})+'\n');
  });
  try {
    await rpc('initialize',{protocolVersion:1, clientCapabilities:{}});
    await run({rpc, prompt:async (sessionId, text, ...steps) => {
      scripts.push(...steps);
      assert.equal((await rpc('session/prompt',{sessionId, prompt:[{type:'text',text}]})).stopReason, 'end_turn');
      assert.deepEqual(errors, []);
      assert.equal(scripts.length, 0, 'not all required model calls took place');
    }});
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try { assert.deepEqual(await done, [0,null]); } finally { clearTimeout(timer); }
  }
}

const read = (observe, exposed={}) => [
  {...exposed, call:() => ['get_goal',{}]},
  {...exposed, call:last => observe(JSON.parse(last.content))},
];
const mutation = (action, fields={}) => ['update_goal',{goal_id:currentGoal.id, revision:currentGoal.revision, action, ...fields}];
const options = {cwd, mcpServers:[]};
try {
  let sessionId;
  await acp(async ({rpc,prompt}) => {
    sessionId = (await rpc('session/new',options)).sessionId;
    await prompt(sessionId, 'Ordinary input has no mutation authority.',
      {call:() => ['create_goal',{objective:'Must not run'}]}, {});
    await prompt(sessionId, '/goal delegate Recover only, without Goal changes.',
      {create:true, update:true, finish:'length'},
      {text:/previous turn reached/i, call:() => ['create_goal',{objective:'Synthetic must not run'}]}, {});
    await prompt(sessionId, 'Read Goal after the negative controls.',
      ...read(value => assert.deepEqual(value, {goal:null})));
    await prompt(sessionId, '/goal delegate Create a two-round verification goal.',
      {create:true, update:true, call:() => ['create_goal',{objective:'Verify the experiment',max_goal_rounds:2}]},
      {update:true, text:/Goal round 1\/2/, call:() => ['get_goal',{}]},
      {update:true, call:last => {
        const state = JSON.parse(last.content);
        currentGoal = state.goal;
        assert.deepEqual([state.activation, currentGoal.revision, currentGoal.roundsStarted], ['armed',1,1]);
        return mutation('blocked',{blocked_reason:'Need a sample'});
      }},
      {update:true, call:last => {
        assert.match(last.content, /at least 3 admitted/);
        return ['pero_goal_stop',{outcome:'paused'}];
      }});
    await prompt(sessionId, '/goal delegate Edit the goal without resuming it.',
      {create:true,update:true,call:() => mutation('edit',{objective:'Verify the revised experiment',max_goal_rounds:3})});
  });
  const before = count;
  await acp(async ({rpc,prompt}) => {
    await rpc('session/load',{...options,sessionId});
    assert.equal(count,before,'opening a saved Goal did not start it');
    await prompt(sessionId,'Read the retained Goal without mutating.',
      ...read(({goal,activation}) => {
        assert.deepEqual([goal.id,goal.revision,goal.roundsStarted,goal.phase,goal.objective,activation],
          [currentGoal.id,2,1,'paused','Verify the revised experiment','disarmed']);
      }));
    await prompt(sessionId,'/goal delegate Try an old edit and a model resume.',
      {create:true,update:true,call:() => mutation('edit',{objective:'Stale update must not apply'})},
      {create:true,update:true,call:last => {
        assert.match(last.content,/stale or missing Goal reference/);
        return mutation('resume',{revision:2});
      }},
      {create:true,update:true,call:last => assert.match(last.content,/only the operator can resume/)});
    await prompt(sessionId,'/goal resume',
      {update:true,text:/Goal round 2\/3/,call:() => mutation('complete',{revision:2})});
    await prompt(sessionId,'Read final Goal.',
      ...read(({goal,activation}) => assert.deepEqual([goal.id,goal.revision,goal.roundsStarted,goal.phase,activation],
        [currentGoal.id,2,2,'complete','disarmed'])));
    const other = (await rpc('session/new',options)).sessionId;
    await prompt(other,'Read Goal from an unrelated root.', ...read(value => assert.deepEqual(value, {goal:null})));
  });
  assert.deepEqual(errors,[]);
  console.log('DSH Goal delegation passed through two real ACP processes: exact tool authority, no synthetic replay mutations, revision and pause preserved, explicit resume and model completion.');
} finally {
  await closeLoopback(server);
  await rm(home,{recursive:true,force:true});
}
