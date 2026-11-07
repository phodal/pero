import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftIssue, endpoint, importServers, matchingServers, needsAttention, runtimeOf,
  serverFromDraft, withEnabled, withImported, withServer, withoutServer,
} from '../ui-src/custom-mcp-model.mjs';

const http = { name: 'docs', enabled: false, transport: { type: 'http', url: 'https://example.test/mcp' } };

test('drafts save disabled and edits revoke a grant', () => {
  const added = serverFromDraft({ name: ' docs ', transport: 'http', url: 'https://example.test/mcp', command: '', argsText: '[]', policy: 'legacy', toolsText: '{}' });
  assert.equal(added.enabled, false);
  assert.equal(added.name, 'docs');
  const enabled = withEnabled([added], 0, true);
  assert.equal(enabled[0].enabled, true);
  const edited = withServer(enabled, 0, { ...added, name: 'docs' });
  assert.equal(edited[0].enabled, false);
  assert.deepEqual(withoutServer(edited, 0), []);
});

test('stdio arguments and tool rules are admitted once', () => {
  const server = serverFromDraft({
    name: 'local', transport: 'stdio', command: '/usr/bin/server', argsText: '["--port","8080"]',
    url: '', policy: 'ask', toolsText: '{"search":"allow","delete":"deny"}',
  });
  assert.deepEqual(server.transport, { type: 'stdio', command: '/usr/bin/server', args: ['--port', '8080'] });
  assert.deepEqual(server.tool_policy, { default: 'ask', tools: { search: 'allow', delete: 'deny' } });
  assert.equal(draftIssue({ ...server, name: '', transport: 'stdio', command: 'server', argsText: '[]', url: '', policy: 'legacy', toolsText: '{}' }), 'name');
  assert.equal(draftIssue({ name: 'local', transport: 'stdio', command: 'server', argsText: '[]', url: '', policy: 'legacy', toolsText: '{}' }), 'command');
  assert.equal(draftIssue({ name: 'local', transport: 'http', command: '', argsText: '[]', url: 'https://user:secret@example.test/mcp', policy: 'legacy', toolsText: '{}' }), 'url');
  assert.equal(draftIssue({ name: 'local', transport: 'stdio', command: '/bin/server', argsText: '[]', url: '', policy: 'deny', toolsText: '{"drop":"keep"}' }), 'tools');
});

test('import rejects extra fields and forces every server disabled', () => {
  const imported = importServers(JSON.stringify([http, { name: 'local', enabled: true, transport: { type: 'stdio', command: '/bin/server' } }]));
  assert.equal(imported.every(server => server.enabled === false), true);
  assert.equal(endpoint(imported[1]), '/bin/server');
  assert.throws(() => importServers('{"mcpServers":{}}'), /import/);
  assert.throws(() => importServers(JSON.stringify([{ ...http, env: { TOKEN: 'secret' } }])), /import/);
  assert.deepEqual(withImported([http], imported).map(server => server.enabled), [false, false, false]);
});

test('attention and search follow enablement and the latest observation', () => {
  const enabled = { ...http, enabled: true };
  const sessions = [{ observable: true, closed: false, servers: [{ server: 'docs', status: 'error', tools: [] }] }, { observable: true, closed: false, servers: [{ server: 'docs', status: 'connected', tools: ['search'] }] }];
  assert.equal(needsAttention(enabled, sessions), false);
  assert.equal(runtimeOf('docs', sessions).status, 'connected');
  assert.equal(needsAttention(http, sessions), true);
  assert.equal(needsAttention(enabled, [{ observable: true, closed: false, servers: [{ server: 'docs', status: 'disconnected', tools: [] }] }]), true);
  assert.equal(runtimeOf('docs', [{ observable: false, closed: false, servers: [] }]).status, 'unobservable');
  assert.deepEqual(matchingServers([enabled, { name: 'other', enabled: true, transport: { type: 'stdio', command: '/bin/other' } }], 'example.test').map(server => server.name), ['docs']);
});
