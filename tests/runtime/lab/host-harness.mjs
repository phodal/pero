// Actual Rust Host + production App routing + installed Lab backend.
// The only substituted Agent is the deterministic ACP transport fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DesktopAppUse } from '../../../desktop/src/main/app-use-mcp.ts';
import { AppWriteRoutes } from '../../../desktop/src/main/app-write-routes.ts';
import { descendants, finishDescendants } from '../research-import/cleanup.mjs';

export const root = resolve(import.meta.dirname, '../../..');

export async function openHost({ directory, executable, python }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, 'agents.json'), JSON.stringify([{ id: 'lab-fixture', name: 'Lab scripted ACP fixture', command: process.execPath,
    args: [resolve(root, 'tests/fixtures/lab-acp.mjs')] }]), { mode: 0o600 });
  await writeFile(resolve(directory, 'settings.json'), JSON.stringify({ computer_use: { enabled: false }, app_python: { apps: { lab: python } } }), { mode: 0o600 });
  let child, selected, stderr = '';
  const pending = new Map(), waiters = new Set(), events = [], writes = [];
  const command = value => { desktop.command(value); child.stdin.write(JSON.stringify(value) + '\n'); };
  function request(action, fields = {}) {
    const id = randomUUID();
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Host ${action} timeout`)); }, 15000);
      pending.set(id, value => { clearTimeout(timer); pending.delete(id); value.ok ? accept(value.value) : reject(new Error(value.error)); });
      child.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
    });
  }
  const routes = new AppWriteRoutes(request, event => writes.push(event), fetch);
  const desktop = new DesktopAppUse({
    selectedThread: async () => selected, presence() {},
    page: async () => { throw new Error('No UI authority in headless validation'); },
    capture: async () => { throw new Error('No capture authority in headless validation'); },
  }, () => {}, resolve(directory, 'evidence'), routes);
  const mcp = await desktop.start();
  // Do not inherit any unrelated provider credentials into the isolated Host.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !name.startsWith('PERO_') && !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)));
  child = spawn(executable, ['--stdio'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], env: { ...env, ...mcp,
    PERO_AGENTS_FILE: resolve(directory, 'agents.json'),
    PERO_APPS_ROOT: resolve(directory, 'installed'), PERO_BUILTIN_APPS_ROOT: '',
    PERO_SETTINGS_PATH: resolve(directory, 'settings.json'), PERO_HISTORY_PATH: resolve(directory, 'history.jsonl'), UV_OFFLINE: '1' } });
  child.stderr.on('data', data => { stderr += String(data); });
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line);
    if (event.kind === 'apps_result') { pending.get(event.request_id)?.(event.data); return; }
    desktop.accept(event);
    // MCP descriptors and private backend credentials are never part of this stream.
    const clean = event;
    events.push(clean);
    for (const waiter of [...waiters]) if (waiter.match(clean)) {
      waiters.delete(waiter); clearTimeout(waiter.timer); waiter.accept(clean);
    }
  });
  function wait(match, timeout = 15000, since = 0) {
    const found = events.slice(since).find(match); if (found) return Promise.resolve(found);
    return new Promise((accept, reject) => {
      const waiter = { match, accept };
      waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Host event timeout')); }, timeout);
      waiters.add(waiter);
    });
  }
  async function stage(name) {
    const existing = (await request('list')).find(record => record.name === name);
    if (existing) { if (!existing.enabled) await request('enable', { name }); return; }
    const source = resolve(directory, 'source-' + name);
    await mkdir(resolve(source, 'dist'), { recursive: true });
    await cp(resolve(root, 'apps', name, 'backend'), resolve(source, 'backend'), {
      recursive: true, filter: path => !path.includes('__pycache__') && !path.endsWith('.pyc'),
    });
    await writeFile(resolve(source, 'dist/index.html'), '<h1>Headless Lab transport verification; no Desktop UI tested</h1>');
    // Preserve the real manifest/dependency declarations. No fake PLR or server.
    await cp(resolve(root, 'apps', name, 'app.json'), resolve(source, 'app.json'));
    await request('install', { path: source }); await request('enable', { name });
  }
  async function close() {
    for (const waiter of waiters) clearTimeout(waiter.timer);
    waiters.clear();
    let owned = [], forcedHost = false, collectionError;
    try { owned = await descendants(child.pid); } catch (error) { collectionError = error; }
    child.stdin.end();
    const term = setTimeout(() => { forcedHost = true; child.kill('SIGTERM'); }, 10000);
    const kill = setTimeout(() => { forcedHost = true; child.kill('SIGKILL'); }, 15000);
    try {
      const result = await exited;
      const cleanup = await finishDescendants(owned);
      if (collectionError) throw collectionError;
      return { ...result, forcedHost, ...cleanup };
    } finally { clearTimeout(term); clearTimeout(kill); await desktop.close(); }
  }
  try {
    await wait(event => event.kind === 'ready');
    await stage('lab');
  } catch (error) { await close(); throw error; }
  return {
    directory, events, writes, request, command, wait,
    stderr: () => stderr,
    async start(thread = randomUUID()) {
      selected = thread;
      const since = events.length;
      command({ action: 'new_session', thread_id: thread, agent_id: 'lab-fixture', scope: { app: 'lab', panel: 'main' } });
      const ready = await wait(event => event.thread_id === thread && ['session_ready', 'session_error'].includes(event.kind), 20000, since);
      assert.equal(ready.kind, 'session_ready', ready.text);
      return thread;
    },
    approve(thread, experiment) {
      // Trusted headless client substitutes the UI reference capture only. The
      // production goal owner still requires the exact actual Host user_message.
      const scope = { app: 'lab', panel: 'main' };
      const reference = { id: 'app-object-' + randomUUID(), kind: 'app_object', label: 'Headless frozen Lab goal',
        source: 'pero-app://lab/#lab@1', content: { type: 'text', text: JSON.stringify({
          schema: 'pero.app-object.v1', scope, objectId: 'lab', revision: 1,
          state: { experimentId: experiment.id, specHash: experiment.spec_hash },
        }) } };
      desktop.goals.approve(scope, thread, [reference]);
      return [reference];
    },
    async prompt(thread, text, timeout = 120000, contexts = []) {
      const since = events.length;
      command({ action: 'prompt', thread_id: thread, text, contexts });
      try {
        const result = await wait(event => event.thread_id === thread && ['turn_finished', 'session_error'].includes(event.kind), timeout, since);
        assert.equal(result.kind, 'turn_finished', result.text);
        return events.slice(since);
      } catch (error) {
        command({ action: 'cancel', thread_id: thread });
        await wait(event => event.thread_id === thread && event.kind === 'turn_finished', 15000, since).catch(() => {});
        throw error;
      }
    },
    async backend(path, data, expected = 200) {
      const access = await request('resolve', { name: 'lab' });
      const response = await fetch(access.backend.url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'X-Pero-App-Token': access.backend.token, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000) });
      const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
    },
    close,
  };
}
