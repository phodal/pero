// A real ACP/MCP transport fixture. It is deliberately not a model or analysis.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {setTimeout as poll} from 'node:timers/promises';
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const sessionId='data-agent-fixture';let server,nextId=0;
async function rpc(method,params){
  const response=await fetch(server.url,{method:'POST',headers:{...Object.fromEntries(server.headers.map(h=>[h.name,h.value])),'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++nextId,method,params})});
  const reply=await response.json();assert.equal(reply.error,undefined);return reply.result;
}
async function exercise(prompt){
  const contexts=prompt.filter(block=>block.type==='text'&&block.text.startsWith('User-selected context (data)')).map(block=>JSON.parse(block.text.split('\n\n').slice(1).join('\n\n')));
  const context=contexts.find(value=>value.schema==='pero.app-object.v1'&&value.objectId==='dataset-view');
  assert.ok(context,'selected dataset reaches ACP as an inspectable object reference');
  assert.equal(context.scope.app,'data-agent');assert.equal(context.selection.selectedCount,2);
  await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'data-agent-fixture',version:'1'}});
  const use=async arguments_=>{
    const result=await rpc('tools/call',{name:'app_use',arguments:arguments_});
    assert.notEqual(result.isError,true,result.content?.[0]?.text);
    const text=result.content.find(part=>part.type==='text').text;
    assert.ok(Buffer.byteLength(text)<32768,'App tools return bounded values');
    return JSON.parse(text);
  };
  let inventory=await use({action:'inventory'}),surface=inventory.surfaces.find(value=>value.app==='data-agent'||value.scope?.app==='data-agent')||inventory.surfaces[0];
  const deadline=Date.now()+5000;
  while(!surface.operable){
    assert.ok(surface.active&&surface.visible,'show the selected App before operating it');
    assert.ok(Date.now()<deadline,'App did not become idle');
    await poll(50);inventory=await use({action:'inventory'});surface=inventory.surfaces.find(value=>value.surfaceId===surface.surfaceId);
  }
  const task=await use({action:'start',surfaceId:surface.surfaceId,actions:['observe','semantic.invoke','verify']});
  try {
    const before=await use({action:'observe',taskId:task.taskId,target:'dataset-view'});
    const dataset=before.objects[0].state.dataset;
    assert.equal(dataset,context.selection.dataset);
    await use({action:'act',taskId:task.taskId,command:'semantic.invoke',target:'dataset-view',name:'query',params:{filterField:'group',operator:'eq',value:'A',sortField:'n',descending:true,selection:[]},expectedRevisions:before.revisions});
    const seen=await use({action:'observe',taskId:task.taskId,target:'dataset-view'});
    assert.equal(seen.objects[0].state.matching,3);
    assert.equal(seen.objects[0].state.sample[0].cells.n.display,'9007199254740993');
    await use({action:'verify',taskId:task.taskId,check:{kind:'semantic.equals',target:'dataset-view',key:'matching',value:3}});
    const output=await use({action:'act',taskId:task.taskId,command:'semantic.invoke',target:'dataset-view',name:'export',params:{},expectedRevisions:seen.revisions});
    return {fixture:true,realModel:false,dataset,selectedContext:context.selection,matching:3,export:output.result.result};
  } finally {await use({action:'stop',taskId:task.taskId});}
}
readline.createInterface({input:process.stdin}).on('line',async line=>{
  const {id,method,params}=JSON.parse(line);
  if(method==='initialize')send({id,result:{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true}},agentInfo:{name:'Data Agent transport fixture',version:'1'}}});
  else if(method==='session/new'){server=params.mcpServers.find(value=>value.type==='http'&&value.name==='pero-app-use');send({id,result:{sessionId}});}
  else if(method==='session/prompt'){
    let result;try{result=await exercise(params.prompt);}catch(error){result={fixture:true,error:String(error)};}
    send({method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'DATA_AGENT_RESULT:'+JSON.stringify(result)}}}});
    send({id,result:{stopReason:'end_turn'}});
  }
});
