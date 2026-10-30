// Real Host persistence and ACP session/new injection; no model or MCP client.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { readFile, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };
import { mcpSettingsFixture } from '../fixtures/mcp-settings.mjs';
const root = resolve(import.meta.dirname, '../..');
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
function conforms(name, value) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  assert(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`);
}
const fixture = await mcpSettingsFixture(root);
const output = resolve(root, 'test-results/mcp-settings');
await rm(resolve(output, 'host-result.json'), { force: true });
let host, fixtureClosed = false;
const publicEvents = [];
function launch() {
  const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: fixture.temp, env: fixture.env });
  const events = [], waiters = new Set();
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line); publicEvents.push(event);
    const waiter = [...waiters].find(waiter => waiter.match(event));
    if (waiter) waiter.resolve(event); else events.push(event);
  });
  const next = (kind, match = () => true) => new Promise((resolveEvent, reject) => {
    const matches = event => event.kind === kind && match(event);
    const index = events.findIndex(matches);
    if (index >= 0) return resolveEvent(events.splice(index, 1)[0]);
    const waiter = { match: matches, resolve: event => { clearTimeout(timer); waiters.delete(waiter); resolveEvent(event); } };
    const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Timed out waiting for ${kind}`)); }, 15000);
    waiters.add(waiter);
  });
  return { next, send: value => {
      if (value.method?.startsWith('settings.mcp.')) conforms('McpSettingsRequest', value);
      child.stdin.write(JSON.stringify(value) + '\n');
    },
    stop: async () => { const exited = once(child, 'exit'); child.stdin.end(); await exited; assert(!stderr.includes(fixture.secret), 'operator secret leaked in stderr'); },
    kill: () => child.kill(),
  };
}
let request = 0;
async function get() {
  const request_id = `mcp-${++request}`;
  host.send({ method: 'settings.mcp.get', request_id, agent_id: 'fixture' });
  const event = await host.next('mcp_settings', event => event.request_id === request_id);
  conforms('McpSettingsEvent', event); return event.data;
}
async function set(current, servers, error) {
  const request_id = `mcp-${++request}`;
  host.send({ method: 'settings.mcp.set', request_id, agent_id: 'fixture', revision: current.revision, servers });
  const response = await host.next(error ? 'mcp_settings_error' : 'mcp_settings', event => event.request_id === request_id);
  conforms(error ? 'McpSettingsErrorEvent' : 'McpSettingsEvent', response);
  if (error) assert.equal(response.data.reason, error);
  return response.data;
}
async function session(id) {
  host.send({ action: 'new_session', thread_id: id, agent_id: 'fixture' });
  await host.next('session_ready', event => event.thread_id === id);
  return (await fixture.sessions()).at(-1).mcpServers;
}
const managed = servers => servers.filter(server => server.name !== 'operator-only' && server.name !== 'pero-app-use');
try {
  host = launch(); await host.next('ready');
  let current = await get(); assert.deepEqual(current.servers, []);
  const disabled = { name: 'local-docs', enabled: false, transport: { type: 'http', url: fixture.url } };
  current = await set(current, [disabled]);
  // Stale revision rejection crosses the same real IPC/schema boundary.
  await set({ revision: current.revision - 1 }, [], 'conflict');
  assert.deepEqual((await get()).servers, [disabled]);
  assert.deepEqual(managed(await session('disabled')), []);
  const enabled = { ...disabled, enabled: true };
  current = await set(current, [enabled]);
  assert.deepEqual(managed(await session('enabled')), [{ type: 'http', name: 'local-docs', url: fixture.url, headers: [] }]);
  // Existing sessions are not recreated when future-session configuration changes.
  assert.equal((await fixture.sessions()).length, 2);
  const edited = { ...enabled, name: 'renamed-docs', transport: { type: 'stdio', command: process.execPath, args: ['--version'] } };
  current = await set(current, [edited]);
  host.send({ action: 'prompt', thread_id: 'enabled', text: 'hello' });
  await host.next('turn_finished', event => event.thread_id === 'enabled');
  assert.equal((await fixture.sessions()).length, 2);
  const next = managed(await session('edited'));
  assert.deepEqual(next, [{ name: 'renamed-docs', command: process.execPath, args: ['--version'], env: [] }]);
  assert((await fixture.sessions()).every(session => session.mcpServers.some(server => server.name === 'operator-only')), 'operator configuration lost');
  await host.stop(); host = undefined;
  host = launch(); await host.next('ready');
  assert.deepEqual((await get()).servers, [edited]);
  current = await set(current, []);
  assert.deepEqual(managed(await session('removed')), []);
  // Operator configuration may change after a valid managed entry was persisted.
  current = await set(current, [disabled]);
  await host.stop(); host = undefined;
  const agents = JSON.parse(await readFile(fixture.env.PERO_AGENTS_FILE, 'utf8'));
  agents[0].mcp_servers.push({ name: disabled.name, command: process.execPath, args: [], env: [] });
  await writeFile(fixture.env.PERO_AGENTS_FILE, JSON.stringify(agents), { mode: 0o600 });
  host = launch(); await host.next('ready');
  current = await get(); assert.deepEqual(current.servers, [disabled]);
  const sessionsBeforeCollision = (await fixture.sessions()).length;
  host.send({ action: 'new_session', thread_id: 'collision-blocked', agent_id: 'fixture' });
  await host.next('session_error', event => event.thread_id === 'collision-blocked');
  assert.equal((await fixture.sessions()).length, sessionsBeforeCollision, 'collision must block ACP startup');
  await set({ revision: current.revision - 1 }, [], 'conflict');
  assert.deepEqual((await get()).servers, [disabled]);
  current = await set(current, []);
  assert.deepEqual((await get()).servers, []);
  const recovered = await session('collision-repaired');
  assert.equal(recovered.filter(server => server.name === disabled.name).length, 1, 'operator entry retained after repair');
  const saved = JSON.parse(await readFile(fixture.settings, 'utf8'));
  assert.deepEqual(saved.unrelated, { preserved: true });
  if (process.platform !== 'win32') assert.equal((await stat(fixture.settings)).mode & 0o777, 0o600);
  const publicText = JSON.stringify(publicEvents);
  assert(!publicText.includes(fixture.secret), 'operator credential reached Host events');
  assert(!publicText.includes('operator-only'), 'operator-only metadata reached Host events');
  assert(!publicText.includes('"connected":true'), 'configuration falsely claimed MCP connectivity');
  assert.equal(fixture.requests(), 0, 'settings or ACP fixture unexpectedly connected to MCP');
  await host.stop(); host = undefined;
  await fixture.close(); fixtureClosed = true;
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'host-result.json'), JSON.stringify({ passed: true, checks: [
    'disabled omitted from ACP', 'enabled HTTP injected', 'stdio edit injected for new session only',
    'existing session remains usable', 'operator configuration retained but not disclosed',
    'restart persistence', 'remove omitted from ACP', 'unrelated preferences preserved',
    'operator-name collision remains readable and repairable while sessions fail closed', 'private settings file', 'no credentials in public events or stderr', 'no MCP connection or connected claim',
  ] }, null, 2));
  console.log('MCP settings Host/ACP acceptance passed (fixture only; no MCP connectivity claimed).');
} finally { host?.kill(); if (!fixtureClosed) await fixture.close(); }
