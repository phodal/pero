// Observe a local command; retain the files and receipts used by ordinary artifact delivery.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { finished } from 'node:stream/promises';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const [system, runId, ...options] = args.slice(0, separator);
const [command, ...commandArgs] = args.slice(separator + 1);
const identifier = value => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value ?? '');
const outputs = [], declared = [];
let python;
for (let index = 0; index < options.length; index++) {
  const value = options[index];
  if (['--input', '--code', '--python'].includes(value)) {
    const file = options[++index];
    if (!file || file.startsWith('--')) throw new Error(`Missing value for ${value}`);
    if (value === '--python') python = file;
    else declared.push({ name: file, role: value.slice(2) });
  } else if (value.startsWith('--')) throw new Error(`Unknown option ${value}`);
  else outputs.push(value);
}
if (separator < 3 || !outputs.length || !command || !identifier(system) || !identifier(runId)) {
  throw new Error('Usage: node scripts/record-external-run.mjs <system> <run-id> <output> [output...] [--code file] [--input file] [--python executable] -- <command> [args...]');
}
const workspace = await realpath(process.cwd());
const relativeFile = file => {
  const name = relative(workspace, file);
  if (!name || name === '..' || name.startsWith('..' + sep)) throw new Error('Recorded files must be inside the workspace');
  return name.split(sep).join('/');
};
const currentFile = async name => {
  try {
    const path = await realpath(name);
    relativeFile(path);
    const details = await stat(path, { bigint: true });
    if (!details.isFile()) throw new Error(`Expected a regular file at ${name}`);
    return { path, revision: `${details.ino}/${details.size}/${details.ctimeNs}`, size: Number(details.size) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const digest = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const paths = [...new Set(outputs.map(name => resolve(workspace, name)))];
for (const path of paths) relativeFile(path);
const previous = await Promise.all(paths.map(currentFile));
const interpreter = basename(command).replace(/\.exe$/i, '');
const isPython = /^python(?:\d+(?:\.\d+)*)?$/.test(interpreter);
const isNode = /^node(?:js)?$/.test(interpreter);
// Direct script invocation is observable. Imported files and implicit data are not inferred.
const script = (isPython || isNode) && commandArgs[0] && !commandArgs[0].startsWith('-')
  ? commandArgs[0] : !isPython && !isNode && resolve(workspace, command).startsWith(workspace + sep) && command.includes('/') ? command : null;
const scriptPath = script ? resolve(workspace, script) : null;
const scriptRelative = scriptPath ? relative(workspace, scriptPath) : null;
if (scriptPath && scriptRelative && scriptRelative !== '..' && !scriptRelative.startsWith('..' + sep)
  && !declared.some(item => resolve(workspace, item.name) === scriptPath)) {
  const file = await currentFile(scriptPath);
  if (file) declared.push({ name: script, role: 'code' });
}
const sources = new Map();
for (const item of declared) {
  const file = await currentFile(resolve(workspace, item.name));
  if (!file) throw new Error(`Missing ${item.role} file: ${item.name}`);
  if (file.size > 10 * 1024 * 1024) throw new Error(`Recorded ${item.role} exceeds the 10 MiB artifact limit: ${item.name}`);
  if (paths.includes(file.path)) throw new Error('A declared output cannot also be a retained input or code file');
  sources.set(file.path, { ...file, role: item.role });
}
if (sources.size > 11) throw new Error('At most 11 code/input files fit in the artifact evidence contract');
const parent = resolve(workspace, '.pero', 'run-records', system);
await mkdir(parent, { recursive: true });
const directory = resolve(await realpath(parent), runId);
relativeFile(directory);
await mkdir(directory);
const evidence = [];
for (const file of sources.values()) {
  const sourcePath = relativeFile(file.path);
  const retained = resolve(directory, 'files', sourcePath);
  await mkdir(dirname(retained), { recursive: true });
  await copyFile(file.path, retained);
  evidence.push({ path: relativeFile(retained), role: file.role, sha256: await digest(retained), source_path: sourcePath });
}
const stdout = resolve(directory, 'stdout.log'), stderr = resolve(directory, 'stderr.log'), environment = resolve(directory, 'environment.json');
const observed = { platform: process.platform, architecture: process.arch, wrapper_node: process.version,
  python: { status: 'unobserved', reason: 'Command is not a direct Python invocation; use --python to observe a related interpreter' } };
if (isPython || python) {
  const target = isPython ? command : python;
  const probe = spawnSync(target, ['-c', 'import importlib.metadata,json,platform,sys; print(json.dumps({"executable":sys.executable,"version":sys.version,"implementation":platform.python_implementation(),"packages":sorted([{"name":d.metadata["Name"],"version":d.version} for d in importlib.metadata.distributions() if d.metadata["Name"]],key=lambda d:d["name"].lower())}))'],
    { cwd: workspace, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  if (probe.status === 0) {
    try {
      observed.python = { status: 'observed', selection: isPython ? 'command_interpreter' : 'explicit_related_interpreter', ...JSON.parse(probe.stdout) };
    } catch { observed.python = { status: 'unavailable', reason: 'Interpreter did not return a valid metadata observation' }; }
  } else observed.python = { status: 'unavailable', reason: probe.error?.code ?? `Metadata probe exited ${probe.status ?? probe.signal}` };
}
await writeFile(environment, JSON.stringify(observed, null, 2));
const startedAt = new Date().toISOString();
const streams = [createWriteStream(stdout), createWriteStream(stderr)];
const child = spawn(command, commandArgs, { cwd: workspace, stdio: ['inherit', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
child.stdout.pipe(streams[0]);
child.stderr.pipe(streams[1]);
let cancellationRequested = false, spawnError;
const interrupt = signal => { cancellationRequested = true; child.kill(signal); };
const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
process.on('SIGINT', onInt);
process.on('SIGTERM', onTerm);
child.once('error', error => { spawnError = error.code ?? error.message; streams[1].write(`Failed to start command: ${spawnError}\n`); });
const [exitCode, signal] = await new Promise(resolveExit => child.once('close', (...result) => resolveExit(result)));
await Promise.all(streams.map(stream => finished(stream)));
process.off('SIGINT', onInt);
process.off('SIGTERM', onTerm);
const outcome = cancellationRequested || signal ? 'cancelled' : exitCode === 0 && !spawnError ? 'succeeded' : 'failed';
const execution = { started_at: startedAt, finished_at: new Date().toISOString(), exit_code: spawnError ? null : exitCode, signal,
  ...(spawnError ? { spawn_error: spawnError } : {}), ...(cancellationRequested ? { cancellation_requested: true } : {}) };
const invocation = { command, args: commandArgs, cwd: '.' };
evidence.unshift(...await Promise.all([[environment, 'environment'], [stdout, 'execution_log'], [stderr, 'execution_log']]
  .map(async ([path, role]) => ({ path: relativeFile(path), role, sha256: await digest(path) }))));
const record = { schema_version: 2, system, run_id: runId, outcome, invocation, execution, evidence };
const recordedOutputs = [];
for (const [index, name] of paths.entries()) {
  const file = await currentFile(name);
  if (!file || file.revision === previous[index]?.revision) continue;
  const output = { output_path: relativeFile(file.path), output_sha256: await digest(file.path) };
  await writeFile(file.path + '.pero-run.json', JSON.stringify({ ...record, ...output }, null, 2));
  recordedOutputs.push(output);
}
// A failed or cancelled command may have no output. Its logs still have a durable record.
const runRecord = resolve(directory, 'run.json');
await writeFile(runRecord, JSON.stringify({ ...record, outputs: recordedOutputs }, null, 2));
await writeFile(runRecord + '.pero-run.json', JSON.stringify({ ...record, output_kind: 'run_report', output_path: relativeFile(runRecord), output_sha256: await digest(runRecord) }, null, 2));
if (!recordedOutputs.length) process.stderr.write(`No changed output files were recorded. Run evidence: ${relativeFile(resolve(directory, 'run.json'))}\n`);
process.exitCode = outcome === 'succeeded' ? (recordedOutputs.length ? 0 : 1) : spawnError ? 1 : exitCode || 1;
