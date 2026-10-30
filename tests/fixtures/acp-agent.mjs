import readline from 'node:readline';
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
let turn = 0;
let active;
let permission;
let timer;
let workspace;
const composerFixture = process.argv.includes('--composer');
const capturePath = process.argv.find(arg => arg.startsWith('--capture='))?.slice('--capture='.length);
const settings = { mode: 'write', effort: 'medium', approval: 'ask' };
const configs = () => [
 {id:'model',name:'Model',category:'model',type:'select',currentValue:'fixture',options:[{value:'fixture',name:'Fixture'}]},
 ...(composerFixture ? [
  {id:'mode',name:'Mode',category:'mode',type:'select',currentValue:settings.mode,options:[{value:'write',name:'Write'},{value:'ask',name:'Ask'},{value:'minimal',name:'Minimal'}]},
  {id:'effort',name:'Thinking effort',category:'thought_level',type:'select',currentValue:settings.effort,options:[{value:'none',name:'Off'},{value:'low',name:'Low'},{value:'medium',name:'Medium'},{value:'high',name:'High'}]},
  {id:'approval',name:'Tool permissions',category:'_permission',type:'select',currentValue:settings.approval,options:[{value:'ask',name:'Ask before tools',description:'Request approval before using tools'},{value:'read',name:'Allow reads',description:'Allow read tools only'}]},
 ] : []),
];
const finish = reason => {
 clearInterval(timer);
 if(active!==undefined){
  if(reason==='end_turn')send({method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'usage_update',used:5000,size:20000,cost:{amount:0.02,currency:'USD'}}}});
  send({id:active,result:{stopReason:reason}});active=undefined;
 }
};
readline.createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line),{id,method,params}=message;
 if (method==='initialize') send({id,result:{protocolVersion:1,agentCapabilities:composerFixture?{promptCapabilities:{image:true,embeddedContext:true}}:{},agentInfo:{name:'test-fixture',version:'1'}}});
 else if(method==='session/new'){
  workspace=params.cwd;send({id,result:{sessionId:'fixture-session',configOptions:configs()}});
  if(composerFixture)send({method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'available_commands_update',availableCommands:[{name:'compact',description:'Compact the conversation',input:{hint:'instructions'}}]}}});
 }
 else if(method==='session/set_config_option'){
  if(composerFixture){settings[params.configId]=params.value;send({id,result:{configOptions:configs()}});}
  else send({id,result:{configOptions:[]}});
 }
 else if(method==='session/prompt'){
  active=id;turn++;
  if(composerFixture && capturePath)appendFileSync(capturePath,JSON.stringify(params.prompt)+'\n');
  const text=params.prompt[0].text;
  const notify=update=>send({method:'session/update',params:{sessionId:'fixture-session',update}});
  // Explicit contribution acceptance uses real file/Git effects in a disposable
  // checkout. Ordinary presentation fixtures below still perform no I/O.
  if(text.includes('contribution-fixture')){
   const path=resolve(workspace,'CONTRIBUTOR.md');
   const contents='# Contributor workflow\n\nPrepared in the task checkout by the ACP fixture.\n';
   writeFileSync(path,contents);
   notify({sessionUpdate:'tool_call',toolCallId:'contribution-edit',title:'Write CONTRIBUTOR.md',kind:'edit',status:'completed',locations:[{path}],content:[{type:'diff',path,oldText:'',newText:contents}]});
   notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Created CONTRIBUTOR.md in the prepared checkout. Ready for review.'}});
   finish('end_turn');return;
  }
  if(text.includes('toolmatrix')){
   const key=name=>`matrix-${name}-${turn}`;
   const content=text=>({type:'content',content:{type:'text',text}});
   const call=(name,title,kind,extra={})=>notify({sessionUpdate:'tool_call',toolCallId:key(name),title,kind,status:'pending',...extra});
   const change=(name,status,extra={})=>notify({sessionUpdate:'tool_call_update',toolCallId:key(name),status,...extra});
   const file='/workspace/fixture/src/fixture.rs';
   notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Inspecting the tool presentation fixture. No commands, file writes or network requests will run.\n\n'}});
   // Keep these adjacent to exercise a single compact read/search/fetch group.
   call('read','Read src/fixture.rs','read',{locations:[{path:file,line:1}],rawInput:{path:file}});
   call('search','Search for retry policies','search',{rawInput:{pattern:'retry|timeout',path:'/workspace/fixture/src'}});
   call('fetch','Read ACP tool-call documentation','fetch',{rawInput:{url:'https://agentclientprotocol.com/protocol/tool-calls'}});
   const phases=[
    ()=>change('read','in_progress'),
    ()=>change('read','completed',{content:[content('Fixture source loaded: 28 lines. No file was read.')] ,rawOutput:{lineCount:28}}),
    ()=>change('search','in_progress'),
    ()=>{change('search','completed',{content:[content('Fixture search: 3 matches in 2 files. No search was executed.')]});change('fetch','in_progress');},
    ()=>{change('fetch','completed',{content:[content('Fixture documentation excerpt: pending → in_progress → completed or failed. No URL was fetched.')]});call('execute','Run fixture unit tests','execute',{rawInput:{command:'cargo test -p fixture',cwd:'/workspace/fixture'}});},
    ()=>change('execute','in_progress',{content:[{type:'terminal',terminalId:`fixture-terminal-${turn}`,_meta:{fixtureOnly:true}},content('Fixture terminal: running 3 tests… (no process launched)')]}),
    ()=>{change('execute','completed',{content:[{type:'terminal',terminalId:`fixture-terminal-${turn}`,_meta:{fixtureOnly:true}},content('Fixture terminal: 3 passed; 0 failed. No process was launched.')],rawOutput:{exitCode:0}});call('edit','Update src/fixture.rs','edit',{locations:[{path:file,line:2}]});},
    ()=>change('edit','in_progress',{content:[{type:'diff',path:file,oldText:'pub fn retry_limit() -> u32 {\n    2\n}\n',newText:'pub fn retry_limit() -> u32 {\n    3\n}\n'}]}),
    ()=>{change('edit','completed');call('think','Review fixture coverage','think');},
    ()=>change('think','in_progress'),
    ()=>{change('think','completed',{content:[content('Fixture coverage review completed.')]});call('other','Inspect custom provider metadata','vendor_future_tool',{name:'fixture.future_variant',_meta:{fixtureOnly:true,variant:'future-tool-kind'}});},
    ()=>change('other','in_progress'),
    ()=>{change('other','completed',{content:[content('Fixture custom tool completed. Unknown kinds must retain a generic compact row.')]});call('failed','Verify fixture endpoint','execute',{rawInput:{command:'fixture-check --expected-status 200'}});},
    ()=>change('failed','in_progress'),
    ()=>{change('failed','failed',{content:[content('Fixture verification failed: expected status 200, received 503. No command was executed.')],rawOutput:{exitCode:1,error:'Unexpected fixture status 503'}});call('cancelled','Canceled fixture command','execute');},
    ()=>change('cancelled','in_progress'),
    // ACP v1 has no cancelled status; use a valid failure plus explicit metadata.
    ()=>change('cancelled','failed',{content:[],rawOutput:{cancelled:true},_meta:{cancelled:true,fixtureOnly:true}}),
    ()=>{notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Tool matrix complete: read/search/fetch, execution, edit diff, review, custom fallback, a visible failure and a canceled empty operation. All results above are simulated fixture data.'}});finish('end_turn');},
   ];
   let phase=0;timer=setInterval(()=>phases[phase++](),350);return;
  }
  if(text.includes('contentview')){
   const path=process.argv.find(arg=>arg.startsWith('--content-file='))?.slice('--content-file='.length);
   const source=readFileSync(path,'utf8');
   notify({sessionUpdate:'tool_call',toolCallId:`content-${turn}`,title:process.argv.find(arg=>arg.startsWith('--content-title='))?.slice('--content-title='.length)||'Structured result',kind:'other',status:'completed',content:[{type:'content',content:{type:'text',text:source}}]});
   notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Result ready.'}});
   finish('end_turn');return;
  }
  if(text.includes('longstream')){
   let i=0;timer=setInterval(()=>{notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:`中文片段${i} `}});if(++i===1000)finish('end_turn');},2);return;
  }
  if(text.includes('permission')){permission=900;send({id:permission,method:'session/request_permission',params:{sessionId:'fixture-session',toolCall:{toolCallId:'tool-1',title:'Read test fixture',status:'pending'},options:[{optionId:'allow',name:'Allow once',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}});return;}
  if(text.includes('wait'))return;
  notify({sessionUpdate:'tool_call',toolCallId:`tool-${turn}`,title:'Read project context',kind:'read',status:'in_progress'});
  notify({sessionUpdate:'tool_call_update',toolCallId:`tool-${turn}`,status:'completed',content:[{type:'content',content:{type:'text',text:'Project context loaded'}}]});
  notify({sessionUpdate:'tool_call',toolCallId:`search-${turn}`,title:'Search project',kind:'search',status:'completed'});
  notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:`Fixture turn ${turn}: **中文流式回复**\n\n`}});
  setTimeout(()=>{notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'```rust\nprintln!("hello");\n```'}});finish('end_turn');},180);
 }else if(method==='session/cancel')finish('cancelled');
 else if(id===permission){send({method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Permission handled'}}}});finish('end_turn');}
 else if(id!==undefined)send({id,error:{code:-32601,message:'Method not found'}});
});
