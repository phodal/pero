/** Real sandboxed Compute UI + SDK + Python persistence; only the Host boundary is a fixture. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  if (options.receipt) {
    await mkdir(resolve(data, 'executions'));
    await writeFile(resolve(data, 'executions', 'job.json'), JSON.stringify(options.receipt));
  }
  if (options.cluster) await writeFile(resolve(data, 'clusters.json'), JSON.stringify({ schemaVersion: 1,
    clusters: [options.cluster], selectedClusterId: options.cluster.id }));
  const errors = [], requests = [];
  let backend, port, diagnostics = '';
  const start = async () => {
    backend = spawn(process.env.PYTHON || 'python3', [resolve(appRoot, 'backend/server.py')], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PERO_APP_DATA: data, PERO_APP_TOKEN: secret,
        ...(options.remoteAccess ? { PERO_REMOTE_COMPUTE_ADDRESS: options.remoteAccess.address, PERO_REMOTE_COMPUTE_TOKEN: options.remoteAccess.token } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
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
      if (request.url === '/api/remote' && options.remote) {
        const result = options.remote(content ? JSON.parse(content) : null);
        response.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify(result.value));
      }
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
        <iframe title="Compute" sandbox="allow-scripts allow-same-origin allow-downloads" src="/app"></iframe><script>
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
  if (!options.failInitial && !options.receipt) await expect(frame.getByRole('heading', { name: '尚无执行回执', exact: true })).toBeVisible();
  if (options.receipt) await expect(frame.getByRole('heading', { name: options.receipt.operation, exact: true })).toBeVisible();
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
  await dialog.getByRole('button', { name: '执行路径', exact: true }).click();
  await frame.getByRole('option', { name: 'SSH 工作站', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Slurm 账号', exact: true })).toHaveCount(0);
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
  assert.equal(state.clusters[1].scheduler, 'ssh');
  assert.ok(state.clusters.every(item => item.connectionStatus === 'not_connected'));
  assert.equal(state.jobs, null); assert.equal(state.jobsStatus, 'not_connected');
  assert.deepEqual(state.executions, []); assert.equal(state.executionsStatus, 'none');
  await frame.getByRole('tab', { name: '执行回执', exact: true }).click();
  await expect(frame.getByText('尚未查询“University HPC”的全站队列。“远程执行”只读取经 Host 提交的原始执行。', { exact: true })).toBeVisible();
  assert.ok(requests.every(item => ['/api/state', '/api/clusters', '/api/selection'].includes(item.path)));
});

test('loading and navigation failures recover while keyboard, locale and appearance keep the draft', async t => {
  const { page, frame } = await fixture(t);
  await page.route('**/api/state', route => route.fulfill({ status: 503, json: { detail: 'Temporary read failure' } }), { times: 1 });
  await frame.getByRole('button', { name: '刷新配置', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('正在显示上次读取的配置');
  await expect(frame.getByRole('heading', { name: '尚无执行回执', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '重试', exact: true }).click();
  await expect(frame.getByRole('alert')).toHaveCount(0);
  // Workers and software environments live in the related-settings menu, not as bar buttons.
  const openRelated = async name => {
    await frame.getByRole('button', { name: '相关设置', exact: true }).click();
    await frame.getByRole('menuitem', { name, exact: true }).click();
  };
  await page.evaluate(() => { window.failNavigation = true; });
  await openRelated('管理执行节点');
  await expect(frame.getByRole('alert')).toContainText('暂时无法打开该页面');
  await page.evaluate(() => { window.failNavigation = false; });
  await openRelated('管理执行节点');
  await page.evaluate(() => { window.failNavigation = true; });
  await openRelated('软件环境');
  await expect(frame.getByRole('alert')).toContainText('请在应用目录检查是否已启用');
  await page.evaluate(() => { window.failNavigation = false; });
  await frame.getByRole('button', { name: '打开应用目录', exact: true }).click();
  await openRelated('软件环境');
  await expect.poll(() => page.evaluate(() => window.hostNavigations)).toEqual(['/workers', '/workers', '/apps/environments', '/apps', '/apps/environments']);
  await frame.getByRole('tab', { name: '执行回执', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(frame.getByRole('tab', { name: '实验报告', exact: true })).toHaveAttribute('aria-selected', 'true');
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
  await expect(frame.getByRole('heading', { name: '尚无执行回执', exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(captures, 'loading-chinese-light.png'), fullPage: true });
  releaseInitial();
  await expect(frame.getByRole('alert')).toContainText('暂时无法读取集群配置');
  await expect(frame.getByRole('heading', { name: '尚无执行回执', exact: true })).toHaveCount(0);
  await expect(frame.getByRole('table')).toHaveCount(0);
  await page.unroute('**/api/state');
  await frame.getByRole('button', { name: '重试', exact: true }).click();
  await expect(frame.getByRole('heading', { name: '尚无执行回执', exact: true })).toBeVisible();
  await expect(frame.getByRole('alert')).toHaveCount(0);
});

test('a process receipt is shown without an external job or a scheduler query', async t => {
  const digest = 'cd'.repeat(32);
  const receipt = { operation: 'use', host: 'host', payload: digest, started: 10, ended: 20, exit_code: 0,
    entry: '/bin/sh -c true', logs: ['stdout.log'] };
  const { frame, request, nonexistent } = await fixture(t, { receipt });
  const state = await request('/api/state');
  assert.equal(state.jobs, null);
  assert.equal(state.executions[0].jobId, null);
  assert.equal(state.executions[0].exitCode, 0);
  await expect(frame.locator('.compute-list').getByText('/bin/sh -c true', { exact: true })).toBeVisible();
  const draft = frame.locator('.compute-draft');
  await expect(draft).toContainText('这份回执没有外部作业。');
  await expect(draft).toContainText('这是进程事实，不是调度观察。');
  await expect(draft).toContainText('stdout.log');
  assert.equal((await nonexistent()).status, 404);
});

test('an unconfirmed process stop is not shown as still running', async t => {
  const digest = 'ef'.repeat(32);
  const receipt = { operation: 'use', host: 'host', payload: digest, started: 10, unconfirmed: true,
    entry: '/bin/sh -c true', logs: ['stdout.log'] };
  const { frame, request } = await fixture(t, { receipt });
  const state = await request('/api/state');
  assert.equal(state.executions[0].unconfirmed, true);
  assert.equal(state.executions[0].exitCode, null);
  assert.equal(state.jobs, null);
  const draft = frame.locator('.compute-draft');
  await expect(draft).toContainText('执行方未能确认这个进程如何停止。没有记录退出码。');
  await expect(draft).not.toContainText('写下这份回执时，进程尚未退出。');
});

test('an owner receipt is shown without querying or resubmitting the cluster job', async t => {
  const digest = 'ab'.repeat(32);
  const receipt = { operation: 'attempt-1', cluster: 'site', constraints: { partition: 'cpu', cpus: 4, memory_mib: 8192, walltime_seconds: 3600 },
    payload: digest, job_id: 42, submit_time: 1700000000, entry: 'python train.py --lr 3e-4',
    logs: ['stdout.log'], outputs: [{ path: 'metrics.json', sha256: digest }] };
  const { frame, request, requests, nonexistent } = await fixture(t, { receipt });
  const state = await request('/api/state');
  assert.equal(state.jobs, null);
  assert.equal(state.jobsStatus, 'not_connected');
  assert.equal(state.executionsStatus, 'recorded');
  assert.equal(state.executions[0].scheduler, null);
  await expect(frame.locator('.compute-list').getByText('python train.py --lr 3e-4', { exact: true })).toBeVisible();
  const draft = frame.locator('.compute-draft');
  await expect(draft).toContainText('这份回执没有调度观察。');
  await expect(draft).toContainText('不要重新提交外部作业 42。');
  await expect(draft).toContainText('stdout.log');
  assert.equal((await nonexistent()).status, 404);
  assert.ok(requests.every(item => item.path === '/api/state'));
});

test('imported experiment observations retain all six rows, raw results, logs and previous report on failure', async t => {
  const { page, frame, restart } = await fixture(t);
  const report = process.env.PERO_PYBAMM_REPORT
    ? JSON.parse(await readFile(process.env.PERO_PYBAMM_REPORT, 'utf8'))
    : JSON.parse(execFileSync(process.env.PYTHON || 'python3', [resolve(appRoot, 'test/test_task_reports.py')], { encoding: 'utf8' }));
  await frame.getByRole('tab', { name: '实验报告', exact: true }).click();
  const upload = value => frame.locator('input[type=file][accept=".json,application/json"]').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await upload(report);
  await expect(frame.locator('.compute-report-row')).toHaveCount(6);
  await expect(frame.getByText('报告记录 6 / 6 项结果一致', { exact: true })).toBeVisible();
  await expect(frame.getByText(new RegExp(report.observed_at.replaceAll('+', '\\+')))).toBeVisible();
  const downloading = page.waitForEvent('download');
  await frame.getByRole('button', { name: '下载原始结果', exact: true }).first().click();
  const chunks = []; for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.rows[0].result_sha256);
  const recordDownload = page.waitForEvent('download');
  await frame.getByRole('button', { name: '下载执行记录与日志', exact: true }).first().click();
  const logs = []; for await (const chunk of await (await recordDownload).createReadStream()) logs.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(logs).toString()), report.details[report.rows[0].experiment]);
  await page.screenshot({ path: resolve(captures, 'task-report-normal-light.png'), fullPage: true });
  await restart(); await frame.getByRole('tab', { name: '实验报告', exact: true }).click();
  await expect(frame.getByRole('heading', { name: report.name, exact: true })).toBeVisible();
  await upload({ ...report, rows: report.rows.slice(1) });
  await expect(frame.getByText(/已保留上一份报告/)).toBeVisible();
  await expect(frame.locator('.compute-report-row')).toHaveCount(6);
  const fault = process.env.PERO_PYBAMM_FAULT_REPORT
    ? JSON.parse(await readFile(process.env.PERO_PYBAMM_FAULT_REPORT, 'utf8'))
    : { ...report, name: 'Fault batch', rows: report.rows.map((row, i) => ({ ...row, state: ['failed', 'cancelled', 'reconcile', 'queued', 'missing', 'unavailable'][i], verification: 'not_checked', result_sha256: '', result_path: '' })), details: {} };
  await upload(fault);
  await expect(frame.getByText('报告记录 0 / 6 项结果一致', { exact: true })).toBeVisible();
  await expect(frame.locator('.compute-report-row')).toHaveCount(6);
  for (const name of ['失败', '已取消', '待核对']) await expect(frame.getByText(name, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 440, height: 900 });
  await page.evaluate(() => { window.context.dark = true; document.querySelector('iframe').contentWindow.postMessage({ type: 'pero:app:context', context: window.context }, '*'); });
  await page.screenshot({ path: resolve(captures, 'task-report-fault-narrow-dark.png'), fullPage: true });
  assert.equal(await frame.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true);
});


test('remote controls consume Host observations, frozen approval and fixed collected references without replay', async t => {
  // The UI runs in Chromium; these are explicit Host boundary fixtures, not an SSH/Slurm acceptance run.
  const cluster = { id: 'cluster-' + 'a'.repeat(32), name: 'Loopback workstation', host: 'loopback-research', scheduler: 'ssh', account: '', partition: '', workdir: '/tmp/research' };
  const { createHash } = await import('node:crypto');
  const digest = 'ab'.repeat(32), resultBytes = Buffer.from('{"integral":3.14159265}\n');
  const outputDigest = createHash('sha256').update(resultBytes).digest('hex'), reference = `compute:remote-1:${outputDigest}`;
  const state = { available: true, attempts: [] };
  let count = 0, collections = 0, failObservation = false, unknownSubmission = false, failPreparation = false;
  const owner = input => {
    if (!input) return { value: state };
    if (input.operation === 'probe') state.probe = { clusterId: cluster.id, endpoint: cluster.host, host: cluster.host, platform: 'Linux fixture', python: '3.12.8' };
    if (input.operation === 'prepare') state.attempts.unshift({ id: `remote-${++count}`, clusterId: cluster.id, host: cluster.host,
      scheduler: 'ssh', directory: `/tmp/research/remote-${count}`, digest, samples: input.samples, repetitions: input.repetitions,
      state: failPreparation ? 'preparation_failed' : 'prepared', error: failPreparation ? 'Input staging was interrupted before readiness was recorded' : undefined, useState: '', logs: { stdout: '', stderr: '' }, outputs: [], collected: false, collectionComplete: false });
    const attempt = state.attempts.find(item => item.id === input.id);
    if (input.operation === 'artifact') {
      assert.equal(input.digest, outputDigest);
      return { value: { filename: 'result.json', sha256: outputDigest, base64: resultBytes.toString('base64') } };
    }
    if (input.operation === 'submit') {
      assert.equal(input.digest, attempt.digest);
      attempt.state = unknownSubmission ? 'unknown' : 'running'; attempt.useState = unknownSubmission ? 'unknown_acquire' : 'in_use';
      if (unknownSubmission) attempt.error = 'Submission reply lost; original remote directory must be reconciled';
    }
    if (input.operation === 'observe') {
      if (failObservation) return { status: 503, value: { detail: 'Original queue observation failed' } };
      attempt.state = attempt.state === 'cancel_requested' ? 'stopped' : 'completed'; attempt.useState = 'released';
      attempt.exitCode = attempt.state === 'stopped' ? 143 : 0; attempt.logs.stdout = 'completed repetition 1: 3.14159265\n';
    }
    if (input.operation === 'cancel') attempt.state = 'cancel_requested';
    if (input.operation === 'collect') {
      attempt.collected = true; attempt.collectionComplete = ++collections > 1;
      attempt.error = attempt.collectionComplete ? undefined : 'Partial evidence collected; remote path retained. Missing log';
      attempt.outputs = [{ path: 'result.json', sha256: outputDigest, reference }];
    }
    return { value: state };
  };
  const { page, frame, requests } = await fixture(t, { cluster, remote: owner });
  await frame.getByRole('tab', { name: '远程执行', exact: true }).click();
  await expect(frame.getByRole('heading', { name: '数值积分', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '探测连接', exact: true }).click();
  await expect(frame.getByText('已验证连接', { exact: true })).toBeVisible();
  await frame.getByRole('spinbutton', { name: '每次采样数', exact: true }).fill('999');
  await frame.getByRole('button', { name: '准备并固定输入', exact: true }).click();
  assert.equal(requests.filter(item => item.value?.operation === 'prepare').length, 0);
  await frame.getByRole('spinbutton', { name: '每次采样数', exact: true }).fill('2000');
  await frame.getByRole('button', { name: '准备并固定输入', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'remote-1', exact: true })).toBeVisible();
  assert.equal(requests.filter(item => item.value?.operation === 'submit').length, 0);
  await expect(frame.getByText(digest, { exact: true })).toBeVisible();
  await frame.getByRole('heading', { name: '数值积分', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(captures, 'remote-prepared-light.png'), fullPage: true });
  await frame.getByRole('button', { name: '批准并提交', exact: true }).click();
  await expect(frame.getByText('运行中', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: '批准并提交', exact: true })).toHaveCount(0);
  await frame.getByRole('button', { name: '读取原执行状态', exact: true }).click();
  await expect(frame.getByText('执行完成', { exact: true })).toBeVisible();
  await expect(frame.locator('[aria-label="stdout"]')).toContainText('3.14159265');
  await frame.getByRole('button', { name: '收集并保存证据', exact: true }).click();
  await expect(frame.getByText(reference, { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: '重试收集缺失证据', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '刷新已保存执行', exact: true }).click();
  await expect(frame.getByText(reference, { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '重试收集缺失证据', exact: true }).click();
  await expect(frame.getByRole('button', { name: '重试收集缺失证据', exact: true })).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await frame.getByRole('button', { name: '下载原始产物', exact: true }).click();
  const chunks = []; for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
  assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), outputDigest);
  await frame.getByText(reference, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(captures, 'remote-collected-light.png'), fullPage: true });
  failObservation = true;
  await frame.getByRole('button', { name: '读取原执行状态', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('已保留上次观察');
  await expect(frame.locator('[aria-label="stdout"]')).toContainText('3.14159265');
  failObservation = false;
  await frame.getByRole('button', { name: '准备并固定输入', exact: true }).click();
  await frame.getByRole('button', { name: '批准并提交', exact: true }).click();
  await frame.getByRole('button', { name: '请求取消', exact: true }).click();
  await expect(frame.getByText('已请求取消', { exact: true })).toBeVisible();
  await expect(frame.getByText('已确认停止', { exact: true })).toHaveCount(0);
  await frame.getByRole('button', { name: '读取原执行状态', exact: true }).click();
  await expect(frame.getByText('已确认停止', { exact: true })).toBeVisible();
  unknownSubmission = true;
  await frame.getByRole('button', { name: '准备并固定输入', exact: true }).click();
  await frame.getByRole('button', { name: '批准并提交', exact: true }).click();
  await expect(frame.getByText('需要核对', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: '批准并提交', exact: true })).toHaveCount(0);
  await expect(frame.getByText('/tmp/research/remote-3', { exact: true })).toBeVisible();
  const palette = JSON.parse(await readFile(resolve(root, 'web/src/theme.generated.json'), 'utf8')).dark;
  await page.evaluate(palette => { window.context = { locale: 'en', dark: true, active: true,
    appearance: { dark: true, accent: 'teal', palette, typography: { ui: 24, chat: 24, code: 24 } } };
    document.querySelector('iframe').contentWindow.postMessage({ type: 'pero:app:context', context: window.context }, '*'); }, palette);
  await page.setViewportSize({ width: 440, height: 900 });
  await expect(frame.getByRole('button', { name: 'Observe original execution', exact: true })).toBeVisible();
  assert.equal(await frame.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true);
  await frame.getByRole('button', { name: 'Observe original execution', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(captures, 'remote-unknown-narrow-dark-24px.png'), fullPage: true });
  assert.equal(requests.filter(item => item.value?.operation === 'submit').length, 3);
  failPreparation = true;
  await frame.getByRole('button', { name: 'Prepare fixed inputs', exact: true }).click();
  const failedAttempt = frame.locator('#compute-remote-attempt');
  await expect(failedAttempt.getByText('Preparation incomplete; prepare a new attempt', { exact: true })).toBeVisible();
  await expect(failedAttempt.getByRole('alert')).toContainText('Input staging was interrupted');
  for (const name of ['Approve and submit', 'Observe original execution', 'Request cancellation', 'Collect and save evidence']) {
    await expect(failedAttempt.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(failedAttempt.locator('#compute-remote-logs')).toHaveCount(0);
  await expect(failedAttempt.locator('#compute-remote-outputs')).toHaveCount(0);
  await expect(failedAttempt.getByText('/tmp/research/remote-4', { exact: true })).toBeVisible();
  await expect(failedAttempt.getByText(digest, { exact: true })).toBeVisible();
  await expect(frame.getByRole('spinbutton', { name: 'Samples per repetition', exact: true })).toHaveValue('2000');
  await failedAttempt.getByText('Preparation incomplete; prepare a new attempt', { exact: true }).scrollIntoViewIfNeeded();
  await expect(failedAttempt.getByRole('alert')).toBeInViewport();
  await page.screenshot({ path: resolve(captures, 'remote-preparation-failed-narrow-dark-24px.png'), fullPage: true });
});

test('opt-in real Host remote calculation is collected and cancelled through the UI', {
  skip: !process.env.PERO_COMPUTE_BROWSER_CLUSTER,
}, async t => {
  const remoteAccess = process.env.PERO_COMPUTE_BROWSER_ACCESS
    ? JSON.parse(await readFile(process.env.PERO_COMPUTE_BROWSER_ACCESS, 'utf8'))
    : { address: process.env.PERO_REMOTE_COMPUTE_ADDRESS, token: process.env.PERO_REMOTE_COMPUTE_TOKEN };
  assert.ok(remoteAccess.address && remoteAccess.token, 'A live private Host bridge is required');
  const cluster = { id: 'cluster-' + 'b'.repeat(32), account: '', partition: '', ...JSON.parse(await readFile(process.env.PERO_COMPUTE_BROWSER_CLUSTER, 'utf8')) };
  const { page, frame, request } = await fixture(t, { cluster, remoteAccess });
  let original = '';
  try {
    await frame.getByRole('tab', { name: '远程执行', exact: true }).click();
    await frame.getByRole('button', { name: '探测连接', exact: true }).click();
    await expect(frame.getByText('已验证连接', { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: '准备并固定输入', exact: true }).click();
    await expect(frame.getByRole('button', { name: '批准并提交', exact: true })).toBeEnabled();
    original = await frame.locator('#compute-remote-attempt h2').textContent();
    await frame.getByRole('button', { name: '批准并提交', exact: true }).click();
    const observe = frame.getByRole('button', { name: '读取原执行状态', exact: true });
    await expect(observe).toBeEnabled();
    await expect.poll(async () => {
      await observe.click(); await expect(observe).toBeEnabled();
      return (await request('/api/remote')).attempts.find(item => item.id === original).state;
    }, { timeout: 60000, intervals: [100, 250, 500, 1000] }).toBe('completed');
    await expect(frame.locator('[aria-label="stdout"]')).not.toBeEmpty();
    await frame.getByRole('button', { name: '收集并保存证据', exact: true }).click();
    const collected = (await request('/api/remote')).attempts.find(item => item.id === original);
    const index = collected.outputs.findIndex(output => output.path === 'result.json');
    assert.ok(index >= 0, 'The original numerical result must be collected');
    const downloading = page.waitForEvent('download');
    await frame.getByRole('button', { name: '下载原始产物', exact: true }).nth(index).click();
    const chunks = []; for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), collected.outputs[index].sha256);
    await frame.getByText(collected.outputs[index].reference, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(captures, 'remote-live-collected-light.png'), fullPage: true });
    original = '';

    await frame.getByRole('spinbutton', { name: '每次采样数', exact: true }).fill('10000000');
    await frame.getByRole('spinbutton', { name: '重复次数', exact: true }).fill('100000');
    await frame.getByRole('button', { name: '准备并固定输入', exact: true }).click();
    await expect(frame.getByRole('button', { name: '批准并提交', exact: true })).toBeEnabled();
    original = await frame.locator('#compute-remote-attempt h2').textContent();
    await frame.getByRole('button', { name: '批准并提交', exact: true }).click();
    await frame.getByRole('button', { name: '请求取消', exact: true }).click();
    await expect(observe).toBeEnabled();
    await expect.poll(async () => {
      await observe.click(); await expect(observe).toBeEnabled();
      return (await request('/api/remote')).attempts.find(item => item.id === original).state;
    }, { timeout: 60000, intervals: [100, 250, 500, 1000] }).toBe('stopped');
    await expect(frame.getByText('已确认停止', { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(captures, 'remote-live-stopped-light.png'), fullPage: true });
    original = '';
  } finally {
    if (original) await request('/api/remote', { operation: 'cancel', id: original });
  }
});
