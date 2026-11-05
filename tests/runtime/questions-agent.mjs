// Structured-input ACP peer. No model, network, workspace or service access.
import readline from 'node:readline';
const scenario = process.env.PERO_QUESTIONS_SCENARIO || '';
let advertised = false;
let active;
let prompt = '';
let next = 100;
const pending = new Map();
const send = message => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...message})+'\n');
const reply = (id,result) => send({id,result});
const update = data => send({method:'session/update',params:{sessionId:'question-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(data)}}}});
const finish = reason => { if(active!==undefined){reply(active,{stopReason:reason});active=undefined;} };
function ask(kind='normal', tool='question-call', session='question-session') {
  const id=next++;
  pending.set(id,{kind,tool});
  send({id,method:'_pero/user_questions/ask',params:{sessionId:session,toolCallId:tool,questions:[
    {question:'Language?',header:'Language',options:[{label:'Go',description:'Harness'},{label:'Rust',description:'Host'}],multiSelect:false},
    {question:'Checks?',header:'Checks',options:[{label:'Tests',description:'Behavior'},{label:'Vet',description:'Analysis'}],multiSelect:true},
  ]}});
  return id;
}
readline.createInterface({input:process.stdin}).on('line',line=>{
  const {id,method,params,result,error}=JSON.parse(line);
  if(method==='initialize') {
    advertised=params.clientCapabilities?._meta?.['pero.userQuestions']===1;
    const revision=scenario==='unnegotiated'?undefined:scenario==='wrong-revision'?2:1;
    reply(id,{protocolVersion:1,agentCapabilities:{loadSession:true,mcpCapabilities:{http:true},...(revision?{_meta:{'pero.userQuestions':revision}}:{})},authMethods:[]});
  } else if(method==='session/new'||method==='session/load') {
    if(scenario==='before-bind') ask('before-bind');
    reply(id,{sessionId:'question-session'});
  } else if(method==='session/prompt') {
    active=id;prompt=params.prompt[0].text;
    if(prompt==='plain'){update({advertised});finish('end_turn');return;}
    if(prompt==='wrong-session'){ask('normal','question-call','different-session');return;}
    if(prompt==='fifo'){ask('fifo','first-call');ask('fifo','second-call');return;}
    const requestId=ask();
    if(prompt==='duplicate')ask('duplicate');
    if(prompt==='cancel-notification') {
      const notice={method:'_pero/user_questions/cancel',params:{sessionId:'question-session',toolCallId:'question-call'}};
      send(notice);send(notice);
    }
    if(prompt==='standard-cancel')send({method:'$/cancel_request',params:{requestId}});
    if(prompt==='peer-exit')process.stdout.write('',()=>process.exit(3));
  } else if(method==='session/cancel') {
    finish('cancelled');
  } else if(pending.has(id)) {
    const {kind,tool}=pending.get(id);pending.delete(id);
    update({kind,tool,advertised,result,error});
    if(kind==='before-bind'||kind==='duplicate')return;
    if(prompt==='cancel'||prompt==='close')return;
    if(kind==='fifo'&&pending.size)return;
    finish('end_turn');
  } else if(id!==undefined) {
    send({id,error:{code:-32601,message:'Unknown fixture method'}});
  }
});
