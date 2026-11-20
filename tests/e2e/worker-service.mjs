// Run against the actual systemd user manager from a disposable Linux account.
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setupSelfHostedMachines } from './self-hosted-machines-fixture.mjs';

const [, , archiveArg, checksumsArg] = process.argv;
if (!archiveArg || !checksumsArg || !process.env.PERO_TEST_DATABASE_URL ||
    process.platform !== 'linux' || process.arch !== 'x64' || process.getuid() === 0) {
  throw new Error('Run node tests/e2e/worker-service.mjs ARCHIVE SHA256SUMS on Linux x86_64 as a disposable non-root user with PERO_TEST_DATABASE_URL');
}

const root = resolve(import.meta.dirname, '../..');
const archive = resolve(archiveArg);
const checksums = resolve(checksumsArg);
const out = resolve(root, 'test-results/worker-service');
const receipt = join(out, 'result.json');
const home = homedir();
const configHome = process.env.XDG_CONFIG_HOME || join(home, '.config');
const dataHome = process.env.XDG_DATA_HOME || join(home, '.local/share');
const stateHome = process.env.XDG_STATE_HOME || join(home, '.local/state');
const executable = join(home, '.local/bin/pero-worker');
const unit = 'pero-worker.service';
const configDir = join(configHome, 'pero-worker');
const dataDir = join(dataHome, 'pero-worker');
const stateDir = join(stateHome, 'pero-worker-state');
const serviceDir = join(configHome, 'systemd/user');
const serviceFile = join(serviceDir, unit);
const journal = join(stateDir, 'journal.json');
const prompts = join(configDir, 'prompts.jsonl');
const systemctl = (...args) => execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8', timeout: 30_000 }).trim();
const property = name => systemctl('show', unit, '-p', name, '--value');
const cancellation = new AbortController();
const interrupt = signal => cancellation.abort(new Error(`Worker service acceptance interrupted by ${signal}`));
const poll = predicate => expect.poll(() => {
  cancellation.signal.throwIfAborted();
  return predicate();
}, { timeout: 30_000, intervals: [100, 250] });

await mkdir(out, { recursive: true });
await rm(receipt, { force: true });
for (const path of [executable, configDir, dataDir, stateDir, serviceFile]) {
  const old = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (old) throw new Error(`Use a disposable user with no previous Worker files (found ${path})`);
}
expect(property('LoadState')).toBe('not-found');
// The manager expands %E and %S from its own environment, not this shell's.
const manager = systemctl('show-environment');
for (const [key, chosen, fallback] of [
  ['HOME', home, home],
  ['XDG_CONFIG_HOME', configHome, join(home, '.config')],
  ['XDG_STATE_HOME', stateHome, join(home, '.local/state')],
]) {
  const managerValue = manager.split('\n').find(line => line.startsWith(key + '='))?.slice(key.length + 1);
  expect(managerValue ?? fallback, key + ' must match the systemd user manager').toBe(chosen);
}

let fixture;
let serviceLoaded = false;
let result;
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  fixture = await setupSelfHostedMachines(process.env.PERO_TEST_DATABASE_URL, {
    outputDirectory: out,
    serverBinary: process.env.PERO_TEST_SERVER_BINARY,
    agentArgs: ['--composer', `--capture=${prompts}`],
  });
  const archiveSnapshot = join(fixture.temp, basename(archive));
  await copyFile(archive, archiveSnapshot);
  cancellation.signal.throwIfAborted();
  execFileSync('sh', [resolve(root, 'deployment/worker/install.sh'), '--archive', archiveSnapshot, checksums], { stdio: 'inherit' });
  expect(property('LoadState')).toBe('not-found');
  await mkdir(configDir, { mode: 0o700, recursive: true });
  await copyFile(join(fixture.temp, 'worker.json'), join(configDir, 'worker.json'));
  await writeFile(join(configDir, 'worker.env'), `PERO_CLOUD_URL=${fixture.base}\nPERO_WORKER_TOKEN=${fixture.chosen.token}\n`, { mode: 0o600 });
  await mkdir(serviceDir, { recursive: true });
  await copyFile(join(dataDir, unit), serviceFile);
  systemctl('daemon-reload');
  serviceLoaded = true;
  expect(property('KillMode')).toBe('control-group');
  expect(property('Restart')).toBe('no');

  const { client, request } = fixture;
  const route = '/api/client/v1/tasks';
  const task = await request(route, 'POST', {
    title: 'Worker service stop acceptance',
    project_id: 'team',
    workspace_key: 'repo',
    agent_id: 'fixture',
    prompt: 'wait',
    acceptance: 'Stop the live ACP child and recover the original Run without replay.',
  }, client.token);
  const detail = () => request(route + '/' + task.id, 'GET', undefined, client.token);
  const workerId = fixture.chosen.worker.id;
  const queued = await request(`${route}/${task.id}/dispatch`, 'POST', { worker_id: workerId }, client.token);
  expect(queued.status).toBe('queued');
  await fixture.assertTarget();
  systemctl('start', unit);
  await poll(async () => (await detail()).events.some(event => event.kind === 'turn_started')).toBe(true);
  const active = await detail();
  expect(active.run).toMatchObject({ id: queued.id, worker_id: workerId, status: 'running' });
  expect((await lstat(configDir)).isDirectory()).toBe(true);
  expect((await lstat(stateDir)).isDirectory()).toBe(true);
  await poll(() => existsSync(prompts)).toBe(true);
  const originalPrompt = await readFile(prompts, 'utf8');
  expect(originalPrompt.trim().split('\n')).toHaveLength(1);
  expect(JSON.parse(await readFile(journal, 'utf8')).active.run.id).toBe(queued.id);

  const mainPid = Number(property('MainPID'));
  expect(mainPid).toBeGreaterThan(0);
  const group = property('ControlGroup');
  expect(group).toMatch(/\/pero-worker\.service$/);
  const cgroup = join('/sys/fs/cgroup', group);
  const pids = (await readFile(join(cgroup, 'cgroup.procs'), 'utf8')).trim().split('\n').map(Number);
  const agentPid = pids.find(pid => readFileSync(`/proc/${pid}/cmdline`).includes('/tests/fixtures/acp-agent.mjs'));
  expect(pids).toContain(mainPid);
  expect(agentPid).toBeGreaterThan(0);

  systemctl('stop', unit);
  await poll(() => pids.filter(pid => existsSync(`/proc/${pid}`))).toEqual([]);
  await poll(async () => {
    try {
      return /^populated 0$/m.test(await readFile(join(cgroup, 'cgroup.events'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
  }).toBe(true);
  expect(property('ActiveState')).toBe('inactive');
  expect(property('MainPID')).toBe('0');
  await poll(async () => (await detail()).run.status).toBe('reconcile');
  expect(property('ActiveState')).toBe('inactive');
  expect(property('NRestarts')).toBe('0');
  expect(JSON.parse(await readFile(journal, 'utf8')).active.run.id).toBe(queued.id);

  systemctl('start', unit);
  await poll(() => property('ActiveState')).toBe('inactive');
  expect(property('ExecMainStatus')).toBe('0');
  expect(JSON.parse(await readFile(journal, 'utf8'))).toMatchObject({ active: null, pending_claim: null });
  expect(await readFile(prompts, 'utf8')).toBe(originalPrompt);
  expect((await detail()).run).toMatchObject({ id: queued.id, worker_id: workerId, status: 'reconcile' });
  result = {
    platform: execFileSync('uname', ['-sm'], { encoding: 'utf8' }).trim(),
    systemd: systemctl('--version').split('\n')[0],
    archiveSha256: createHash('sha256').update(await readFile(archiveSnapshot)).digest('hex'),
    workerId, taskId: task.id, runId: queued.id, mainPid, agentPid,
    stoppedPids: pids, cgroupEmpty: true, recoveryExit: 0, promptAttempts: 1, finalRunStatus: 'reconcile',
  };
} finally {
  try {
    if (serviceLoaded) systemctl('stop', unit);
    for (const path of [serviceFile, executable, configDir, dataDir, stateDir]) {
      await rm(path, { recursive: true, force: true });
    }
    if (serviceLoaded) systemctl('daemon-reload');
  } finally {
    try {
      await fixture?.close();
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  }
}
cancellation.signal.throwIfAborted();
await writeFile(receipt, JSON.stringify(result, null, 2) + '\n');
console.log(`Installed Worker stopped its ACP process and reconciled only the original Run. Receipt: ${receipt}`);
