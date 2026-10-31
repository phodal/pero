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
import { buildPointRuntime } from '../../scripts/build/point-app.mjs';
import { pointHeaders } from '../../desktop/src/main/point-apps.ts';
import { pointAppManifest } from '../../packages/point-app/manifest.mjs';

if (!process.env.POINT_ROOT) throw new Error('Set POINT_ROOT to the Point source checkout with built Apps and installed SDK dependencies');
const pointRoot = resolve(process.env.POINT_ROOT);
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-point-apps-'));
const out = resolve(root, 'test-results/point-apps');
await mkdir(out, { recursive: true });
const profile = resolve(temp, 'profile');
await mkdir(profile);
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_APPS_ROOT: resolve(profile, 'apps'), PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_LOCALE: 'en', PERO_HOST_EXECUTABLE: resolve(root, 'target/point-apps/debug/pero-host'), PERO_POINT_RUNTIME_ROOT: resolve(root, 'packages/point-app/dist'), PERO_BUILTIN_APPS: 'no-builtins', PERO_REQUIRED_APPS: 'no-builtins' };
const checks = [], errors = [], packages = [];
const sourceBase = (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim();
const digest = async file => createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
const artifacts = {};
let host, hostExited, app;
try {
  await buildPointRuntime({ pointRoot, destination: env.PERO_POINT_RUNTIME_ROOT });
  const pointRevision = JSON.parse(await readFile(resolve(env.PERO_POINT_RUNTIME_ROOT, 'runtime.json'))).pointRevision;
  const names = ['welcome', 'ontology-explorer', 'virtual-cell', 'map', 'design-system', 'can-bus-monitor', 'data-lab', 'cad-studio', 'ai4s-lab'];
  for (const name of ['factory', 'calendar', 'aaos-test', 'cobol-modernization']) {
    const manifest = JSON.parse(await readFile(resolve(pointRoot, 'apps', name, 'app.json'), 'utf8'));
    assert.throws(() => pointAppManifest(manifest));
  }
  checks.push('unchanged Point bundles; unsupported permissions, backends and contributions refused');
  artifacts.hostForInstall = await digest('target/point-apps/debug/pero-host');
  host = spawn(env.PERO_HOST_EXECUTABLE, ['--stdio'], { cwd: root, env: { ...env, PERO_BUILTIN_APPS_ROOT: resolve(temp, 'no-builtins') }, stdio: ['pipe', 'pipe', 'inherit'] });
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
  await assert.rejects(request('install', {path:resolve(pointRoot,'apps/pages')}), /Unsupported Point shared module: @point\/pages-ui/);
  for (const name of names) {
    await request('install', { path: resolve(pointRoot, 'apps', name) });
    await request('enable', { name });
    const directory = resolve(profile, 'apps', name);
    const manifest = JSON.parse(await readFile(resolve(directory, 'app.json'), 'utf8'));
    const receipt = JSON.parse(await readFile(resolve(directory, 'point-build.json'), 'utf8'));
    assert.deepEqual(await readFile(resolve(directory, 'dist/point-ui/dist/index.mjs')), await readFile(resolve(pointRoot, 'apps', name, 'ui/dist/index.mjs')));
    packages.push({ directory, manifest, receipt });
  }
  const multi = resolve(temp, 'multi-panel');
  await mkdir(multi);
  await cp(resolve(pointRoot, 'apps/welcome/ui'), resolve(multi, 'ui'), {recursive:true});
  await writeFile(resolve(multi, 'app.json'), JSON.stringify({ name:'point-multi-panel', version:'1.0.0',displayName:'Point multi-panel fixture',permissions:{api:['/api/projects'],events:[]},contributes:{panelTabs:[{id:'first',title:'First',entry:'dist/index.mjs'},{id:'second',title:'Second',entry:'dist/index.mjs'}]} }));
  await request('install', {path:multi});
  await request('enable', {name:'point-multi-panel'});
  const access = await request('resolve', { name: 'virtual-cell' });
  assert.equal((await fetch(access.backend.url + '/api/inputs')).status, 401);
  assert.equal((await fetch(access.backend.url + '/api/inputs', { headers: { 'X-Point-App-Proxy': 'caller-controlled' } })).status, 401);
  assert.equal((await fetch(access.backend.url + '/api/inputs', { headers: pointHeaders(access.backend.token, 'GET', '/api/inputs') })).status, 200);
  checks.push('real Host install/enable; Python rejects missing token and forged Point signature');
  host.stdin.end(); await hostExited; host = undefined;
  artifacts.hostForDesktop = await digest('target/point-apps/debug/pero-host');
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
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.length)).toBe(names.length + 1);
  const open = async name => {
    const catalog = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).sidebarButtonBounds?.apps);
    if (catalog) await page.mouse.click(catalog.x + catalog.width / 2, catalog.y + catalog.height / 2);
    else await page.mouse.click(80, await page.evaluate(() => innerHeight - 76));
    await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
    await page.mouse.move(850, 500);
    for (let attempt = 0; attempt < 12; attempt++) {
      const bounds = await page.evaluate(name => JSON.parse(window.peroDiagnostics.snapshot()).appOpenButtonBounds?.[name], name);
      if (bounds && bounds.y >= 0 && bounds.y + bounds.height <= await page.evaluate(() => innerHeight)) break;
      await page.mouse.wheel(0, attempt < 6 ? 450 : -450);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    await clickAppOpen(page, name);
    const frame = page.frameLocator(`iframe[title="${name}"]`);
    await expect(frame.locator('#app')).not.toBeEmpty();
    return frame;
  };
  const multiple = await open('point-multi-panel');
  await expect(multiple.locator('html')).toHaveAttribute('data-point-panel', 'first');
  const projectCheck = await multiple.locator('body').evaluate(async () => {
    const created = await fetch('/api/projects', {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'point-app-project-1'},body:JSON.stringify({title:'Pero local research',typeId:'software'})});
    const value = await created.json();
    const read = await fetch('/api/projects/' + value.project.id);
    const local = await (await fetch('/api/projects/' + value.project.id + '/hub')).json();
    return {status:created.status,read:read.status,etag:read.headers.get('etag'),local};
  });
  assert.deepEqual(projectCheck, {status:201,read:200,etag:'"1"',local:{connected:false,connection:null,shared:false,hostId:projectCheck.local.hostId}});
  assert.ok(projectCheck.local.hostId);
  checks.push('original Project API creates durable local Pero state without Point service; revision and local Hub ownership preserved');
  const secondary = await multiple.locator('body').evaluate(async () => { const response = await fetch('/dist/second.html'); return {status:response.status,text:await response.text()}; });
  assert.equal(secondary.status, 200);
  assert.ok(secondary.text.includes('data-point-panel="second"'));
  checks.push('two Point panel identities preserved; first rendered and secondary entry served');
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
  const appUse = request => page.evaluate(({ request }) => new Promise((resolveReply, reject) => {
    const frame = document.querySelector('iframe[title="ontology-explorer"]');
    const id = crypto.randomUUID();
    const receive = event => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'pero:app-use:result' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive); resolveReply(event.data);
    };
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('App Use timeout')); }, 5000);
    window.addEventListener('message', receive);
    frame.contentWindow.postMessage({ type: 'pero:app-use:request', id, request }, '*');
  }), { request });
  const semantic = await appUse({ action: 'semantic', target: 'ontology-explorer' });
  assert.equal(semantic.ok, true);
  assert.equal(semantic.value.objects[0].state.status, 'ready');
  const geometry = await appUse({ action: 'geometry', target: 'ontology-explorer' });
  assert.equal(geometry.ok, true);
  checks.push('Point semantic registry and data-point-object geometry connected to existing App Use bridge');
  checks.push('Ontology local example analysis; state retained across App switches');
  const cell = await open('virtual-cell');
  await cell.getByRole('button', { name: 'Load synthetic example', exact: true }).click();
  await expect(cell.getByRole('button', { name: 'Compare baselines and predictions', exact: true })).toBeEnabled();
  await cell.getByRole('button', { name: 'Compare baselines and predictions', exact: true }).click();
  await expect.poll(async () => cell.locator('body').evaluate(async () => {
    const inputs = await (await fetch('/apps/virtual-cell/api/inputs')).json();
    return inputs.items.length;
  })).toBe(1);
  await expect(cell.locator('body')).toContainText('additive');
  const result = await cell.locator('body').evaluate(async () => {
    const inputs = await (await fetch('/apps/virtual-cell/api/inputs')).json();
    const response = await fetch('/apps/virtual-cell/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputId: inputs.items[0].id, operation: 'evaluate' }) });
    return { status: response.status, value: await response.json() };
  });
  assert.equal(result.status, 200);
  assert.ok(result.value.id);
  assert.deepEqual(result.value.result.models.map(model => model.model.id), ['control', 'train_mean', 'additive']);
  for (const model of result.value.result.models) assert.deepEqual(model.denominator, { attempted: 5, evaluated: 5, failed: 0 });
  await writeFile(resolve(out, 'virtual-cell-result.json'), JSON.stringify(result.value, null, 2));
  await page.screenshot({ path: resolve(out, 'virtual-cell.png') });
  checks.push('original Virtual Cell Python: authenticated import, persisted input and baseline computation');
  for (const name of ['map', 'design-system', 'can-bus-monitor', 'data-lab', 'cad-studio', 'ai4s-lab']) {
    const frame = await open(name);
    await expect(frame.locator('#app')).not.toContainText('Error:');
    const apiPath = name === 'can-bus-monitor' ? '/api/bus/state' : name === 'data-lab' ? '/api/datasets' : name === 'cad-studio' ? '/api/status' : name === 'ai4s-lab' ? '/api/environment' : '/api/catalog';
    const result = await frame.locator('body').evaluate(async (_element, { name, apiPath }) => {
      const response = await fetch(`/apps/${name}${apiPath}`);
      return { status: response.status, text: (await response.text()).slice(0, 500) };
    }, { name, apiPath });
    console.log(name, result);
    assert.equal(result.status, 200, name + ': ' + result.text);
    await page.screenshot({ path: resolve(out, `${name}.png`) });
  }
  const science = await open('ai4s-lab');
  const config = await science.locator('body').evaluate(async () => {
    const before = await (await fetch('/api/apps/ai4s-lab/config')).json();
    const written = await fetch('/api/apps/ai4s-lab/config', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...before, compatibilityReceipt: 'point-config-roundtrip'})});
    return { status: written.status, value: await (await fetch('/api/apps/ai4s-lab/config')).json() };
  });
  assert.equal(config.status, 200);
  assert.equal(config.value.compatibilityReceipt, 'point-config-roundtrip');
  checks.push('Point App storage/config API roundtrip remains owned by Rust Host');
  const dataLab = await open('data-lab');
  await dataLab.getByRole('button', { name: 'Run analysis', exact: true }).click();
  await expect.poll(async () => dataLab.locator('body').evaluate(async () => {
    const data = await (await fetch('/apps/data-lab/api/runs')).json();
    return data.items[0]?.status;
  })).toBe('succeeded');
  await dataLab.getByRole('button', { name: 'Discuss in App chat', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).composer)).toContain('Data Lab');
  // Close the shared dock through its actual control before checking more Apps.
  const map = await open('map');
  await map.locator('body').evaluate(async () => { const response = await fetch('/apps/map/api/map/reset', {method:'POST'}); if (!response.ok) throw new Error('Cannot seed prior Map document'); });
  const written = await map.locator('body').evaluate(async () => {
    const response = await fetch('/apps/map/api/map', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title: 'Portable Point API', points: [{ id: 'point-1', name: 'Portable location', latitude: 30.25, longitude: 120.15 }] }) });
    return { status: response.status, receipt: await response.json() };
  });
  assert.equal(written.status, 200);
  const restored = await map.locator('body').evaluate(async () => {
    const response = await fetch('/apps/map/api/map/restore', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    return response.status;
  });
  assert.equal(restored, 200);
  checks.push('original Point examples, Data Lab analysis/chat draft, Map PUT and undo API');
  checks.push('six further original Apps loaded with their Node/Python backend APIs');

  await open('virtual-cell');
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
  await mkdir(resolve(out, 'receipts'), {recursive:true});
  for (const output of packages) await writeFile(resolve(out, 'receipts', output.manifest.name + '.json'), JSON.stringify({manifest:output.manifest,receipt:output.receipt},null,2));
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, artifacts, pointRevision, peroBaseRevision: sourceBase }, null, 2));
  await rm(resolve(out, 'failure.png'), { force: true });
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: resolve(out, 'failure.png') });
    console.error(await page.evaluate(() => { const state = JSON.parse(window.peroDiagnostics?.snapshot() || '{}'); return { navigation: state.navigation, appError: state.appError, activeApp: state.activeApp }; }));
    console.error(await page.evaluate(() => [...document.querySelectorAll('iframe')].map(frame => ({ title: frame.title, src: frame.src }))));
    for (const frame of page.frames()) console.error('Frame', frame.url(), await frame.getByRole('alert').allTextContents().catch(() => []));
  }
  throw error;
} finally {
  if (app) await app.close();
  if (host) { host.stdin.end(); host.kill('SIGTERM'); await hostExited; }
  await rm(temp, { recursive: true, force: true });
}
