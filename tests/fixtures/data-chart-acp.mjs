// Exercises the actual ACP -> MCP -> managed App path; this is not a model.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {setTimeout as poll} from 'node:timers/promises';

const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const sessionId='data-chart-fixture';
let server,nextId=0;
async function rpc(method,params) {
  const response=await fetch(server.url,{method:'POST',headers:{...Object.fromEntries(server.headers.map(h=>[h.name,h.value])),'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++nextId,method,params})});
  const reply=await response.json();assert.equal(reply.error,undefined);return reply.result;
}
async function exercise(prompt) {
  const contexts=prompt.filter(block=>block.type==='text'&&block.text.startsWith('User-selected context (data)')).map(block=>JSON.parse(block.text.split('\n\n').slice(1).join('\n\n')));
  const context=contexts.find(value=>value.schema==='pero.app-object.v1'&&value.objectId==='dataset-view');
  assert.ok(context,'dataset context must reach ACP');
  await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'data-chart-fixture',version:'1'}});
  const use=async args=>{
    const result=await rpc('tools/call',{name:'app_use',arguments:args});
    assert.notEqual(result.isError,true,result.content?.[0]?.text);
    return JSON.parse(result.content.find(part=>part.type==='text').text);
  };
  let inventory=await use({action:'inventory'});
  let surface=inventory.surfaces.find(value=>value.app==='data-agent'||value.scope?.app==='data-agent');
  assert.ok(surface,'Data Agent must be mounted');
  const deadline=Date.now()+5000;
  while(!surface.operable){
    assert.ok(surface.active&&surface.visible,'Data Agent must be visible');
    assert.ok(Date.now()<deadline,'Data Agent did not become idle');
    await poll(50);inventory=await use({action:'inventory'});surface=inventory.surfaces.find(value=>value.surfaceId===surface.surfaceId);
  }
  const task=await use({action:'start',surfaceId:surface.surfaceId,actions:['observe','semantic.invoke','verify']});
  try {
    const before=await use({action:'observe',taskId:task.taskId,target:'chart-document'});
    const created=await use({action:'act',taskId:task.taskId,command:'semantic.invoke',target:'chart-document',name:'create',params:{type:'line',x:'period',y:'value'},expectedRevisions:before.revisions});
    const chart=created.result.result;
    assert.equal(chart.dataset,context.selection.dataset);
    assert.equal(chart.viewId,context.selection.viewId);
    assert.equal(chart.records,2);
    assert.equal(chart.type,'line');
    assert.match(chart.artifactId,/^[a-f0-9]{64}$/);
    const observed=await use({action:'observe',taskId:task.taskId,target:'chart-document'});
    assert.equal(observed.objects[0].state.dataset,chart.dataset);
    assert.equal(observed.objects[0].state.viewId,chart.viewId);
    assert.equal(observed.objects[0].state.artifactId,chart.artifactId);
    await use({action:'verify',taskId:task.taskId,check:{kind:'semantic.equals',target:'chart-document',key:'artifactId',value:chart.artifactId}});
    const source=await use({action:'act',taskId:task.taskId,command:'semantic.invoke',target:'chart-document',name:'source',params:{record:0},expectedRevisions:observed.revisions});
    assert.equal(source.result.result.dataset,chart.dataset);
    return {fixture:true,realModel:false,chart,source:source.result.result};
  } finally {await use({action:'stop',taskId:task.taskId});}
}
readline.createInterface({input:process.stdin}).on('line',async line=>{
  const {id,method,params}=JSON.parse(line);
  if(method==='initialize')send({id,result:{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true}},agentInfo:{name:'Data chart transport fixture',version:'1'}}});
  else if(method==='session/new'){server=params.mcpServers.find(value=>value.type==='http'&&value.name==='pero-app-use');send({id,result:{sessionId}});}
  else if(method==='session/prompt'){
    let result;try{result=await exercise(params.prompt);}catch(error){result={fixture:true,error:String(error)};}
    send({method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'DATA_CHART_RESULT:'+JSON.stringify(result)}}}});
    send({id,result:{stopReason:'end_turn'}});
  }
});
