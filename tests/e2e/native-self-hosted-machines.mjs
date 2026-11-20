// Drive the actual Native window while checking the real control plane and Worker.
import { expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setupSelfHostedMachines } from './self-hosted-machines-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const [mode, path, ...extra] = process.argv.slice(2);
if (!path || extra.length || !['--preview', '--dmg'].includes(mode) || process.platform !== 'darwin') {
  throw new Error('On macOS, run with --preview <Pero Native.app> or --dmg <Pero-Native-macos-arm64.dmg>');
}
const packaged = mode === '--dmg';
const out = resolve(root, 'test-results/self-hosted-machines', packaged ? 'native-installed' : 'native-preview');
await rm(resolve(out, 'result.json'), { force: true });
const database = process.env.PERO_TEST_DATABASE_URL;
if (!database) throw new Error('Set PERO_TEST_DATABASE_URL to an isolated PostgreSQL database');
const input = await realpath(path);
const scratch = await mkdtemp(resolve(tmpdir(), 'pero-native-machines-'));
const cancellation = new AbortController();
const interrupt = signal => cancellation.abort(new Error(`Native acceptance interrupted by ${signal}`));
const appExited = (code, signal) => {
  cancellation.abort(new Error(`Native window closed before acceptance completed (${signal ?? code})`));
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let fixture;
let app;
let appLog = '';
let result;
try {
  let bundle = input;
  if (packaged) {
    const mount = resolve(scratch, 'mount');
    bundle = resolve(scratch, 'installed/Pero Native.app');
    await mkdir(mount);
    await mkdir(resolve(bundle, '..'), { recursive: true });
    execFileSync('hdiutil', ['attach', input, '-mountpoint', mount, '-readonly', '-nobrowse']);
    try {
      execFileSync('ditto', [resolve(mount, 'Pero Native.app'), bundle]);
    } finally {
      execFileSync('hdiutil', ['detach', mount]);
    }
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
  }
  const binary = resolve(bundle, 'Contents/MacOS/pero-native');
  const workerBinary = packaged ? resolve(bundle, 'Contents/Resources/app/bin/pero-worker')
    : resolve(root, 'target/release/pero-worker');
  await Promise.all([access(binary), access(workerBinary)]);
  fixture = await setupSelfHostedMachines(database, { workerBinary, outputDirectory: out });
  cancellation.signal.throwIfAborted();
  const env = {
    HOME: scratch, PATH: '/usr/bin:/bin', PERO_LOCALE: 'en',
    PERO_ENV_FILE: '/dev/null', PERO_NATIVE_DATA_DIR: resolve(scratch, 'profile'),
    PERO_NATIVE_EPHEMERAL_SECRETS: '1',
  };
  app = spawn(binary, [], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.once('exit', appExited);
  for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => {
    appLog = (appLog + chunk.toString()).slice(-16000);
  });
  await new Promise((done, reject) => {
    app.once('spawn', done);
    app.once('error', reject);
  });
  const { client, chosen, creationAttempts, dispatches } = fixture;
  const read = route => fixture.request('/api/client/v1' + route, 'GET', undefined, client.token);
  const step = { timeout: 600000, intervals: [500] };
  const poll = predicate => expect.poll(() => {
    cancellation.signal.throwIfAborted();
    return predicate();
  }, step);
  const title = 'Native creation retry';
  const stopTitle = 'Native cancellation';
  console.log(`Native window: ${bundle}\nConnect as Project client to ${fixture.url}\nDisposable loopback token: ${client.token}`);
  console.log(`Create a draft titled "${title}" with instructions "Return a fixture result", completion criteria "Retain execution events" and machine "Research machine". Observe the first response failure and retry the retained draft.`);
  await poll(() => creationAttempts.length).toBe(2);
  expect(creationAttempts[0].key).toBeTruthy();
  expect(creationAttempts[1]).toEqual(creationAttempts[0]);
  const created = (await read('/tasks')).tasks;
  expect(created).toHaveLength(1);
  const [task] = created;
  expect(task).toMatchObject({ id: creationAttempts[0].task, title, claimed_by: { id: client.client.id } });
  console.log('Creation retry reused the committed receipt. Open the task, select Research machine, and click Delegate.');
  const runTask = async taskId => {
    const route = `/tasks/${taskId}`;
    await poll(() => dispatches.some(dispatch => dispatch.task === taskId)).toBe(true);
    expect(dispatches.filter(dispatch => dispatch.task === taskId)).toEqual([
      { task: taskId, worker: chosen.worker.id },
    ]);
    const queued = (await read(route)).run;
    expect(queued?.status).toBe('queued');
    await fixture.assertTarget();
    return { route, queued, worker: fixture.startWorker() };
  };
  const first = await runTask(task.id);
  await poll(async () => (await read(first.route)).run.status).toBe('succeeded');
  const success = await read(first.route);
  expect(success.run).toMatchObject({ id: first.queued.id, worker_id: chosen.worker.id });
  expect(success.events.some(event => event.kind === 'session_update')).toBe(true);
  await fixture.stop(first.worker);
  console.log(`Observe progress and Agent finished. Create "${stopTitle}" with instructions "wait" and delegate it to Research machine.`);
  await poll(() => creationAttempts.length).toBe(3);
  const waiting = await runTask(creationAttempts[2].task);
  await poll(async () => {
    const { run, events } = await read(waiting.route);
    return run.status === 'running' && events.some(event => event.kind === 'turn_started');
  }).toBe(true);
  await poll(async () => (await read('/workers')).workers.find(worker => worker.id === chosen.worker.id)?.occupied).toBe(true);
  console.log('The selected Worker has started the ACP turn. Observe progress, click Stop, then confirm Stop execution.');
  await poll(async () => (await read(waiting.route)).run.status).toBe('cancelled');
  const cancelled = await read(waiting.route);
  expect(cancelled.run).toMatchObject({ id: waiting.queued.id, worker_id: chosen.worker.id });
  const exit = waiting.worker.exitCode ?? await new Promise((done, reject) => {
    if (waiting.worker.signalCode) return done(null);
    const timer = setTimeout(() => reject(new Error('Worker did not exit after cancellation')), 15000);
    waiting.worker.once('exit', code => { clearTimeout(timer); done(code); });
  });
  expect(exit).toBe(0);
  const tasks = (await read('/tasks')).tasks;
  expect(tasks).toHaveLength(2);
  expect(cancelled.task.title).toBe(stopTitle);
  console.log('Server and Worker checks passed. After observing Stopped in the Native window, press Enter here.');
  const confirmation = createInterface({ input: process.stdin, output: process.stdout });
  confirmation.once('SIGINT', () => interrupt('SIGINT'));
  let confirmed;
  try {
    confirmed = await confirmation.question('Confirm Native window observations with Enter: ', {
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(step.timeout)]),
    });
  } finally {
    confirmation.close();
  }
  cancellation.signal.throwIfAborted();
  expect(confirmed).toBe('');
  result = {
    mode: packaged ? 'installed-dmg' : 'preview',
    input,
    ...(packaged ? { dmgSha256: execFileSync('shasum', ['-a', '256', input], { encoding: 'utf8' }).split(' ')[0] } : {}),
    nativeSha256: execFileSync('shasum', ['-a', '256', binary], { encoding: 'utf8' }).split(' ')[0],
    tasks: tasks.map(({ id, title, state }) => ({ id, title, state })),
    worker: chosen.worker.id, run: success.run.id, events: success.events.map(event => event.kind),
    cancelledRun: cancelled.run.id, cancellationEvents: cancelled.events.map(event => event.kind), workerExit: exit,
    checked: ['dropped response and same creation receipt', 'scoped creator claim', 'spare worker excluded', 'ACP progress', 'confirmed cancellation'],
  };
} catch (error) {
  console.error(fixture?.logs());
  throw error;
} finally {
  app?.removeListener('exit', appExited);
  try {
    await fixture?.stop(app);
    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, 'native.log'), appLog);
  } finally {
    try {
      await fixture?.close();
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Acceptance passed. Receipt: ${resolve(out, 'result.json')}`);
