// Real Host/ACP wiring with isolated local packages; no model or MCP execution.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };

const repository = resolve(import.meta.dirname, '../..');
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const validateAppRequest = ajv.getSchema(`${schema.$id}#/$defs/AppRequest`);
const validateAppsResult = ajv.getSchema(`${schema.$id}#/$defs/AppsResultEvent`);
const validateSessionCreated = ajv.getSchema(`${schema.$id}#/$defs/SessionCreatedEvent`);
const schemaFailures = [];
const profile = await mkdtemp(join(tmpdir(), 'pero-app-plugins-'));
const source = join(profile, 'sample-source');
const plugin = join(source, 'agent-plugins/literature');
const workspace = join(profile, 'workspace');
const instruction = 'APP-PLUGIN-INSTRUCTION: cite the observed sources.';
const skill = 'DEPENDENCY-SKILL-INSTRUCTION: preserve exact quotations.';
let networkRequests = 0;
const endpoint = createServer((_request, response) => { networkRequests++; response.writeHead(501).end(); });
endpoint.listen(0, '127.0.0.1');
await once(endpoint, 'listening');
const origin = `http://127.0.0.1:${endpoint.address().port}`;
let host;
let stderr = '';
const events = [];
const changed = new EventEmitter();
let exited;
let requestId = 0;
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));
const send = command => host.stdin.write(JSON.stringify(command) + '\n');
async function until(predicate, after = 0) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const found = events.slice(after).find(predicate);
    if (found) return found;
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, `Missing Host state. ${stderr}\n${JSON.stringify(events.slice(-8))}`);
    await new Promise((resolveChange, reject) => {
      const listener = () => { clearTimeout(timer); resolveChange(); };
      const timer = setTimeout(() => {
        changed.off('event', listener);
        reject(Error(`Host state timed out. ${stderr}\n${JSON.stringify(events.slice(-8))}`));
      }, remaining);
      changed.once('event', listener);
    });
  }
}
async function apps(action, fields = {}) {
  const id = `app-plugin-${++requestId}`;
  const input = { method: 'apps', action, id, ...fields };
  assert.ok(validateAppRequest(input), ajv.errorsText(validateAppRequest.errors));
  send(input);
  return (await until(event => event.kind === 'apps_result' && event.request_id === id)).data;
}
async function successfulApp(action, fields = {}) {
  const result = await apps(action, fields);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
async function prompt(thread, text) {
  const after = events.length;
  send({ action: 'prompt', thread_id: thread, text });
  const output = await until(event => event.thread_id === thread && event.kind === 'session_update'
    && event.data.sessionUpdate === 'agent_message_chunk', after);
  await until(event => event.thread_id === thread && event.kind === 'turn_finished', after);
  return JSON.parse(output.data.content.text);
}
try {
  await Promise.all([mkdir(join(source, 'dist'), { recursive: true }), mkdir(join(plugin, 'skills/citations'), { recursive: true }), mkdir(workspace)]);
  await writeFile(join(source, 'dist/index.html'), '<h1>App Plugin fixture</h1>');
  await writeFile(join(source, 'server.mjs'), '// Declared backend is not started by conversation assembly.\n');
  await writeFile(join(plugin, 'skills/citations/SKILL.md'), skill);
  await writeJson(join(plugin, 'plugin.json'), {
    schemaVersion: 1, name: 'literature', version: '1.0.0', instructions: 'DEPENDENCY-PLUGIN-INSTRUCTION: use the citations skill.',
    skills: ['skills/citations/SKILL.md'],
    mcpServers: [{ type: 'http', name: 'literature-search', url: `${origin}/literature`, headers: [] }],
  });
  await writeJson(join(source, 'app.json'), {
    schemaVersion: 1, name: 'sample', version: '1.0.0', displayName: 'Sample',
    permissions: { host: ['agent', 'agent-plugin'] }, requiresAgentPlugins: ['literature'],
    backend: { type: 'node', entry: 'server.mjs' },
    contributes: {
      panels: [{ id: 'viewer', title: 'Sample', entry: 'dist/index.html' }],
      writes: [{ name: 'research', description: 'Research fixture', path: '/api/research', schema: { type: 'object' } }],
      agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: instruction, tools: ['research'], maxCalls: 3 },
    },
  });
  const agents = join(profile, 'agents.json');
  await writeJson(agents, [{
    id: 'fixture', name: 'Plugin wiring fixture', command: process.execPath,
    args: [join(repository, 'tests/runtime/lifecycle-agent.mjs')], env: { PERO_FIXTURE_SCENARIO: 'app_use_boundary' },
  }, {
    id: 'no-http', name: 'Agent without HTTP MCP', command: process.execPath,
    args: [join(repository, 'tests/runtime/lifecycle-agent.mjs')], env: { PERO_FIXTURE_SCENARIO: 'no_http' },
  }]);
  const env = { ...process.env,
    PERO_SETTINGS_PATH: join(profile, 'settings.json'), PERO_HISTORY_PATH: join(profile, 'history.jsonl'),
    PERO_APPS_ROOT: join(profile, 'apps'), PERO_BUILTIN_APPS_ROOT: '', PERO_REQUIRED_APPS: '',
    PERO_AGENTS_FILE: agents, PERO_APP_USE_URL: `${origin}/mcp`, PERO_APP_USE_TOKEN: 'a'.repeat(64),
  };
  delete env.PERO_CONNECTORS_URL; delete env.PERO_CONNECTORS_TOKEN;
  host = spawn(process.env.PERO_HOST_PATH || join(repository, 'target/debug/pero-host'), ['--stdio'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
  exited = once(host, 'exit');
  host.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line);
    if (event.kind === 'apps_result' && !validateAppsResult(event)) schemaFailures.push(ajv.errorsText(validateAppsResult.errors));
    if (event.kind === 'session_created' && !validateSessionCreated(event)) schemaFailures.push(ajv.errorsText(validateSessionCreated.errors));
    events.push(event); changed.emit('event');
  });
  await until(event => event.kind === 'ready');

  await successfulApp('install', { path: source });
  await successfulApp('prepare', { name: 'sample' });
  await successfulApp('enable', { name: 'sample' });
  const installed = await successfulApp('pluginlist');
  assert.equal(installed.length, 1);
  assert.equal(installed[0].name, 'literature');
  assert.equal(installed[0].enabled, true);
  assert.match(installed[0].revision, /^sha256:[a-f0-9]{64}$/);

  send({ action: 'new_session', thread_id: 'plugin-session', agent_id: 'fixture', scope: { app: 'sample', panel: 'viewer' } });
  const created = await until(event => event.kind === 'session_created' && event.thread_id === 'plugin-session');
  assert.equal(created.data.appPlugin.app, 'sample');
  assert.equal(created.data.scope.panel, 'viewer');
  assert.deepEqual(created.data.appPlugin.tools.map(tool => tool.name), ['research']);
  assert.equal(created.data.appPlugin.maxCalls, 3);
  assert.match(created.data.appPlugin.revision, /^[a-f0-9]{64}$/);
  assert.equal(created.data.agentPlugins[0].revision, installed[0].revision);
  await until(event => event.kind === 'session_ready' && event.thread_id === 'plugin-session');
  const scoped = await prompt('plugin-session', 'Inspect source evidence.');
  const scopedText = JSON.stringify(scoped.prompt);
  assert.ok(scopedText.includes(instruction));
  assert.ok(scopedText.includes(skill));
  assert.deepEqual(scoped.mcpServers.map(server => server.name).sort(), ['literature-search', 'pero-app-use']);

  const legacy = await successfulApp('agent', { name: 'sample', request: {
    operation: 'start', requestId: 'legacy', prompt: 'Review the App-selected source evidence.', agentId: 'fixture',
  } });
  const legacyCreated = await until(event => event.kind === 'session_created' && event.thread_id === legacy.sessionId);
  assert.equal(legacyCreated.data.scope.panel, 'viewer');
  assert.equal(legacyCreated.data.appPlugin.app, 'sample');
  assert.equal(legacyCreated.data.agentPlugins[0].revision, installed[0].revision);
  const legacyOutput = await until(event => event.kind === 'session_update' && event.thread_id === legacy.sessionId
    && event.data.sessionUpdate === 'agent_message_chunk');
  const legacyWire = JSON.parse(legacyOutput.data.content.text);
  assert.ok(JSON.stringify(legacyWire.prompt).includes(instruction));
  assert.ok(JSON.stringify(legacyWire.prompt).includes(skill));
  assert.deepEqual(legacyWire.mcpServers.map(server => server.name).sort(), ['literature-search', 'pero-app-use']);
  await until(event => event.kind === 'turn_finished' && event.thread_id === legacy.sessionId);

  const unsupportedStart = events.length;
  send({ action: 'new_session', thread_id: 'unsupported-plugin-session', agent_id: 'no-http', scope: { app: 'sample', panel: 'viewer' } });
  const unsupported = await until(event => event.kind === 'session_error' && event.thread_id === 'unsupported-plugin-session', unsupportedStart);
  assert.match(unsupported.text, /MCP HTTP/);
  await until(event => event.kind === 'session_closed' && event.thread_id === 'unsupported-plugin-session', unsupportedStart);
  assert.ok(!events.slice(unsupportedStart).some(event => event.kind === 'session_ready' && event.thread_id === 'unsupported-plugin-session'));

  send({ action: 'new_session', thread_id: 'ordinary-session', agent_id: 'fixture' });
  const ordinaryCreated = await until(event => event.kind === 'session_created' && event.thread_id === 'ordinary-session');
  assert.equal(ordinaryCreated.data.appPlugin, undefined);
  assert.equal(ordinaryCreated.data.agentPlugins, undefined);
  await until(event => event.kind === 'session_ready' && event.thread_id === 'ordinary-session');
  const ordinary = await prompt('ordinary-session', 'Inspect ordinary conversation.');
  assert.ok(!JSON.stringify(ordinary.prompt).includes(instruction));
  assert.ok(!JSON.stringify(ordinary.prompt).includes(skill));
  assert.ok(!ordinary.mcpServers.some(server => server.name === 'literature-search'));

  const afterDisable = events.length;
  await successfulApp('pluginenable', { name: 'literature', enabled: false });
  await until(event => event.kind === 'session_closed' && event.thread_id === 'plugin-session', afterDisable);
  await until(event => event.kind === 'session_closed' && event.thread_id === legacy.sessionId, afterDisable);
  assert.ok(!events.slice(afterDisable).some(event => event.kind === 'session_closed' && event.thread_id === 'ordinary-session'));
  const next = events.length;
  send({ action: 'new_session', thread_id: 'disabled-plugin-session', agent_id: 'fixture', scope: { app: 'sample', panel: 'viewer' } });
  const rejected = await until(event => event.kind === 'session_error' && event.thread_id === 'disabled-plugin-session', next);
  assert.match(rejected.text, /literature.*disabled/i);
  assert.ok(!events.slice(next).some(event => event.kind === 'session_created' && event.thread_id === 'disabled-plugin-session'));
  assert.equal((await successfulApp('pluginlist'))[0].enabled, false);
  const journal = await readFile(join(profile, 'history.jsonl'), 'utf8');
  assert.ok(journal.includes('"agentPlugins"'));
  assert.deepEqual(schemaFailures, [], 'Generated contracts must admit App requests, results and session assemblies');
  assert.equal(networkRequests, 0, 'Protocol fixture must not execute the declared MCP servers');
  console.log('App Agent Plugins: embedded dependencies, shared Chat and App-initiated non-main panel assembly, Skills/MCP isolation, unsupported HTTP refusal and disable revocation passed.');
} finally {
  let hostExitCode;
  if (host) {
    host.stdin.end();
    const timer = setTimeout(() => host.kill('SIGKILL'), 5_000);
    [hostExitCode] = await exited;
    clearTimeout(timer);
  }
  await new Promise(done => endpoint.close(done));
  await rm(profile, { recursive: true, force: true });
  if (host) assert.equal(hostExitCode, 0, stderr);
}
