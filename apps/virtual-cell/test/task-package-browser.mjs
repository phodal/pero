/** Browser UI + real CPU backend. Parent SDK context is a fixture; no Desktop/Host acceptance. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '../../..');
const appRoot = resolve(root, 'apps/virtual-cell');
const out = resolve(root, 'test-results/virtual-cell-task-package');
const execute = promisify(execFile), python = process.env.PYTHON || 'python3.12';

test('CPU task package prepares, reuses and stops its endpoint, checks and exports real artifacts', async () => {
  await mkdir(out, { recursive: true });
  await Promise.all(['result.json', 'failure.json', 'failure.png'].map(name => rm(resolve(out, name), { force: true })));
  const data = await mkdtemp(resolve(out, 'data-'));
  const secret = 'virtual-cell-task-package-loopback';
  const errors = [], requests = [], runs = [], hostRequests = [];
  const backendEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PERO_APP_DATA: data, PERO_APP_TOKEN: secret };
  delete backendEnv.PERO_VIRTUAL_CELL_MODEL_URL; delete backendEnv.PERO_VIRTUAL_CELL_MODEL_TOKEN;
  let backend, server, browser, page, success, diagnostics = '';
  try {
    backend = spawn(python, [resolve(appRoot, 'backend/server.py')], {
      cwd: root, env: backendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stderr.on('data', chunk => { diagnostics += chunk; });
    const port = await new Promise((resolvePort, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Backend readiness timed out: ${diagnostics}`)), 10000);
      backend.once('error', reject);
      backend.once('exit', code => reject(new Error(`Backend exited ${code}: ${diagnostics}`)));
      createInterface({ input: backend.stdout }).once('line', line => { clearTimeout(deadline); resolvePort(JSON.parse(line).port); });
    });
    server = createServer(async (request, response) => {
      if (request.url.startsWith('/api/')) {
        let body = '';
        for await (const chunk of request) body += chunk;
        requests.push({ method: request.method, path: request.url });
        const reply = await fetch(`http://127.0.0.1:${port}${request.url}`, {
          method: request.method, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': secret },
          ...(body ? { body } : {}),
        });
        response.writeHead(reply.status, { 'Content-Type': 'application/json' });
        return response.end(await reply.text());
      }
      if (request.url === '/host/environment') {
        hostRequests.push({ method: request.method, path: request.url });
        response.writeHead(503, { 'Content-Type': 'text/plain' });
        return response.end('Host environment inspection is unavailable in this standalone browser fixture.');
      }
      if (request.url === '/app') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        return response.end(await readFile(resolve(appRoot, 'dist/index.html')));
      }
      if (request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        return response.end(`<!doctype html><style>body{margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
          <iframe title="Virtual Cell" sandbox="allow-scripts allow-same-origin allow-downloads" src="/app"></iframe><script>
          addEventListener('message',event=>{
            if(event.data?.type==='pero:app:ready')event.source.postMessage({type:'pero:app:context',context:{locale:'en',dark:false,active:true}},'*');
            if(event.data?.type==='pero:app:sdk'&&event.data.operation==='navigate')event.source.postMessage({type:'pero:app:sdk-result',id:event.data.id,ok:true},'*');
          });</script>`);
      }
      const name = request.url.slice(1);
      if (name === basename(name) && /\.(js|css|woff2?)$/.test(name)) {
        response.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'font/woff2' });
        return response.end(await readFile(resolve(appRoot, 'dist', name)));
      }
      response.writeHead(404); response.end();
    });
    await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
    browser = await chromium.launch({ headless: true, ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}) });
    page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const frame = page.frameLocator('iframe');
    const read = path => frame.locator('body').evaluate(async (_body, path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
      return response.json();
    }, path);
    const clickPost = async (name, path) => {
      const reply = page.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'POST');
      await frame.getByRole('button', { name, exact: true }).click();
      const response = await reply;
      assert.ok(response.ok(), `${path}: ${response.status()}`);
      return response.json();
    };
    await frame.getByRole('button', { name: 'Data view', exact: true }).click();
    await frame.getByRole('listbox', { name: 'Data view', exact: true }).getByRole('option', { name: 'Baseline comparison', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'CPU perturbation comparison package', exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'Environment', exact: true }).click();
    await expect(frame.getByRole('dialog')).toBeVisible();
    await expect(frame.getByText('Host environment inspection is unavailable in this standalone browser fixture.', { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(out, 'host-inspection-unavailable-fixture.png') });
    await frame.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Environment', exact: true })).toBeFocused();
    await frame.getByRole('button', { name: 'Load CPU example', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Prepare selected input', exact: true })).toBeEnabled();
    const prepared = await clickPost('Prepare selected input', '/api/model/start');
    assert.equal(prepared.status, 'ready');
    await page.screenshot({ path: resolve(out, 'prepared-light.png') });
    async function start(name) {
      const started = await clickPost(name, '/api/comparisons');
      let finished;
      await expect.poll(async () => { finished = await read(`/api/comparisons/${started.id}`); return finished.status; }).toBe('succeeded');
      await expect(frame.locator('.vc-comparison-detail > .pero-inspector-header [role="status"]')).toHaveText('Calculation completed');
      runs.push(finished);
      return finished;
    }
    const first = await start('Start comparison');
    assert.equal(first.modelEndpoint.model.id, 'additive-endpoint');
    assert.equal(first.taskPackage.id, 'virtual-cell.comparison');
    await expect(frame.locator('.vc-comparison-models tbody tr')).toHaveCount(4);
    const checked = await clickPost('Check artifacts independently', `/api/comparisons/${first.id}/check`);
    assert.equal(checked.check.status, 'PASS');
    await expect(frame.getByText('Independent arithmetic checks passed', { exact: true })).toBeVisible();
    await frame.locator('.vc-comparison-detail').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, 'checked-light.png') });
    const second = await start('Rerun');
    assert.notEqual(second.id, first.id);
    assert.equal(second.inputId, first.inputId);
    assert.equal(second.outputId, first.outputId);
    assert.equal(second.check, null);
    assert.equal((await read(`/api/comparisons/${first.id}`)).check.digest, checked.check.digest);
    assert.equal((await read('/api/model')).uses, 2);
    const downloadEvent = page.waitForEvent('download');
    await frame.getByRole('button', { name: 'Export run package', exact: true }).click();
    const exported = resolve(out, 'endpoint-run-export.json');
    await (await downloadEvent).saveAs(exported);
    const recomputed = resolve(out, 'endpoint-recomputed.json'), receipt = resolve(out, 'endpoint-check.json');
    await Promise.all([rm(recomputed, { force: true }), rm(receipt, { force: true })]);
    await execute(python, [resolve(appRoot, 'backend/cli.py'), 'compare', '--bundle', exported, '--out', recomputed], { cwd: root, timeout: 30000 });
    await execute(python, [resolve(appRoot, 'backend/check_comparison.py'), '--export', exported, '--out', receipt], { cwd: root, timeout: 30000 });
    assert.equal(JSON.parse(await readFile(receipt, 'utf8')).status, 'PASS');
    const output = (await read(`/api/artifacts/${second.outputId}`));
    assert.deepEqual(JSON.parse(await readFile(recomputed, 'utf8')).evaluation, output.result);
    await frame.locator('.vc-comparison-detail').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, 'completed-light.png') });
    assert.equal((await clickPost('Stop endpoint', '/api/model/stop')).status, 'stopped');
    await page.setViewportSize({ width: 430, height: 900 });
    await page.locator('iframe').evaluate(element => element.contentWindow.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, '*'));
    await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
    await frame.getByRole('heading', { name: 'CPU perturbation comparison package', exact: true }).scrollIntoViewIfNeeded();
    await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: resolve(out, 'stopped-narrow-dark.png') });
    assert.deepEqual(errors, []);
    assert.equal(requests.filter(request => request.method === 'POST' && request.path === '/api/comparisons').length, 2);
    success = { status: 'passed', scope: 'browser-real-cpu-synthetic-input', hostContext: 'fixture', desktop: 'unverified', environmentInspection: 'explicit unavailable fixture', runs, requests, hostRequests, errors };
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error.stack || error), diagnostics, requests, errors }, null, 2));
    throw error;
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise(done => server.close(done));
    if (backend && backend.exitCode === null) await new Promise(done => { backend.once('exit', done); backend.kill('SIGTERM'); });
    await rm(data, { recursive: true, force: true });
  }
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ ...success, temporaryInputsRemoved: true, backendStopped: backend.exitCode === 0 }, null, 2));
});
