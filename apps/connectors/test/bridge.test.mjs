import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorRequest } from '../ui-src/bridge.ts';

test('Host failures preserve their cause without replaying a management request', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const [status, body, expected] of [
    [403, 'App grant refused', 'MCP_HOST_FORBIDDEN'],
    [404, 'Missing route', 'MCP_HOST_ROUTE_UNAVAILABLE'],
    [405, 'Method refused', 'MCP_HOST_ROUTE_UNAVAILABLE'],
    [503, 'Host stopped', 'MCP_HOST_UNAVAILABLE'],
    [503, '{"ok":false,"code":"MCP_PLATFORM_UNSUPPORTED"}', 'MCP_PLATFORM_UNSUPPORTED'],
    [200, '{"directory":[]}', 'MCP_HOST_INVALID_RESPONSE'],
    [200, '{"ok":false,"code":"MCP_CONFIG_CONFLICT"}', 'MCP_CONFIG_CONFLICT'],
  ]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(body, { status }); };
    assert.deepEqual(await connectorRequest({ operation: 'snapshot' }), { ok: false, code: expected });
    assert.equal(calls, 1);
  }
  globalThis.fetch = async () => { throw new TypeError('Host gone'); };
  assert.equal((await connectorRequest({ operation: 'snapshot' })).code, 'MCP_HOST_UNAVAILABLE');
});
