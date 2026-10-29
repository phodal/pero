// One real stdio check for App ownership, request reconciliation and journal recovery.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-app-agent-'));
const capture = resolve(temp, 'turns.jsonl');
const registry = resolve(temp, 'agents.json');
await writeFile(registry, JSON.stringify([{ id: 'fixture', name: 'Synthetic paper fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/paper-agent.mjs'), `--capture=${capture}`] }]));
const launches = [];
async function launch() {
  const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: temp,
    env: { ...process.env, PERO_APPS_ROOT: resolve(temp, 'installed'), PERO_BUILTIN_APPS_ROOT: '', PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: registry }, stdio: ['pipe', 'pipe', 'inherit'] });
  launches.push(child);
  const pending = new Map();
  const exit = new Promise(done => child.once('exit', done));
  let ready;
  const started = new Promise(done => { ready = done; });
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line);
    if (event.kind === 'ready') ready();
    if (event.kind === 'apps_result') pending.get(event.request_id)?.(event.data);
  });
  await Promise.race([started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Host readiness timeout')), 10000); timer.unref(); })]);
  return {
    request(action, fields = {}) {
      const id = crypto.randomUUID();
      return new Promise((done, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`App ${action} timeout`)); }, 10000);
        pending.set(id, value => { clearTimeout(timer); pending.delete(id); done(value); });
        child.stdin.write(JSON.stringify({ method: 'apps', action, id, ...fields }) + '\n');
      });
    },
    close() { child.stdin.end(); return exit; },
  };
}
async function until(observe, accepted) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await observe();
    if (accepted(value)) return value;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error('External Host/fixture condition timed out');
}
async function turns() { try { return (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).length; } catch { return 0; } }
let host;
try {
  host = await launch();
  for (const name of ['paper-alpha', 'paper-beta']) {
    const source = resolve(temp, name);
    await mkdir(resolve(source, 'dist'), { recursive: true });
    await writeFile(resolve(source, 'dist/index.html'), '<h1>Synthetic fixture</h1>');
    await writeFile(resolve(source, 'app.json'), JSON.stringify({ schemaVersion: 1, name, version: '0.1.0', displayName: name,
      permissions: { host: ['agent'] }, contributes: { panels: [{ id: 'main', title: name, entry: 'dist/index.html' }] } }));
    assert.equal((await host.request('install', { path: source })).ok, true);
    assert.equal((await host.request('enable', { name })).ok, true);
  }
  const call = (name, request) => host.request('agent', { name, request });
  const start = { operation: 'start', requestId: 'wait-one', agentId: 'fixture', prompt: 'paper-fixture-wait' };
  const first = await call('paper-alpha', start);
  assert.equal(first.ok, true, first.error);
  await until(turns, value => value === 1);
  assert.deepEqual(await call('paper-alpha', start), first);
  assert.equal((await call('paper-alpha', { ...start, prompt: 'different frozen input' })).ok, false);
  const foreign = await call('paper-beta', { operation: 'events', sessionId: first.value.sessionId, after: 0 });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /belong/);
  assert.equal((await call('paper-beta', { operation: 'cancel', sessionId: first.value.sessionId })).ok, false);
  assert.equal((await call('paper-alpha', { operation: 'cancel', sessionId: first.value.sessionId })).ok, true);
  await until(() => call('paper-alpha', { operation: 'events', sessionId: first.value.sessionId, after: 0 }), value => value.value?.status === 'cancelled');
  await host.close();
  host = await launch();
  assert.deepEqual(await call('paper-alpha', start), first);
  assert.equal((await call('paper-alpha', { operation: 'events', sessionId: first.value.sessionId, after: 0 })).value.status, 'cancelled');
  assert.equal(await turns(), 1);
  assert.equal((await host.request('disable', { name: 'paper-alpha' })).ok, true);
  assert.equal((await call('paper-alpha', { operation: 'info' })).ok, false);
  console.log('App session ownership, cancellation, frozen request reconciliation and journal restart passed.');
} finally {
  if (host) await host.close();
  for (const child of launches) if (child.exitCode === null) child.kill();
  await rm(temp, { recursive: true, force: true });
}
