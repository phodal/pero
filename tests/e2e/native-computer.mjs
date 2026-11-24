// Opt-in: real Native GPUI Chat, configured DeepSeek, and an owned AppKit window.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { computerEvidenceDirectory, computerFixture } from '../fixtures/computer-app.mjs';

assert(process.platform === 'darwin' && process.env.PERO_NATIVE_COMPUTER_DEEPSEEK === '1',
  'Run with PERO_NATIVE_COMPUTER_DEEPSEEK=1 to use the configured real DeepSeek provider on macOS.');
const root = resolve(import.meta.dirname, '../..');
const installedApp = process.env.PERO_NATIVE_COMPUTER_INSTALLED_APP;
const binary = resolve(installedApp ? resolve(installedApp, 'Contents/MacOS/pero-native')
  : process.env.PERO_NATIVE_COMPUTER_BINARY || resolve(root, 'target/debug/pero-native'));
if (installedApp) {
  for (const app of [installedApp, resolve(installedApp, '../Pero Computer Use.app')]) {
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', app]);
  }
}
assert((await readFile(binary)).includes(Buffer.from('Native Computer Use timed out')), 'Build with --features native-probe.');
const output = resolve(computerEvidenceDirectory(root), 'pero-native-deepseek');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-computer-'));
let fixture;
let child;
try {
  const data = resolve(temp, 'data');
  const workspace = resolve(temp, 'workspace');
  await Promise.all([mkdir(data), mkdir(workspace), mkdir(output, { recursive: true })]);
  const receipt = resolve(output, 'session.json');
  await rm(receipt, { force: true });
  await writeFile(resolve(data, 'settings.json'), JSON.stringify({ chat_agent: 'pero', computer_use: { allowed_applications: ['dev.pero.perocomputerfixture'] } }));
  fixture = await computerFixture(root, temp);
  const env = { ...process.env, PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: data,
    PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_COMPUTER_PROBE_WORKSPACE: workspace, PERO_LOCALE: 'en' };
  delete env.PERO_AGENTS_FILE; // Run exactly the product's built-in Pero (DeepSeek).
  if (installedApp) {
    env.PERO_ENV_FILE ||= resolve(root, '.env');
    for (const key of ['PERO_NATIVE_HOST', 'PERO_ADAPTER_NODE', 'PERO_BUILTIN_APPS_ROOT', 'PERO_BUILTIN_APPS', 'PERO_REQUIRED_APPS']) delete env[key];
  }
  child = spawn(binary, ['--verify-apps', receipt, 'computer'], { cwd: installedApp ? workspace : root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', chunk => { log += chunk; });
  child.stdout.on('data', chunk => { log += chunk; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 200_000);
  try {
    const exit = await new Promise((done, fail) => {
      child.once('error', fail);
      child.once('exit', (code, signal) => done({ code, signal }));
    });
    await writeFile(resolve(output, 'native.log'), log);
    assert.deepEqual(exit, { code: 0, signal: null }, log);
  } finally {
    clearTimeout(timer);
  }
  const result = JSON.parse(await readFile(receipt, 'utf8'));
  const effects = await fixture.state();
  await writeFile(resolve(output, 'effects.json'), JSON.stringify(effects, null, 2));
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.agent, 'pero');
  assert.equal(result.settingsEnabledAndStopped, true);
  if (installedApp) {
    assert.match(result.initialStatus.message, /^Permission owner: Pero Computer Use\./);
    assert.equal(result.initialStatus.accessibility, 'granted');
    assert.equal(result.initialStatus.screen_recording, 'granted');
  }
  const settings = JSON.parse(await readFile(resolve(data, 'settings.json'), 'utf8'));
  assert.equal(settings.computer_use.enabled, false);
  assert(result.mcp.servers.some(server => server.server === 'pero-app-use' && server.tools.includes('computer_use')));
  assert.equal(effects.count, 1, 'The fixture must record exactly one real callback.');
  const thread = createHash('sha256').update(result.thread).digest('hex');
  const evidence = resolve(data, 'computer-use', thread);
  const reads = (directory, names) => Promise.all(names.map(async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'))));
  const receipts = await reads(evidence, (await readdir(evidence)).filter(name => name.endsWith('.json')));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].action.input.kind, 'click');
  assert.equal(receipts[0].action.delivery, 'background');
  assert.equal(receipts[0].receipt.outcome.status, 'executed');
  const images = resolve(evidence, 'images');
  const screenshots = await reads(images, (await readdir(images)).filter(name => name.endsWith('.json')));
  assert(screenshots.length >= 2);
  assert(screenshots.some(image => image.observation_id === receipts[0].action.observation_id));
  for (const screenshot of screenshots) {
    const imageName = `${screenshot.id}.${screenshot.media_type === 'image/png' ? 'png' : 'jpg'}`;
    const source = resolve(images, imageName);
    const image = await readFile(source);
    assert(screenshot.width > 0 && screenshot.height > 0);
    assert.equal(screenshot.bytes, image.length);
    assert.equal(screenshot.sha256, createHash('sha256').update(image).digest('hex'));
    assert.deepEqual(screenshot.target, receipts[0].action.target);
    await copyFile(source, resolve(output, imageName));
  }
  const operations = result.tools.filter(tool => tool.status === 'completed' && tool.title === 'mcp__pero-app-use__computer_use')
    .map(tool => tool.transcript?.input?.operation);
  const action = operations.indexOf('act');
  assert(operations.includes('status') && operations.includes('targets'));
  assert(action > 0 && operations.slice(0, action).includes('observe') && operations.slice(action + 1).includes('observe'));
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({
    passed: true, installedApp: installedApp ?? null, operations, initialStatus: result.initialStatus,
    fixtureCount: effects.count, screenshots, receipts,
  }, null, 2));
  console.log(`Pero Native with real DeepSeek passed: ${screenshots.length} captures, one executed AX click, independently observed Count=1.`);
} finally {
  child?.kill();
  await fixture?.close();
  await rm(temp, { recursive: true, force: true });
}
