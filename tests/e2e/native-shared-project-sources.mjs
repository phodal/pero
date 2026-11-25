// Opt in via the PostgreSQL HTTP integration test. Both Native profiles are disposable.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { assertDesktopAccess } from './electron.mjs';

const origin = process.env.PERO_SHARED_SOURCES_ORIGIN;
const writer = process.env.PERO_SHARED_SOURCES_WRITER;
const reader = process.env.PERO_SHARED_SOURCES_READER;
const project = process.env.PERO_SHARED_SOURCES_PROJECT ?? 'lab';
const service = new URL(origin);
const hosted = service.protocol === 'https:';
assert.equal(service.origin, origin);
assert(hosted || (service.protocol === 'http:' && service.hostname === '127.0.0.1'));
assert(/^[a-zA-Z0-9._-]{1,128}$/.test(project));
assert(writer && reader && writer !== reader);
assertDesktopAccess();
const root = resolve(import.meta.dirname, '../..');
const installed = process.env.PERO_TEST_SHARED_SOURCES_APP && await realpath(process.env.PERO_TEST_SHARED_SOURCES_APP);
if (hosted) {
  assert(installed && process.env.PERO_SHARED_SOURCES_PROJECT, 'Hosted verification requires a probe app and an explicit test Project');
  const identities = await Promise.all([writer, reader].map(async token => {
    const response = await fetch(`${origin}/api/client/v1/me`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    assert.ok(response.ok, `Hosted client identity rejected (${response.status})`);
    const identity = await response.json();
    assert(identity.id && identity.projects.includes(project), 'Hosted client has no access to the test Project');
    return identity.id;
  }));
  assert.notEqual(...identities, 'Hosted verification needs two independent client identities');
}
if (installed) {
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', installed]);
}
const binary = installed ? resolve(installed, 'Contents/MacOS/pero-native') : resolve(root, 'target/debug/pero-native');
const output = resolve(root, 'test-results', hosted ? 'hosted-shared-project-sources'
  : installed ? 'installed-shared-project-sources' : 'native-shared-project-sources');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-shared-sources-'));
const children = [];
const site = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<title>Field notes</title><main>Amber observatory</main>');
});
let chrome, evidence;

async function startNative(phase, client) {
  const data = resolve(temp, phase === 'restore' ? 'read' : phase);
  const receipt = resolve(temp, `${phase}.json`);
  const agents = resolve(temp, 'agents.json');
  if (phase !== 'restore') {
    await mkdir(data);
    await writeFile(agents, JSON.stringify([{ id: 'browser-use-fixture', name: 'Collector fixture',
      command: process.execPath, args: [resolve(root, 'tests/fixtures/browser-use-agent.mjs')] }]));
    await writeFile(resolve(data, 'settings.json'), JSON.stringify({ chat_agent: 'browser-use-fixture' }));
  }
  const env = { ...process.env, PERO_NATIVE_DATA_DIR: data,
    PERO_ENV_FILE: '/dev/null', PERO_LOCALE: 'en', PERO_AGENTS_FILE: agents,
    PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_SHARED_SOURCES_FILES: temp, PERO_SHARED_SOURCES_PROJECT: project };
  for (const key of ['PERO_SHARED_SOURCES_WRITER', 'PERO_SHARED_SOURCES_READER', 'PERO_SHARED_SOURCES_CLIENT',
    'PERO_NATIVE_HOST', 'PERO_ADAPTER_NODE', 'PERO_NATIVE_EPHEMERAL_SECRETS']) delete env[key];
  if (client) env.PERO_SHARED_SOURCES_CLIENT = client;
  if (!installed) {
    env.PERO_NATIVE_EPHEMERAL_SECRETS = '1';
    env.PERO_ADAPTER_NODE = process.execPath;
  }
  const child = spawn(binary, ['--verify-apps', receipt, 'shared-project-sources', phase],
    { cwd: installed ? temp : root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(child);
  let log = '';
  child.stderr.on('data', value => log += value);
  const exit = once(child, 'exit');
  async function result() {
    const status = await exit;
    const contents = await readFile(receipt, 'utf8').catch(() => '');
    assert.deepEqual(status, [0, null], log || contents);
    assert.ok(contents, `Native ${phase} exited without a receipt\n${log}`);
    const result = JSON.parse(contents);
    assert.equal(result.passed, true, result.error || log);
    return result;
  }
  return { exit, result };
}

try {
  await mkdir(output, { recursive: true });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${site.address().port}/`;
  const writeNative = await startNative('write', writer);
  const extension = installed ? resolve(installed, 'Contents/Resources/app/packages/connectors/helpers/chrome-extension')
    : resolve(root, 'target/chrome-extension');
  chrome = await chromium.launchPersistentContext(resolve(temp, 'chrome'), { executablePath: chromium.executablePath(),
    headless: false, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`] });
  const target = chrome.pages()[0];
  await target.goto(url);
  const worker = chrome.serviceWorkers()[0] || await chrome.waitForEvent('serviceworker');
  const base = worker.url().replace(/\/service-worker\.js$/, '/');
  let pairing;
  await Promise.race([
    expect.poll(async () => Boolean(pairing = await readFile(resolve(temp, 'pairing'), 'utf8').catch(() => '')),
      { timeout: 40_000 }).toBe(true),
    writeNative.exit.then(async () => {
      await writeNative.result();
      throw new Error('Native writer exited before it paired with Chrome');
    }),
  ]);
  const panel = await chrome.newPage();
  await panel.goto(base + 'sidepanel.html');
  const review = await chrome.newPage();
  await review.goto(base + 'relay.html#' + new URLSearchParams({ pair: pairing }));
  await expect(review.locator('#status')).toContainText('Connected');
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Collector' }).click();
  await expect(panel.locator('#collector-capture')).toBeEnabled();
  await target.locator('main').evaluate(main => getSelection().selectAllChildren(main));
  await target.bringToFront();
  const sourceTab = await worker.evaluate(async targetUrl => (await chrome.tabs.query({ url: targetUrl }))[0].id, url);
  await panel.goto('about:blank');
  await panel.goto(base + `collector.html#tab=${sourceTab}&scope=selection`);
  await expect(panel.locator('#collector-capture-scope')).toHaveValue('selection');
  await expect(panel.locator('#collector-content')).toHaveValue('Amber observatory');
  await panel.getByLabel('Save to').selectOption(`shared:${project}`);
  const title = `Field notes 摘录 ${randomUUID()}`;
  await panel.locator('#collector-title').fill(title);
  await panel.locator('#collector-content').fill('Amber observatory 🌱');
  await panel.locator('#collector-reason').fill('Record the observation');
  await panel.locator('#collector-question').fill('What changed?');
  const preview = await panel.locator('#collector-final-preview').textContent();
  const digest = createHash('sha256').update(preview).digest('hex');
  await panel.locator('#collector-save').click();
  await expect(panel.locator('#collector-receipt')).toContainText(`Saved to Shared Project · ${project}`);
  await panel.setViewportSize({ width: 420, height: 760 });
  await panel.screenshot({ path: resolve(output, 'collector.png') });
  await chrome.close();
  chrome = undefined;
  await writeFile(resolve(temp, 'saved'), digest);
  const written = await writeNative.result();
  const readNative = await startNative('read', reader);
  const read = await readNative.result();
  assert.notEqual(read.account, written.account);
  assert.equal(read.source.projectId, project);
  assert.equal(read.source.source.url, url);
  assert.equal(read.source.source.title, title);
  assert.equal(read.source.source.content, 'Amber observatory 🌱');
  assert.equal(read.source.source.scope, 'selection');
  assert.equal(read.source.source.reason, 'Record the observation');
  assert.equal(read.source.source.question, 'What changed?');
  assert.equal(read.receipt.sha256, digest);
  assert.equal(read.source.sha256, read.receipt.sha256);
  if (installed) {
    const restored = await startNative('restore');
    assert.deepEqual(await restored.result(), read, 'Native did not restore the same Cloud identity and Project source from Keychain');
  }
  evidence = { ...read, writer: written.account, keychainRestart: !!installed, hosted };
} finally {
  await chrome?.close();
  for (const child of children) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit');
      child.kill();
      await done;
    }
  }
  const cleanup = [];
  if (installed) {
    for (const phase of ['write', 'read']) {
      const account = createHash('sha256').update(resolve(temp, phase)).digest('hex');
      cleanup.push(spawnSync('/usr/bin/security', ['delete-generic-password', '-s', 'com.openpero.native.cloud', '-a', account], { stdio: 'ignore' }).status);
    }
  }
  await new Promise(resolve => site.close(resolve));
  await rm(temp, { recursive: true, force: true });
  if (evidence && installed) assert.deepEqual(cleanup, [0, 0], 'Could not remove the fixture Keychain entries');
}
await writeFile(resolve(output, 'result.json'), JSON.stringify(evidence, null, 2));
console.log(`Chromium Collector exchanged the same reviewed Project source with an independent Native profile${installed ? ' that restored its Cloud account from Keychain after relaunch' : ''}.`);
