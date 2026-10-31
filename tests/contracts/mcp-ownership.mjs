// Both MCP composition routes share Host, not configuration stores or grants.
// Uses the settings fixture's inert endpoint; never connects an MCP client.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };
import { mcpSettingsFixture } from '../fixtures/mcp-settings.mjs';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/mcp-ownership');
await mkdir(out, { recursive: true });
await rm(resolve(out, 'result.json'), { force: true });
const fixture = await mcpSettingsFixture(root);
const env = { ...fixture.env };
delete env.PERO_MCP_EXTERNAL;
const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: fixture.temp, env });
const exited = once(child, 'exit');
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let stderr = '', fixtureClosed = false;
child.stderr.on('data', value => { stderr += value; });
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const input = ajv.getSchema(`${schema.$id}#/$defs/HostInput`);
const output = ajv.getSchema(`${schema.$id}#/$defs/HostEvent`);
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 15000);
  })]); } finally { clearTimeout(timer); }
}
async function next(kind, requestId) {
  return bounded((async () => {
    while (true) {
      const line = await lines.next();
      assert(!line.done, `Host stopped before ${kind}`);
      const event = JSON.parse(line.value);
      assert(!line.value.includes(fixture.secret), 'operator credential reached Host events');
      if (event.kind === 'mcp_error' && kind !== 'mcp_error' && event.request_id === requestId)
        throw new Error(`Host rejected ${requestId}: ${event.text}`);
      if (event.kind === kind && (requestId === undefined || event.request_id === requestId)) {
        assert(output(event), `${event.kind}: ${ajv.errorsText(output.errors)}`);
        return event;
      }
    }
  })(), kind);
}
function send(value) {
  assert(input(value), ajv.errorsText(input.errors));
  child.stdin.write(JSON.stringify(value) + '\n');
}
try {
  await next('ready');
  send({ method: 'settings.mcp.get', request_id: 'settings-read', agent_id: 'fixture' });
  const current = (await next('mcp_settings', 'settings-read')).data;
  const managed = { name: 'shared-name', enabled: false, transport: { type: 'http', url: fixture.url } };
  send({ method: 'settings.mcp.set', request_id: 'settings-save', agent_id: 'fixture', revision: current.revision, servers: [managed] });
  const saved = (await next('mcp_settings', 'settings-save')).data;
  send({ method: 'mcp', action: 'open', request_id: 'apps-denied', thread_id: 'not-admitted' });
  assert.match((await next('mcp_error', 'apps-denied')).text, /unavailable/);
  send({ method: 'mcp', action: 'open', request_id: 'apps-open' });
  const panel = new URL((await next('mcp_sources', 'apps-open')).data.url);
  assert.equal(panel.hostname, '127.0.0.1');
  assert.equal((await fetch(panel, { signal: AbortSignal.timeout(15000) })).status, 200);
  const command = async value => {
    const response = await fetch(new URL('/api', panel), { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Origin: panel.origin, Authorization: `Bearer ${panel.searchParams.get('token')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value) });
    assert(response.ok, `MCP Apps command failed (${response.status})`); return response.json();
  };
  assert.deepEqual(await command({ action: 'list' }), [], 'Agent settings must not populate MCP Apps');
  const apps = { id: 'shared-name', title: 'Independent MCP Apps config', transport: 'http', url: fixture.url, header_env: {} };
  const projection = await command({ action: 'configure', config: apps });
  assert.equal(projection[0].connected, false);
  send({ method: 'settings.mcp.get', request_id: 'settings-after-apps', agent_id: 'fixture' });
  assert.deepEqual((await next('mcp_settings', 'settings-after-apps')).data, saved, 'MCP Apps must not change Agent settings');
  const appsFile = resolve(dirname(fixture.settings), 'mcp-servers.json');
  assert.deepEqual(JSON.parse(await readFile(appsFile, 'utf8')), [apps]);
  send({ method: 'settings.mcp.set', request_id: 'settings-remove', agent_id: 'fixture', revision: saved.revision, servers: [] });
  assert.deepEqual((await next('mcp_settings', 'settings-remove')).data.servers, []);
  assert.deepEqual(JSON.parse(await readFile(appsFile, 'utf8')), [apps], 'Agent settings must not overwrite MCP Apps store');
  assert.equal((await command({ action: 'list' })).length, 1);
  assert.equal(fixture.requests(), 0, 'Configuration must not connect either MCP route');
  child.stdin.end();
  assert.deepEqual(await bounded(exited, 'Host/provider graceful close'), [0, null]);
  await assert.rejects(fetch(panel, { signal: AbortSignal.timeout(1000) }), 'provider listener must close with Host');
  assert(!stderr.includes(fixture.secret), 'operator credential leaked in stderr');
  await fixture.close(); fixtureClosed = true;
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, checks: [
    'both real Host routes conform to schema', 'MCP Apps rejects unknown thread', 'real Node provider serves loopback panel',
    'same name remains independent across stores', 'settings removal preserves MCP Apps configuration',
    'configuration does not grant connectivity', 'Host and provider close before success receipt',
  ] }, null, 2));
  console.log('MCP ownership acceptance passed: independent stores/routes and graceful Host/provider teardown.');
} finally {
  try {
    if (child.exitCode === null) {
      child.stdin.end();
      try { await bounded(exited, 'Host cleanup'); } catch (error) { child.kill(); throw error; }
    }
  } finally { if (!fixtureClosed) await fixture.close(); }
}
