// Real Go Harness -> ACP Host -> shared App Use MCP -> installed backend.
// Default: scripted provider. --real explicitly opts into real model inference.
// App data/dependency service are always synthetic; approval replies use Host API.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseEnv } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '../..');
const real = process.argv.includes('--real');
const decision = process.argv.find(arg => arg.startsWith('--decision='))?.split('=')[1];
assert(!decision || ['allow','reject'].includes(decision));
assert(!real || decision, 'Real validation requires --decision=allow|reject');
const local = real ? parseEnv(await readFile(join(root,'.env'),'utf8').catch(error => { if(error.code==='ENOENT')return '';throw error; })) : {};
const credential = real ? (process.env.DEEPSEEK_API_KEY || local.DEEPSEEK_API_KEY) : 'local-plugin-fixture';
assert(credential, 'Missing provider credential');
const model = real ? 'deepseek-flash' : 'fixture';
const directory = await mkdtemp(join(tmpdir(), 'pero-plugin-harness-'));
const agent = resolve(root, 'target/debug/pero-agent-acp');
const binary = resolve(root, 'target/debug/pero-host');
const events = [], requests = [], dependencyCalls = [], providerErrors = [];
const changed = new EventEmitter();
const instruction = 'APP_PLUGIN_EVIDENCE_POLICY: save exact observations.';
const skill = 'PLUGIN_SKILL_EVIDENCE: preserve the citation identifier.';
let host, desktop, exit, stderr = '', selected, sequence = 0;
const servers = [];
const json = (path, data) => writeFile(path, JSON.stringify(data));
async function listen(handler) {
  const server = createServer(handler); servers.push(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function wait(predicate, after = 0) {
  const deadline = Date.now() + (real ? 180000 : 30000);
  for (;;) {
    const found = events.slice(after).find(predicate); if (found) return found;
    const remaining = deadline - Date.now();
    assert(remaining > 0, `Host timeout: ${stderr}\n${JSON.stringify(events.slice(-4))}`);
    await new Promise((accept, reject) => {
      const listener = () => { clearTimeout(timer); accept(); };
      const timer = setTimeout(() => { changed.off('change', listener); reject(Error(`Host timeout: ${stderr}`)); }, remaining);
      changed.once('change', listener);
    });
  }
}
const send = command => { desktop.command(command); host.stdin.write(JSON.stringify(command) + '\n'); };
async function request(action, fields = {}) {
  const id = `plugin-${++sequence}`;
  host.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
  const event = await wait(event => event.kind === 'apps_result' && event.request_id === id);
  assert(event.data.ok, event.data.error); return event.data.value;
}
async function prompt(thread, text) {
  const after = events.length; send({ action: 'prompt', thread_id: thread, text });
  const result = await wait(event => event.thread_id === thread && ['turn_finished', 'session_error'].includes(event.kind), after);
  assert.equal(result.kind, 'turn_finished', result.text);
  assert.equal(result.data.stopReason, 'end_turn');
}
try {
  // Bundle TS adapters exactly as the Desktop composition does; no Electron UI.
  await build({ stdin: { contents: `export { DesktopAppUse } from './desktop/src/main/app-use-mcp.ts'; export { AppWriteRoutes } from './desktop/src/main/app-write-routes.ts';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: join(directory, 'adapter.mjs') });
  const { DesktopAppUse, AppWriteRoutes } = await import(join(directory, 'adapter.mjs'));
  const dependency = await listen(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture-evidence', version: '1' } };
    else if (message.method === 'tools/list') result = { tools: [{ name: 'lookup', description: 'Read fixture evidence', annotations: {readOnlyHint:true}, inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }] };
    else if (message.method === 'tools/call') {
      dependencyCalls.push(message.params);
      result = { content: [{ type: 'text', text: 'citation:fixture-42' }] };
    } else result = {};
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  const provider = await listen(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw); requests.push(input); assert(requests.length <= 8);
      const text = JSON.stringify(input.messages);
      const ordinary = text.includes('ordinary-check');
      const tools = input.tools.map(tool => tool.function.name);
      if (ordinary) {
        assert(!text.includes(instruction)); assert(!text.includes(skill));
        assert(!tools.includes('mcp__evidence__lookup'));
      } else {
        assert(text.includes(instruction)); assert(text.includes(skill));
        assert(tools.includes('mcp__evidence__lookup'));
      }
      const step = input.messages.filter(message => message.role === 'tool').length;
      if (decision) {
        const done = ordinary || input.messages.some(message => message.role === 'tool' && message.tool_call_id === 'approval-write');
        const call = step === 0 ? ['mcp__evidence__lookup',{id:'fixture-42'},'approval-read'] : ['mcp__pero-app-use__app__sample__save',{observation:'fixture-42'},'approval-write'];
        res.writeHead(200, {'content-type':'text/event-stream'});
        const delta = done ? {content:'fixture verified'} : {tool_calls:[{index:0,id:call[2],type:'function',function:{name:call[0],arguments:JSON.stringify(call[1])}}]};
        res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:done?'stop':'tool_calls'}]})}\n\ndata: [DONE]\n\n`); return;
      }
      const plan = [
        ['mcp__pero-app-use__app_write', { app: 'sample', tool: 'hidden', document: {} }],
        ['mcp__pero-app-use__app__sample__save', { observation: 'fixture-42' }],
        ['mcp__pero-app-use__app_write', { app: 'sample', tool: 'save', document: { observation: 'must-not-write' } }],
        ['mcp__evidence__lookup', { id: 'fixture-42' }],
      ];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const call = ordinary ? undefined : plan[step];
      if (call) {
        assert(tools.includes(call[0]), `Missing Harness tool ${call[0]}`);
        res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `plugin-call-${step}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      } else res.end('data: {"choices":[{"index":0,"delta":{"content":"fixture verified"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    } catch (error) { providerErrors.push(String(error)); res.destroy(); }
  });
  const source = join(directory, 'source');
  await mkdir(join(source, 'dist'), { recursive: true });
  await mkdir(join(source, 'agent-plugins/evidence/skills'), { recursive: true });
  await writeFile(join(source, 'dist/index.html'), '<h1>Plugin Harness fixture</h1>');
  await writeFile(join(source, 'agent-plugins/evidence/skills/SKILL.md'), skill);
  await json(join(source, 'agent-plugins/evidence/plugin.json'), { schemaVersion: 1, name: 'evidence', version: '1', skills: ['skills/SKILL.md'], mcpServers: [{ type: 'http', name: 'evidence', url: dependency + '/mcp', headers: [] }] });
  await writeFile(join(source, 'server.mjs'), `import {createServer} from 'node:http'; import {appendFile} from 'node:fs/promises'; import {join} from 'node:path';
const server=createServer(async(req,res)=>{if(req.headers['x-pero-app-token']!==process.env.PERO_APP_TOKEN){res.writeHead(403).end();return;}let text='';for await(const chunk of req)text+=chunk;await appendFile(join(process.env.PERO_APP_DATA,'saved.jsonl'),text+'\\n');res.setHeader('content-type','application/json');res.end(JSON.stringify({saved:true}));});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`);
  await json(join(source, 'app.json'), { schemaVersion: 1, name: 'sample', version: '1', displayName: 'Harness fixture', permissions: { host: ['agent', 'agent-plugin'] }, requiresAgentPlugins: ['evidence'], backend: { type: 'node', entry: 'server.mjs' }, contributes: {
    panels: [{ id: 'main', title: 'Fixture', entry: 'dist/index.html' }],
    writes: ['save', 'hidden'].map(name => ({ name, description: name, path: '/api/' + name, schema: { type: 'object', properties: { observation: { type: 'string' } } } })),
    agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: instruction, tools: ['save'], maxCalls: 1 },
  } });
  await json(join(directory, 'agents.json'), [{ id: 'harness', name: 'Real Go Harness', command: agent, args: ['--endpoint', real ? 'https://api.deepseek.com/v1' : provider + '/v1', '--model', model, '--session-dir', join(directory, 'sessions'), '--api-key-env', 'PLUGIN_FIXTURE_KEY', '--approval', 'ask', '--max-retries', '0', '--max-requests', '8', '--max-tokens', '2048', ...(real ? ['--use-env-proxy'] : [])], env: {} }]);
  const routes = new AppWriteRoutes(request, () => {}, fetch);
  desktop = new DesktopAppUse({ selectedThread: async () => selected, presence() {}, page: async () => { throw Error('No UI'); }, capture: async () => { throw Error('No capture'); } }, () => {}, join(directory, 'evidence'), routes);
  const endpoint = await desktop.start();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_') && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  host = spawn(binary, ['--stdio'], { cwd: directory, env: { ...env, ...endpoint, PLUGIN_FIXTURE_KEY: credential, PERO_AGENTS_FILE: join(directory, 'agents.json'), PERO_APPS_ROOT: join(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '', PERO_SETTINGS_PATH: join(directory, 'settings.json'), PERO_HISTORY_PATH: join(directory, 'history.jsonl'), UV_OFFLINE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  exit = once(host, 'exit'); host.stderr.on('data', chunk => { stderr += String(chunk).split(credential).join('[REDACTED]'); });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line); desktop.accept(event); events.push(event); changed.emit('change');
    if (event.kind === 'permission') {
      const option = event.data.options.find(option => option.kind === (decision === 'reject' ? 'reject_once' : 'allow_once'));
      assert(option); send({ action: 'permission', thread_id: event.thread_id, request_id: event.data.permission_id, option_id: option.optionId });
    }
  });
  await wait(event => event.kind === 'ready');
  await request('install', { path: source }); await request('enable', { name: 'sample' });
  selected = 'scoped'; send({ action: 'new_session', thread_id: selected, agent_id: 'harness', scope: { app: 'sample', panel: 'main' } });
  await wait(event => event.kind === 'session_ready' && event.thread_id === selected);
  if (decision) {
    const after = events.length; send({action:'configure',thread_id:selected,config_id:'permission',value:'full-access'});
    await wait(event => event.thread_id===selected && event.kind==='configuration_changed',after);
  }
  await prompt(selected, real ? 'This is a synthetic plugin acceptance test. First call mcp__evidence__lookup with id fixture-42. Then call mcp__pero-app-use__app__sample__save with observation exactly fixture-42 once. If approval is denied, report it and stop; never retry or use another tool to write. Finish briefly after the result. Do not use other tools.' : 'Execute the plugin verification fixture.');
  assert.deepEqual(providerErrors, []);
  const saved = await readFile(join(directory,'app-data/sample/saved.jsonl'),'utf8').catch(error => {if(error.code==='ENOENT')return '';throw error;});
  const appWrites = saved.trim() ? saved.trim().split('\n').map(line=>JSON.parse(line)) : [];
  assert.deepEqual(appWrites, decision === 'reject' ? [] : [{ observation: 'fixture-42' }]);
  assert.deepEqual(dependencyCalls, [{ name: 'lookup', arguments: { id: 'fixture-42' } }]);
  if (!real && !decision) {
  const results = requests.at(-1).messages.filter(message => message.role === 'tool').map(message => message.content);
  assert.equal(results.length, 4);
  assert.match(results[0], /no such|unknown|declare/i);
  assert.match(results[1], /saved/);
  assert.match(results[2], /no such|unknown|limit|budget/i);
  assert.match(results[3], /citation:fixture-42/);
  }
  if (decision) {
    const permissions = events.filter(event=>event.kind==='permission');
    assert.equal(permissions.length,1,'One real Agent-originated approval required');
    const updates=events.filter(event=>event.thread_id==='scoped' && event.data?.sessionUpdate==='tool_call_update');
    assert(updates.some(event=>event.data.status === (decision==='reject'?'failed':'completed')));
  }
  if (!decision) assert.equal(events.filter(event=>event.kind==='permission').length,0);
  selected = 'ordinary'; send({ action: 'new_session', thread_id: selected, agent_id: 'harness' });
  await wait(event => event.kind === 'session_ready' && event.thread_id === selected); await prompt(selected, 'ordinary-check');
  await request('pluginenable', { name: 'evidence', enabled: false });
  await wait(event => event.kind === 'session_closed' && event.thread_id === 'scoped');
  assert(!events.some(event => event.kind === 'session_closed' && event.thread_id === 'ordinary'));
  const before = requests.length;
  send({ action: 'new_session', thread_id: 'disabled', agent_id: 'harness', scope: { app: 'sample', panel: 'main' } });
  await wait(event => event.kind === 'session_error' && event.thread_id === 'disabled');
  assert.equal(requests.length, before);
  const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
  const report = { passed: true, mode: real?'real-provider':'scripted-provider', model, decision:decision||'auto-review', source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceState: 'Development worktree; binary hashes identify executed builds', testSHA256: await hash(import.meta.filename), hostSHA256: await hash(binary), harnessSHA256: await hash(agent), providerRequests: real ? null : requests.length, dependencyCalls: dependencyCalls.length, appWrites: appWrites.length, permissionRequests: events.filter(event => event.kind === 'permission').length,
    checks: decision ? ['real dependency MCP lookup','one Agent approval: '+decision,'verified backend effects','ordinary session','disable revocation'] : ['App instructions and dependency Skill reach provider', 'undeclared route refused', 'real backend write', 'generic route shares alias budget', 'dependency MCP executed', 'default auto-review policy', 'ordinary-session isolation', 'disable revokes and prevents remount'], limitations: ['Synthetic App and evidence MCP; no scientific acceptance','Headless Agent-originated approval response; no human UI click acceptance', ...(real?[]:['Scripted loopback model decisions'])] };
  await mkdir(join(root, 'test-results/app-plugin-harness'), { recursive: true });
  await json(join(root, `test-results/app-plugin-harness/${real?'real':decision?'approval':'result'}${decision?'-'+decision:''}.json`), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (host) { host.stdin.end(); const timer = setTimeout(() => host.kill('SIGKILL'), 5000); const [code] = await exit; clearTimeout(timer); assert.equal(code, 0, stderr); }
  await desktop?.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await rm(directory, { recursive: true, force: true });
}
