import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { HostConnectors } from '../src/host.mjs';
import { MCPSession } from '../src/session.mjs';
import { readPortableRegistry } from '../src/portable-registry.mjs';
import { fixture } from './fixtures/http.mjs';

test('Host persists configuration, fences stale conversations and edits, and never exports secrets', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pero-connectors-host-'));
  const remote = await fixture(), values = new Map();
  const options = { root, executable: resolve(import.meta.dirname, '../../../target/debug/pero-connector-worker'),
    store: { read: async key => values.get(key) ?? null, write: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); } },
    authorize: async () => {}, openURL: async () => {} };
  let host = new HostConnectors(options);
  t.after(async () => { await host.close(); await remote.close(); await rm(root, { recursive: true, force: true }); });
  await host.start();
  const frozenRevision = (await readPortableRegistry(host.registry)).revision;
  const definition = { transport: 'http', url: remote.origin + '/mcp', allowLoopbackHttp: true, tools: ['counter'] };
  assert.equal((await host.request({ operation: 'put', connectorId: 'fixture', definition })).ok, true);
  const stale = new MCPSession({ executable: options.executable, registry: host.registry, expectedRevision: frozenRevision });
  await assert.rejects(stale.open(), { code: 'MCP_CONFIG_CHANGED' });
  await stale.retire();
  const list = async () => (await host.request({ operation: 'list' })).result;
  let entry = (await list()).find(item => item.connectorId === 'fixture');
  assert.equal((await host.request({ operation: 'put', connectorId: 'fixture', definition, expectedRevision: 'stale' })).code, 'MCP_CONFIG_CONFLICT');
  assert.equal((await host.request({ operation: 'verify', connectorId: 'fixture' })).result.toolCount, 1);
  const first = await host.call('conversation', 'fixture', 'counter', {});
  assert.equal(JSON.parse(first.content[0].text).count, 1);
  await assert.rejects(host.call('conversation', 'fixture', 'not-allowed', {}), { code: 'MCP_TOOL_DENIED' });
  assert.equal((await host.request({ operation: 'enable', connectorId: 'fixture', enabled: false, expectedRevision: entry.revision })).ok, true);
  await assert.rejects(host.call('conversation', 'fixture', 'counter', {}), { code: 'MCP_CONFIG_CHANGED' });
  await assert.rejects(host.call('new-conversation', 'fixture', 'counter', {}), { code: 'MCP_TOOL_DENIED' });
  await host.close(); host = new HostConnectors(options); await host.start();
  entry = (await list()).find(item => item.connectorId === 'fixture');
  assert.equal(entry.enabled, false);
  assert.equal((await host.request({ operation: 'enable', connectorId: 'fixture', enabled: true, expectedRevision: entry.revision })).ok, true);
  entry = (await list()).find(item => item.connectorId === 'fixture');
  const credentialDefinition = { ...definition, headers: { 'X-Resource-Key': { secretRef: 'fixture.secret' } } };
  assert.equal((await host.request({ operation: 'put', connectorId: 'fixture', definition: credentialDefinition, expectedRevision: entry.revision })).ok, true);
  assert.equal((await host.request({ operation: 'secret.set', reference: 'fixture.secret', value: 'private-value' })).ok, true);
  assert.ok(values.size > 0);
  assert.ok(!JSON.stringify(await host.request({ operation: 'snapshot' })).includes('private-value'));
  assert.ok(!(await readFile(host.registry, 'utf8')).includes('private-value'));
  assert.equal(JSON.parse((await host.call('authorized', 'fixture', 'counter', {})).content[0].text).count, 1);
  assert.equal(remote.metrics.publicHeader, true);
  assert.equal((await host.request({ operation: 'secret.delete', reference: 'fixture.secret' })).ok, true);
  await assert.rejects(host.call('authorized', 'fixture', 'counter', {}), { code: 'MCP_CONFIG_CHANGED' });
  entry = (await list()).find(item => item.connectorId === 'fixture');
  assert.equal((await host.request({ operation: 'remove', connectorId: 'fixture', expectedRevision: entry.revision })).ok, true);
  assert.equal((await list()).some(item => item.connectorId === 'fixture'), false);
});

test('cancellation retires the active connector without replaying an uncertain effect', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pero-connectors-cancel-')), remote = await fixture();
  const host = new HostConnectors({ root, executable: resolve(import.meta.dirname, '../../../target/debug/pero-connector-worker'),
    store: { read: async () => null, write: async () => {}, remove: async () => {} }, authorize: async () => {}, openURL: async () => {} });
  const hold = remote.holdCalls();
  t.after(async () => { hold.release(); await host.close(); await remote.close(); await rm(root, { recursive: true, force: true }); });
  await host.start();
  assert.equal((await host.request({ operation: 'put', connectorId: 'fixture', definition: { transport: 'http', url: remote.origin + '/mcp', allowLoopbackHttp: true, tools: ['counter'] } })).ok, true);
  const abort = new AbortController();
  const pending = host.call('conversation', 'fixture', 'counter', {}, abort.signal);
  const rejected = assert.rejects(pending, { code: 'ABORT_ERR' });
  await hold.entered; abort.abort(); await rejected;
  await assert.rejects(host.call('conversation', 'fixture', 'counter', {}), { code: 'MCP_SESSION_RETIRED' });
  assert.equal(remote.metrics.calls, 1);
});

test('management refuses disabled App authority and messaging channel transports', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pero-connectors-denied-'));
  const host = new HostConnectors({ root, executable: process.execPath, store: { read: async () => null, write: async () => {}, remove: async () => {} }, authorize: async () => { throw new Error('disabled'); }, openURL: async () => {} });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  await host.start();
  assert.equal((await host.request({ operation: 'put', connectorId: 'denied', definition: { transport: 'http', url: 'https://example.com/mcp', tools: [] } })).ok, false);
  assert.equal((await host.request({ operation: 'put', connectorId: 'bot', definition: { transport: 'websocket', tools: [] } })).code, 'MCP_TRANSPORT_UNSUPPORTED');
});

test('pinned stdio accepts ordinary environment settings while credentials remain references', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pero-connectors-stdio-')), values = new Map();
  const host = new HostConnectors({ root, executable: resolve(import.meta.dirname, '../../../target/debug/pero-connector-worker'),
    store: { read: async key => values.get(key) ?? null, write: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); } }, authorize: async () => {}, openURL: async () => {} });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  await host.start();
  const command = await realpath(process.execPath), script = resolve(import.meta.dirname, 'fixtures/stdio.mjs');
  const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const definition = { transport: 'stdio', command, sha256: await digest(command), args: [script], files: [{ path: script, sha256: await digest(script) }], tools: ['read_binding'], env: { PROJECT_NAME: 'fixture', API_TOKEN: { secretRef: 'stdio.token' } } };
  const plaintext = { ...definition, env: { API_TOKEN: 'stdio-private-value' } };
  assert.equal((await host.request({ operation: 'put', connectorId: 'plaintext', definition: plaintext })).code, 'MCP_CREDENTIAL_STORE_UNAVAILABLE');
  assert.equal((await host.request({ operation: 'put', connectorId: 'stdio', definition })).ok, true);
  assert.equal((await host.request({ operation: 'secret.set', reference: 'stdio.token', value: 'stdio-private-value' })).ok, true);
  const result = await host.call('stdio-conversation', 'stdio', 'read_binding', {});
  assert.deepEqual(JSON.parse(result.content[0].text), { label: 'fixture', authenticated: true });
});
