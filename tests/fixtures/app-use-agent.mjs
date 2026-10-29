// ACP fixture using the actual Desktop-provided MCP endpoint, never a model.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let server, requestId = 0, active, imageCount = 0;
const sessionId = 'app-use-fixture';
const permissionAnswers=new Map();let permissionId=100000;
async function askAgentPolicy(signal){
  const id=++permissionId;
  const result=await new Promise((resolve,reject)=>{
    const cancel=()=>{permissionAnswers.delete(id);reject(signal.reason);};
    permissionAnswers.set(id,result=>{signal.removeEventListener('abort',cancel);resolve(result);});
    signal.addEventListener('abort',cancel,{once:true});
    send({id,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:String(id),title:'Agent policy · App tool call',kind:'other',status:'pending'},options:[{optionId:'allow',name:'Allow / 允许',kind:'allow_once'},{optionId:'reject',name:'Reject / 拒绝',kind:'reject_once'}]}});
  });
  return result.outcome?.outcome==='selected'&&result.outcome.optionId==='allow';
}
const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  const { text, dom, image, snapshot, objects, ...rest } = value;
  return { ...Object.fromEntries(Object.entries(rest).map(([key, part]) => [key, normalize(part)])),
    ...(Array.isArray(objects) ? { objects: objects.map(object => ({ id: object.id, revision: object.revision, state: object.state, commands: object.commands.map(command => command.name) })) } : objects === undefined ? {} : { objects: normalize(objects) }),
    ...(typeof text === 'string' ? { textLength: text.length } : {}),
    ...(Array.isArray(dom) ? { domCount: dom.length, controls: dom.filter(control => ['Find gene', 'MS4A1'].includes(control.label)) } : {}),
    ...(snapshot ? { snapshot: normalize(snapshot) } : {}) };
};
async function rpc(method, params, signal) {
  assert.ok(server, 'ACP session/new must inject an HTTP MCP server');
  const headers = Object.fromEntries(server.headers.map(header => [header.name, header.value]));
  const response = await fetch(server.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }), signal });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.error, undefined);
  return reply.result;
}
async function run(scenario, signal, prompt) {
  if(scenario==='context'){
    const contexts=prompt.filter(block=>block.type==='text'&&block.text.startsWith('User-selected context (data)')).map(block=>{const data=block.text.split('\n\n').slice(1).join('\n\n');return JSON.parse(data);});
    assert.ok(contexts.some(context=>context.schema==='pero.app-object.v1'));
    assert.ok(contexts.some(context=>context.schema==='pero.app-annotation.v1'));
    assert.equal(prompt.filter(block=>block.type==='image').length,1);
    return {scenario,contexts,images:1};
  }
  const steps = [];
  const tool = async (args, errorCode) => {
    const id = `app-use-${requestId + 1}`;
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: id, title: `App Use: ${args.action}`, kind: 'other', status: 'in_progress', rawInput: args } } });
    const result = await rpc('tools/call', { name: 'app_use', arguments: args }, signal);
    const text = result.content.find(content => content.type === 'text')?.text || '';
    if (errorCode) {
      assert.equal(result.isError, true, `Expected ${errorCode}: ${text}`);
      assert.ok(text.startsWith(`${errorCode}:`), text);
      steps.push({ action: args.action, command: args.command, error: errorCode });
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { expectedError: errorCode } } } });
      return;
    }
    assert.notEqual(result.isError, true, text);
    const value = JSON.parse(text);
    const images = result.content.filter(content => content.type === 'image');
    if (args.action === 'capture') {
      assert.equal(images.length, 1);
      const image = Buffer.from(images[0].data, 'base64');
      assert.ok(image.length > 1000);
      assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      if (process.env.PERO_APP_USE_FIXTURE_OUTPUT) {
        await mkdir(process.env.PERO_APP_USE_FIXTURE_OUTPUT, { recursive: true });
        await writeFile(join(process.env.PERO_APP_USE_FIXTURE_OUTPUT, `capture-${++imageCount}.png`), image);
      }
    }
    steps.push({ action: args.action, command: args.command, result: normalize(value), ...(images.length ? { images: images.length } : {}) });
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: normalize(value) } } });
    return value;
  };
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pero-app-use-fixture', version: '1' } }, signal);
  const catalog = await rpc('tools/list', {}, signal);
  assert.ok(catalog.tools.some(tool => tool.name === 'app_use'));
  const inventory = await tool({ action: 'inventory' });
  assert.equal(inventory.surfaces.length, 1);
  const surfaceId = inventory.surfaces[0].surfaceId;
  if(scenario==='input'){
    const file=inventory.fileReferences.find(file=>file.name==='selected-输入.json');assert.ok(file);
    const task=await tool({action:'start',surfaceId,actions:['semantic.invoke','verify']});
    const observed=await tool({action:'observe',taskId:task.taskId,target:'virtual-cell'});
    const acted=await tool({action:'act',taskId:task.taskId,command:'semantic.invoke',target:'virtual-cell',name:'import_file',params:{file:file.ref},expectedRevisions:observed.revisions});
    const inputId=acted.result.result.inputId;assert.ok(inputId);
    await tool({action:'wait',taskId:task.taskId,until:{target:'virtual-cell',key:'inputId',equals:inputId}});
    await tool({action:'stop',taskId:task.taskId});
    return {scenario,inputId,steps};
  }
  if(scenario==='write-deny'){assert.equal(await askAgentPolicy(signal),false);return {scenario,denied:true};}
  if(scenario==='write'){
    const described=await rpc('tools/call',{name:'app_describe',arguments:{}},signal);
    assert.equal(described.isError,false);assert.ok(JSON.parse(described.content[0].text).apps.some(tool=>tool.app==='virtual-cell'&&tool.tool==='import-inputs'));
    const content=await readFile(process.env.PERO_APP_USE_FIXTURE_INPUT,'utf8');
    const written=await rpc('tools/call',{name:'app_write',arguments:{app:'virtual-cell',tool:'import-inputs',document:{documents:[content]}}},signal);
    assert.equal(written.isError,false);
    return {scenario,written:JSON.parse(written.content[0].text)};
  }
  if(scenario==='deny'){assert.equal(await askAgentPolicy(signal),false);return {scenario,steps,denied:true};}
  if(scenario==='standing-after-revoke'){
    assert.deepEqual(inventory.standing,[]);
    const task=await tool({action:'start',surfaceId,scope:'session',actions:['observe','verify']});
    await tool({action:'observe',taskId:task.taskId,target:'virtual-cell'});await tool({action:'stop',taskId:task.taskId});
    return {scenario,steps,restarted:true};
  }
  if (scenario === 'hidden') {
    assert.equal(inventory.surfaces[0].operable, false);
    const reading = await tool({ action: 'start', surfaceId, actions: ['observe', 'capture', 'verify'] });
    const seen = await tool({ action: 'observe', taskId: reading.taskId, target: 'virtual-cell' });
    assert.equal(seen.objects[0].state.view, 'cells');
    await tool({ action: 'capture', taskId: reading.taskId }, 'APP_SURFACE_HIDDEN');
    await tool({ action: 'start', surfaceId, actions: ['semantic.invoke'] }, 'APP_SURFACE_HIDDEN');
    await tool({ action: 'stop', taskId: reading.taskId });
    return { scenario, steps };
  }
  if (scenario === 'standing') {
    for (let round = 0; round < 2; ++round) {
      const grant = await tool({ action: 'start', surfaceId, scope: 'session', actions: ['observe', 'verify'] });
      const seen = await tool({ action: 'observe', taskId: grant.taskId, target: 'virtual-cell' });
      assert.equal(seen.objects[0].state.view, 'cells');
      const verified = await tool({ action: 'verify', taskId: grant.taskId, check: { kind: 'semantic.equals', target: 'virtual-cell', key: 'view', value: 'cells' } });
      assert.equal(verified.verdict, 'pass');
      await tool({ action: 'stop', taskId: grant.taskId });
    }
    return { scenario, steps };
  }
  assert.equal(scenario, 'full');
  const start = await tool({ action: 'start', surfaceId, actions: ['observe', 'capture', 'semantic.invoke', 'dom.click', 'dom.fill', 'verify'] });
  const taskId = start.taskId;
  const declared = await tool({ action: 'describe', taskId, target: 'virtual-cell' });
  assert.ok(declared.objects[0].commands.some(command => command.name === 'select_view'));
  const baseline = await tool({ action: 'capture', taskId, target: 'virtual-cell' });
  const changeView = async view => {
    const seen = await tool({ action: 'observe', taskId, target: 'virtual-cell' });
    const act = await tool({ action: 'act', taskId, command: 'semantic.invoke', target: 'virtual-cell', name: 'select_view', params: { view }, expectedRevisions: seen.revisions });
    assert.equal(act.verdict, 'not-run');
    const waited = await tool({ action: 'wait', taskId, until: { target: 'virtual-cell', key: 'view', equals: view }, timeoutMs: 10000 });
    assert.equal(waited.matched, true);
    const verified = await tool({ action: 'verify', taskId, check: { kind: 'semantic.equals', target: 'virtual-cell', key: 'view', value: view } });
    assert.equal(verified.verdict, 'pass');
  };
  await changeView('mechanism');
  for (const check of [{ kind: 'visual.nonblank', target: 'virtual-cell' }, { kind: 'visual.changed', target: 'virtual-cell', baseline: baseline.evidence.id }]) {
    const verified = await tool({ action: 'verify', taskId, check });
    assert.equal(verified.verdict, 'pass');
  }
  await changeView('cells');
  const beforeFill = await tool({ action: 'observe', taskId });
  const input = beforeFill.dom.find(control => control.label === 'Find gene' && control.tag === 'input');
  assert.ok(input, 'Find gene must be present in observation-minted refs');
  await tool({ action: 'act', taskId, command: 'dom.fill', target: input.ref, params: { value: 'MS4A1' }, expectedRevisions: beforeFill.revisions });
  await tool({ action: 'act', taskId, command: 'dom.fill', target: input.ref, params: { value: 'BAD-STALE-WRITE' }, expectedRevisions: beforeFill.revisions }, 'APP_REF_STALE');
  const beforeClick = await tool({ action: 'observe', taskId });
  assert.equal(beforeClick.dom.find(control => control.label === 'Find gene').value, 'MS4A1');
  const gene = beforeClick.dom.find(control => control.role === 'button' && control.label === 'MS4A1');
  assert.ok(gene, 'Observed MS4A1 gene result');
  await tool({ action: 'act', taskId, command: 'dom.click', target: gene.ref, expectedRevisions: beforeClick.revisions });
  const visible = await tool({ action: 'verify', taskId, check: { kind: 'dom.exists', label: 'MS4A1', role: 'button' } });
  assert.equal(visible.verdict, 'pass');
  await tool({ action: 'capture', taskId });
  await tool({ action: 'stop', taskId });
  const reading = await tool({ action: 'start', surfaceId, actions: ['observe', 'verify'] });
  const plan = await tool({ action: 'runPlan', taskId: reading.taskId, steps: [
    { id: 'seen', request: { action: 'observe', target: 'virtual-cell' } },
    { id: 'checked', request: { action: 'verify', check: { kind: 'semantic.equals', target: 'virtual-cell', key: 'view', value: { $ref: 'seen.objects.0.state.view' } } } },
  ] });
  assert.equal(plan.state, 'completed');
  await tool({ action: 'observe', taskId: reading.taskId }, 'APP_TASK_REQUIRED');
  return { scenario, steps };
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params,result } = JSON.parse(line);
  if(!method&&permissionAnswers.has(id)){const answer=permissionAnswers.get(id);permissionAnswers.delete(id);answer(result);return;}
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true }, promptCapabilities: { image: true } }, agentInfo: { name: 'App Use fixture', version: '1' } } });
  else if (method === 'session/new') {
    server = params.mcpServers.find(server => server.type === 'http' && server.name === 'pero-app-use');
    send({ id, result: { sessionId } });
  } else if (method === 'session/prompt') {
    const scenario = params.prompt.find(block => block.type === 'text')?.text.match(/app-use:([\w-]+)/)?.[1];
    const controller = new AbortController(); active = { id, controller };
    try {
      const result = await run(scenario, controller.signal, params.prompt);
      if (active?.id !== id) return;
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `APP_USE_RESULT:${JSON.stringify(result)}` } } } });
      send({ id, result: { stopReason: 'end_turn' } });
    } catch (error) {
      if (active?.id !== id) return;
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `APP_USE_RESULT:${JSON.stringify({ scenario, error: error.message })}` } } } });
      send({ id, result: { stopReason: 'end_turn' } });
    } finally { if (active?.id === id) active = undefined; }
  } else if (method === 'session/cancel' && active) {
    const turn = active; active = undefined; turn.controller.abort(); send({ id: turn.id, result: { stopReason: 'cancelled' } });
  }
});
