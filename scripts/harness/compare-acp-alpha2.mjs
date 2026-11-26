// Opt-in, no-model smoke of the two actual executables. See
// docs/fitness/dsh-alpha2-alignment.md for setup and scope.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [dshPackage, peroBinary] = process.argv.slice(2);
assert.ok(dshPackage && peroBinary,
  'usage: node scripts/harness/compare-acp-alpha2.mjs <DSH package.json> <pero-agent-acp binary>');
const manifest = JSON.parse(await readFile(dshPackage, 'utf8'));
const dshVersion = '0.2.3-alpha.2';
assert.equal(manifest.name, '@deepseek-ai/dsh');
assert.equal(manifest.version, dshVersion);
const dshEntry = resolve(dirname(dshPackage), manifest.bin.dsh);
const root = await realpath(await mkdtemp(join(tmpdir(), 'pero-dsh-acp-')));
const timeoutMillis = 15000;
let providerRequests = 0;
const provider = createServer((_request, response) => {
  providerRequests++;
  response.writeHead(500).end();
});
const key = 'offline-fixture-only';

async function withAgent(engine, paths, run) {
  const endpoint = `http://127.0.0.1:${provider.address().port}`;
  const child = spawn(engine.command, engine.args({ ...paths, endpoint }), {
    cwd: paths.workspace,
    env: {
      PATH: process.env.PATH,
      HOME: paths.home,
      USERPROFILE: paths.home,
      XDG_CONFIG_HOME: join(paths.home, 'config'),
      XDG_DATA_HOME: join(paths.home, 'data'),
      XDG_CACHE_HOME: join(paths.home, 'cache'),
      DSH_HOME: join(paths.home, 'dsh'),
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_BASE_URL: endpoint,
      DEEPSEEK_API_KEY: key,
      PERO_FIXTURE_API_KEY: key,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume();
  child.stdin.on('error', () => {});
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  exited.catch(() => {}); // also observed on request/close below
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let nextID = 0;
  const updates = [];
  function bounded(operation, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${engine.name}: ${label} timed out`)), timeoutMillis);
    });
    return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
  }
  async function ask(method, params) {
    const id = ++nextID;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return bounded((async () => {
      for (;;) {
        const next = await lines.next();
        assert.ok(!next.done, `${engine.name}: stdout closed during ${method}`);
        const message = JSON.parse(next.value);
        assert.equal(message.jsonrpc, '2.0');
        if (message.id === undefined && message.method === 'session/update') {
          updates.push(message.params?.update?.sessionUpdate);
          continue;
        }
        assert.equal(message.id, id, `${engine.name}: unexpected message during ${method}`);
        return message;
      }
    })(), method);
  }
  async function request(method, params) {
    const result = await ask(method, params);
    assert.equal(result.error, undefined, `${engine.name}: ${method} returned RPC error ${result.error?.code}`);
    return result.result;
  }
  try {
    const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    assert.equal(init.protocolVersion, 1);
    for (const capability of ['list', 'close', 'resume']) {
      assert.ok(Object.hasOwn(init.agentCapabilities.sessionCapabilities, capability), capability);
    }
    const result = await run({ ask, request, updates, capabilities: init.agentCapabilities });
    child.stdin.end();
    assert.deepEqual(await bounded(exited, 'shutdown'), { code: 0, signal: null });
    return result;
  } finally {
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited.catch(() => {});
  }
}

async function compare(engine) {
  const home = join(root, engine.name);
  const workspace = join(home, 'workspace');
  const other = join(home, 'other-workspace');
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(other, { recursive: true })]);
  const paths = { home, workspace };
  const params = { cwd: workspace, mcpServers: [] };
  const sessionId = await withAgent(engine, paths, async ({ request }) => {
    const created = await request('session/new', params);
    assert.equal(typeof created.sessionId, 'string');
    assert.ok(created.sessionId);
    assert.deepEqual((await request('session/list', { cwd: workspace })).sessions, []);
    await request('session/close', { sessionId: created.sessionId });
    return created.sessionId;
  });
  return withAgent(engine, paths, async ({ ask, request, updates, capabilities }) => {
    const list = await request('session/list', { cwd: workspace });
    assert.deepEqual(list.sessions.map(s => [s.sessionId, s.cwd]), [[sessionId, workspace]]);
    assert.deepEqual((await request('session/list', { cwd: other })).sessions, []);
    const wrong = await ask('session/resume', { ...params, cwd: other, sessionId });
    assert.equal(typeof wrong.error?.code, 'number', 'wrong workspace must not resume');
    await request('session/resume', { ...params, sessionId });
    assert.deepEqual((await request('session/list', { cwd: workspace })).sessions, []);
    assert.ok(!updates.some(kind => ['agent_message_chunk', 'user_message_chunk', 'tool_call'].includes(kind)),
      'empty session resume must not emit conversation messages or tool calls');
    await request('session/close', { sessionId });
    const supportsLoad = capabilities.loadSession === true;
    assert.equal(supportsLoad, engine.name === 'pero', 'expected alpha.2 capability difference changed');
    if (supportsLoad) {
      await request('session/load', { ...params, sessionId });
      await request('session/close', { sessionId });
    }
    return {
      engine: engine.name, protocolVersion: 1,
      newCloseRestartListResume: 'passed', differentWorkspaceRejected: true,
      loadSession: supportsLoad ? 'advertised; empty history load passed' : 'not advertised',
    };
  });
}

try {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const engines = [
    { name: 'dsh', command: process.execPath, args: () => [dshEntry, '--profile', 'acp'] },
    { name: 'pero', command: resolve(peroBinary), args: ({ home, endpoint }) => [
      '--endpoint', endpoint, '--model', 'fixture', '--api-key-env', 'PERO_FIXTURE_API_KEY',
      '--session-dir', join(home, 'sessions'), '--approval', 'never',
    ] },
  ];
  const results = [];
  for (const engine of engines) results.push(await compare(engine));
  assert.equal(providerRequests, 0, 'empty lifecycle should make no provider requests');
  console.log(JSON.stringify({ dshVersion, scope: 'empty ACP lifecycle; no prompts', providerRequests, results }, null, 2));
} finally {
  if (provider.listening) await new Promise(resolveClose => provider.close(resolveClose));
  await rm(root, { recursive: true, force: true });
}
