import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {App} from '@modelcontextprotocol/ext-apps';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {McpHost} from './mcp-host.ts';
import {startMcpFixture} from '../../../tests/fixtures/mcp-app/server.ts';

test('real MCP transport, scoped resource, official App handshake and interactive tools close together',async()=>{
  const home=await mkdtemp(join(tmpdir(),'pero-mcp-app-'));
  const secret='fixture-host-credential';process.env.PERO_MCP_TEST_KEY=`Bearer ${secret}`;
  const fixture=await startMcpFixture({authorization:`Bearer ${secret}`});
  const host=new McpHost(join(home,'servers.json'),resolve('desktop/dist'));
  let app:App|undefined,bridge:AppBridge|undefined;
  try {
    await host.start();const panel=new URL(host.open('thread-one'));
    const command=async<T=unknown>(value:object,url=panel):Promise<T>=>{
      const response=await fetch(new URL('/api',url),{method:'POST',headers:{Origin:url.origin,Authorization:`Bearer ${url.searchParams.get('token')}`,'Content-Type':'application/json'},body:JSON.stringify(value)});
      const data=await response.json();if(!response.ok)throw new Error(data.error);return data as T;
    };
    await command({action:'configure',config:{id:'fixture',title:'Fixture',transport:'http',url:fixture.endpoint,header_env:{Authorization:'PERO_MCP_TEST_KEY'}}});
    await command({action:'connect',server:'fixture'});
    const view=await command<{binding:{id:string;resource_uri:string};input:Record<string,unknown>;result:CallToolResult;sandbox:string}>({action:'execute',server:'fixture',thread_id:'thread-one',tool:'show',arguments:{label:'original result'}});
    assert.equal(view.binding.resource_uri,'ui://fixture/view');assert.equal(view.result._meta?.view_only,'retained');
    assert.ok(!JSON.stringify(view).includes(secret));
    const sandbox=await fetch(view.sandbox);assert.equal(sandbox.status,200);assert.notEqual(new URL(view.sandbox).origin,panel.origin);
    const resource=await fetch(new URL(`/resource?binding=${view.binding.id}`,view.sandbox));
    assert.match(resource.headers.get('content-security-policy')!,/connect-src 'none'/);
    assert.match(resource.headers.get('content-security-policy')!,/frame-src 'none'/);
    const other=new URL(host.open('thread-two'));
    await assert.rejects(command({action:'tool',binding:view.binding.id,name:'increment',arguments:{by:99}},other),/outside/);
    await assert.rejects(command({action:'tool',binding:view.binding.id,name:'model_only',arguments:{}}),/not available/);
    await assert.rejects(command({action:'resource',binding:view.binding.id,uri:'ui://other/view'}),/outside/);
    const [hostTransport,appTransport]=InMemoryTransport.createLinkedPair();
    bridge=new AppBridge(null,{name:'Pero test Host',version:'1.0.0'},{serverTools:{}},{hostContext:{theme:'light',locale:'en',displayMode:'inline',availableDisplayModes:['inline'],platform:'desktop'}});
    bridge.oncalltool=params=>command<CallToolResult>({action:'tool',binding:view.binding.id,name:params.name,arguments:params.arguments||{}});
    app=new App({name:'Real MCP fixture App',version:'1.0.0'},{},{autoResize:false});
    let resolveInitialized!:()=>void;const initialized=new Promise<void>(resolve=>{resolveInitialized=resolve;});bridge.oninitialized=resolveInitialized;
    let resolveInput!:(value:unknown)=>void,resolveResult!:(value:unknown)=>void;
    const input=new Promise(resolve=>{resolveInput=resolve;}),result=new Promise(resolve=>{resolveResult=resolve;});
    app.ontoolinput=value=>resolveInput(value.arguments);app.ontoolresult=resolveResult;
    await bridge.connect(hostTransport);await app.connect(appTransport);await initialized;
    await bridge.sendToolInput({arguments:view.input});await bridge.sendToolResult(view.result);
    assert.deepEqual(await input,{label:'original result'});assert.deepEqual(await result,view.result);
    const interactive=await app.callServerTool({name:'increment',arguments:{by:2}});
    assert.equal(interactive.structuredContent?.counter,2);assert.equal(fixture.counter,2);
    let teardown=false;app.onteardown=async()=>{teardown=true;return {};};
    await bridge.teardownResource({});assert.equal(teardown,true);
    await command({action:'close',binding:view.binding.id});
    await assert.rejects(command({action:'tool',binding:view.binding.id,name:'increment',arguments:{by:2}}),/closed/);
  } finally {
    await bridge?.close();await app?.close();await host.close();await fixture.close();await rm(home,{recursive:true,force:true});delete process.env.PERO_MCP_TEST_KEY;
  }
});
