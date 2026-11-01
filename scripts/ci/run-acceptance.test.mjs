import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run-acceptance.mjs', import.meta.url));
async function run(t, name, script, timeout = 5, binary = process.execPath) {
  const cwd = await mkdtemp(join(tmpdir(), 'pero-ci-runner-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const child = spawn(process.execPath, [runner, '--timeout-seconds', String(timeout), '--name', name, '--', binary, '-e', script], { cwd });
  t.after(() => child.kill('SIGTERM'));
  let stdout = '', stderr = '';
  const cleanupIds = new Map();
  child.stdout.on('data', chunk => {
    stdout += chunk;
    const ready = stdout.match(/READY (\[[^\n]+\])/);
    if (ready) for (const pid of JSON.parse(ready[1])) {
      if (cleanupIds.has(pid)) continue;
      try { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); cleanupIds.set(pid, { start: fields[19], group: Number(fields[2]) }); } catch {}
    }
  });
  t.after(() => {
    for (const [pid, { start }] of cleanupIds) {
      try { if (readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19] === start) process.kill(pid, 'SIGKILL'); } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    }
    child.stdout.destroy(); child.stderr.destroy();
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
  const receipt = JSON.parse(await readFile(join(cwd, 'test-results', 'ci', `${name}.json`), 'utf8'));
  return { ...exit, receipt, stdout, stderr, observed: cleanupIds };
}

test('records actual success and command failure without masking exit codes', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  for (const [name, code] of [['success', 0], ['failure', 7]]) {
    const result = await run(t, name, `console.log('streamed output');console.error('streamed error');process.exitCode=${code}`);
    assert.equal(result.code, code);
    assert.equal(result.receipt.exitCode, code);
    assert.equal(result.receipt.outcome, code === 0 ? 'passed' : 'failed');
    assert.equal(result.receipt.timedOut, false);
    assert.match(result.stdout, /streamed output/);
    assert.match(result.stderr, /streamed error/);
    assert.equal(result.receipt.command, process.execPath);
    assert.ok(result.receipt.finishedAt >= result.receipt.startedAt);
    assert.ok(result.receipt.durationMs >= 0);
  }
});

test('deadline fails and kills owned TERM-resistant detached descendants, not unrelated processes', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  // IPC proves the descendant installed its signal handler before the fixture reports readiness.
  const descendant = `process.on('SIGTERM',()=>{});process.send(process.pid);setInterval(()=>{},1000)`;
  const fixture = `const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:['ignore','inherit','inherit','ipc']});child.on('message',pid=>console.log('READY '+JSON.stringify([process.pid,pid])));setInterval(()=>{},1000)`;
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(() => unrelated.kill('SIGKILL'));
  const result = await run(t, 'deadline', fixture, 2);
  assert.equal(result.code, 124);
  assert.equal(result.receipt.outcome, 'timed_out');
  assert.equal(result.receipt.timedOut, true);
  assert.equal(result.receipt.signal, 'SIGKILL');
  assert.ok(result.receipt.durationMs >= 2000);
  const ready = result.stdout.match(/READY (\[[^\n]+\])/);
  assert.ok(ready, 'fixture must establish descendant readiness');
  const [parent, descendantPid] = JSON.parse(ready[1]);
  assert.equal(result.observed.get(parent)?.group, parent);
  assert.equal(result.observed.get(descendantPid)?.group, descendantPid, 'grandchild actually owns a separate process group');
  for (const pid of [parent, descendantPid]) {
    // Linux may leave an orphan zombie until PID 1 reaps it; it is not executing.
    const deadline = Date.now() + 1000;
    for (;;) {
      try { if ((await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1][0] === 'Z') break; }
      catch (error) { if (error.code === 'ENOENT') break; throw error; }
      assert.ok(Date.now() < deadline, `owned process ${pid} must stop`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  assert.equal(process.kill(unrelated.pid, 0), true, 'an unrelated child must remain alive');
});


test('missing executable leaves a failed receipt instead of a pass', { skip: process.platform !== 'linux', timeout: 5000 }, async t => {
  const result = await run(t, 'missing', '', 2, '/nonexistent/pero-ci-acceptance-command');
  assert.equal(result.code, 127);
  assert.equal(result.receipt.outcome, 'spawn_failed');
  assert.equal(result.receipt.exitCode, null);
  assert.equal(result.receipt.timedOut, false);
  assert.match(result.receipt.error, /ENOENT/);
  assert.ok(result.receipt.finishedAt);
});
