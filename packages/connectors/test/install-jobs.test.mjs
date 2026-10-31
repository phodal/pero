import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { InstallJobs } from '../src/connectors/install-jobs.mjs';

function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, options) => {
    const child = Object.assign(new EventEmitter(), { pid: 100 + calls.length, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: signal => child.emit('close', null, signal) });
    calls.push({ cmd, args, options, child });
    return child;
  };
  return { spawn, calls };
}

test('install jobs run once per provider, keep a bounded log, and report the outcome', () => {
  const { spawn, calls } = fakeSpawn();
  const jobs = new InstallJobs({ spawn });
  assert.equal(jobs.snapshot('p'), null);
  assert.equal(jobs.start('p', 'echo hi').state, 'running');
  jobs.start('p', 'echo again');
  assert.equal(calls.length, 1, 'a running job is not started twice');
  calls[0].child.stdout.emit('data', 'x'.repeat(20000));
  calls[0].child.emit('close', 0, null);
  const done = jobs.snapshot('p');
  assert.equal(done.state, 'done');
  assert.equal(done.log.length, 16 * 1024);
  jobs.start('p', 'retry');
  calls[1].child.emit('close', 2, null);
  assert.deepEqual([jobs.snapshot('p').state, jobs.snapshot('p').exitCode], ['failed', 2]);
});

test('only a job that exits 0 reports done, and running lists unfinished jobs', async () => {
  const { spawn, calls } = fakeSpawn();
  const done = [];
  const jobs = new InstallJobs({ spawn, onDone: id => done.push(id) });
  jobs.start('ok', 'a'); jobs.start('bad', 'b');
  assert.deepEqual(jobs.running(), ['ok', 'bad']);
  calls[0].child.emit('close', 0, null);
  calls[1].child.emit('close', 1, null);
  await Promise.resolve();
  assert.deepEqual([done, jobs.running()], [['ok'], []]);
});

test('cancel signals the isolated process group and escalates until pipes close', async () => {
  const { spawn, calls } = fakeSpawn();
  const signals = [], completed = [], timers = new Map();
  const jobs = new InstallJobs({ spawn, kill: (pid, signal) => signals.push([pid, signal]), onDone: id => completed.push(id),
    setTimer: callback => { timers.set(1, callback); return 1; }, clearTimer: id => timers.delete(id) });
  jobs.start('p', 'installer');
  assert.equal(calls[0].options.detached, true);
  assert.equal(jobs.cancel('p').state, 'running', 'do not claim cancellation before exit');
  jobs.cancel('p');
  assert.deepEqual(signals, [[-100, 'SIGTERM']], 'TERM reaches descendants, once');
  timers.get(1)();
  assert.deepEqual(signals.at(-1), [-100, 'SIGKILL']);
  calls[0].child.emit('close', 0, null);
  await Promise.resolve();
  assert.equal(jobs.snapshot('p').state, 'cancelled', 'even a clean exit after cancellation is not an install success');
  assert.deepEqual(completed, []);
  assert.equal(timers.size, 0);
});

test('cancellation tolerates an already exited group', () => {
  const { spawn, calls } = fakeSpawn();
  const jobs = new InstallJobs({ spawn, kill: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); }, setTimer: () => 1, clearTimer() {} });
  jobs.start('p', 'installer'); jobs.cancel('p');
  calls[0].child.emit('close', null, 'SIGTERM');
  assert.equal(jobs.snapshot('p').state, 'cancelled');
  assert.equal(jobs.snapshot('p').log, '');
});
