import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { DesktopAppUse } from '../../../desktop/src/main/app-use-mcp.ts';
import { AppWriteRoutes } from '../../../desktop/src/main/app-write-routes.ts';
import { publicSourceTools } from './scenarios.mjs';
import { paperWritesForSession } from '../research-import/host-harness.mjs';
import { readFileSync } from 'node:fs';
import { PreparedAppWrite } from '../../../desktop/src/main/app-write.ts';

test('public replay registry denies guessed generic and alias legacy writes before backend access', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'source-tool-boundary-'));
  const manifest = JSON.parse(await readFile(new URL('../../../apps/paper-agent/app.json', import.meta.url), 'utf8'));
  const writes = paperWritesForSession(manifest.contributes.writes, publicSourceTools, false);
  let resolved = 0, fetched = 0;
  const routes = new AppWriteRoutes(async action => {
    if (action === 'list') return [{ name: 'paper-agent', enabled: true, version: 'fixture', panels: [{ id: 'main' }], writes }];
    assert.equal(action, 'resolve'); resolved++;
    return { backend: { url: 'http://127.0.0.1/not-a-server', token: 'local-fixture-token' } };
  }, () => {}, async () => { fetched++; return new Response('{"fixture":true}'); });
  const desktop = new DesktopAppUse({ selectedThread: async () => 'test-thread', presence() {},
    page: async () => assert.fail('No UI capability'), capture: async () => assert.fail('No capture capability') }, () => {}, directory, routes);
  try {
    const endpoint = await desktop.start();
    desktop.accept({ kind: 'session_created', thread_id: 'test-thread', data: { scope: { app: 'paper-agent', panel: 'main' }, appBinding: { app: 'paper-agent' } } });
    desktop.accept({ kind: 'turn_started', thread_id: 'test-thread' });
    const call = async (name, args) => {
      const response = await fetch(endpoint.PERO_APP_USE_URL, { method: 'POST',
        headers: { Authorization: `Bearer ${endpoint.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': 'test-thread' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      return (await response.json()).result;
    };
    const allowed = await call('app__paper-agent__research-source-read', { operation: 'list', bundleId: 'a'.repeat(64), resourceId: 'b'.repeat(64) });
    assert.equal(allowed.isError, false); assert.equal(resolved, 1); assert.equal(fetched, 1);
    for (const tool of ['prepare-research', 'import-paper', 'research-pdf', 'research-assets']) {
      for (const [name, args] of [['app_write', { app: 'paper-agent', tool, document: {} }], [`app__paper-agent__${tool}`, {}]]) {
        const denied = await call(name, args);
        assert.equal(denied.isError, true); assert.match(denied.content[0].text, /APP_WRITE_UNKNOWN/);
      }
    }
    for (const [name, args] of [
      ['app_write', { app: 'paper-agent', tool: 'research-source-read', document: { operation: 'image', bundleId: 'a'.repeat(64), resourceId: 'b'.repeat(64), memberId: 'c'.repeat(64) } }],
      ['app__paper-agent__research-source-read', { operation: 'image', bundleId: 'a'.repeat(64), resourceId: 'b'.repeat(64), memberId: 'c'.repeat(64) }],
    ]) {
      const denied = await call(name, args);
      assert.equal(denied.isError, true);
      assert.equal(fetched, 1, 'Text-only image operation must be rejected before backend fetch');
    }
    assert.equal(resolved, 1, 'Denied routes reached backend resolution');
    assert.equal(fetched, 1, 'Denied routes reached backend fetch');
  } finally { await desktop.close(); await rm(directory, { recursive: true, force: true }); }
});

test('image-enabled campaign preserves image schema and does not mutate the original manifest', () => {
  const writes = JSON.parse(readFileSync(new URL('../../../apps/paper-agent/app.json', import.meta.url))).contributes.writes;
  const definition = imageInput => ({ app: 'paper-agent', panel: 'main', version: 'fixture',
    ...paperWritesForSession(writes, undefined, imageInput).find(write => write.name === 'research-source-read') });
  const image = { operation: 'image', bundleId: 'a'.repeat(64), resourceId: 'b'.repeat(64), memberId: 'c'.repeat(64) };
  assert.throws(() => new PreparedAppWrite(definition(false), image));
  assert.doesNotThrow(() => new PreparedAppWrite(definition(true), image));
  assert(writes.find(write => write.name === 'research-source-read').schema.properties.operation.enum.includes('image'));
});
