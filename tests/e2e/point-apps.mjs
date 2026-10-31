// Opt-in real Point checkout, unchanged bundles, real Rust Host and Electron.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { cp, mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { electron } from './electron.mjs';
import { clickAppOpen, setAppearance } from './sidebar-controls.mjs';
import { buildPointApp } from '../../scripts/build/point-app.mjs';
import { pointAppManifest } from '../../packages/point-app/manifest.mjs';

if (!process.env.POINT_ROOT) throw new Error('Set POINT_ROOT to the Point source checkout with built Apps and installed SDK dependencies');
const pointRoot = resolve(process.env.POINT_ROOT);
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-point-apps-'));
const out = resolve(root, 'test-results/point-apps');
await mkdir(out, { recursive: true });
const profile = resolve(temp, 'profile');
await mkdir(profile);
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_APPS_ROOT: resolve(profile, 'apps'), PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_LOCALE: 'en', PERO_BUILTIN_APPS: 'no-builtins', PERO_REQUIRED_APPS: 'no-builtins' };
const checks = [], errors = [], packages = [];
const digest = async file => createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
const artifacts = {};
let host, hostExited, app;
try {
  for (const name of ['welcome', 'ontology-explorer', 'virtual-cell']) {
    const output = await buildPointApp({ pointRoot, source: resolve(pointRoot, 'apps', name), destination: resolve(temp, name) });
    const original = await readFile(resolve(pointRoot, 'apps', name, 'ui/dist/index.mjs'));
    assert.deepEqual(await readFile(resolve(temp, name, 'dist/point-ui/dist/index.mjs')), original);
    packages.push(output);
  }
  for (const name of ['factory', 'calendar', 'map', 'paper-agent']) {
    const manifest = JSON.parse(await readFile(resolve(pointRoot, 'apps', name, 'app.json'), 'utf8'));
    assert.throws(() => pointAppManifest(manifest));
  }
  checks.push('unchanged Point bundles; unsupported permissions, backends and contributions refused');
  artifacts.hostForInstall = await digest('target/debug/pero-host');
  host = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: root, env: { ...env, PERO_BUILTIN_APPS_ROOT: resolve(temp, 'no-builtins') }, stdio: ['pipe', 'pipe', 'inherit'] });
  hostExited = new Promise(resolveExit => host.once('exit', resolveExit));
  const pending = new Map();
  const lines = createInterface({ input: host.stdout });
  lines.on('line', line => {
    const event = JSON.parse(line);
    if (event.kind === 'apps_result') pending.get(event.request_id)?.(event.data);
  });
  const request = (action, fields = {}) => new Promise((resolveReply, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Host ${action} timeout`)); }, 20000);
    pending.set(id, value => { clearTimeout(timer); pending.delete(id); if (!value.ok) reject(new Error(JSON.stringify(value))); else resolveReply(value.value); });
    host.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
  });
  for (const output of packages) {
    await request('install', { path: output.directory });
    await request('enable', { name: output.manifest.name });
  }
  const access = await request('resolve', { name: 'virtual-cell' });
  assert.equal((await fetch(access.backend.url + '/api/inputs')).status, 401);
  assert.equal((await fetch(access.backend.url + '/api/inputs', { headers: { 'X-Point-App-Proxy': 'caller-controlled' } })).status, 401);
  assert.equal((await fetch(access.backend.url + '/api/inputs', { headers: { 'X-Pero-App-Token': access.backend.token } })).status, 200);
  checks.push('real Host install/enable; Python rejects missing token and forged Point signature');
  host.stdin.end(); await hostExited; host = undefined;
  artifacts.hostForDesktop = await digest('target/debug/pero-host');
  artifacts.desktop = await digest('desktop/dist/main.cjs');
  artifacts.web = {};
  for (const file of await readdir(resolve(root, 'web/dist/assets'))) {
    if (/\.(js|wasm)$/.test(file)) artifacts.web[file] = await digest('web/dist/assets/' + file);
  }
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Renderer:', message.text()); });
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.length)).toBe(3);
  const open = async name => {
    await page.mouse.click(80, await page.evaluate(() => innerHeight - 76));
    await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
    await clickAppOpen(page, name);
    const frame = page.frameLocator(`iframe[title="${name}"]`);
    await expect(frame.locator('#app')).not.toBeEmpty();
    return frame;
  };
  const welcome = await open('welcome');
  await expect(welcome.getByRole('heading', { name: 'Get started with Point Apps' })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'welcome.png') });
  checks.push('Welcome rendered through real Pero origin and original Point SDK');
  let ontology = await open('ontology-explorer');
  await ontology.getByRole('button', { name: 'Load synthetic example' }).click();
  await expect(ontology.getByRole('button', { name: 'Clear session' })).toBeEnabled();
  await expect(ontology.getByText('Synthetic example · not real business data', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'ontology-light.png') });
  await open('welcome');
  ontology = await open('ontology-explorer');
  await expect(ontology.getByText('Synthetic example · not real business data', { exact: true })).toBeVisible();
  checks.push('Ontology local example analysis; state retained across App switches');
  const cell = await open('virtual-cell');
  await cell.getByRole('button', { name: 'Load synthetic example', exact: true }).click();
  await expect(cell.getByRole('button', { name: 'Compare baselines and predictions', exact: true })).toBeEnabled();
  await cell.getByRole('button', { name: 'Compare baselines and predictions', exact: true }).click();
  await expect.poll(async () => cell.locator('body').evaluate(async () => {
    const inputs = await (await fetch('/api/inputs')).json();
    return inputs.items.length;
  })).toBe(1);
  await expect(cell.locator('body')).toContainText('additive');
  const result = await cell.locator('body').evaluate(async () => {
    const inputs = await (await fetch('/api/inputs')).json();
    const response = await fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputId: inputs.items[0].id, operation: 'evaluate' }) });
    return { status: response.status, value: await response.json() };
  });
  assert.equal(result.status, 200);
  assert.ok(result.value.id);
  assert.deepEqual(result.value.result.models.map(model => model.model.id), ['control', 'train_mean', 'additive']);
  for (const model of result.value.result.models) assert.deepEqual(model.denominator, { attempted: 5, evaluated: 5, failed: 0 });
  await writeFile(resolve(out, 'virtual-cell-result.json'), JSON.stringify(result.value, null, 2));
  await page.screenshot({ path: resolve(out, 'virtual-cell.png') });
  checks.push('original Virtual Cell Python: authenticated import, persisted input and baseline computation');
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click();
    BrowserWindow.getAllWindows()[0].setSize(1000, 788);
  });
  await expect(cell.getByRole('button', { name: '载入合成示例', exact: true })).toBeVisible();
  await open('ontology-explorer');
  await expect(ontology.getByRole('button', { name: '清空会话', exact: true })).toBeVisible();
  await setAppearance(page, 'dark');
  await expect.poll(async () => ontology.locator('html').getAttribute('data-theme')).toBe('point-dark');
  assert.equal(await ontology.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  await ontology.getByRole('button', { name: '清空会话', exact: true }).focus();
  await expect(ontology.getByRole('button', { name: '清空会话', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(ontology.getByText('导入表格，或载入合成示例', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'ontology-dark-zh-narrow.png') });
  checks.push('real locale switch, parent theme context, narrow layout and keyboard action');
  assert.deepEqual(errors, []);
  await rm(resolve(out, 'packages'), { recursive: true, force: true });
  await mkdir(resolve(out, 'packages'));
  for (const output of packages) await cp(output.directory, resolve(out, 'packages', output.manifest.name), { recursive: true });
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, artifacts, pointRevision: packages[0].receipt.pointRevision, peroRevision: packages[0].receipt.peroRevision }, null, 2));
  await rm(resolve(out, 'failure.png'), { force: true });
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: resolve(out, 'failure.png') });
    console.error(await page.evaluate(() => window.peroDiagnostics?.snapshot()));
    console.error(await page.evaluate(() => [...document.querySelectorAll('iframe')].map(frame => ({ title: frame.title, src: frame.src }))));
    for (const frame of page.frames()) console.error('Frame', frame.url(), (await frame.locator('body').innerText().catch(() => '')).slice(0, 3000));
  }
  throw error;
} finally {
  if (app) await app.close();
  if (host) { host.stdin.end(); host.kill('SIGTERM'); await hostExited; }
  await rm(temp, { recursive: true, force: true });
}
