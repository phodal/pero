// Real Rust Host, Project Agent and Go ACP harness; only the provider is simulated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { closeLoopback } from '../fixtures/loopback-model.mjs';
import { createFilesFixture, swatches } from '../../scripts/harness/compare-dsh-alpha2-files.mjs';

const root = resolve(import.meta.dirname, '../..');
const home = await realpath(await mkdtemp(join(tmpdir(), 'pero-host-messages-files-')));
const workspace = join(home, 'workspace');
const agent = 'messages-files-fixture';
const project = 'synthetic-image-project';
const key = 'host-messages-files-loopback-only';
const initial = 'Compare two synthetic swatches.';
const followup = 'Use the same swatches in a follow-up.';
const fixture = createFilesFixture(key);
const errors = [];
const server = createServer((req, res) => void fixture.handle(req, res).catch(error => {
  errors.push(error.message);
  if (!res.headersSent) res.writeHead(500);
  res.end('Loopback fixture failed');
}));
let child, exited;
const counts = () => [fixture.uploads.length, fixture.inference.length];
const send = payload => child.stdin.write(JSON.stringify(payload) + '\n');

async function withHost(run) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(PERO_|XDG_|HOME$|USERPROFILE$)/.test(name) && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROXY)/i.test(name)));
  child = spawn(process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host'), ['--stdio'], {
    cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], env: {
      ...env, HOME: home, USERPROFILE: home, NO_PROXY: '127.0.0.1',
      PERO_DESKTOP_DATA_DIR: join(home, 'profile'), PERO_SETTINGS_PATH: join(home, 'settings.json'),
      PERO_HISTORY_PATH: join(home, 'host.jsonl'), PERO_AGENTS_FILE: join(home, 'agents.json'),
      PERO_ENV_FILE: join(home, 'no-env'), PERO_APPS_ROOT: join(home, 'apps'),
      PERO_BUILTIN_APPS_ROOT: '', PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '',
    },
  });
  exited = once(child, 'close');
  void exited.catch(() => {}); // A spawn error may precede the first readiness check.
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') spawnError = error; });
  const events = [];
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => events.push(JSON.parse(line)));
  const wait = async (kinds, match = () => true) => {
    const end = Date.now() + 30_000;
    while (Date.now() < end) {
      assert.deepEqual(errors, []);
      const index = events.findIndex(event => kinds.includes(event.kind) && match(event));
      if (index >= 0) return events.splice(index, 1)[0];
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, stderr);
      await new Promise(done => setTimeout(done, 25));
    }
    throw Error(`Host timeout: ${kinds.join(', ')}. Recent events: ${events.slice(-8).map(event => event.kind).join(', ')}. ${stderr}`);
  };
  await wait(['ready']);
  await run({
    request: async (action, fields = {}) => {
      const request_id = `fixture-${action}`;
      send({ method: 'project_agent', request_id, action, project_id: project, ...fields });
      const event = await wait(['project_agent', 'project_agent_error'], event => event.request_id === request_id);
      assert.equal(event.kind, 'project_agent', event.text);
      return event.data;
    },
    threadEvent: async (kind, thread) => {
      const event = await wait([kind, 'session_error', 'command_rejected', 'permission'], event => event.thread_id === thread);
      assert.equal(event.kind, kind, event.text);
      return event.data;
    },
  });
  assert.deepEqual(await stopHost(), [0, null], stderr);
}

async function stopHost() {
  if (!child?.pid) return;
  child.stdin.end();
  const shutdown = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try { return await exited; }
  finally { clearTimeout(shutdown); child = undefined; }
}

try {
  await mkdir(workspace);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/messages`;
  await writeFile(join(home, 'settings.json'), JSON.stringify({ workbench: { research_projects: [{
    id: project, title: 'Synthetic image evidence', goal: 'Retain the exact image context after reload', workspace, resources: [],
  }] } }));
  await writeFile(join(home, 'agents.json'), JSON.stringify([{ id: agent, name: 'Messages Files loopback',
    command: process.env.PERO_FILES_HARNESS || join(root, 'target/debug/pero-agent-acp'),
    args: ['--endpoint', endpoint, '--api-format', 'deepseek-messages', '--model', 'deepseek-flash', '--image-input',
      '--session-dir', join(home, 'sessions'), '--api-key-env', 'PERO_FIXTURE_API_KEY',
      '--messages-files-key-env', 'PERO_FIXTURE_FILES_KEY', '--approval', 'never', '--max-tokens', '128', '--max-retries', '0'],
    env: { PERO_FIXTURE_API_KEY: key, PERO_FIXTURE_FILES_KEY: randomBytes(32).toString('hex') },
  }]), { mode: 0o600 });
  let thread, session;
  await withHost(async ({ request, threadEvent }) => {
    ({ selected_thread: thread } = await request('start', { agent_id: agent }));
    assert.ok(thread);
    const ready = await threadEvent('session_ready', thread);
    assert.equal(ready.peroCapabilities.images, true);
    session = ready.sessionId;
    assert.ok(session);
    assert.deepEqual(counts(), [0, 0]);
    send({ action: 'prompt', thread_id: thread, text: initial,
      contexts: swatches.map((data, index) => ({ id: `fixture-swatch-${index}`, kind: 'image',
        label: `Swatch ${index + 1}`, source: `fixture:swatch-${index}`, content: { type: 'image', mime_type: 'image/png', data } })) });
    assert.equal((await threadEvent('turn_finished', thread)).stopReason, 'end_turn');
    assert.deepEqual(counts(), [2, 1]);
    assert.ok(fixture.inference[0].userText.includes(initial));
    assert.notDeepEqual(fixture.uploads[0].image, fixture.uploads[1].image);
    assert.deepEqual(fixture.inference[0].sources.map(source => source.file_id), fixture.uploads.map(upload => upload.id));
  });
  await withHost(async ({ request, threadEvent }) => {
    const snapshot = await request('snapshot');
    assert.equal(snapshot.sessions.find(row => row.thread_id === thread)?.active, false);
    assert.equal((await request('start', { agent_id: agent })).selected_thread, thread);
    assert.equal((await threadEvent('session_ready', thread)).sessionId, session);
    assert.deepEqual(counts(), [2, 1], 'Opening the original Project Agent must not call the provider');
    send({ action: 'prompt', thread_id: thread, text: followup });
    assert.equal((await threadEvent('turn_finished', thread)).stopReason, 'end_turn');
    assert.deepEqual(counts(), [2, 2]);
    assert.ok(fixture.inference[1].userText.includes(followup));
    assert.deepEqual(fixture.inference[1].sources, fixture.inference[0].sources);
  });
  assert.deepEqual(errors, []);
  console.log('Project Agent Messages Files: 2 uploads, 2 inferences, same ACP session and file IDs, zero requests on reopen.');
} finally {
  await stopHost().catch(() => {});
  if (server.listening) await closeLoopback(server);
  await rm(home, { recursive: true, force: true });
}
