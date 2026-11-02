// Launch the actual portable GPUI package from a clean home outside the checkout.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const source = join(root, 'target/native-package/Pero Native.app');
const scratch = mkdtempSync(join(tmpdir(), 'pero-native-installation-'));
const output = join(root, 'test-results/native-package');
mkdirSync(output, { recursive: true });
const app = join(scratch, 'Pero Native.app');
cpSync(source, app, { recursive: true, verbatimSymlinks: true });
const payload = join(app, 'Contents/Resources/app');
const executable = join(app, 'Contents/MacOS/pero-native');
const node = join(payload, 'bin/node');
const env = { ...process.env, HOME: scratch, PATH: '/usr/bin:/bin', PERO_NATIVE_DATA_DIR: join(scratch, 'data'), PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_ENV_FILE: '/dev/null' };
for (const key of ['PERO_NATIVE_HOST', 'PERO_ADAPTER_NODE', 'PERO_AGENT_ROOT', 'PERO_BUILTIN_APPS_ROOT', 'PERO_BUILTIN_APPS', 'PERO_REQUIRED_APPS', 'DEEPSEEK_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[key];
for (const name of ['codex-acp', 'claude-agent-acp']) assert.ok(execFileSync(node, [join(payload, 'adapters', `${name}.mjs`), '--version'], { cwd: scratch, env, timeout: 30000 }).toString().trim());
const receipt = join(scratch, 'receipt.json');
const child = spawn(executable, ['--verify-installation', receipt], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', chunk => log += chunk);
child.stderr.on('data', chunk => log += chunk);
const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
try {
  const exit = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal })); });
  writeFileSync(join(output, 'native.log'), log);
  assert.equal(exit.signal, null, log);
  assert.equal(exit.code, 0, log);
  const result = JSON.parse(readFileSync(receipt, 'utf8'));
  assert.equal(result.passed, true);
  assert.equal(result.root, realpathSync(payload));
  const product = JSON.parse(readFileSync(join(payload, 'products/pero.json'), 'utf8'));
  assert.deepEqual(result.apps, product.apps);
  writeFileSync(join(output, 'smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Portable Native passed: actual GPUI window, bundled Host/Node/adapters/Apps, clean home, no source checkout or system Node.');
} finally { clearTimeout(timeout); child.kill(); rmSync(scratch, { recursive: true, force: true }); }
