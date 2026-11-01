#!/usr/bin/env node
// Linux CI only. Track owned process identities, never other jobs' names/groups.
// /proc observation cannot capture a process orphaned before any ancestry sample.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

async function main(args) {
  const split = args.indexOf('--');
  const options = new Map();
  for (let i = 0; i < split; i += 2) options.set(args[i], args[i + 1]);
  const seconds = Number(options.get('--timeout-seconds'));
  const name = options.get('--name');
  const command = args.slice(split + 1);
  if (process.platform !== 'linux' || split !== 4 || options.size !== 2 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name ?? '') ||
      !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400 ||
      !options.has('--timeout-seconds') || !command[0]) {
    throw new Error('Usage (Linux): --timeout-seconds N --name suite -- command [args...]');
  }
  const parseIdentity = raw => {
    const fields = raw.slice(raw.lastIndexOf(') ') + 2).split(' ');
    return { pid: Number(raw.slice(0, raw.indexOf(' '))), parent: Number(fields[1]), group: Number(fields[2]), start: fields[19] };
  };
  const self = parseIdentity(readFileSync('/proc/self/stat', 'utf8'));
  const byPid = parseIdentity(readFileSync(`/proc/${process.pid}/stat`, 'utf8'));
  if (self.pid !== process.pid || byPid.pid !== process.pid || self.start !== byPid.start || self.group !== byPid.group) {
    throw new Error('Cannot safely track children: /proc PID namespace does not match this runner');
  }
  const directory = resolve('test-results/ci');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${name}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  const start = performance.now();
  const receipt = { name, command: command[0], args: command.slice(1), timeoutSeconds: seconds,
    startedAt: new Date().toISOString(), finishedAt: null, durationMs: null,
    outcome: 'running', exitCode: null, signal: null, timedOut: false };
  const save = async () => { await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`); await rename(temporary, file); };
  await save();
  console.log(`[${name}] starting ${JSON.stringify(command)}; deadline ${seconds}s; ${file}`);
  const spawnedAt = performance.now();
  const child = spawn(command[0], command.slice(1), { detached: true, stdio: 'inherit' });
  let cleanup;
  let cleanupError;
  let interrupted;
  const owned = new Map();
  const groups = new Set();
  const identity = pid => {
    try {
      const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const item = parseIdentity(raw);
      if (item.pid !== pid) throw new Error('Process identity does not match /proc entry');
      return item;
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) cleanupError = error.message;
      return null;
    }
  };
  const remember = item => {
    owned.set(item.pid, item);
    if (item.pid === item.group) groups.add(item.group);
  };
  if (child.pid) { const root = identity(child.pid); if (root) remember(root); }
  const discover = () => {
    // Some Linux kernels omit task/*/children. Read PPIDs, then follow only
    // the identity-checked ancestry closure; unrelated entries are never owned.
    const snapshot = new Map();
    for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      const item = identity(Number(name));
      if (item) snapshot.set(item.pid, item);
    }
    const children = new Map();
    for (const item of snapshot.values()) {
      if (!children.has(item.parent)) children.set(item.parent, []);
      children.get(item.parent).push(item);
    }
    const queue = [...owned.values()].filter(old => snapshot.get(old.pid)?.start === old.start).map(old => snapshot.get(old.pid));
    const seen = new Set();
    for (const current of queue) {
      if (seen.has(current.pid)) continue;
      seen.add(current.pid);
      remember(current);
      queue.push(...(children.get(current.pid) ?? []));
    }
  };
  discover();
  const watcher = setInterval(discover, 100);
  const signalOwned = signal => {
    discover();
    const signalled = new Set();
    let found = false;
    for (const previous of owned.values()) {
      const current = identity(previous.pid);
      if (!current || current.start !== previous.start || current.group !== previous.group) continue;
      // A descendant in an unowned/shared group is signalled individually.
      const target = groups.has(current.group) ? -current.group : current.pid;
      if (signalled.has(target)) continue;
      signalled.add(target);
      try { process.kill(target, signal); found = true; }
      catch (error) { if (error.code !== 'ESRCH') cleanupError = error.message; }
    }
    return found;
  };
  const stopGroup = () => cleanup ??= (async () => {
    if (!signalOwned('SIGTERM')) return;
    await new Promise(resolve => setTimeout(resolve, 250));
    signalOwned('SIGKILL');
  })();
  const onSignal = signal => { interrupted ??= signal; void stopGroup(); };
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  const deadline = setTimeout(() => { receipt.timedOut = true; void stopGroup(); }, Math.max(0, seconds * 1000 - (performance.now() - spawnedAt)));
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ error: error.message }));
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  clearTimeout(deadline);
  await stopGroup(); // Includes observed detached descendants, even after the root exits.
  clearInterval(watcher);
  process.removeListener('SIGINT', onInt);
  process.removeListener('SIGTERM', onTerm);
  Object.assign(receipt, { finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start),
    exitCode: result.exitCode ?? null, signal: result.signal ?? null });
  if (result.error) receipt.error = result.error;
  if (cleanupError) receipt.cleanupError = cleanupError;
  if (interrupted) receipt.interruptedBy = interrupted;
  receipt.outcome = receipt.timedOut ? 'timed_out' : interrupted ? 'interrupted' :
    result.error ? 'spawn_failed' : cleanupError ? 'cleanup_failed' : result.exitCode === 0 ? 'passed' : 'failed';
  await save();
  console.log(`[${name}] ${receipt.outcome} (${receipt.durationMs} ms); ${file}`);
  return receipt.timedOut ? 124 : interrupted ? 128 + constants.signals[interrupted] :
    result.error ? 127 : cleanupError ? 1 : result.exitCode ?? 128 + (constants.signals[result.signal] ?? 1);
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
