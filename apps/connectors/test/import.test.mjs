import test from 'node:test';
import assert from 'node:assert/strict';
import { importConnectorJSON } from '../ui-src/shared/import-json.mjs';

const note = (result, fragment) => result.notes.some(item => item.includes(fragment));

test('the wrapper shapes other MCP clients write are all accepted', () => {
  const server = { url: 'https://mcp.example.com/mcp' };
  for (const document of [
    { mcpServers: { docs: server } },
    { servers: { docs: server } },
    { mcp_servers: { docs: server } },
    { docs: server },
  ]) {
    const result = importConnectorJSON(JSON.stringify(document));
    assert.equal(result.connectorId, 'docs');
    assert.equal(result.definition.url, 'https://mcp.example.com/mcp');
    assert.equal(result.definition.transport, 'http');
  }
  // A bare server object has no name to take, so the user supplies one.
  const bare = importConnectorJSON(JSON.stringify(server));
  assert.equal(bare.connectorId, '');
  assert.equal(bare.definition.url, 'https://mcp.example.com/mcp');
});

test('a stdio snippet keeps what was written and names what it still needs', () => {
  const result = importConnectorJSON(JSON.stringify({
    mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/srv'], env: { TOKEN: 'literal-secret' } } },
  }));
  assert.equal(result.connectorId, 'filesystem');
  assert.equal(result.definition.transport, 'stdio');
  // The launcher is preserved rather than rewritten: the user has to resolve
  // it, and can only do that if they can still see what the snippet said.
  assert.equal(result.definition.command, 'npx');
  assert.deepEqual(result.definition.args, ['-y', '@modelcontextprotocol/server-filesystem', '/srv']);
  assert.deepEqual(result.definition.env, { TOKEN: 'literal-secret' });
  assert.equal(note(result, '不是绝对路径'), true);
  assert.equal(note(result, 'SHA-256'), true);
  assert.equal(note(result, 'secretRef'), true);
  assert.equal(note(result, '工具白名单'), true);
});

test('a literal Authorization header is dropped with an instruction, not carried to a save-time rejection', () => {
  const result = importConnectorJSON(JSON.stringify({
    mcpServers: { api: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer sk-live-1234', 'X-Tenant': 'acme' } } },
  }));
  assert.equal(JSON.stringify(result.definition).includes('sk-live-1234'), false);
  assert.deepEqual(result.definition.headers, { 'X-Tenant': 'acme' });
  assert.equal(note(result, '系统凭据存储'), true);
});

test('legacy SSE is refused rather than rewritten into a different endpoint', () => {
  for (const server of [{ type: 'sse', url: 'https://mcp.example.com/sse' }, { transport: 'sse', url: 'https://mcp.example.com/sse' }]) {
    assert.throws(() => importConnectorJSON(JSON.stringify({ mcpServers: { legacy: server } })), { code: 'MCP_TRANSPORT_UNSUPPORTED' });
  }
});

test('unsafe or unusable documents fail with an actionable code', () => {
  for (const [text, code] of [
    ['{not json', 'MCP_IMPORT_JSON'],
    ['[]', 'MCP_IMPORT_JSON'],
    ['{}', 'MCP_IMPORT_SHAPE'],
    [JSON.stringify({ mcpServers: {} }), 'MCP_IMPORT_EMPTY'],
    [JSON.stringify({ mcpServers: { x: { url: 'not-a-url' } } }), 'MCP_IMPORT_URL'],
    [JSON.stringify({ mcpServers: { x: { url: 'http://example.com/mcp' } } }), 'MCP_IMPORT_URL'],
    [JSON.stringify({ mcpServers: { x: { command: '/bin/x', args: [1] } } }), 'MCP_IMPORT_ARGS'],
    [JSON.stringify({ mcpServers: { x: { note: 'neither command nor url' } } }), 'MCP_IMPORT_SHAPE'],
  ]) {
    assert.throws(() => importConnectorJSON(text), value => value.code === code, `${text} should fail with ${code}`);
  }
  // Loopback HTTP is allowed, but only by marking it explicitly.
  const loopback = importConnectorJSON(JSON.stringify({ mcpServers: { dev: { url: 'http://127.0.0.1:3000/mcp' } } }));
  assert.equal(loopback.definition.allowLoopbackHttp, true);
});

test('our own definition shape survives a round trip, and extra servers are reported', () => {
  const own = { transport: 'http', url: 'https://mcp.example.com/mcp', tools: ['search_docs'], callTimeoutMs: 12000, oauth: { issuer: 'https://auth.example', clientId: 'point', redirectUri: 'http://127.0.0.1:34567/callback', scopes: ['tools'], persist: true } };
  const result = importConnectorJSON(JSON.stringify({ mcpServers: { docs: own, extra: { url: 'https://other.example/mcp' } } }));
  assert.deepEqual(result.definition.tools, ['search_docs']);
  assert.deepEqual(result.definition.oauth, own.oauth);
  assert.equal(result.definition.callTimeoutMs, 12000);
  assert.equal(note(result, '只导入'), true);
  assert.equal(note(result, 'extra'), true);
  assert.equal(note(result, '工具白名单'), false, 'a definition that already lists tools needs no reminder');
});

test('a name the connector grammar cannot accept is reported instead of silently rewritten', () => {
  const result = importConnectorJSON(JSON.stringify({ mcpServers: { '我的 服务': { url: 'https://mcp.example.com/mcp' } } }));
  assert.equal(result.connectorId, '');
  assert.equal(note(result, '连接 ID'), true);
});

test('English callers get English notes and errors with the same codes', () => {
  const result = importConnectorJSON(JSON.stringify({ mcpServers: { x: { command: 'npx', args: ['server'] } } }), 'en');
  assert.ok(result.notes.length > 0);
  assert.ok(result.notes.every(text => !/[一-鿿]/.test(text)), result.notes.join(' '));
  assert.equal(note(result, 'absolute path'), true);
  assert.throws(() => importConnectorJSON('{not json', 'en'), value => value.code === 'MCP_IMPORT_JSON' && /valid JSON/.test(value.message));
});
