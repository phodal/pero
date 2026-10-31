import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAutomationTransport } from '../ui-src/transport.ts';

test('Point REST and connector calls use their declared Host capabilities and preserve HTTP outcomes', async () => {
  const original = globalThis.fetch;
  const desktop = globalThis.pointGoDesktop;
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    if (path === '/host/connectors') return Response.json({ ok: true, connections: [] });
    const command = JSON.parse(options.body);
    if (command.method === 'DELETE') return Response.json({ status: 204, body: null });
    if (command.path.endsWith('/conflict')) return Response.json({ status: 409, body: { error: 'Revision changed' } });
    return Response.json({ status: 200, body: { items: [] } });
  };
  try {
    installAutomationTransport();
    const response = await fetch('/api/automations');
    assert.deepEqual(await response.json(), { items: [] });
    assert.deepEqual(JSON.parse(calls[0].options.body), { method: 'GET', path: '/api/automations', body: null });
    assert.equal((await fetch('/api/automations/conflict', { method: 'PUT', body: JSON.stringify({ enabled: true }) })).status, 409);
    assert.equal(await (await fetch('/api/automations/item', { method: 'DELETE' })).text(), '');
    assert.deepEqual(await globalThis.pointGoDesktop.workbench('connectors', { operation: 'snapshot' }), { ok: true, connections: [] });
    assert.equal(calls.at(-1).path, '/host/connectors');
    await assert.rejects(globalThis.pointGoDesktop.workbench('sessions', {}), /declared Connectors/);
  } finally {
    globalThis.fetch = original;
    globalThis.pointGoDesktop = desktop;
  }
});
