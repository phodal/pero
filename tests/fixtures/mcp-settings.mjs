// A disposable ACP boundary plus an inert loopback endpoint. The ACP fixture
// records injection; neither it nor the UI pretends to connect to an MCP server.
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function mcpSettingsFixture(root) {
  const temp = await mkdtemp(resolve(tmpdir(), 'pero-mcp-settings-'));
  let requests = 0;
  const server = createServer((request, response) => {
    requests++; response.writeHead(503); response.end('Fixture does not provide MCP connectivity');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const secret = randomUUID(), capture = resolve(temp, 'sessions.jsonl');
  const settings = resolve(temp, 'settings.json'), agents = resolve(temp, 'agents.json');
  await writeFile(capture, '', { mode: 0o600 });
  await writeFile(settings, JSON.stringify({ unrelated: { preserved: true } }));
  await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'MCP acceptance fixture',
    command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), `--session-capture=${capture}`],
    mcp_servers: [{ name: 'operator-only', command: process.execPath, args: [], env: [{ name: 'TOKEN', value: secret }] }],
  }]), { mode: 0o600 });
  return {
    temp, settings, secret, url,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
      PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' },
    requests: () => requests,
    sessions: async () => (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),
    close: async () => { await new Promise(done => server.close(done)); await rm(temp, { recursive: true, force: true }); },
  };
}
