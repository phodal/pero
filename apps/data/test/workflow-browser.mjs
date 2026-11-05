/** Real Data UI and Python catalog over loopback. Host transport is the only substituted seam. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { appSdkAliases } from '../../../scripts/build/app-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..'), appRoot = resolve(root, 'apps/data');
const output = resolve(root, 'test-results/data-workflow');
let directory, browser, bundle, css;
before(async () => {
  await mkdir(output, { recursive: true });
  directory = await mkdtemp(resolve(tmpdir(), 'pero-data-workflow-'));
  await build({ entryPoints: [resolve(appRoot, 'ui-src/frame.tsx')], outfile: resolve(directory, 'app.js'),
    bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', alias: appSdkAliases(root),
    nodePaths: [resolve(appRoot, 'node_modules')], loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
    plugins: [{ name: 'app-react-runtime', setup(builder) {
      builder.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => args.resolveDir === appRoot ? undefined : builder.resolve(args.path, { kind: args.kind, resolveDir: appRoot }));
    } }] });
  [bundle, css] = await Promise.all(['app.js', 'app.css'].map(name => readFile(resolve(directory, name))));
  browser = await chromium.launch({ ...(process.env.PERO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PERO_CHROMIUM_EXECUTABLE } : {}), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function fixture(t) {
  const data = await mkdtemp(resolve(directory, 'catalog-')), errors = [], requests = [];
  let backend, port;
  const start = async () => {
    let stderr = '';
    backend = spawn(process.env.PYTHON || 'python3', [resolve(appRoot, 'backend/server.py')], {
      cwd: appRoot, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PERO_APP_DATA: data, PERO_APP_TOKEN: 'local-browser-fixture' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stderr.on('data', chunk => { stderr += chunk; });
    const lines = createInterface({ input: backend.stdout });
    port = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Data did not become ready: ${stderr}`)), 15_000);
      backend.once('error', reject);
      backend.once('exit', code => reject(new Error(`Data exited ${code}: ${stderr}`)));
      lines.once('line', line => { clearTimeout(deadline); resolve(JSON.parse(line).port); });
    });
    lines.close();
  };
  const stop = async () => {
    if (!backend || backend.exitCode !== null) return;
    const current = backend;
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { current.kill('SIGKILL'); reject(new Error('Data did not stop')); }, 10_000);
      current.once('exit', () => { clearTimeout(deadline); resolve(); });
      current.kill('SIGTERM');
    });
  };
  await start();
  const server = createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/api/')) {
        let body = ''; for await (const chunk of request) body += chunk;
        requests.push({ method: request.method, path: request.url });
        const result = await fetch(`http://127.0.0.1:${port}${request.url}`, {
          method: request.method, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': 'local-browser-fixture' },
          ...(body ? { body } : {}),
        });
        response.writeHead(result.status, { 'Content-Type': 'application/json' });
        return response.end(await result.text());
      }
      if (request.url === '/host/sdk') { response.writeHead(200, { 'Content-Type': 'application/json' }); return response.end('{}'); }
      if (request.url === '/app.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(bundle); }
      if (request.url === '/app.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); return response.end(css); }
      if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="app"></div><script type="module" src="/app.js"></script>'); }
      response.writeHead(404); response.end();
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    if (t.passed === false) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
    await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await stop();
    assert.deepEqual(errors, []);
  });
  const request = async (path, value) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: value === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': 'local-browser-fixture' },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const choose = async (label, option) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await expect(page.getByRole('button', { name: 'Add data', exact: true })).toBeEnabled();
  return { page, request, choose, requests, data, restart: async () => { await stop(); await start(); await page.reload(); } };
}

test('explicit CSV interpretation, issue evidence and pinned saved views survive a real backend restart', async t => {
  const { page, request, choose, requests, restart } = await fixture(t);
  const checks = [], bytes = Buffer.from('id,measure\n001,10\n002,2\n003,0\n004,bad\n005,\n001,10\n006,-1\n');
  const rows = () => page.getByRole('region', { name: 'Data records', exact: true }).locator('tbody tr');
  const tab = name => page.getByRole('tab', { name, exact: true }).click();
  const rowNumbers = () => rows().locator('th').allTextContents();
  const capture = name => page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  try {
    await page.getByRole('button', { name: 'Add data', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'measurements.csv', mimeType: 'text/csv', buffer: bytes });
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(rows()).toHaveCount(7);
    const state = await request('/api/state'), asset = state.assets[0], datasetId = state.datasets[0].id;
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await readFile(asset.location), bytes);
    await expect(page.getByRole('cell', { name: '001', exact: true })).toHaveCount(2);

    await choose('Filter field', 'measure');
    await choose('Condition', 'At least');
    await page.getByRole('textbox', { name: 'Filter value', exact: true }).fill('2');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('explicitly interpret CSV/TSV', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No matching records', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear filter', exact: true })).toBeVisible();
    checks.push('raw CSV numeric filter is an explicit error, not successful zero matches; controls remain usable');

    await page.getByRole('button', { name: 'Preview number type', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Type preview for measure', exact: true });
    await expect(preview.getByText('7 records checked / 2 conversion failures in measure', { exact: true })).toBeVisible();
    await expect(preview.getByText('Row 4 / line 5: bad', { exact: true })).toBeVisible();
    await capture('type-preview-light');
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await tab('Table');
    await expect(page.getByText('explicitly interpret CSV/TSV', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Preview number type', exact: true }).click();
    await expect(preview.getByRole('button', { name: 'Apply type', exact: true })).toBeEnabled();
    await preview.getByRole('button', { name: 'Apply type', exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByText('Decimal number (explicit)', { exact: false })).toBeVisible();
    await tab('Table');
    await expect(rows()).toHaveCount(3);
    await choose('Sort field', 'measure');
    await expect.poll(rowNumbers).toEqual(['2', '1', '6']);
    await page.getByRole('textbox', { name: 'View name', exact: true }).fill('Numeric baseline');
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect.poll(async () => (await request('/api/state')).views.length).toBe(1);
    const saved = (await request('/api/state')).views[0];
    assert.deepEqual(saved.view.interpretations, { measure: 'number' });
    assert.equal(saved.report.rowCount, 7);
    assert.equal(saved.report.conversionFailures, 2);
    await capture('numeric-filter-light');
    checks.push('preview and Cancel leave analysis unchanged; explicit Apply filters and sorts exact numbers while IDs retain leading zeros');

    await tab('Fields');
    await expect(page.getByText('Full input / 7 records, independent of the table filter.', { exact: false })).toBeVisible();
    await tab('Checks');
    await expect(page.getByText('Full input / 7 records', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show conversion failures', exact: true }).click();
    await expect(rows()).toHaveCount(2);
    await expect.poll(rowNumbers).toEqual(['5', '4']);
    await expect(page.getByText('Previous filter and selection paused', { exact: false })).toBeVisible();
    await expect(page.getByText('Conversion failed', { exact: true })).toHaveCount(2);
    await page.getByRole('textbox', { name: 'View name', exact: true }).fill('Conversion issues');
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect.poll(async () => (await request('/api/state')).views.length).toBe(2);
    await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, '*'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
    await capture('issues-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Return to analysis', exact: true })).toBeVisible();
    assert.equal(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await capture('issues-narrow-dark');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Return to analysis', exact: true }).click();
    await expect.poll(rowNumbers).toEqual(['2', '1', '6']);
    await tab('Checks');
    await page.getByRole('button', { name: 'Show duplicate rows', exact: true }).click();
    await expect.poll(rowNumbers).toEqual(['6']);
    await page.getByRole('button', { name: 'Return to analysis', exact: true }).click();
    await expect.poll(rowNumbers).toEqual(['2', '1', '6']);
    checks.push('full-input counts stay explicit under filtering; failure/duplicate drilldown pauses filter and restores analysis with stable source row IDs');

    const target = { datasetId, assetId: asset.id, view: saved.view };
    const exported = JSON.parse((await request('/api/export', target)).content);
    assert.deepEqual(exported.rows, [{ id: '002', measure: 2 }, { id: '001', measure: 10 }, { id: '001', measure: 10 }]);
    assert.deepEqual(exported.manifest.view.interpretations, { measure: 'number' });
    assert.equal((await request('/api/source', target)).content, bytes.toString());
    const chart = await request('/api/chart', { ...target,
      aggregation: { category: 'id', measure: 'measure', aggregation: 'sum' },
      chartDocument: { title: 'Measured values', chart: { type: 'bar', x: 'label', y: 'value' } } });
    assert.deepEqual(chart.document.source.dataView.interpretations, { measure: 'number' });
    assert.equal(chart.document.rows.length, 2);
    assert.equal(chart.document.source.records.length, 3);

    await restart();
    await tab('History');
    await page.getByRole('button', { name: 'Numeric baseline', exact: true }).click();
    await expect.poll(rowNumbers).toEqual(['2', '1', '6']);
    assert.deepEqual((await request('/api/state')).views.find(view => view.id === saved.id), saved);
    await tab('History');
    await page.getByRole('button', { name: 'Conversion issues', exact: true }).click();
    await expect.poll(rowNumbers).toEqual(['5', '4']);
    await page.getByRole('button', { name: 'Return to analysis', exact: true }).click();
    await expect(rows()).toHaveCount(7);
    checks.push('export and chart use explicit interpretation; original source unchanged; real backend restart reopens both numerical and issue views');

    await page.getByRole('button', { name: 'Add version', exact: true }).click();
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'new-version.csv', mimeType: 'text/csv', buffer: Buffer.from('id,measure\n009,9\n') });
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(rows()).toHaveCount(1);
    await tab('Fields');
    await expect(page.getByText('Decimal number (explicit)', { exact: false })).toHaveCount(0);
    await tab('History');
    await page.getByRole('button', { name: 'Numeric baseline', exact: true }).click();
    await expect.poll(rowNumbers).toEqual(['2', '1', '6']);
    await writeFile(asset.location, Buffer.from(bytes.toString().replace('001', '009')));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Original bytes no longer match the stored SHA-256', { exact: true })).toBeVisible();
    await expect(rows()).toHaveCount(0);
    await writeFile(asset.location, bytes);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(rowNumbers).toEqual(['2', '1', '6']);
    checks.push('new version starts without inherited interpretation; saved view stays pinned to v1; changed bytes refuse cached success and recover after restoration');
    await tab('Checks');
    await page.getByRole('button', { name: 'Show conversion failures', exact: true }).click();
    await expect(rows()).toHaveCount(2);
    await tab('Fields');
    const fieldRow = page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Show measure', exact: true }) });
    await fieldRow.getByRole('button', { name: 'Revert to text', exact: true }).click();
    await expect(preview.getByRole('button', { name: 'Apply type', exact: true })).toBeEnabled();
    await preview.getByRole('button', { name: 'Apply type', exact: true }).click();
    await expect(preview).toBeHidden();
    await tab('Table');
    await expect(rows()).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Return to analysis', exact: true })).toHaveCount(0);
    await expect(page.getByText('Conversion failed', { exact: true })).toHaveCount(0);
    assert.deepEqual(await readFile(asset.location), bytes);
    checks.push('reverting the interpreted field from its issue view clears the incompatible issue and preserves original bytes');
    await choose('Filter field', 'measure');
    await choose('Condition', 'At least');
    await page.getByRole('textbox', { name: 'Filter value', exact: true }).fill('not-a-number');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('A numeric filter needs a finite decimal value', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expect(rows()).toHaveCount(7);
    await expect(page.getByText('A numeric filter needs a finite decimal value', { exact: false })).toHaveCount(0);
    checks.push('invalid numeric threshold has an explicit error and Reset view restores usable data');
    assert.equal(requests.filter(item => /download/.test(item.path) && item.method === 'POST').length, 0);
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ scope: 'real-app-frame-and-python-catalog', checks,
      exclusions: ['Host authorization transport', 'Workbench/standalone Desktop', 'signed releases', 'real scientific validation'],
      bundles: { js: createHash('sha256').update(bundle).digest('hex'), css: createHash('sha256').update(css).digest('hex') } }, null, 2));
  } catch (error) {
    await capture('failure');
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks }, null, 2));
    throw error;
  }
});
