import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

async function identity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, parent: Number(fields[1]), start: fields[19], running: !['Z', 'X'].includes(fields[0]) };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}

// Snapshot only this launched Host's descendants, without reading command lines
// or environments. Start-time identity prevents signaling a reused PID.
export async function descendants(pid) {
  const snapshot = (await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(name => identity(Number(name))))).filter(Boolean);
  const owned = [];
  function visit(parent) {
    for (const child of snapshot.filter(value => value.parent === parent)) { owned.push(child); visit(child.pid); }
  }
  visit(pid); return owned;
}

export async function finishDescendants(owned) {
  const active = async () => (await Promise.all(owned.map(async value => {
    const current = await identity(value.pid);
    return current?.start === value.start && current.running ? value : null;
  }))).filter(Boolean);
  let remaining = await active();
  const graceful = Date.now() + 1000;
  while (remaining.length && Date.now() < graceful) { await pause(25); remaining = await active(); }
  const forced = remaining.length > 0;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const value of remaining) {
      const current = await identity(value.pid);
      if (current?.start !== value.start || !current.running) continue;
      try { process.kill(value.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const deadline = Date.now() + (signal === 'SIGTERM' ? 3000 : 1000);
    while (remaining.length && Date.now() < deadline) { await pause(25); remaining = await active(); }
    if (!remaining.length) break;
  }
  return { descendantsExited: remaining.length === 0, descendantCount: owned.length, forcedDescendants: forced };
}

// Remove any exact credential echo before exposing a trajectory. Preserve other
// bytes, including synthetic assets, and never retain an original/backup copy.
export async function scrubTree(directory, credential) {
  if (!credential) throw new Error('Nonempty credential required for redaction');
  const needle = Buffer.from(credential), replacement = Buffer.from('[REDACTED]');
  let found = false;
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile()) continue;
      const original = await readFile(file);
      let offset = 0, index = original.indexOf(needle), parts = [];
      if (index < 0) continue;
      found = true;
      while (index >= 0) { parts.push(original.subarray(offset, index), replacement); offset = index + needle.length; index = original.indexOf(needle, offset); }
      parts.push(original.subarray(offset));
      try { await writeFile(file, Buffer.concat(parts)); }
      catch (error) { await rm(file, { force: true }); throw error; }
    }
  }
  await walk(directory); return found;
}
