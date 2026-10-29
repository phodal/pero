import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
const entrypoint = fileURLToPath(new URL('../entrypoint.sh', import.meta.url));
const prepare = fileURLToPath(new URL('../prepare-workspace.mjs', import.meta.url));
const revision = 'a'.repeat(40);
const processOutput = (command, args, env) => new Promise((ok, fail) => {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 15000);
  child.on('error', error => { clearTimeout(timer); fail(error); });
  child.on('close', code => { clearTimeout(timer); ok({ code, stdout, stderr }); });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'pero-sandbox-image-'));
  const seed = join(root, 'seed'), workspace = join(root, 'workspace');
  await mkdir(seed); await writeFile(join(seed, '.pero-workspace-revision'), revision + '\n'); await writeFile(join(seed, 'README.md'), 'prepared\n');
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), PERO_RUNTIME_POD_UID: 'pod-uid', PERO_WORKSPACE_REVISION: revision, PERO_WORKER_CONFIG: join(root, 'worker.json'), PERO_WORKER_STATE: join(root, 'state', 'worker.json'), PERO_WORKSPACE_SEED: seed, PERO_WORKSPACE_DIRECTORY: workspace, PERO_WORKER_BINARY: '/bin/true' };
  return { root, seed, workspace, env };
}
test('entrypoint preserves workspace changes and refuses mismatched or partial preparation', async () => {
  const f = await directory();
  try {
    assert.equal((await processOutput(entrypoint, [], f.env)).code, 0);
    await writeFile(join(f.workspace, 'README.md'), 'retained change\n');
    assert.equal((await processOutput(entrypoint, [], f.env)).code, 0);
    assert.equal(await readFile(join(f.workspace, 'README.md'), 'utf8'), 'retained change\n');
    assert.notEqual((await processOutput(entrypoint, [], { ...f.env, PERO_WORKSPACE_REVISION: 'b'.repeat(40) })).code, 0);
    await rm(f.workspace, { recursive: true }); await mkdir(f.workspace + '.preparing');
    assert.match((await processOutput(entrypoint, [], f.env)).stderr, /Interrupted workspace preparation/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('image init keeps Worker below PID1 and forwards signals with its true exit status', { skip: !process.env.PERO_TEST_TINI_BIN }, async t => {
  for (const [signal, status] of [['SIGTERM', 23], ['SIGINT', 24], [null, 17]]) await t.test(signal ?? 'normal exit', async () => {
    const f = await directory(); let child, workerPID, timeout;
    try {
      const worker = join(f.root, 'worker-process.mjs');
      await writeFile(worker, `#!${process.execPath}\nprocess.on('SIGTERM', () => process.exit(23));\nprocess.on('SIGINT', () => process.exit(24));\nconsole.log(JSON.stringify({ pid: process.pid, parent: process.ppid }));\n${signal ? 'setInterval(() => {}, 1000);' : 'process.exit(17);'}\n`, { mode: 0o700 });
      // -s is only for this host-process test; the image runs Tini as PID1.
      child = spawn(resolve(process.env.PERO_TEST_TINI_BIN), ['-s', '--', entrypoint], { env: { ...f.env, PERO_WORKER_BINARY: worker }, stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = new Promise((ok, fail) => { child.once('error', fail); child.once('close', (code, signal) => ok({ code, signal })); });
      timeout = setTimeout(() => {
        // Kill the fixture too: a broken init forwarder must not keep inherited
        // stdio open forever and prevent the child's close event.
        if (workerPID) { try { process.kill(workerPID, 'SIGKILL'); } catch {} }
        child.kill('SIGKILL');
      }, 5000);
      const ready = await new Promise((ok, fail) => {
        let output = '';
        child.stdout.on('data', chunk => {
          output += chunk;
          if (output.includes('\n')) ok(JSON.parse(output.split('\n')[0]));
        });
        child.once('error', fail);
        child.once('close', () => { if (!output.includes('\n')) fail(new Error('Worker readiness not observed')); });
      });
      workerPID = ready.pid;
      assert.notEqual(ready.pid, child.pid, 'Worker must not replace container init');
      assert.equal(ready.parent, child.pid, 'container init must be the live Worker parent');
      if (signal) child.kill(signal);
      assert.deepEqual(await exited, { code: status, signal: null });
      assert.throws(() => process.kill(workerPID, 0), { code: 'ESRCH' });
    } finally {
      clearTimeout(timeout);
      if (workerPID) { try { process.kill(workerPID, 'SIGKILL'); } catch {} }
      child?.kill('SIGKILL');
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
test('prepared workspace exports only an exact tracked commit, without local secrets or Git configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-sandbox-prepare-'));
  try {
    const repo = join(root, 'repo'), out = join(root, 'out'); await mkdir(repo);
    execFileSync('git', ['init', '-q', repo]); await writeFile(join(repo, 'tracked'), 'committed\n');
    execFileSync('git', ['-C', repo, 'add', 'tracked']); execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'fixture']);
    const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(join(repo, 'tracked'), 'local change\n'); await writeFile(join(repo, 'untracked-secret'), 'not exported');
    execFileSync(process.execPath, [prepare, repo, commit, out]);
    assert.equal(await readFile(join(out, 'tracked'), 'utf8'), 'committed\n');
    assert.equal(await readFile(join(out, '.pero-workspace-revision'), 'utf8'), commit + '\n');
    await assert.rejects(readFile(join(out, 'untracked-secret'))); await assert.rejects(readFile(join(out, '.git', 'config')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual entrypoint → Rust Worker → Go ACP retains events/result and original Pod identity', { skip: !process.env.PERO_TEST_WORKER_BIN || !process.env.PERO_TEST_AGENT_BIN }, async () => {
  const f = await directory(); const events = [], claims = []; let completed, providerTurns = 0;
  const run = { id: 'run_fixture', generation: 1, instance_id: '', status: 'running', lease_expires_at: new Date(Date.now() + 60000).toISOString(), spec: { title: 'Fixture', prompt: 'Reply with a fixture answer', acceptance: '', workspace_key: 'repo', agent_id: 'dsh' } };
  const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const provider = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-provider-key'); for await (const ignored of req) void ignored;
    providerTurns++; res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"index":0,"delta":{"content":"sandbox fixture answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  const cloud = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-worker-token'); let raw = ''; for await (const data of req) raw += data;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url.endsWith('/claims')) { claims.push(body); assert.equal(body.runtime_pod_uid, 'pod-uid'); run.instance_id = body.instance_id; return json(res, { run: completed ? null : run }); }
    if (req.url.endsWith('/renew')) return json(res, { cancel_requested: false, lease_expires_at: run.lease_expires_at });
    if (req.url.endsWith('/events')) { events.push(...body.events); return json(res, { last_seq: events.at(-1).seq }); }
    if (req.url.endsWith('/complete')) { completed = body; run.status = body.outcome; }
    return json(res, run);
  });
  const listen = server => new Promise(ok => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${server.address().port}`)));
  try {
    const providerURL = await listen(provider), cloudURL = await listen(cloud);
    const wrapper = join(f.root, 'worker-once.sh');
    await writeFile(wrapper, `#!/bin/sh\nexec "$PERO_TEST_WORKER_BIN" --once\n`, { mode: 0o700 });
    await writeFile(join(f.root, 'agents.json'), JSON.stringify([{ id: 'dsh', name: 'Real Go ACP', command: resolve(process.env.PERO_TEST_AGENT_BIN), args: ['--endpoint', providerURL + '/v1', '--model', 'fixture', '--session-dir', join(f.root, 'sessions'), '--workspace', f.workspace, '--approval', 'ask'], env: { AGENT_PROVIDER_API_KEY: 'synthetic-provider-key' } }]));
    await writeFile(f.env.PERO_WORKER_CONFIG, JSON.stringify({ workspaces: { repo: f.workspace }, agents_file: join(f.root, 'agents.json') }));
    const env = { ...f.env, PERO_WORKER_BINARY: wrapper, PERO_TEST_WORKER_BIN: resolve(process.env.PERO_TEST_WORKER_BIN), PERO_CLOUD_URL: cloudURL, PERO_WORKER_TOKEN: 'synthetic-worker-token' };
    const launch = () => processOutput(process.env.PERO_TEST_TINI_BIN ? resolve(process.env.PERO_TEST_TINI_BIN) : entrypoint, process.env.PERO_TEST_TINI_BIN ? ['-s', '--', entrypoint] : [], env);
    const first = await launch(); assert.equal(first.code, 0, first.stderr);
    assert.equal(completed.outcome, 'succeeded'); assert.equal(providerTurns, 1); assert(events.length > 0);
    assert(!JSON.stringify(events).includes('synthetic-worker-token')); assert(!JSON.stringify(events).includes('synthetic-provider-key'));
    await writeFile(join(f.workspace, 'README.md'), 'retained after turn\n');
    const second = await launch(); assert.equal(second.code, 0, second.stderr);
    assert.equal(providerTurns, 1); assert.equal(claims.length, 2); assert.equal(await readFile(join(f.workspace, 'README.md'), 'utf8'), 'retained after turn\n');
    const journal = JSON.parse(await readFile(f.env.PERO_WORKER_STATE, 'utf8')); assert.equal(journal.active, null);
  } finally {
    provider.closeAllConnections(); cloud.closeAllConnections(); await Promise.all([new Promise(ok => provider.close(ok)), new Promise(ok => cloud.close(ok))]);
    await rm(f.root, { recursive: true, force: true });
  }
});
