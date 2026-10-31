import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { closeOwnedElectron } from '../e2e/owned-electron-close.mjs';

async function fixture(detached = true) {
  const child = spawn(process.execPath, ['-e', `
    const {spawn}=require('node:child_process');
    const nested=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    process.stdout.write(JSON.stringify({nested:nested.pid})+'\\n');
    setInterval(()=>{},1000);
  `], { detached, stdio: ['ignore', 'pipe', 'pipe'] });
  const [line] = await once(child.stdout, 'data');
  return { child, nested: JSON.parse(String(line)).nested };
}
async function stopped(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return ['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
  } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
for (const crashed of [true, false]) {
  test(`owned close ${crashed ? 'crash bypass' : 'deadline remains failure'} reaps the private process tree`, { skip: process.platform !== 'linux', timeout: 5000 }, async t => {
    const { child, nested } = await fixture();
    t.after(() => { if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL'); });
    let closeCalls = 0;
    const app = { process: () => child, close: () => { closeCalls++; return new Promise(() => {}); } };
    const operation = closeOwnedElectron(app, { crashed, timeoutMs: 100 });
    if (crashed) await operation;
    else await assert.rejects(operation, /Normal Electron close exceeded/);
    assert.equal(closeCalls, crashed ? 0 : 1);
    assert.equal(child.signalCode, 'SIGKILL');
    const until = Date.now() + 2000;
    while (!(await stopped(nested)) && Date.now() < until) await pause(10);
    assert.equal(await stopped(nested), true, 'known child cannot outlive cleanup');
  });
}
test('normal successful close is not force-killed', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
  await once(child.stdout, 'data');
  await closeOwnedElectron({ process: () => child, close: async () => { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } });
  assert.equal(child.signalCode, 'SIGTERM');
});

test('cleanup refuses a process in a shared group', { skip: process.platform !== 'linux', timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; } });
  await once(child.stdout, 'data');
  await assert.rejects(closeOwnedElectron({ process: () => child }, { crashed: true }), /shared process group/);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
});
