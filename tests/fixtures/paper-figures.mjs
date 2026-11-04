// Deterministic ACP driver: actual approved Paper reads and MCP image delivery,
// with a visibly labelled fixture answer. No model or experiment is simulated.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const paperId = option('paper'), output = option('output');
assert.match(paperId ?? '', /^[a-f0-9]{64}$/);
let mcp, rpcId = 0;
const sessionId = 'paper-figure-fixture';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', ...value })+'\n');
const update = value => send({method:'session/update',params:{sessionId,update:value}});
async function rpc(method, params) {
  const response = await fetch(mcp.url,{method:'POST',headers:{...Object.fromEntries(mcp.headers.map(h=>[h.name,h.value])),'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const reply = await response.json(); assert.equal(response.status,200); assert.equal(reply.error,undefined);
  return reply.result;
}
async function read(document) {
  const toolCallId = `figure-${++rpcId}`;
  update({sessionUpdate:'tool_call',toolCallId,title:'Paper figure read',kind:'read',status:'in_progress',rawInput:document});
  const result = await rpc('tools/call',{name:'app_write',arguments:{app:'paper-agent',tool:'research-source-read',document}});
  assert.notEqual(result.isError,true,JSON.stringify(result));
  const envelope = JSON.parse(result.content.find(c=>c.type==='text').text);
  assert.notEqual(envelope.type,'content_reference','Use a short query so the fixture only reads one relevant figure.');
  update({sessionUpdate:'tool_call_update',toolCallId,status:'completed',content:result.content.map(content=>({type:'content',content}))});
  return {value:envelope.result, content:result.content};
}
readline.createInterface({input:process.stdin}).on('line',async line=>{
  const request=JSON.parse(line); if(!request.method)return;
  try {
    if(request.method==='initialize')send({id:request.id,result:{protocolVersion:1,agentInfo:{name:'Paper figure fixture',version:'1'},agentCapabilities:{loadSession:true,promptCapabilities:{image:true,embeddedContext:true},mcpCapabilities:{http:true}}}});
    else if(request.method==='session/new'||request.method==='session/load') {
      mcp=request.params.mcpServers.find(server=>server.type==='http'&&server.name==='pero-app-use'); assert.ok(mcp);
      send({id:request.id,result:{sessionId}});
    } else if(request.method==='session/prompt') {
      const prompt=JSON.stringify(request.params.prompt); assert.ok(prompt.includes(paperId),'Question must retain the selected paper identity');
      await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'figure-fixture',version:'1'}});
      const found=await read({operation:'figures',paperId,query:option('query')||'ablation'});
      const figure=found.value.figures.find(f=>f.resolved); assert.ok(figure);
      const viewed=await read({operation:'image',bundleId:figure.bundleId,resourceId:figure.resourceId,memberId:figure.members[0].id});
      const image=viewed.content.find(c=>c.type==='image'); assert.ok(image);
      const sha=createHash('sha256').update(Buffer.from(image.data,'base64')).digest('hex');
      assert.equal(viewed.value.answerImage.uri,`pero-image://${sha}`);
      if(output){writeFileSync(`${output}.png`,Buffer.from(image.data,'base64'));writeFileSync(`${output}.json`,JSON.stringify({fixture:true,paperId,figure,image:viewed.value},null,2));}
      const markdown = option('legacy') === 'true' ? `图 5 消融实验 ![Source image](${viewed.value.answerImage.uri}) ${figure.caption}` : viewed.value.answerImage.markdown;
      update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:`界面链路验证：以下图片来自当前论文已保存的源码文件。\n\n${markdown}\n\n${figure.caption}\n\n来源：${figure.texPath} 第 ${figure.startLine}–${figure.endLine} 行，${figure.members[0].path}。此处未调用模型或复现实验。`}});
      send({id:request.id,result:{stopReason:'end_turn'}});
    } else if(request.id!==undefined)send({id:request.id,result:{}});
  } catch(error) {send({id:request.id,error:{code:-32603,message:String(error)}});}
});
