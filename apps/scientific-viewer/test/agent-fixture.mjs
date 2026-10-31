// Synthetic ACP transport only. No model, provider, tools or scientific judgment.
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const capture=process.argv[2];if(!capture)throw new Error('A test-owned capture path is required');
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const {id,method,params}=JSON.parse(line);
 if(method==='initialize')send({id,result:{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true}},agentInfo:{name:'Synthetic evidence review',version:'1'}}});
 else if(method==='session/new')send({id,result:{sessionId:'synthetic-evidence-review',configOptions:[]}});
 else if(method==='session/prompt'){
  appendFileSync(capture,JSON.stringify(params.prompt)+'\n',{mode:0o600});
  const text=params.prompt.filter(item=>item.type==='text').map(item=>item.text).join('\n');
  if(!text.includes('Synthetic scientific evidence.')||!text.includes('Source SHA-256:')||!text.includes('not scientific verification')){send({id,error:{code:-32602,message:'Expected bounded quotation evidence and trust context'}});return;}
  for(const text of ['Synthetic transport review. ','The quotation is present; scientific validity is not assessed.'])send({method:'session/update',params:{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
  send({id,result:{stopReason:'end_turn'}});
 }else if(id!==undefined)send({id,error:{code:-32601,message:`Unsupported fixture method: ${method}`}});
});
