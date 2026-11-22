// Real macOS Native Workbench, stdio Host, ACP session, MCP, and WebKit.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { browserInputCommands, browserInputFrame, browserInputPage, verifyBrowserInputs } from '../fixtures/browser-use-inputs.mjs';

assert.equal(process.platform, 'darwin');
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-browser-'));
let jumpHits = 0, foreignHits = 0;
const foreign = createServer((_request, response) => { foreignHits++; response.end('Other site'); });
await new Promise(done => foreign.listen(0, '127.0.0.1', done));
const server = createServer((request, response) => {
  if (request.url === '/jump') {
    jumpHits++;
    response.writeHead(302, { Location: 'http://127.0.0.1:' + foreign.address().port });
    response.end();
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(request.url === '/batch-frame' ? browserInputFrame : browserInputPage);
});
await new Promise((done, fail) => {
  server.once('error', fail);
  server.listen(0, '127.0.0.1', done);
});
let child, timer;
try {
  const data = resolve(temp, 'data');
  const workspace = resolve(temp, 'workspace');
  const output = resolve(root, 'test-results/native-browser-use');
  const agents = resolve(temp, 'agents.json');
  const receipt = resolve(output, 'session.json');
  await Promise.all([mkdir(data), mkdir(workspace), mkdir(output, { recursive: true })]);
  await rm(receipt, { force: true });
  await writeFile(agents, JSON.stringify([{ id: 'browser-use-fixture', name: 'Browser Use fixture', command: process.execPath,
    args: [resolve(root, 'tests/fixtures/browser-use-agent.mjs')] }]));
  await writeFile(resolve(data, 'settings.json'), JSON.stringify({ chat_agent: 'browser-use-fixture' }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const commands = [...browserInputCommands, { action: 'navigate', url: origin + '/jump' }];
  child = spawn(process.env.PERO_NATIVE_BROWSER_BINARY || resolve(root, 'target/debug/pero-native'),
    ['--verify-apps', receipt, 'browser'], {
      cwd: root,
      env: { ...process.env, PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: data,
        PERO_AGENTS_FILE: agents, PERO_ADAPTER_NODE: process.execPath, PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en',
        PERO_NATIVE_BROWSER_PROBE_WORKSPACE: workspace, PERO_NATIVE_BROWSER_PROBE_COMMANDS: JSON.stringify(commands),
        PERO_NATIVE_BROWSER_PROBE_URL: origin + '/' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let log = '';
  child.stderr.on('data', chunk => { log += chunk; });
  child.stdout.on('data', chunk => { log += chunk; });
  timer = setTimeout(() => child.kill('SIGTERM'), 65_000);
  const exit = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  await writeFile(resolve(output, 'native.log'), log);
  assert.deepEqual(exit, { code: 0, signal: null }, log);
  const session = JSON.parse(await readFile(receipt, 'utf8'));
  assert.equal(session.passed, true, session.error);
  assert(session.mcp.servers.some(server => server.server === 'pero-app-use'));
  const [before, results, after] = session.replies;
  assert.deepEqual(before, [{ authorized: false, isError: false }]);
  verifyBrowserInputs(results.slice(0, -1));
  assert.equal(jumpHits, 1);
  assert.equal(foreignHits, 0);
  assert.deepEqual(after, before);
  const directory = resolve(data, 'browser-use-evidence', createHash('sha256').update(session.thread).digest('hex'));
  const receipts = await readdir(directory);
  for (const { receiptId } of results.filter(result => result.receiptId)) {
    assert(receipts.includes(receiptId + '.intent.json'));
    const result = JSON.parse(await readFile(resolve(directory, receiptId + '.result.json'), 'utf8'));
    assert.equal(result.outcome, 'dispatched');
  }
  console.log('Native Browser Use passed through GPUI → Host → ACP/MCP → WKWebView, including trusted events, two attachments, and revoke.');
} finally {
  clearTimeout(timer);
  child?.kill();
  await Promise.all([server, foreign].map(server => new Promise(done => server.close(done))));
  await rm(temp, { recursive: true, force: true });
}
