// Real Host, ACP, Harness and App backend with loopback MCP and model fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { closeLoopback, jsonReply, listenJson, streamCompletion } from '../fixtures/loopback-model.mjs';

const root = resolve(import.meta.dirname, '../..');
const app = 'tool-fixture';
const model = 'tool-loading-fixture';
const appRoute = `app__${app}__save`;
const appTool = `mcp__pero-app-use__${appRoute}`;
const appDescribe = 'mcp__pero-app-use__app_describe';
const optionalServer = 'fixture-tools';
const echo = `mcp__${optionalServer}__echo`;
const other = `mcp__${optionalServer}__summarize`;
const search = 'tool_search';
const loading = 'pero.appToolLoading';
const userInput = 'Save the synthetic observation and check it with the optional fixture echo.';
const observation = 'tool-loading-observation';
const observationSchema = { type: 'object', additionalProperties: false, required: ['observation'],
  properties: { observation: { type: 'string', minLength: 1 } } };
const profileRoot = await realpath(await mkdtemp(join(tmpdir(), 'pero-app-tool-loading-')));
const readLines = text => text.trim().split('\n').map(JSON.parse);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const toolText = (messages, id) => messages.find(message => message.role === 'tool' && message.tool_call_id === id)?.content;
const toolOutcome = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const methodNotFound = (response, id) => response.writeHead(200, { 'Content-Type': 'application/json' })
  .end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }));

async function runProfile(eager) {
  const policy = eager ? 'eager' : 'auto';
  const profile = join(profileRoot, policy);
  const workspace = join(profile, 'workspace');
  const sessions = join(profile, 'sessions');
  const wireFile = join(profile, 'acp.jsonl');
  const hostHistory = join(profile, 'host.jsonl');
  const agents = join(profile, 'agents.json');
  const appSource = join(profile, 'builtins', app);
  const providerKey = `loopback-${policy}-key`;
  const token = randomBytes(32).toString('hex');
  const servers = [], errors = [], events = [], requests = [], appThreads = [], appCalls = [], echoCalls = [];
  const changed = new EventEmitter();
  let host, exit, backend, requestId = 0, stderr = '';
  const send = command => host.stdin.write(JSON.stringify(command) + '\n');
  const redact = value => value.replaceAll(providerKey, '[redacted]').replaceAll(token, '[redacted]');

  async function listen(handler) {
    const { server, url } = await listenJson(handler, errors);
    servers.push(server);
    return url;
  }

  function wait(predicate, label) {
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveEvent, reject) => {
      const receive = event => {
        if (!predicate(event)) return;
        clearTimeout(timeout);
        changed.off('event', receive);
        resolveEvent(event);
      };
      const timeout = setTimeout(() => {
        changed.off('event', receive);
        reject(Error(`${policy}: did not receive ${label}; ${redact(errors.join('\n'))}; ${stderr}`));
      }, 30_000);
      changed.on('event', receive);
    });
  }

  async function appRequest(action, fields = {}) {
    const id = `fixture-${++requestId}`;
    send({ method: 'apps', action, name: app, id, ...fields });
    const event = await wait(item => item.kind === 'apps_result' && item.request_id === id, `App ${action}`);
    assert.equal(event.data.ok, true, event.data.error);
    return event.data.value;
  }

  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(join(appSource, 'dist'), { recursive: true });
    await writeFile(join(appSource, 'dist/index.html'), '<title>App tool loading fixture</title>');
    await writeFile(join(appSource, 'server.mjs'), `
import {createServer} from 'node:http';
let saved;
const server = createServer(async (request, response) => {
  if (request.headers['x-pero-app-token'] !== process.env.PERO_APP_TOKEN || request.url !== '/api/save') {
    response.writeHead(403).end(); return;
  }
  if (request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    saved = JSON.parse(Buffer.concat(chunks));
  }
  response.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({saved}));
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port:server.address().port})));
`);
    await writeFile(join(appSource, 'app.json'), JSON.stringify({ schemaVersion: 1, name: app, version: '1.0.0',
      displayName: 'App tool loading fixture', permissions: { host: ['agent', 'agent-plugin'], api: ['/api/save'] },
      backend: { type: 'node', entry: 'server.mjs' }, contributes: {
        panels: [{ id: 'main', title: 'App tool loading fixture', entry: 'dist/index.html' }],
        writes: [{ name: 'save', description: 'Save a synthetic observation to this App', path: '/api/save', schema: observationSchema }],
        agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: 'Save the synthetic observation in this App.', tools: ['save'], maxCalls: 1 },
      } }));

    const appMCP = await listen(async (request, response, message) => {
      assert.equal(request.url, '/mcp');
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      appThreads.push(request.headers['x-pero-thread']);
      if (request.method !== 'POST') return response.writeHead(405).end();
      if (message.id === undefined) return response.writeHead(202).end();
      if (message.method === 'server/discover') return methodNotFound(response, message.id);
      if (message.method === 'initialize') return jsonReply(response, message.id, {
        protocolVersion: '2024-11-05', serverInfo: { name: 'pero-app-use', version: '1' }, capabilities: { tools: {} },
      });
      if (message.method === 'tools/list') return jsonReply(response, message.id, { tools: [
        { name: appRoute, description: 'Save a synthetic observation to this App', inputSchema: observationSchema, annotations: { readOnlyHint: false } },
        { name: 'app_describe', description: 'Describe this App', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      ] });
      assert.equal(message.method, 'tools/call');
      assert.equal(message.params.name, appRoute);
      appCalls.push(message.params.arguments);
      const saved = await fetch(`${backend.url}/api/save`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Pero-App-Token': backend.token,
      }, body: JSON.stringify(message.params.arguments) });
      assert.equal(saved.status, 200);
      return jsonReply(response, message.id, toolOutcome(await saved.json()));
    });

    const optionalMCP = await listen((request, response, message) => {
      assert.equal(request.url, '/mcp');
      if (request.method !== 'POST') return response.writeHead(405).end();
      if (message.id === undefined) return response.writeHead(202).end();
      if (message.method === 'server/discover') return methodNotFound(response, message.id);
      if (message.method === 'initialize') return jsonReply(response, message.id, {
        protocolVersion: '2024-11-05', serverInfo: { name: optionalServer, version: '1' }, capabilities: { tools: {} },
      });
      if (message.method === 'tools/list') return jsonReply(response, message.id, { tools: [
        { name: 'echo', description: 'Echo a synthetic observation', inputSchema: observationSchema, annotations: { readOnlyHint: true } },
        { name: 'summarize', description: 'Summarize a synthetic observation', inputSchema: observationSchema, annotations: { readOnlyHint: true } },
      ] });
      assert.equal(message.method, 'tools/call');
      assert.equal(message.params.name, 'echo');
      echoCalls.push(message.params.arguments);
      return jsonReply(response, message.id, toolOutcome({ echoed: message.params.arguments.observation }));
    });

    const provider = await listen((request, response, input, body) => {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, `Bearer ${providerKey}`);
      const names = input.tools.map(tool => tool.function.name);
      const step = requests.length;
      requests.push({ input, body, names });
      assert(step < 4);
      assert(names.includes(appTool) && names.includes(search), `App tool and search must be eager in ${policy}`);
      assert(names.includes(appDescribe), 'The App capability entry point must remain eager');
      assert.equal(names.includes(echo), eager || step >= 2);
      assert.equal(names.includes(other), eager);
      if (step === 3) {
        assert(toolText(input.messages, 'echo')?.includes(`"echoed":"${observation}"`));
        return streamCompletion(response, { id: 'step-4', model, delta: { content: 'Fixture App save and optional echo completed.' } });
      }
      if (step === 1) assert(toolText(input.messages, 'save')?.includes(`"observation":"${observation}"`));
      if (step === 2) {
        const output = toolText(input.messages, 'find-echo');
        assert(output?.includes(echo), 'The discovery result must identify the requested tool');
        if (!eager) {
          assert.match(output, /"activated"\s*:\s*true/);
          assert.match(output, /"schema_in_declaration"\s*:\s*true/);
          assert(!output.includes('input_schema'), 'Activation output should not duplicate the declaration');
        }
        assert.deepEqual(input.tools.find(tool => tool.function.name === echo).function.parameters, observationSchema);
      }
      const calls = [['save', appTool, { observation }], ['find-echo', search, { query: `select:${echo}` }], ['echo', echo, { observation }]];
      const [id, name, args] = calls[step];
      streamCompletion(response, { id: `step-${step + 1}`, model, finish: 'tool_calls',
        delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } });
    });

    const hostPath = process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host');
    const agentPath = process.env.PERO_RECEIPT_HARNESS || join(root, 'target/debug/pero-agent-acp');
    await writeFile(agents, JSON.stringify([{ id: 'tool-fixture', name: 'Local tool loading fixture', command: process.execPath,
      args: [join(root, 'tests/fixtures/record-acp.mjs'), wireFile, agentPath, '--endpoint', `${provider}/v1`, '--model', model,
        '--session-dir', sessions, '--workspace', workspace, '--tool-format', 'native', '--approval', 'ask', '--max-retries', '0',
        '--max-requests', '5', '--max-tokens', '1024', ...(eager ? ['--defer-tool-loading=false'] : [])],
      mcp_servers: [{ type: 'http', name: optionalServer, url: `${optionalMCP}/mcp`, headers: [] }],
    }]));
    await writeFile(join(profile, 'settings.json'), '{}');
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !name.startsWith('PERO_') && !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROXY)/i.test(name)));
    host = spawn(hostPath, ['--stdio'], { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], env: {
      ...env, AGENT_PROVIDER_API_KEY: providerKey, PERO_AGENTS_FILE: agents, PERO_NODE_BINARY: process.execPath,
      PERO_SETTINGS_PATH: join(profile, 'settings.json'), PERO_HISTORY_PATH: hostHistory, PERO_ENV_FILE: join(profile, 'no-env'),
      PERO_APPS_ROOT: join(profile, 'apps'), PERO_BUILTIN_APPS_ROOT: join(profile, 'builtins'), PERO_BUILTIN_APPS: app,
      PERO_REQUIRED_APPS: '', PERO_APP_USE_URL: `${appMCP}/mcp`, PERO_APP_USE_TOKEN: token,
    } });
    exit = once(host, 'close');
    host.stderr.on('data', data => { stderr += redact(String(data)); });
    createInterface({ input: host.stdout }).on('line', line => {
      const event = JSON.parse(line);
      events.push(event);
      if (event.kind === 'permission') {
        const option = event.data.options.find(choice => choice.kind === 'allow_once');
        assert(option, 'Expected a one-time permission option');
        send({ action: 'permission', thread_id: event.thread_id, request_id: event.data.permission_id, option_id: option.optionId });
      }
      changed.emit('event', event);
    });

    await wait(event => event.kind === 'ready', 'Host readiness');
    await appRequest('apiaccess', { path: '/api/save' });
    ({ backend } = await appRequest('resolve'));
    assert.equal(new URL(backend.url).hostname, '127.0.0.1');
    const catalog = await appRequest('agentcatalog', { path: '/api/workspaces' });
    const scope = { workspaceId: catalog.items[0].workspaceId };
    const run = await appRequest('agentrun', { request: { operation: 'start', scope, requestId: 'fixture-tool-loading', harnessId: 'tool-fixture', text: userInput } });
    const ready = await wait(event => event.thread_id === run.sessionId && ['session_ready', 'session_error'].includes(event.kind), 'App ACP session');
    assert.equal(ready.kind, 'session_ready', `${ready.text}; ${redact(errors.join('\n'))}`);
    const completed = await wait(event => event.thread_id === run.sessionId && ['turn_finished', 'session_error'].includes(event.kind), 'App turn');
    assert.deepEqual(errors.map(redact), []);
    assert.equal(completed.kind, 'turn_finished', completed.text);
    assert.equal(completed.data.stopReason, 'end_turn');
    const transcript = await appRequest('agentrun', { request: { operation: 'events', scope, runId: run.id } });
    assert.equal(transcript.run.status, 'completed');
    const saved = await fetch(`${backend.url}/api/save`, { headers: { 'X-Pero-App-Token': backend.token } });
    assert.deepEqual(await saved.json(), { saved: { observation } });
    host.stdin.end();
    assert.deepEqual(await exit, [0, null], stderr);

    assert(appThreads.length && appThreads.every(thread => thread === run.sessionId));
    assert.deepEqual(appCalls, [{ observation }]);
    assert.deepEqual(echoCalls, [{ observation }]);
    assert.equal(requests.length, 4);
    const frames = readLines(await readFile(wireFile, 'utf8')).map(entry => ({ line: entry.line, message: JSON.parse(entry.line) }));
    const setup = frames.find(frame => frame.message.method === 'session/new').message;
    const capabilities = frames.find(({ message }) => message.result?.agentCapabilities).message.result.agentCapabilities._meta;
    assert.equal(capabilities[loading], eager ? undefined : 1);
    assert.deepEqual(setup.mcpServerNames.toSorted(), [optionalServer, 'pero-app-use'].toSorted());
    assert.deepEqual(setup.appToolLoading, eager ? undefined : { app, requiredServers: [] });
    const acpPrompt = frames.find(frame => frame.message.method === 'session/prompt');
    const promptId = acpPrompt.message.params._meta['pero.turnReceipt'].id;
    const journal = readLines(await readFile(join(sessions, `${ready.data.sessionId}.jsonl`), 'utf8')).flatMap(line => line.event ? [line.event] : []);
    const approval = journal.find(event => event.type === 'approval/asked' && event.data.toolName === appTool);
    assert(approval && journal.some(event => event.type === 'approval/decided' && event.data.id === approval.data.id),
      'App write must pass through the normal approval policy');
    const wire = journal.filter(event => event.type === 'request/wire-size');
    assert.equal(wire.length, 4);
    assert(readLines(await readFile(hostHistory, 'utf8')).some(event =>
      event.thread_id === run.sessionId && event.kind === 'session_created' && event.data.appBinding?.run));
    const measured = requests.map(({ body, names, input }, index) => {
      const receipt = wire[index].data;
      assert.equal(receipt.promptId, promptId);
      assert.equal(receipt.payload_sha256, sha256(body));
      assert.equal(receipt.payload_bytes, body.length);
      const toolsJSON = JSON.stringify(input.tools).replace(/[<>&\u2028\u2029]/g, char =>
        `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
      assert.equal(receipt.tools_bytes, Buffer.byteLength(toolsJSON));
      return { count: names.length, toolsBytes: receipt.tools_bytes, payloadBytes: body.length,
        toolResultMessageBytes: receipt.tool_result_message_bytes, sha256: receipt.payload_sha256, names };
    });
    const rawACP = frames.map(frame => frame.line).join('\n') + '\n';
    const rawProvider = Buffer.concat(requests.flatMap(({ body }) => [body, Buffer.from('\n')]));
    for (const secret of [providerKey, token, backend.token]) {
      assert(!rawACP.includes(secret) && !rawProvider.includes(secret));
    }
    return { summary: { policy, runStatus: transcript.run.status, sessionId: ready.data.sessionId, setup, promptId, measured }, rawACP, rawProvider };
  } finally {
    if (host?.exitCode === null && host.signalCode === null) {
      host.stdin.end();
      const timeout = setTimeout(() => host.kill('SIGKILL'), 5000);
      try { await exit; } finally { clearTimeout(timeout); }
    }
    await Promise.all(servers.map(closeLoopback));
  }
}

try {
  const eager = await runProfile(true);
  const auto = await runProfile(false);
  assert(auto.summary.measured.every((call, index) => call.count < eager.summary.measured[index].count
    && call.toolsBytes < eager.summary.measured[index].toolsBytes));
  const report = { fixture: 'Same durable App Run and local backend. Explicit eager vs default compatible App scope.',
    eager: eager.summary, auto: auto.summary };
  if (process.env.PERO_APP_TOOL_LOADING_REPORT) {
    const base = process.env.PERO_APP_TOOL_LOADING_REPORT;
    await Promise.all([writeFile(`${base}.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }),
      ...[eager, auto].flatMap(run => [
        writeFile(`${base}.${run.summary.policy}.acp.jsonl`, run.rawACP, { mode: 0o600 }),
        writeFile(`${base}.${run.summary.policy}.provider.jsonl`, run.rawProvider, { mode: 0o600 }),
      ]),
    ]);
  }
  console.log(`App tool loading verified: eager first request ${eager.summary.measured[0].count} tools (${eager.summary.measured[0].toolsBytes} bytes), auto ${auto.summary.measured[0].count} tools (${auto.summary.measured[0].toolsBytes} bytes). Both durable Runs completed.`);
} finally {
  await rm(profileRoot, { recursive: true, force: true });
}
