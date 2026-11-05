// Hidden real Native GPUI → Host → newly built Go Harness → actual builtin MCPs.
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { assertDesktopAccess } from './electron.mjs';

assertDesktopAccess();
const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/native-agent-startup');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-startup-'));
await mkdir(out, { recursive: true });
await rm(resolve(out, 'result.json'), { force: true });
await mkdir(resolve(temp, 'data'));
await writeFile(resolve(temp, 'data/settings.json'), JSON.stringify({ chat_agent: 'pero' }));
const binaries = ['pero-native', 'pero-host', 'pero-agent-acp', 'pero-connector-worker'];
for (const name of binaries) await copyFile(resolve(root, 'target/debug', name), resolve(temp, name));
assert((await readFile(resolve(temp, 'pero-native'))).includes(Buffer.from('Native Agent startup timed out')), 'Build with --features native-probe first');
await writeFile(resolve(temp, 'agents.json'), JSON.stringify([{ id: 'pero', name: 'Built-in Harness startup probe', command: resolve(temp, 'pero-agent-acp'),
  args: ['--endpoint', 'http://127.0.0.1:1', '--model', 'probe', '--api-key-env', 'PERO_PROBE_KEY', '--session-dir', resolve(temp, 'sessions'),
    '--workspace', '{workspace}', '--enable-agent-instructions', '--enable-todos'], env: { PERO_PROBE_KEY: 'synthetic-no-model-request' } }]));
const child = spawn(resolve(temp, 'pero-native'), ['--verify-apps', resolve(out, 'result.json'), 'startup'], { cwd: root, env: { ...process.env,
  PERO_NATIVE_BUNDLED: '1', PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: resolve(temp, 'data'), PERO_NATIVE_HOST: resolve(temp, 'pero-host'),
  PERO_AGENTS_FILE: resolve(temp, 'agents.json'), PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_ENV_FILE: resolve(temp, 'absent.env'),
  DEEPSEEK_API_KEY: 'synthetic-no-model-request', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1',
}, stdio: ['ignore', 'pipe', 'pipe'] });
const started = performance.now();
let log = '';
child.stdout.on('data', value => log += value);
child.stderr.on('data', value => log += value);
const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
try {
  const exit = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal })); });
  await writeFile(resolve(out, 'native.log'), log);
  assert.equal(exit.signal, null, log); assert.equal(exit.code, 0, log);
  const value = JSON.parse(await readFile(resolve(out, 'result.json'), 'utf8'));
  assert.equal(value.passed, true, JSON.stringify(value));
  assert.deepEqual(value.mcp.servers.find(server => server.server === 'pero-connectors').tools, ['connectors_list', 'connectors_call']);
  const hashes = Object.fromEntries(await Promise.all(binaries.map(async name => [name, createHash('sha256').update(await readFile(resolve(temp, name))).digest('hex')])));
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ ...value, totalMs: Math.round(performance.now() - started), sha256: hashes }, null, 2));
  console.log('Native Agent startup passed: both builtin MCPs connected, no model prompt.');
} finally { clearTimeout(timer); child.kill(); await rm(temp, { recursive: true, force: true }); }
