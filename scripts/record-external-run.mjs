// Run a local command and write versioned artifact receipts for the files it changed.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { relative, resolve, sep } from 'node:path';
import { finished } from 'node:stream/promises';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const [system, runId, ...outputs] = args.slice(0, separator);
const [command, ...commandArgs] = args.slice(separator + 1);
const identifier = value => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value ?? '');
if (separator < 3 || !command || !identifier(system) || !identifier(runId)) {
  throw new Error('Usage: node scripts/record-external-run.mjs <system> <run-id> <output> [output...] -- <command> [args...]');
}
const workspace = await realpath(process.cwd());
const relativeFile = file => {
  const name = relative(workspace, file);
  if (!name || name === '..' || name.startsWith('..' + sep)) throw new Error('Output must be inside the workspace');
  return name;
};
const currentFile = async name => {
  try {
    const path = await realpath(name);
    relativeFile(path);
    const details = await stat(path, { bigint: true });
    if (!details.isFile()) throw new Error(`Expected a regular file at ${name}`);
    return { path, revision: `${details.ino}/${details.size}/${details.ctimeNs}` };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const paths = [...new Set(outputs.map(name => resolve(workspace, name)))];
for (const path of paths) relativeFile(path);
const previous = await Promise.all(paths.map(currentFile));
const parent = resolve(workspace, '.pero', 'run-records', system);
await mkdir(parent, { recursive: true });
const directory = resolve(await realpath(parent), runId);
relativeFile(directory);
await mkdir(directory);
const stdout = resolve(directory, 'stdout.log'), stderr = resolve(directory, 'stderr.log'), environment = resolve(directory, 'environment.json');
await writeFile(environment, JSON.stringify({ platform: process.platform, architecture: process.arch, wrapper_node: process.version }, null, 2));
const child = spawn(command, commandArgs, { cwd: workspace, stdio: ['inherit', 'pipe', 'pipe'] });
const streams = [createWriteStream(stdout), createWriteStream(stderr)];
child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
child.stdout.pipe(streams[0]);
child.stderr.pipe(streams[1]);
const interrupt = () => child.kill('SIGINT');
process.on('SIGINT', interrupt);
let exitCode, signal;
try {
  [[exitCode, signal]] = await Promise.all([once(child, 'exit'), ...streams.map(stream => finished(stream))]);
} finally {
  process.off('SIGINT', interrupt);
}
const digest = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const evidence = await Promise.all([[environment, 'environment'], [stdout, 'execution_log'], [stderr, 'execution_log']]
  .map(async ([path, role]) => ({ path: relativeFile(path), role, sha256: await digest(path) })));
let recorded = 0;
for (const [index, name] of paths.entries()) {
  const file = await currentFile(name);
  if (!file || file.revision === previous[index]?.revision) continue;
  await writeFile(file.path + '.pero-run.json', JSON.stringify({ schema_version: 1, system, run_id: runId,
    outcome: signal ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed',
    output_sha256: await digest(file.path), evidence }, null, 2));
  recorded++;
}
if (!recorded) process.stderr.write('No changed output files were recorded.\n');
process.exitCode = exitCode || (signal ? 1 : recorded ? 0 : 1);
