// Actual Host → ACP proxy contract, using an explicit resource/observation stub.
// This is not Electron UI acceptance or real MCP execution evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };
import { mcpSettingsFixture } from '../fixtures/mcp-settings.mjs';
const root = resolve(import.meta.dirname, '../..');
const fixture = await mcpSettingsFixture(root);
const capture = resolve(fixture.temp, 'mcp-session-calls.jsonl');
await writeFile(capture, '');
const agents = JSON.parse(await readFile(fixture.env.PERO_AGENTS_FILE, 'utf8'));
agents[0].args = [resolve(root, 'tests/fixtures/acp-mcp-session.mjs'), `--capture=${capture}`];
agents.push({ ...agents[0], id: 'unsupported', name: 'Unsupported fixture', args: [...agents[0].args, '--unsupported'] });
await writeFile(fixture.env.PERO_AGENTS_FILE, JSON.stringify(agents), { mode: 0o600 });
const ajv = new Ajv2020({ strict: true, strictTypes: false }); ajv.addSchema(schema);
const events = [], waiters = new Set(); let stderr = '', sequence = 0;
const host = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: fixture.temp, env: fixture.env });
host.stderr.on('data', data => { stderr += data; });
createInterface({ input: host.stdout }).on('line', line => {
  const event = JSON.parse(line); const waiter = [...waiters].find(item => item.match(event));
  if (waiter) waiter.resolve(event); else events.push(event);
});
function next(kind, match = () => true) {
  return new Promise((resolveEvent, reject) => {
    const matches = event => (!kind || event.kind === kind) && match(event);
    const index = events.findIndex(matches);
    if (index >= 0) return resolveEvent(events.splice(index, 1)[0]);
    const waiter = { match: matches, resolve: event => { clearTimeout(timer); waiters.delete(waiter); resolveEvent(event); } };
    const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Timed out waiting for ${kind}: ${stderr}`)); }, 15000);
    waiters.add(waiter);
  });
}
const send = value => host.stdin.write(JSON.stringify(value) + '\n');
const calls = async () => (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
function conforms(name, value) { const check = ajv.getSchema(`${schema.$id}#/$defs/${name}`); assert(check(value), ajv.errorsText(check.errors)); }
async function configure(agent) {
  const request_id = `get-${++sequence}`; send({ method: 'settings.mcp.get', request_id, agent_id: agent });
  const current = (await next('mcp_settings', event => event.request_id === request_id)).data;
  const saved = `set-${++sequence}`;
  send({ method: 'settings.mcp.set', request_id: saved, agent_id: agent, revision: current.revision,
    servers: [{ name: 'My Docs', enabled: true, transport: { type: 'http', url: fixture.url } },
      { name: 'disabled', enabled: false, transport: { type: 'http', url: fixture.url } }] });
  await next('mcp_settings', event => event.request_id === saved);
}
async function session(thread, agent = 'fixture') {
  send({ action: 'new_session', thread_id: thread, agent_id: agent });
  await next('session_ready', event => event.thread_id === thread);
  return (await next('mcp_runtime', event => event.thread_id === thread && event.data.servers.some(server => server.server === 'My Docs' && server.status === 'connected'))).data;
}
async function request(snapshot, fields, error) {
  const value = { method: 'mcp.session', request_id: `session-${++sequence}`, thread_id: snapshot.thread_id,
    incarnation: snapshot.incarnation, revision: snapshot.revision, ...fields };
  if (!('sessionId' in value)) conforms('McpSessionRequest', value);
  send(value);
  const result = await next(null, event => event.request_id === value.request_id && ['mcp_session', 'mcp_session_error'].includes(event.kind));
  assert.equal(result.kind, error ? 'mcp_session_error' : 'mcp_session', JSON.stringify({ request: value, result }));
  conforms(error ? 'McpSessionErrorEvent' : 'McpSessionEvent', result);
  assert.equal(result.thread_id, value.thread_id); assert.equal(result.data.incarnation, value.incarnation); assert.equal(result.data.revision, value.revision);
  if (error) assert.equal(result.data.reason, error);
  return result.data.result;
}
let stopped = false;
try {
  await next('ready'); await configure('fixture'); await configure('unsupported');
  const snapshot = await session('managed');
  const listed = await request(snapshot, { action: 'list' });
  assert.deepEqual(listed.servers, [{ name: 'My Docs', generation: 1, connected: true, tools: [] }], 'operator/internal/disabled connections leaked');
  assert.deepEqual(listed.echo, { action: 'list', sessionId: snapshot.session_id }, 'Host identities leaked or ACP session identity was not authoritative');
  const read = await request(snapshot, { action: 'read', server: 'My Docs', generation: 1, uri: 'fixture://document' });
  assert.equal(read.contents[0].text, 'Synthetic session-bound resource');
  assert.deepEqual(read.echo, { action: 'read', server: 'My Docs', generation: 1, uri: 'fixture://document', sessionId: snapshot.session_id });
  const pendingRead = request(snapshot, { action: 'read', server: 'My Docs', generation: 1, uri: 'fixture://slow' }, 'unavailable');
  const waitRecorded = async predicate => {
    const deadline = Date.now() + 10000;
    while (!(await calls()).some(predicate)) {
      assert(Date.now() < deadline, 'fixture receipt did not arrive');
      await new Promise(done => setTimeout(done, 10));
    }
  };
  await waitRecorded(call => call.uri === 'fixture://slow');
  const queuedRead = request(snapshot, { action: 'read', server: 'My Docs', generation: 1, uri: 'fixture://queued' }, 'unavailable');
  send({ action: 'cancel', thread_id: snapshot.thread_id });
  await Promise.all([pendingRead, queuedRead]);
  await waitRecorded(call => call.method === 'session/cancel');
  assert(!(await calls()).some(call => call.uri === 'fixture://queued'), 'cancel replayed a queued MCP request');
  await request(snapshot, { action: 'list' }); // Cancellation does not invent a replacement session.
  const prepared = await request(snapshot,{action:'prepare',server:'My Docs',generation:1,name:'ask-write'});
  assert.equal(prepared.binding,'fixture-binding');
  assert(!(await calls()).some(call=>call.method==='tool_executed'),'prepare executed a business tool');
  // Drive the real Host permission callback, then revoke before supplying a late answer.
  const askingTool = request(snapshot, { action:'tool',binding:'fixture-binding',name:'ask-write',arguments:{} }, 'unavailable');
  const permission = await next('permission',event => event.thread_id === snapshot.thread_id && event.data.toolCall?.toolCallId === 'app-write');
  const otherSnapshot = await session('other-approval-session');
  const otherTool = request(otherSnapshot,{action:'tool',binding:'fixture-binding',name:'ask-write',arguments:{}});
  const otherPermission = await next('permission',event=>event.thread_id===otherSnapshot.thread_id && event.data.toolCall?.toolCallId==='app-write');
  const closingApp = request(snapshot,{action:'close',binding:'fixture-binding'});
  // Back-to-back Host inputs: do not wait for the close RPC acknowledgment.
  send({action:'permission',thread_id:snapshot.thread_id,request_id:permission.data.permission_id,option_id:'allow-once'});
  send({action:'permission',thread_id:otherSnapshot.thread_id,request_id:otherPermission.data.permission_id,option_id:'allow-once'});
  await Promise.all([closingApp,askingTool,otherTool]);
  await request(snapshot,{action:'list'}); // Ordered RPC barrier after the late UI answer.
  const afterClose = await calls();
  assert(afterClose.some(call=>call.action==='close'&&call.binding==='fixture-binding'),'close was deferred behind approval');
  assert(afterClose.some(call=>call.method==='approval_answer'&&call.outcome?.outcome==='cancelled'),'closed App retained a live permission sender');
  assert(!afterClose.some(call=>call.method==='tool_executed'&&call.sessionId===snapshot.session_id),'late approval executed a closed App tool');
  assert(afterClose.some(call=>call.method==='tool_executed'&&call.sessionId===otherSnapshot.session_id),'closing one binding cancelled another session approval');
  const beforeContexts = (await calls()).filter(call => call.method === 'session/prompt').length;
  for (const change of [{ thread_id: 'another-thread' }, { incarnation: snapshot.incarnation + 1 }]) {
    const provenance = { thread_id: snapshot.thread_id, incarnation: snapshot.incarnation, revision: snapshot.revision,
      server: 'My Docs', generation: 1, uri: 'fixture://document', ...change };
    const source = 'mcp-resource:' + JSON.stringify(provenance);
    send({ action: 'prompt', thread_id: snapshot.thread_id, text: 'Read this resource', contexts: [
      { id: source, kind: 'fetch', label: 'Synthetic resource', source, content: { type: 'text', text: 'Untrusted synthetic resource' } },
    ] });
    const rejected = await next('session_error', event => event.thread_id === snapshot.thread_id);
    assert.match(rejected.text, /MCP resource/);
  }
  assert.equal((await calls()).filter(call => call.method === 'session/prompt').length, beforeContexts, 'mismatched resource context reached ACP prompt');
  send({method:'mcp.session',request_id:'legacy-open',thread_id:snapshot.thread_id,incarnation:snapshot.incarnation,revision:snapshot.revision,action:'open',server:'My Docs',generation:1,name:'ask-write',arguments:{}});
  assert.equal((await next('mcp_session_error',event=>event.request_id==='legacy-open')).data.reason,'invalid');
  const beforeRejected = (await calls()).length;
  await request(snapshot, { action: 'list', incarnation: snapshot.incarnation + 1 }, 'stale');
  await request(snapshot, { action: 'list', revision: snapshot.revision + 1 }, 'stale');
  await request(snapshot, { action: 'read', server: 'My Docs', generation: 2, uri: 'fixture://document' }, 'stale');
  await request(snapshot, { action: 'read', server: 'operator-only', generation: 1, uri: 'fixture://document' }, 'denied');
  await request(snapshot, { action: 'read', server: 'disabled', generation: 1, uri: 'fixture://document' }, 'denied');
  await request(snapshot, { action: 'list', sessionId: 'forged-session' }, 'invalid');
  const unsupported = await session('unsupported-thread', 'unsupported');
  await request(unsupported, { action: 'list' }, 'unsupported');
  assert.equal((await calls()).length, beforeRejected, 'rejected request reached ACP proxy');
  send({ action: 'close', thread_id: snapshot.thread_id }); await next('session_closed', event => event.thread_id === snapshot.thread_id);
  await request(snapshot, { action: 'list' }, 'unavailable');
  assert.equal((await calls()).length, beforeRejected, 'closed session reached ACP proxy');
  assert.equal(fixture.requests(), 0, 'Host or stub opened a second MCP client');
  const exited = once(host, 'exit'); host.stdin.end(); await exited; stopped = true;
  assert(!stderr.includes(fixture.secret), 'operator credential leaked');
  await mkdir(resolve(root, 'test-results/mcp-session'), { recursive: true });
  await writeFile(resolve(root, 'test-results/mcp-session/host-result.json'), JSON.stringify({ passed: true, actualHost: true, realMCP: false, checks: [
    'cancel forwarded to ACP and queued operation not replayed', 'App close interrupts real Host approval; late allow executes no tool', 'mismatched resource context rejected before ACP prompt',
    'managed directory filters operator/internal/disabled', 'resource read uses actual ACP session identity', 'no Host identity fields forwarded',
    'stale incarnation/revision/generation refused', 'operator/disabled denied', 'forged client sessionId invalid',
    'unsupported Agent refused', 'closed session refused', 'rejected calls never reach proxy', 'no second MCP client',
  ] }, null, 2));
  console.log('MCP session actual Host/ACP proxy checks passed (explicit stub; no MCP execution or UI claimed).');
} finally { if (!stopped) host.kill(); await fixture.close(); }
