import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {McpHost} from './mcp-host.ts';
import {McpSessionSources,type McpResourceSelection} from './mcp-session-sources.ts';
import {McpSessionRpc,type McpSessionRequest,type McpSessionCall} from './mcp-session-rpc.ts';
const scope={thread_id:'thread-one',incarnation:3,revision:7};
const tool={name:'show',inputSchema:{type:'object' as const},_meta:{ui:{resourceUri:'ui://fixture/view'}}};
const resource={contents:[{uri:'ui://fixture/view',mimeType:'text/html;profile=mcp-app',text:'<p>session App</p>'}]};

test('session RPC correlates authority, preserves denial, and rejects pending calls on closure',async()=>{
  const sent:McpSessionRequest[]=[];const rpc=new McpSessionRpc(request=>sent.push(request));
  const first=rpc.request(scope,{action:'list'});
  assert.equal(rpc.accept({kind:'mcp_session',request_id:sent[0].request_id,thread_id:'another',data:{...scope,result:'wrong'}}),true);
  const reply=(request:McpSessionRequest,kind:string,data:object)=>({kind,request_id:request.request_id,thread_id:request.thread_id,data:{incarnation:request.incarnation,revision:request.revision,...data}});
  rpc.accept(reply(sent[0],'mcp_session',{result:{servers:[]}}));assert.deepEqual(await first,{servers:[]});
  const denied=rpc.request(scope,{action:'tool',binding:'opaque',name:'write',arguments:{}});
  rpc.accept(reply(sent[1],'mcp_session_error',{reason:'denied'}));await assert.rejects(denied,/denied/);
  const pending=rpc.request(scope,{action:'read',server:'same',generation:1,uri:'note://one'});
  rpc.forgetThread(scope.thread_id);await assert.rejects(pending,/closed/);assert.equal(sent.length,3);
  assert.equal(rpc.accept(reply({...sent[0],request_id:'unowned'},'mcp_session',{result:{}})),false);rpc.close();
});

test('managed panel uses only session RPC, scopes resources and Apps, and retains policy failures',async()=>{
  const calls:McpSessionCall[]=[],selected:McpResourceSelection[]=[];
  let contents:unknown[]=[{uri:'note://one',text:'Untrusted resource'}];
  const sources=new McpSessionSources(scope,async(received,call)=>{
    assert.deepEqual(received,scope);calls.push(call);
    switch(call.action){
      case 'list':return {servers:[{name:'same',generation:2,connected:true,tools:[tool,{...tool,name:'model-only',_meta:{ui:{resourceUri:'ui://fixture/view',visibility:['model']}}}]}]};
      case 'prepare':return {binding:'agent-binding',resource};
      case 'tool':if(call.name==='show')return {content:[{type:'text',text:'result'}]};throw new Error('MCP session request failed: denied');
      case 'resources':return {resources:[{uri:'note://one',name:'One'}]};
      case 'read':return {contents};
      case 'close':return {};
      default:throw new Error('Unexpected call');
    }
  },undefined,selection=>selected.push(selection));
  const host=new McpHost('',resolve('desktop/dist'),undefined,undefined,sources);
  try{
    await host.start();const panel=new URL(host.open(scope.thread_id));assert.equal(panel.searchParams.get('mode'),'session');
    const command=async(value:object,origin=panel.origin,token=panel.searchParams.get('token'))=>{
      const response=await fetch(new URL('/api',panel),{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(value)});
      const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
    };
    const servers=await command({action:'list'});assert.equal(servers[0].managed,true);assert.equal(servers[0].generation,2);assert.deepEqual(servers[0].tools.map((tool:{name:string})=>tool.name),['show']);
    const before=calls.length;
    await assert.rejects(command({action:'connect',server:'same'}),/settings/);
    await assert.rejects(command({action:'configure',config:{id:'x',title:'X',transport:'http',url:'https://example.com'}}),/settings/);
    assert.equal(calls.length,before);
    await assert.rejects(command({action:'resources',server:'same',generation:1}),/stale/);
    await assert.rejects(command({action:'list'},'https://untrusted.example'),/unavailable/);
    await assert.rejects(command({action:'list'},panel.origin,'wrong-token'),/unavailable/);
    assert.equal((await command({action:'resources',server:'same',generation:2})).resources[0].uri,'note://one');
    assert.equal((await command({action:'read',server:'same',generation:2,uri:'note://one'})).contents[0].text,'Untrusted resource');
    const reads=calls.filter(call=>call.action==='read').length;
    await command({action:'attach_resource',server:'same',generation:2,uri:'note://one'});
    assert.equal(calls.filter(call=>call.action==='read').length,reads+1);
    assert.deepEqual(selected,[{...scope,server:'same',generation:2,uri:'note://one',contents}]);
    await assert.rejects(command({action:'attach_resource',server:'same',generation:2,uri:'note://one',contents:[{text:'injected'}]}));
    contents=[{uri:'note://one',blob:'eA=='}];await assert.rejects(command({action:'attach_resource',server:'same',generation:2,uri:'note://one'}),/text resources only/);
    contents=[{uri:'note://one',text:'Mixed',blob:'eA=='}];await assert.rejects(command({action:'attach_resource',server:'same',generation:2,uri:'note://one'}),/text resources only/);
    contents=[{uri:'note://one',text:'\0'}];await assert.rejects(command({action:'attach_resource',server:'same',generation:2,uri:'note://one'}),/text resources only/);
    contents=Array.from({length:17},()=>({uri:'note://one',text:'x'}));await assert.rejects(command({action:'attach_resource',server:'same',generation:2,uri:'note://one'}),/text resources only/);
    contents=[{uri:'note://one',text:'文'.repeat(30_000)}];await assert.rejects(command({action:'attach_resource',server:'same',generation:2,uri:'note://one'}),/64 KB/);
    assert.equal(selected.length,1);
    await assert.rejects(command({action:'execute',server:'same',generation:2,thread_id:'another',tool:'show',arguments:{}}),/outside/);
    const view=await command({action:'execute',server:'same',generation:2,thread_id:scope.thread_id,tool:'show',arguments:{},operation:'open-main'});
    assert.notEqual(view.binding.id,'agent-binding');assert.equal(JSON.stringify(view).includes('agent-binding'),false);
    assert.notEqual(new URL(view.sandbox).origin,panel.origin);
    await assert.rejects(command({action:'resource',binding:view.binding.id,uri:'ui://other'}),/outside/);
    const count=calls.length;
    await assert.rejects(command({action:'tool',binding:view.binding.id,name:'write',arguments:{}}),/denied/);
    assert.equal(calls.length,count+1);assert.deepEqual(calls.at(-1),{action:'tool',binding:'agent-binding',name:'write',arguments:{}});
    sources.observeServers([{server:'same',generation:3,status:'connected'}]);
    await assert.rejects(command({action:'tool',binding:view.binding.id,name:'write',arguments:{}}),/closed/);
    assert.equal((await fetch(view.sandbox)).status,400);
    host.forgetThread(scope.thread_id);await assert.rejects(command({action:'list'}),/unavailable/);
  }finally{await host.close();}
});

test('Native sidecar completes managed requests over duplex stdio and keeps standalone independent',{timeout:15_000},async()=>{
  const {spawn}=await import('node:child_process');
  const {createInterface}=await import('node:readline');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const directory=await mkdtemp(join(tmpdir(),'pero-session-provider-'));
  const child=spawn(process.execPath,[resolve('desktop/dist/mcp-provider.cjs'),'--stdio','--config',join(directory,'standalone.json')],{stdio:['pipe','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const messages:any[]=[],waiters=new Set<()=>void>();
  const write=(value:object)=>child.stdin.write(JSON.stringify(value)+'\n');
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    const event=JSON.parse(line);messages.push(event);
    if(event.kind==='mcp_session_request'){
      const request=event.request;assert.equal(request.thread_id,scope.thread_id);assert.equal(request.incarnation,scope.incarnation);
      const result=request.action==='list'?{servers:[{name:'same',generation:2,connected:true,tools:[tool]}]}:
        request.action==='read'?{contents:[{uri:request.uri,text:'Sidecar resource'}]}:{resources:[]};
      write({action:'session_result',event:{kind:'mcp_session',request_id:request.request_id,thread_id:request.thread_id,data:{incarnation:request.incarnation,revision:request.revision,result}}});
    }
    for(const waiter of waiters)waiter();
  });
  const waitFor=(predicate:(event:any)=>boolean)=>new Promise<any>((resolveWait,reject)=>{
    const check=()=>{const found=messages.find(predicate);if(found){clearTimeout(timer);waiters.delete(check);resolveWait(found);}};
    const timer=setTimeout(()=>{waiters.delete(check);reject(new Error(`Provider did not respond: ${stderr}`));},5000);waiters.add(check);check();
  });
  try{
    await waitFor(event=>event.kind==='mcp_ready');
    write({action:'open',request_id:'managed',thread_id:scope.thread_id,mode:'session',session:scope});
    const opened=await waitFor(event=>event.kind==='mcp_sources'&&event.request_id==='managed');
    const url=new URL(opened.data.url);assert.equal(url.searchParams.get('mode'),'session');
    const api=async(value:object)=>fetch(new URL('/api',url),{method:'POST',headers:{Origin:url.origin,Authorization:`Bearer ${url.searchParams.get('token')}`,'Content-Type':'application/json'},body:JSON.stringify(value)});
    assert.equal((await api({action:'list'})).status,200);
    assert.equal((await api({action:'attach_resource',server:'same',generation:2,uri:'note://one'})).status,200);
    const selected=await waitFor(event=>event.kind==='mcp_resource_selected');assert.equal(selected.thread_id,scope.thread_id);assert.equal(selected.data.contents[0].text,'Sidecar resource');
    write({action:'open',request_id:'independent',mode:'standalone'});
    const independent=await waitFor(event=>event.kind==='mcp_sources'&&event.request_id==='independent');assert.equal(new URL(independent.data.url).searchParams.get('mode'),'standalone');
    write({action:'forget_thread',thread_id:scope.thread_id});
    // A following standalone open is an observable input barrier; no arbitrary sleep.
    write({action:'open',request_id:'after-forget',mode:'standalone'});await waitFor(event=>event.kind==='mcp_sources'&&event.request_id==='after-forget');
    const closed=await api({action:'list'}).catch(()=>undefined);assert.ok(!closed||closed.status===400);
  }finally{
    if(child.exitCode===null){const exited=new Promise<void>(resolveExit=>child.once('exit',()=>resolveExit()));const timer=setTimeout(()=>child.kill('SIGKILL'),3000);write({action:'shutdown'});await exited;clearTimeout(timer);}
    lines.close();await rm(directory,{recursive:true,force:true});
  }
});

test('closing an App while preparing or awaiting approval cannot start or replay its business tool',async()=>{
  for(const phase of ['prepare','approval']){
    let releasePrepare!:(value:unknown)=>void,releaseTool!:(value:unknown)=>void;
    let observed!:(value:void)=>void;const ready=new Promise<void>(resolve=>{observed=resolve;});
    const calls:McpSessionCall[]=[];
    const sources=new McpSessionSources(scope,async(_,call)=>{
      calls.push(call);
      if(call.action==='list')return {servers:[{name:'same',generation:2,connected:true,tools:[tool]}]};
      if(call.action==='prepare'){
        if(phase==='prepare'){observed();return new Promise(resolve=>{releasePrepare=resolve;});}
        return {binding:'pending-binding',resource};
      }
      if(call.action==='tool'){observed();return new Promise(resolve=>{releaseTool=resolve;});}
      if(call.action==='close'){if(releaseTool)releaseTool({content:[],isError:true});return {};}
      throw new Error('Unexpected command');
    });
    await sources.list();
    const opening=sources.command({action:'execute',server:'same',generation:2,thread_id:scope.thread_id,tool:'show',arguments:{},operation:'pending'});
    const rejected=assert.rejects(opening,/cancelled/);
    await ready;await sources.command({action:'cancel_open',operation:'pending'});
    if(phase==='prepare')releasePrepare({binding:'pending-binding',resource});
    await rejected;
    assert.equal(calls.filter(call=>call.action==='tool').length,phase==='prepare'?0:1);
    assert(calls.some(call=>call.action==='close'&&call.binding==='pending-binding'));
    await sources.close();
  }
});

test('invalid App resource or CSP closes its prepared binding before any tool call',async()=>{
  for(const contents of [
    null,
    [{uri:'ui://other',mimeType:'text/html;profile=mcp-app',text:'wrong resource'}],
    [{uri:'ui://fixture/view',mimeType:'text/plain',text:'not an App'}],
    [{uri:'ui://fixture/view',mimeType:'text/html;profile=mcp-app',text:'bad policy',_meta:{ui:{csp:{connectDomains:['https://example.com/;script-src *']}}}}],
  ]){
    const calls:McpSessionCall[]=[];
    const sources=new McpSessionSources(scope,async(_,call)=>{
      calls.push(call);if(call.action==='list')return {servers:[{name:'same',generation:2,connected:true,tools:[tool]}]};
      if(call.action==='prepare')return {binding:'invalid-view',resource:{contents}};
      if(call.action==='close')return {};
      throw new Error('Business tool must not run');
    });
    await sources.list();await assert.rejects(sources.command({action:'execute',server:'same',generation:2,thread_id:scope.thread_id,tool:'show',arguments:{},operation:'invalid'}));
    assert.equal(calls.filter(call=>call.action==='tool').length,0);assert.equal(calls.filter(call=>call.action==='close'&&call.binding==='invalid-view').length,1);await sources.close();
  }
});

test('an invalid original result revokes its adopted binding without executing a tool',async()=>{
  const calls:McpSessionCall[]=[];
  const sources=new McpSessionSources(scope,async(_,call)=>{
    calls.push(call);
    if(call.action==='list')return {servers:[{name:'same',generation:2,connected:true,tools:[tool]}]};
    if(call.action==='adopt')return {binding:'invalid-original',resource,input:{},result:{content:null},tool:'show',resource_uri:'ui://fixture/view'};
    if(call.action==='close')return {};
    throw new Error('Original result adoption cannot execute tools');
  });
  await sources.list();
  await assert.rejects(sources.command({action:'adopt',server:'same',generation:2,tool_call:'actual-call',operation:'invalid-original'}));
  assert.deepEqual(calls.map(call=>call.action),['list','adopt','close']);await sources.close();
});

test('conversation views reuse the original call on mount and reopen; only live bindings can send messages',async()=>{
  const calls:McpSessionCall[]=[],messages:{scope:typeof scope;text:string}[]=[];
  const original={content:[{type:'text' as const,text:'original'}],structuredContent:{time:'original-time'},_meta:{private:'retained'}};
  const sources=new McpSessionSources(scope,async(_,call)=>{
    calls.push(call);
    if(call.action==='list')return {servers:[{name:'same',generation:2,connected:true,tools:[tool]}]};
    if(call.action==='adopt')return {binding:`remote-${calls.length}`,resource,input:{revision:4},result:original,tool:'show',resource_uri:'ui://fixture/view'};
    if(call.action==='close')return {};
    throw new Error('Opening a recorded view must not execute a tool');
  },undefined,undefined,async(scope,text)=>{messages.push({scope,text});});
  await sources.list();
  const adopt=()=>sources.command({action:'adopt',server:'same',generation:2,tool_call:'actual-call',operation:'mount'}) as Promise<any>;
  const first=await adopt();
  assert.equal(first.binding.tool_call,'actual-call');assert.deepEqual(first.input,{revision:4});assert.deepEqual(first.result,original);
  await sources.command({action:'message',binding:first.binding.id,text:'Follow up from the App'});
  assert.deepEqual(messages,[{scope,text:'Follow up from the App'}]);
  await sources.command({action:'close',binding:first.binding.id});
  await assert.rejects(sources.command({action:'message',binding:first.binding.id,text:'closed'}),/closed/);
  const reopened=await adopt();assert.deepEqual(reopened.result,original);assert.equal(reopened.binding.tool_call,first.binding.tool_call);
  assert.equal(calls.filter(call=>call.action==='tool'||call.action==='prepare').length,0);
  sources.observeServers([{server:'same',generation:3,status:'connected'}]);
  await assert.rejects(sources.command({action:'message',binding:reopened.binding.id,text:'stale'}),/closed/);
  assert.equal(messages.length,1);await sources.close();
});
