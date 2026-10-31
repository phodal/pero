// Deterministic ACP seam only. This is not a real scientific/model result.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const capture=process.argv.find(value=>value.startsWith('--capture='))?.slice(10);
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const reply=(id,result)=>send({id,result});
const sessionId='scientific-acp-fixture';
let active;
createInterface({input:process.stdin}).on('line',line=>{
  const {id,method,params={}}=JSON.parse(line);
  if(!method)return;
  if(capture)appendFileSync(capture,JSON.stringify({method,sessionId:params.sessionId,cwd:params.cwd,...(method==='session/prompt'?{prompt:params.prompt}:{})})+'\n');
  if(method==='initialize')reply(id,{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{embeddedContext:true}},authMethods:[]});
  else if(method==='session/new')reply(id,{sessionId});
  else if(method==='session/load') {if(params.sessionId!==sessionId)throw new Error('Wrong ACP Session resumed');reply(id,{});}
  else if(method==='session/prompt'){
    active=id;
    const text=JSON.stringify(params.prompt);
    if(text.includes('science-wait'))return;
    const evidence=/point-evidence:([a-f0-9]{64})/.exec(text)?.[1];
    const output=JSON.stringify({title:'Synthetic compatibility review',markdown:`# Synthetic compatibility review\n\nThe fixture quotation is preserved [source](point-evidence:${evidence??'0'.repeat(64)}).`});
    // Split a real structured message: the Host must aggregate chunks before
    // projecting Point's assistant/message ledger used to save/export a review.
    for(const part of [output.slice(0,31),output.slice(31)])send({method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:part}}}});
    reply(active,{stopReason:'end_turn'});active=undefined;
  }else if(method==='session/cancel') {if(active!==undefined){reply(active,{stopReason:'cancelled'});active=undefined;}}
  else if(id!==undefined)reply(id,{});
});
