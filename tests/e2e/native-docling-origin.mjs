// Read-only real WKWebView transport, not full Paper or native consent acceptance.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'darwin') throw Error('This probe requires macOS WKWebView.');
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/native-docling-origin');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-docling-origin-'));
await mkdir(out, { recursive: true });
const receipt = resolve(out, 'result.json');
await rm(receipt, { force: true });
let child, timer, log = '', timedOut = false;
const stop = () => {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
};
try {
  const binary = resolve(temp, 'pero-native'), host = resolve(temp, 'pero-host');
  await copyFile(resolve(root, 'target/debug/pero-native'), binary);
  await copyFile(resolve(root, 'target/debug/pero-host'), host);
  assert((await readFile(binary)).includes(Buffer.from('Native Docling origin probe timed out')), 'Build with --features native-probe first');
  const builtins = resolve(temp, 'builtins'), paper = resolve(builtins, 'paper-agent'), data = resolve(temp, 'data');
  await mkdir(paper, { recursive: true });
  await cp(resolve(root, 'apps/paper-agent/dist'), resolve(paper, 'dist'), { recursive: true });
  const original = JSON.parse(await readFile(resolve(root, 'apps/paper-agent/app.json'), 'utf8'));
  // Keep the real entry, permissions and assets. Omit backend/write declarations
  // so loading this fixture cannot prepare Python or install App dependencies.
  const fixture = { schemaVersion: original.schemaVersion, name: original.name, version: original.version,
    displayName: original.displayName, description: original.description, permissions: original.permissions,
    contributes: { panels: original.contributes.panels } };
  await writeFile(resolve(paper, 'app.json'), JSON.stringify(fixture));
  const python = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 10000 }).trim();
  const context = {
    checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim(),
    pullRequestHeadSha: process.env.PERO_NATIVE_PROBE_PR_HEAD_SHA || null,
    githubRunId: process.env.PERO_NATIVE_PROBE_RUN_ID || null,
    macosVersion: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 10000 }).trim(),
    machine: execFileSync('/usr/bin/uname', ['-m'], { encoding: 'utf8', timeout: 10000 }).trim(),
    nodeArch: process.arch,
    sha256: Object.fromEntries(await Promise.all([
      ['native', binary], ['host', host], ['paperIndex', resolve(paper, 'dist/index.js')],
    ].map(async ([name, path]) => [name, createHash('sha256').update(await readFile(path)).digest('hex')]))),
  };
  assert.match(context.checkoutSha, /^[a-f0-9]{40}$/);
  if (context.pullRequestHeadSha !== null) assert.match(context.pullRequestHeadSha, /^[a-f0-9]{40}$/);
  if (context.githubRunId !== null) assert.match(context.githubRunId, /^\d+$/);
  await writeFile(resolve(out, 'context.json'), `${JSON.stringify(context, null, 2)}\n`);
  const env = { ...process.env, HOME: temp, PERO_NATIVE_BUNDLED: '1', PERO_NATIVE_EPHEMERAL_SECRETS: '1',
    PERO_NATIVE_DATA_DIR: data, PERO_APPS_ROOT: resolve(data, 'apps'), PERO_NATIVE_HOST: host,
    PERO_BUILTIN_APPS_ROOT: builtins, PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: '',
    PERO_APP_PYTHON: python, PERO_ENV_FILE: '/dev/null', PERO_LOCALE: 'en' };
  for (const key of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[key];
  child = spawn(binary, ['--verify-apps', receipt, 'docling-origin'], { cwd: root, env,
    detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', value => log += value);
  child.stderr.on('data', value => log += value);
  timer = setTimeout(() => { timedOut = true; stop(); }, 45000);
  const exit = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { clearTimeout(timer); done({ code, signal }); });
  });
  assert.equal(timedOut, false, `Native origin probe exceeded 45 seconds\n${log}`);
  assert.equal(exit.signal, null, log);
  assert.equal(exit.code, 0, log);
  const result = JSON.parse(await readFile(receipt, 'utf8'));
  Object.assign(result, context, { webviewPassed: result.passed, passed: false });
  await writeFile(receipt, `${JSON.stringify(result, null, 2)}\n`);
  assert.equal(result.webviewPassed, true, JSON.stringify(result));
  assert.equal(result.native_approval_exercised, false);
  for (const absent of [resolve(data, 'environment/paper-docling'), resolve(data, 'app-data/paper-agent/research-v1/docling-runtime.json')]) {
    await assert.rejects(access(absent), { code: 'ENOENT' }, 'Read-only probe must not install or persist authorization');
  }
  result.optional_runtime_files_created = false;
  result.passed = true;
  await writeFile(receipt, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Native WKWebView status and forged-input refusal passed; observed origin: ${result.observation.origin}`);
} finally {
  clearTimeout(timer);
  stop();
  await writeFile(resolve(out, 'native.log'), log);
  await writeFile(resolve(out, 'process.json'), `${JSON.stringify({ timeoutSeconds: 45, timedOut,
    exitCode: child?.exitCode ?? null, signal: child?.signalCode ?? null }, null, 2)}\n`);
  await rm(temp, { recursive: true, force: true });
}
