/** Real sandboxed Compute UI + SDK + Python persistence; only the Host boundary is a fixture. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { appSdkAliases } from '../../../scripts/build/app-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..'), appRoot = resolve(root, 'apps/compute');
const captures = resolve(root, 'test-results/compute');
let browser, directory, bundle, css;
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'pero-compute-ui-'));
  await mkdir(captures, { recursive: true });
  await build({ entryPoints: [resolve(appRoot, 'ui-src/frame.tsx')], outfile: resolve(directory, 'app.js'),
    bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', alias: appSdkAliases(root),
    nodePaths: [resolve(appRoot, 'node_modules')], loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
    plugins: [{ name: 'app-react-runtime', setup(builder) {
      builder.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => args.resolveDir === appRoot ? undefined : builder.resolve(args.path, { kind: args.kind, resolveDir: appRoot }));
    } }] });
  [bundle, css] = await Promise.all(['app.js', 'app.css'].map(name => readFile(resolve(directory, name))));
  browser = await chromium.launch({ headless: true, ...(process.env.PERO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PERO_CHROMIUM_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function fixture(t, options = {}) {
  const data = await mkdtemp(resolve(tmpdir(), 'pero-compute-data-')), secret = 'compute-loopback-fixture';
  const errors = [], requests = [];
  let backend, port, diagnostics = '';
  const start = async () => {
    backend = spawn(process.env.PYTHON || 'python3', [resolve(appRoot, 'backend/server.py')], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PERO_APP_DATA: data, PERO_APP_TOKEN: secret }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stderr.on('data', chunk => { diagnostics += chunk; });
    const lines = createInterface({ input: backend.stdout });
    port = await new Promise((resolvePort, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Compute readiness timed out: ${diagnostics}`)), 10000);
      backend.once('error', reject);
      backend.once('exit', code => reject(new Error(`Compute exited ${code}: ${diagnostics}`)));
      lines.once('line', line => { clearTimeout(deadline); resolvePort(JSON.parse(line).port); });
    });
    lines.close();
  };
  const stop = async () => {
    if (!backend || backend.exitCode !== null) return;
    const current = backend;
    await new Promise(resolveStop => { current.once('exit', resolveStop); current.kill('SIGTERM'); });
  };
  await start();
  const server = createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) {
      let content = ''; for await (const chunk of request) content += chunk;
      requests.push({ path: request.url, method: request.method, value: content ? JSON.parse(content) : null });
      const result = await fetch(`http://127.0.0.1:${port}${request.url}`, { method: request.method,
        headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': secret }, ...(content ? { body: content } : {}) });
      response.writeHead(result.status, { 'Content-Type': 'application/json' }); return response.end(await result.text());
    }
    if (request.url === '/host/sdk') { response.writeHead(200, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify({ name: 'compute', locale: 'zh-CN', dark: false, active: true })); }
    if (request.url === '/app.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(bundle); }
    if (request.url === '/app.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); return response.end(css); }
    if (request.url === '/app') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="app"></div><script type="module" src="/app.js"></script>'); }
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      return response.end(`<!doctype html><style>body{margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
        <iframe title="Compute" sandbox="allow-scripts allow-same-origin" src="/app"></iframe><script>
        window.hostNavigations=[];window.failNavigation=false;window.context={locale:'zh-CN',dark:false,active:true};
        addEventListener('message',event=>{
          if(event.data?.type==='pero:app:ready')event.source.postMessage({type:'pero:app:context',context:window.context},'*');
          if(event.data?.type==='pero:app:sdk'&&event.data.operation==='navigate'){
            hostNavigations.push(event.data.input.path);
            event.source.postMessage({type:'pero:app:sdk-result',id:event.data.id,ok:!window.failNavigation,error:window.failNavigation?'Host navigation unavailable':undefined},'*');
          }
        });</script>`);
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    if (!t.passed) await page.screenshot({ path: resolve(captures, 'failure.png'), fullPage: true });
    await page.close(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
    await stop(); await rm(data, { recursive: true, force: true }); assert.deepEqual(errors, []);
  });
  const request = async (path, value) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: value === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': secret }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    assert.equal(response.status, 200); return response.json();
  };
  let releaseInitial;
  const initialGate = options.holdInitial ? new Promise(resolveInitial => { releaseInitial = resolveInitial; }) : Promise.resolve();
  if (options.failInitial) await page.route('**/api/state', async route => { await initialGate; await route.fulfill({ status: 503, json: { detail: 'Initial configuration read failed' } }); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const frame = page.frameLocator('iframe');
  if (!options.failInitial) await expect(frame.getByRole('heading', { name: '尚未连接，无法读取作业', exact: true })).toBeVisible();
  return { page, frame, request, requests, releaseInitial, restart: async () => { await stop(); await start(); await page.reload(); },
    unauthorized: () => fetch(`http://127.0.0.1:${port}/api/state`),
    nonexistent: () => fetch(`http://127.0.0.1:${port}/api/jobs/submit`, { method: 'POST', headers: { 'X-Pero-App-Token': secret } }) };
}

test('saved cluster drafts create, edit, select and restart without claiming a scheduler connection', async t => {
  const { page, frame, request, requests, restart, unauthorized, nonexistent } = await fixture(t);
  assert.equal((await unauthorized()).status, 401);
  assert.equal((await nonexistent()).status, 404);
  assert.equal((await request('/api/state')).jobs, null);
  await expect(frame.getByRole('table')).toHaveCount(0);
  await page.screenshot({ path: resolve(captures, 'jobs-chinese-light.png'), fullPage: true });
  await frame.getByRole('button', { name: '管理集群', exact: true }).click();
  await frame.getByRole('button', { name: '添加集群配置', exact: true }).click();
  const dialog = frame.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: '集群名称', exact: true })).toBeFocused();
  await expect(dialog.locator('input[type=password]')).toHaveCount(0);
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(dialog).toBeVisible();
  assert.equal(requests.filter(item => item.method === 'POST').length, 0);
  await dialog.getByRole('textbox', { name: '集群名称', exact: true }).fill('University HPC');
  await dialog.getByRole('textbox', { name: '登录主机或 SSH 别名', exact: true }).fill('login.example.test');
  await dialog.getByRole('textbox', { name: 'Slurm 账号', exact: true }).fill('research');
  await dialog.getByRole('textbox', { name: 'Slurm 分区', exact: true }).fill('cpu');
  await dialog.getByRole('textbox', { name: '工作目录', exact: true }).fill('/scratch/research');
  await dialog.getByRole('textbox', { name: '工作目录', exact: true }).dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  assert.equal(requests.filter(item => item.method === 'POST').length, 0);
  await dialog.getByRole('textbox', { name: '工作目录', exact: true }).press('Enter');
  await expect(dialog).toHaveCount(0);
  const identity = (await request('/api/state')).selectedClusterId;
  await expect(frame.getByRole('heading', { name: 'University HPC', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '添加集群配置', exact: true }).click();
  await dialog.getByRole('textbox', { name: '集群名称', exact: true }).fill('Second cluster');
  await dialog.getByRole('textbox', { name: '登录主机或 SSH 别名', exact: true }).fill('second.example.test');
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await frame.locator('.compute-list .pero-list-open').filter({ hasText: 'University HPC' }).click();
  await expect.poll(async () => (await request('/api/state')).selectedClusterId).toBe(identity);
  await frame.getByRole('button', { name: '编辑配置', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Slurm 分区', exact: true }).fill('gpu');
  await page.route('**/api/clusters', route => route.fulfill({ status: 503, json: { detail: 'Temporary local save failure' } }), { times: 1 });
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(1);
  await expect(dialog.getByRole('textbox', { name: 'Slurm 分区', exact: true })).toHaveValue('gpu');
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: resolve(captures, 'cluster-draft-chinese-light.png'), fullPage: true });
  await restart();
  await frame.getByRole('tab', { name: '集群', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'University HPC', exact: true })).toBeVisible();
  const state = await request('/api/state');
  assert.equal(state.clusters.length, 2); assert.equal(state.selectedClusterId, identity);
  assert.equal(state.clusters[0].partition, 'gpu');
  assert.ok(state.clusters.every(item => item.connectionStatus === 'not_connected'));
  assert.equal(state.jobs, null); assert.equal(state.jobsStatus, 'not_connected');
  await frame.getByRole('tab', { name: '作业', exact: true }).click();
  await expect(frame.getByText('“University HPC”仍是未连接的配置草稿，当前无法读取该集群的队列与作业历史。', { exact: true })).toBeVisible();
  assert.ok(requests.every(item => ['/api/state', '/api/clusters', '/api/selection'].includes(item.path)));
});

test('loading and navigation failures recover while keyboard, locale and appearance keep the draft', async t => {
  const { page, frame } = await fixture(t);
  await page.route('**/api/state', route => route.fulfill({ status: 503, json: { detail: 'Temporary read failure' } }), { times: 1 });
  await frame.getByRole('button', { name: '刷新配置', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('正在显示上次读取的配置');
  await expect(frame.getByRole('heading', { name: '尚未连接，无法读取作业', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '重试', exact: true }).click();
  await expect(frame.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => { window.failNavigation = true; });
  await frame.getByRole('button', { name: '管理执行节点', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('暂时无法打开该页面');
  await page.evaluate(() => { window.failNavigation = false; });
  await frame.getByRole('button', { name: '管理执行节点', exact: true }).click();
  await page.evaluate(() => { window.failNavigation = true; });
  await frame.getByRole('button', { name: '软件环境', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('请在应用目录检查是否已启用');
  await page.evaluate(() => { window.failNavigation = false; });
  await frame.getByRole('button', { name: '打开应用目录', exact: true }).click();
  await frame.getByRole('button', { name: '软件环境', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.hostNavigations)).toEqual(['/workers', '/workers', '/apps/environments', '/apps', '/apps/environments']);
  await frame.getByRole('tab', { name: '作业', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(frame.getByRole('tab', { name: '集群', exact: true })).toHaveAttribute('aria-selected', 'true');
  const add = frame.getByRole('button', { name: '添加集群配置', exact: true });
  await add.click();
  const dialog = frame.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '集群名称', exact: true }).fill('Unlost draft');
  const palette = JSON.parse(await readFile(resolve(root, 'web/src/theme.generated.json'), 'utf8')).dark;
  await page.evaluate(palette => {
    window.context = { locale: 'en', dark: true, active: true, appearance: { dark: true, accent: 'teal', palette, typography: { ui: 24, chat: 24, code: 24 } } };
    document.querySelector('iframe').contentWindow.postMessage({ type: 'pero:app:context', context: window.context }, '*');
  }, palette);
  await page.setViewportSize({ width: 390, height: 650 });
  await expect(frame.locator('html')).toHaveCSS('font-size', '24px');
  await expect(dialog.getByRole('textbox', { name: 'Cluster name', exact: true })).toHaveValue('Unlost draft');
  await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport();
  assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth));
  await page.screenshot({ path: resolve(captures, 'cluster-editor-narrow-dark-24px.png'), fullPage: true });
  await dialog.press('Escape');
  await expect(frame.getByRole('button', { name: 'Add cluster draft', exact: true })).toBeFocused();
  await expect(frame.getByRole('button', { name: 'Add cluster draft', exact: true })).toBeInViewport({ ratio: 1 });
  assert.ok(await frame.locator('html').evaluate(node => node.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(captures, 'clusters-narrow-dark-24px.png'), fullPage: true });
});

test('a pending cluster selection disables other choices until persistence completes', async t => {
  const { frame, page, request, requests } = await fixture(t);
  for (const name of ['Cluster A', 'Cluster B', 'Cluster C']) await request('/api/clusters', { name, host: `${name.at(-1).toLowerCase()}.example.test` });
  await frame.getByRole('button', { name: '刷新配置', exact: true }).click();
  await frame.getByRole('tab', { name: '集群', exact: true }).click();
  const row = name => frame.locator('.compute-list .pero-list-open').filter({ hasText: name });
  await expect(frame.getByRole('heading', { name: 'Cluster C', exact: true })).toBeVisible();
  let release;
  const pending = new Promise(resolvePending => { release = resolvePending; });
  await page.route('**/api/selection', async route => { await pending; await route.continue(); }, { times: 1 });
  await row('Cluster B').click();
  await expect(row('Cluster A')).toBeDisabled();
  await expect(row('Cluster C')).toBeDisabled();
  await expect(frame.getByRole('status')).toContainText('正在保存集群选择');
  // A native click on a disabled control cannot create another selection request.
  await row('Cluster C').evaluate(button => button.click());
  release();
  await expect(frame.getByRole('heading', { name: 'Cluster B', exact: true })).toBeVisible();
  await expect(row('Cluster C')).toBeEnabled();
  assert.equal(requests.filter(item => item.path === '/api/selection').length, 1);
  await row('Cluster C').click();
  await expect(frame.getByRole('heading', { name: 'Cluster C', exact: true })).toBeVisible();
  assert.equal(requests.filter(item => item.path === '/api/selection').length, 2);
});

test('an initial configuration failure is recoverable and never presented as an empty queue', async t => {
  const { page, frame, releaseInitial } = await fixture(t, { failInitial: true, holdInitial: true });
  await expect(frame.getByRole('status')).toContainText('正在读取集群配置');
  await expect(frame.getByRole('heading', { name: '尚未连接，无法读取作业', exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(captures, 'loading-chinese-light.png'), fullPage: true });
  releaseInitial();
  await expect(frame.getByRole('alert')).toContainText('暂时无法读取集群配置');
  await expect(frame.getByRole('heading', { name: '尚未连接，无法读取作业', exact: true })).toHaveCount(0);
  await expect(frame.getByRole('table')).toHaveCount(0);
  await page.unroute('**/api/state');
  await frame.getByRole('button', { name: '重试', exact: true }).click();
  await expect(frame.getByRole('heading', { name: '尚未连接，无法读取作业', exact: true })).toBeVisible();
  await expect(frame.getByRole('alert')).toHaveCount(0);
});
