// Actual Paper store/HTTP → Rust Host authority → actual Data worker/catalog.
// Only metadata fetch and byte-stream seams are synthetic; no external network/model.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-research-import-'));
const dataHome = resolve(temp, 'app-data/data');
const expected = Buffer.from('verified tiny research model\n');
const ajv = new Ajv2020({ strict: true, strictTypes: false }); ajv.addSchema(schema);
const validateInput = ajv.getSchema(`${schema.$id}#/$defs/AppRequest`);
const validateReply = ajv.getSchema(`${schema.$id}#/$defs/AppsResultEvent`);
const researchBase = { method: 'apps', id: 'research-contract', action: 'research-assets', name: 'paper-agent' };
for (const [request, accepted] of [
  [{ operation: 'start', bundleId: 'a'.repeat(64), assetId: 'b'.repeat(64) }, true],
  [{ operation: 'status', bundleId: 'a'.repeat(64) }, true],
  [{ operation: 'cancel', bundleId: 'a'.repeat(64), assetId: 'b'.repeat(64) }, true],
  [{ operation: 'start', bundleId: 'a'.repeat(64) }, false],
  [{ operation: 'status', bundleId: '../private' }, false],
  [{ operation: 'start', bundleId: 'a'.repeat(64), assetId: 'b'.repeat(64), url: 'https://example.test/file' }, false],
  [{ operation: 'cancel', bundleId: 'a'.repeat(64), target: 'another-app' }, false],
]) assert.equal(validateInput({ ...researchBase, request }), accepted, JSON.stringify(request));
const failures = [], children = [];
let host;

async function launch() {
  const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], {
    cwd: temp, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env,
      PERO_APPS_ROOT: resolve(temp, 'installed'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
      PERO_BUILTIN_APPS_ROOT: '', PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
      PERO_AGENTS_FILE: resolve(temp, 'agents.json'), UV_OFFLINE: '1' },
  });
  children.push(child);
  const pending = new Map();
  const exited = new Promise(done => child.once('exit', done));
  let ready;
  const started = new Promise(done => { ready = done; });
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line);
    if (event.kind === 'ready') ready();
    if (event.kind !== 'apps_result') return;
    if (!validateReply(event)) failures.push(ajv.errorsText(validateReply.errors));
    pending.get(event.request_id)?.(event.data);
  });
  await Promise.race([started, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Host readiness timeout')), 10000); timer.unref();
  })]);
  return {
    request(action, fields = {}) {
      const input = { method: 'apps', id: crypto.randomUUID(), action, ...fields };
      assert(validateInput(input), ajv.errorsText(validateInput.errors));
      return new Promise((done, reject) => {
        const timer = setTimeout(() => { pending.delete(input.id); reject(new Error(`Host ${action} timeout`)); }, 15000);
        pending.set(input.id, value => { clearTimeout(timer); pending.delete(input.id); done(value); });
        child.stdin.write(JSON.stringify(input) + '\n');
      });
    },
    close() { child.stdin.end(); return exited; },
  };
}

async function stage(name) {
  const source = resolve(temp, 'source-' + name);
  await mkdir(resolve(source, 'dist'), { recursive: true });
  await cp(resolve(root, 'apps', name, 'backend'), resolve(source, 'backend'), {
    recursive: true, filter: path => !path.includes('__pycache__') && !path.endsWith('.pyc'),
  });
  // Mirror scripts/build/apps.mjs: installed Data Apps carry the shared exact-value core.
  if (name === 'data') {
    await mkdir(resolve(source, 'backend/_core'), { recursive: true });
    for (const name of ['dataset.py', 'view.py', 'chart_document.py'])
      await cp(resolve(root, 'harness/go/charts/python', name), resolve(source, 'backend/_core', name));
  }
  for (const [from, to] of [['research-import-backend.py', 'research_fixture_server.py'],
                           ['research-resources.py', 'research_resources_fixture.py']])
    await cp(resolve(root, 'tests/fixtures', from), resolve(source, 'backend', to));
  await writeFile(resolve(source, 'dist/index.html'), '<h1>Offline research integration fixture</h1>');
  // Production manifests carry unrelated UI/dependency declarations; this fixture
  // changes only the composition root, declared permission, and tiny static panel.
  await writeFile(resolve(source, 'app.json'), JSON.stringify({ schemaVersion: 1, name, version: 'fixture', displayName: name,
    permissions: { host: name === 'paper-agent' ? ['research-assets'] : [] },
    contributes: { panels: [{ id: 'main', title: name, entry: 'dist/index.html' }] },
    backend: { type: 'python', entry: 'backend/research_fixture_server.py' } }));
  let reply = await host.request('install', { path: source }); assert(reply.ok, reply.error);
  reply = await host.request('enable', { name }); assert(reply.ok, reply.error);
}

async function backend(name, path, body, expectedStatus = 200) {
  const access = await host.request('resolve', { name }); assert(access.ok, access.error);
  const response = await fetch(access.value.backend.url + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': access.value.backend.token },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) });
  const value = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(value));
  return value;
}
async function handoff(operation, bundleId, assetId) {
  const request = { operation, bundleId, ...(assetId ? { assetId } : {}) };
  return host.request('research-assets', { name: 'paper-agent', request });
}
async function until(observe, accepted, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await observe();
    if (accepted(value)) return value;
    await new Promise(done => setTimeout(done, 20)); // Observe an external worker condition.
  }
  throw new Error('Timed out waiting for ' + label);
}
async function inspect(url) {
  const initial = await backend('paper-agent', '/api/research/inspect', { url });
  return until(() => backend('paper-agent', '/api/research/inspect', { draftId: initial.id }),
    draft => { assert.notEqual(draft.status, 'failed', draft.error); return draft.status === 'ready'; }, 'inspection');
}
async function files() { try { return await readdir(resolve(dataHome, 'files')); } catch { return []; } }
async function opens() { try { return (await readFile(resolve(dataHome, 'fixture-opens.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).length; } catch { return 0; } }

try {
  await writeFile(resolve(temp, 'agents.json'), '[]');
  host = await launch();
  await stage('paper-agent'); await stage('data');
  const first = await inspect('https://example.org/research-one');
  const model = first.resources.find(resource => resource.kind === 'model'); assert(model);
  const weights = model.assets.find(asset => asset.filename === 'weights.bin');
  const slow = model.assets.find(asset => asset.filename === 'slow.bin'); assert(weights && slow);
  const selection = { draftId: first.id, resourceIds: first.resources.map(resource => resource.id) };
  const refs = await backend('paper-agent', '/api/research/commit', selection, 201);
  assert.deepEqual(refs.downloadIds, []);
  const otherCaller = await host.request('research-assets', { name: 'data', request: { operation: 'status', bundleId: refs.id } });
  assert.equal(otherCaller.ok, false); assert.match(otherCaller.error, /reserved for Paper/);
  assert.equal((await backend('data', '/api/state')).download, null);
  assert.deepEqual(await files(), []); assert.equal(await opens(), 0);
  let refused = await handoff('start', refs.id, weights.id); assert.equal(refused.ok, false); assert.match(refused.error, /403/);
  await backend('paper-agent', '/api/research/commit', { ...selection, downloadIds: [weights.id], confirmedDownloads: false }, 400);
  assert.equal(await opens(), 0);

  const approved = await backend('paper-agent', '/api/research/commit', {
    ...selection, downloadIds: [weights.id, slow.id], confirmedDownloads: true,
  }, 201);
  let start = await handoff('start', approved.id, weights.id); assert(start.ok, start.error);
  const completed = await until(() => handoff('status', approved.id, weights.id), reply => {
    assert(reply.ok, reply.error); assert.notEqual(reply.value.download?.status, 'failed', reply.value.download?.error);
    return reply.value.download?.status === 'completed';
  }, 'verified file publication');
  const receipt = completed.value;
  assert.equal(receipt.asset.sha256, createHash('sha256').update(expected).digest('hex'));
  assert.equal(receipt.asset.size, expected.length);
  assert.equal(receipt.source.bundleId, approved.id); assert.equal(receipt.source.revision, weights.revision);
  assert(!JSON.stringify(receipt).includes('location')); assert(!JSON.stringify(receipt).includes('X-Pero-App-Token'));
  assert.deepEqual(await readFile(resolve(dataHome, 'files', receipt.receipt.catalogAssetId)), expected);
  const repeated = await handoff('start', approved.id, weights.id); assert(repeated.ok, repeated.error);
  assert.equal(repeated.value.receipt.catalogAssetId, receipt.receipt.catalogAssetId);
  assert.equal(repeated.value.receipt.reused, true); assert.equal(await opens(), 1);

  const second = await inspect('https://example.org/research-two');
  const unrelated = await backend('paper-agent', '/api/research/commit', {
    draftId: second.id, resourceIds: second.resources.map(resource => resource.id),
  }, 201);
  assert.notEqual(unrelated.id, approved.id);
  start = await handoff('start', approved.id, slow.id); assert(start.ok, start.error);
  await until(() => stat(resolve(dataHome, 'fixture-slow-entered')).then(() => true, () => false), Boolean, 'blocked tiny stream');
  refused = await handoff('cancel', unrelated.id, slow.id); assert.equal(refused.ok, false);
  const scoped = await handoff('cancel', unrelated.id); assert(scoped.ok, scoped.error); assert.deepEqual(scoped.value.assets, []);
  let status = await handoff('status', approved.id, slow.id); assert.equal(status.value.download.status, 'running');
  assert.equal(status.value.download.total, slow.size); assert.equal(status.value.download.received, 0);
  const sameRunning = await handoff('start', approved.id, slow.id); assert(sameRunning.ok, sameRunning.error);
  assert.equal(sameRunning.value.receipt.jobId, status.value.receipt.jobId); assert.equal(await opens(), 2);
  const cancelled = await handoff('cancel', approved.id, slow.id); assert(cancelled.ok, cancelled.error);
  await writeFile(resolve(dataHome, 'fixture-release-slow'), 'release');
  await until(() => handoff('status', approved.id, slow.id), reply => reply.ok && reply.value.download?.status === 'cancelled', 'scoped cancellation');
  assert.equal((await files()).length, 1); assert.equal((await readdir(dataHome)).filter(name => name.endsWith('.part')).length, 0);

  await host.close(); host = await launch();
  const restored = await backend('paper-agent', '/api/research/bundles/' + approved.id);
  assert.deepEqual(restored, approved);
  status = await handoff('status', approved.id, weights.id); assert(status.ok, status.error);
  assert.equal(status.value.receipt.catalogAssetId, receipt.receipt.catalogAssetId);
  assert.equal(status.value.asset.localAvailable, true);
  const retry = await handoff('start', approved.id, weights.id); assert(retry.ok, retry.error);
  assert.equal(retry.value.receipt.reused, true); assert.equal(await opens(), 2);
  assert.equal((await handoff('status', approved.id, slow.id)).value.download.status, 'cancelled');
  assert.deepEqual(failures, []);
  console.log('Research import: real Paper store → Rust Host → Data, explicit consent, verified bytes, scoped cancel, dedup and restart passed.');
} finally {
  if (host) await host.close();
  for (const child of children) if (child.exitCode === null) child.kill();
  await rm(temp, { recursive: true, force: true });
}
