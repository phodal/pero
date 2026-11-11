import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rename,rm,rmdir} from 'node:fs/promises';
import {request} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {App} from '@modelcontextprotocol/ext-apps';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {McpHost} from './mcp-host.ts';
import {McpSources} from './mcp-sources.ts';
import {startMcpFixture} from '../../../tests/fixtures/mcp-app/server.ts';

async function configFixture(t:TestContext) {
  const home = await mkdtemp(join(tmpdir(), 'pero-mcp-config-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  const file = join(home, 'servers.json');
  const sources = new McpSources(file);
  const save = (id:string, title:string) => sources.command({
    action:'configure', config:{id, title, transport:'http', url:'http://example.invalid', header_env:{}},
  });
  const reload = async () => {
    const fresh = new McpSources(file);
    await fresh.load();
    return fresh.list();
  };
  return {file, sources, save, reload};
}

test('a rejected server edit stays out of the live catalog and subsequent saves', async t => {
  const {file, sources, save, reload} = await configFixture(t);
  await save('a', 'Original');
  const original = sources.list();

  // A directory at the destination makes file replacement fail even when tests run as root.
  const backup = file + '.saved';
  await rename(file, backup);
  await mkdir(file);
  await assert.rejects(save('a', 'Rejected edit'));
  await rmdir(file);
  await rename(backup, file);

  assert.deepEqual(sources.list(), original);
  await save('b', 'Other server');
  assert.deepEqual((await reload()).map(({id, title}) => [id, title]), [['a', 'Original'], ['b', 'Other server']]);
});

test('overlapping server saves both survive reload', async t => {
  const {save, reload} = await configFixture(t);
  await Promise.all([save('a', 'First'), save('b', 'Second')]);
  const entries = (await reload()).map(({id, title}) => [id, title]);
  assert.deepEqual(Object.fromEntries(entries), {a:'First', b:'Second'});
});

test('panel request bytes preserve Unicode and enforce the body limit', async t => {
  const title = '数值实验🧪';
  const command = Buffer.from(JSON.stringify({
    action:'configure',
    config:{id:'unicode', title, transport:'http', url:'http://example.invalid', header_env:{}},
  }));
  for (const scenario of [
    {name:'complete request'},
    {name:'split after first Chinese byte', character:'数'},
    {name:'split after first emoji byte', character:'🧪'},
    {name:'exact byte limit', size:16_000_000},
    {name:'one byte over limit', size:16_000_001},
  ]) await t.test(scenario.name, async t => {
    const home = await mkdtemp(join(tmpdir(), 'pero-mcp-body-'));
    const file = join(home, 'servers.json');
    const host = new McpHost(file, home);
    t.after(async () => { await host.close(); await rm(home, {recursive:true, force:true}); });
    await host.start();
    const panel = new URL(host.open('unicode-test'));
    // JSON whitespace lets the same valid command exercise the exact wire-byte boundary.
    const body = scenario.size ? Buffer.alloc(scenario.size, ' ') : Buffer.from(command);
    command.copy(body);
    const split = scenario.character ? body.indexOf(Buffer.from(scenario.character)) + 1 : 0;
    let firstReadBytes = 0;
    const result = await new Promise<{status:number|undefined; text:string}>((resolve, reject) => {
      const req = request(new URL('/api', panel), {
        method:'POST',
        headers:{Origin:panel.origin, Authorization:`Bearer ${panel.searchParams.get('token')}`,
          'Content-Type':'application/json', 'Content-Length':body.length},
      }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status:res.statusCode, text}));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Panel request timed out')));
      t.after(() => req.destroy());
      if (split) {
        // Observe the real server read before sending the rest; TCP cannot coalesce the split.
        host['panel']!.once('request', incoming => incoming.once('data', chunk => {
          firstReadBytes = chunk.length;
          req.end(body.subarray(split));
        }));
        req.write(body.subarray(0, split));
      } else req.end(body);
    });
    assert.equal(firstReadBytes, split);
    if (scenario.size === 16_000_001) {
      assert.equal(result.status, 400);
      assert.deepEqual(JSON.parse(result.text), {error:'MCP source request exceeds limit'});
      assert.deepEqual(host.sources.list(), []);
      await assert.rejects(readFile(file), {code:'ENOENT'});
    } else {
      assert.equal(result.status, 200);
      assert.equal(JSON.parse(result.text)[0].title, title);
      assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].title, title);
    }
  });
});

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
