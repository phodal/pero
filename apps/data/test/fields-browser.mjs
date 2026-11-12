/** Real Data + SDK DOM regression; the fake is only the bounded HTTP API seam. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { appSdkAliases } from '../../../scripts/build/app-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..'), appRoot = resolve(root, 'apps/data');
const fields = ['voltage', 'time', 'current'];
const asset = id => ({ id, name: `${id}.csv`, kind: 'dataset', format: 'csv', size: 40,
  source: 'Synthetic keyboard fixture', revision: id, license: '', sha256: id.repeat(64), createdAt: '2026-11-03T00:00:00Z',
  checksums: [], bundleId: '', sourceId: '', localAvailable: true, availability: 'present' });
const catalog = { assets: [asset('a'), asset('b')], datasets: [{ id: 'measurements', name: 'Measurements', kind: 'dataset',
  versions: ['a', 'b'], projectRef: '', archived: false }], views: [], sources: [], download: null, parserVersion: 'fixture-v1',
  limits: { importBytes: 1000, previewBytes: 1000, records: 100, fields: 10, columns: 3 }, selectedDatasetId: 'measurements', selectedAssetId: 'a' };
function inspection(input) {
  const columns = input.view.columns.length ? input.view.columns : fields;
  return { status: 'ok', datasetId: input.datasetId, assetId: input.assetId, sha256: input.assetId.repeat(64),
    report: { parserVersion: input.parserVersion, scope: 'full', rowCount: 1,
      fields: fields.map(name => ({ name, kinds: ['number'], missing: 0, nulls: 0, empty: 0 })),
      missing: 0, nulls: 0, empty: 0, duplicateRows: 0, blankLines: 0, duplicates: [] },
    columns, matched: 1, offset: 0, nextOffset: null,
    rows: [{ row: 1, pointer: '', line: 2, cells: columns.map(() => ({ kind: 'number', text: input.assetId === 'a' ? '111' : '222' })) }] };
}
const screenshots = resolve(root, 'test-results/data-fields');
let browser, directory, bundle, css;
before(async () => {
  await mkdir(screenshots, { recursive: true });
  directory = await mkdtemp(resolve(tmpdir(), 'pero-data-fields-'));
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

async function fixture(t, options = {}) {
  const pending = [], errors = [];
  let releaseCatalog;
  const value = options.catalog ?? catalog;
  const json = (response, value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  const server = createServer(async (request, response) => {
    if (request.url === '/api/state') {
      if (options.deferCatalog) { releaseCatalog = () => json(response, value); return; }
      return json(response, value);
    }
    if (request.url === '/api/charts') return json(response, { charts: [] });
    if (request.url === '/host/sdk') return json(response, {});
    if (request.url === '/api/inspect') {
      let body = ''; for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      pending.push({ input, reply: async (value = inspection(input), status = 200) => {
        const received = page.waitForEvent('requestfinished', { predicate: request => request.url().endsWith('/api/inspect') && request.postData() === body });
        json(response, value, status);
        await received;
        // Wait for browser rendering, not a delay that guesses when React has run.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      } });
      return;
    }
    if (request.url === '/app.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(bundle); }
    if (request.url === '/app.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); return response.end(css); }
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="app"></div><script type="module" src="/app.js"></script>'); }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); });
  const next = async () => { await expect.poll(() => pending.length).toBeGreaterThan(0); return pending.shift(); };
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if (!options.deferCatalog && options.inspect !== false) {
    await (await next()).reply();
    if (options.tab !== 'Table') {
      await page.getByRole('tab', { name: 'Fields', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Unit for voltage', exact: true })).toBeVisible();
    }
  }
  return { page, next, releaseCatalog: async () => { await expect.poll(() => Boolean(releaseCatalog)).toBe(true); releaseCatalog(); } };
}

test('field controls retain keyboard focus, drafts and latest selections during delayed reinspection', async t => {
  const { page, next } = await fixture(t);
  const voltage = page.getByRole('textbox', { name: 'Unit for voltage', exact: true });
  const time = page.getByRole('textbox', { name: 'Unit for time', exact: true });
  const showTime = page.getByRole('checkbox', { name: 'Show time', exact: true });
  await voltage.fill('V'); await voltage.press('Tab');
  const first = await next();
  await expect(showTime).toBeFocused(); // onBlur must not unmount/disable the next native input.
  await page.keyboard.press('Tab'); await expect(time).toBeFocused();
  await page.keyboard.type('m');
  await page.screenshot({ path: resolve(screenshots, 'fields-pending-light.png'), fullPage: true });
  await first.reply();
  await expect(page.getByText('Updating inspection', { exact: false })).toHaveCount(0);
  await expect(voltage).toHaveValue('V'); await expect(time).toBeFocused(); await expect(time).toHaveValue('m');
  await page.keyboard.type('s'); await page.keyboard.press('Tab');
  const second = await next();
  assert.deepEqual(second.input.view.units, { voltage: 'V', time: 'ms' });
  await expect(page.getByRole('checkbox', { name: 'Show current', exact: true })).toBeFocused();
  await showTime.uncheck(); const third = await next();
  await page.getByRole('checkbox', { name: 'Show current', exact: true }).uncheck(); const fourth = await next();
  assert.deepEqual(fourth.input.view.columns, ['voltage']);
  await expect(showTime).not.toBeChecked();
  await fourth.reply(); await third.reply(); await second.reply();
  await expect(time).toHaveValue('ms'); await expect(showTime).not.toBeChecked();
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'voltage (V)', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'time (ms)', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Fields', exact: true }).click();
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, '*'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await page.screenshot({ path: resolve(screenshots, 'fields-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(time).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'fields-narrow-dark.png'), fullPage: true });
});

test('switching version isolates fields and ignores a late response from the previous version', async t => {
  const { page, next } = await fixture(t);
  await page.getByRole('textbox', { name: 'Unit for voltage', exact: true }).fill('old-unit');
  await page.getByRole('textbox', { name: 'Unit for voltage', exact: true }).press('Tab');
  const old = await next();
  await page.getByRole('button', { name: 'Version', exact: true }).click();
  await page.getByRole('option', { name: 'v2 · 40 B · 2026-11-03 · b', exact: true }).click();
  const current = await next(); assert.equal(current.input.assetId, 'b');
  await expect(page.getByRole('textbox', { name: 'Unit for voltage', exact: true })).toHaveCount(0);
  await current.reply();
  await expect(page.getByRole('textbox', { name: 'Unit for voltage', exact: true })).toHaveValue('');
  await old.reply();
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('cell', { name: '222', exact: true })).toHaveCount(3);
  await expect(page.getByRole('cell', { name: '111', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'voltage (old-unit)', exact: true })).toHaveCount(0);
});

for (const failure of ['changed', 'transport', 'permission']) test(`${failure} failure preserves only allowed previous results with an explicit scope`, async t => {
  const { page, next } = await fixture(t);
  const input = page.getByRole('textbox', { name: 'Unit for voltage', exact: true });
  await input.fill('V'); await input.press('Tab');
  const request = await next();
  if (failure === 'changed') await request.reply({ status: 'changed', datasetId: 'measurements', assetId: 'a', message: 'Fixture bytes no longer match' });
  else await request.reply({ detail: 'Fixture inspection unavailable' }, failure === 'permission' ? 403 : 503);
  if (failure === 'transport') await expect(input).toHaveValue('V');
  else await expect(input).toHaveCount(0);
  await expect(page.getByText('Bytes matched', { exact: false })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Checks', exact: true }).click();
  if (failure === 'transport') {
    await expect(page.getByText('Full input / 1 records', { exact: true })).toBeVisible();
    await expect(page.getByText('Showing the last successful result', { exact: false })).toBeVisible();
  } else await expect(page.getByText('No current checks.', { exact: true })).toBeVisible();
  if (failure === 'transport') {
    await page.getByRole('button', { name: 'Retry inspection', exact: true }).click();
    const retry = await next();
    assert.deepEqual(retry.input, request.input);
    await retry.reply();
    await expect(page.getByText('Full input / 1 records', { exact: true })).toBeVisible();
  }
});


test('table rows and save drafts stay mounted across delayed filters, failure and retry', async t => {
  const { page, next } = await fixture(t, { tab: 'Table' });
  const rows = page.getByRole('region', { name: 'Data records', exact: true });
  await page.getByRole('textbox', { name: 'View name', exact: true }).fill('Unsubmitted view');
  await page.getByRole('button', { name: 'Filter field', exact: true }).click();
  await page.getByRole('option', { name: 'voltage', exact: true }).click();
  await page.getByRole('textbox', { name: 'Filter value', exact: true }).fill('new');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const request = await next();
  await expect(rows.getByRole('cell', { name: '111', exact: true })).toHaveCount(3);
  await expect(page.getByRole('textbox', { name: 'View name', exact: true })).toHaveValue('Unsubmitted view');
  await expect(page.getByText('Showing the last successful result', { exact: false })).toContainText('all records');
  await request.reply({ detail: 'Temporary read failure' }, 503);
  await expect(rows.getByRole('cell', { name: '111', exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Save view', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry inspection', exact: true }).click();
  await (await next()).reply();
  await expect(page.getByText('Showing the last successful result', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'View name', exact: true })).toHaveValue('Unsubmitted view');
  await expect(page.getByRole('button', { name: 'Save view', exact: true })).toBeEnabled();
});

test('first loading and an empty catalog share one workspace state', async t => {
  const { page, releaseCatalog } = await fixture(t, { catalog: { ...catalog, datasets: [], assets: [] }, deferCatalog: true, inspect: false });
  await expect(page.getByText('Loading data…', { exact: true })).toHaveCount(1);
  await expect(page.getByText('No dataset selected', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No data yet', { exact: true })).toHaveCount(0);
  await releaseCatalog();
  await expect(page.getByText('No data yet', { exact: true })).toHaveCount(1);
  await expect(page.getByText('No dataset selected', { exact: true })).toHaveCount(0);
  await expect(page.locator('.pero-app-bar').getByRole('button', { name: 'Add data', exact: true })).toHaveCount(1);
  await expect(page.locator('.data-first-use').getByRole('button', { name: 'Add data', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add data', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose file', exact: true })).toBeFocused();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('button', { name: 'Add data', exact: true })).toBeFocused();
});

test('Chinese first import keeps optional drafts and a selected file through failure and appearance changes', async t => {
  const { page } = await fixture(t, { catalog: { ...catalog, datasets: [], assets: [] }, inspect: false });
  const imports = [];
  const saved = { ...catalog, assets: [{ ...asset('a'), kind: 'model', format: 'bin' }],
    datasets: [{ ...catalog.datasets[0], kind: 'model', versions: ['a'] }] };
  await page.route('**/api/import', async route => {
    imports.push(route.request().postDataJSON());
    await route.fulfill({ status: imports.length === 1 ? 503 : 200,
      json: imports.length === 1 ? { detail: 'Temporary import failure' } : saved });
  });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'zh-CN', dark: false, active: true } }, '*'));
  await expect(page.getByRole('heading', { name: '还没有数据', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'first-use-chinese-light.png'), fullPage: true });
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('导入数据');
  await expect(dialog.getByRole('button', { name: '选择文件', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: '来源', exact: true })).toBeHidden();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'oversize.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1001) });
  await expect(dialog.getByRole('alert')).toHaveText('请选择大小为 1 字节至 1000 B 的文件。');
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeDisabled();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'model.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('original model bytes') });
  await dialog.getByRole('button', { name: '类型', exact: true }).click();
  await page.getByRole('option', { name: '模型', exact: true }).click();
  await expect(dialog.getByText('模型文件保留版本记录，不提供表格预览。', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'import-chinese-light.png'), fullPage: true });
  await dialog.getByText('来源与详细信息（可选）', { exact: true }).click();
  await dialog.getByRole('textbox', { name: '来源', exact: true }).fill('Local experiment');
  await dialog.getByRole('textbox', { name: '项目引用', exact: true }).fill('project-draft');
  await dialog.getByRole('textbox', { name: '项目引用', exact: true }).press('Enter');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '项目引用', exact: true })).toHaveValue('project-draft');
  const palette = JSON.parse(await readFile(resolve(root, 'web/src/theme.generated.json'), 'utf8')).dark;
  await page.evaluate(palette => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true,
    appearance: { dark: true, accent: 'teal', palette, typography: { ui: 24, chat: 24, code: 24 } } } }, '*'), palette);
  await page.setViewportSize({ width: 390, height: 650 });
  await expect(page.locator('html')).toHaveCSS('font-size', '24px');
  await expect(dialog.getByRole('textbox', { name: 'Project reference', exact: true })).toHaveValue('project-draft');
  await expect(dialog.getByRole('status')).toContainText('model.bin');
  await expect(dialog.locator('.pero-ui-dialog-foot').getByRole('button', { name: 'Import', exact: true })).toBeInViewport();
  assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth));
  await page.screenshot({ path: resolve(screenshots, 'import-narrow-dark-24px.png'), fullPage: true });
  await dialog.getByText('Source and details (optional)', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal(imports.length, 2);
  assert.deepEqual(imports[1], imports[0]);
  assert.deepEqual({ ...imports[1], content: undefined }, { name: 'model.bin', kind: 'model', source: 'Local experiment', license: 'Unknown', projectRef: 'project-draft', content: undefined });
  assert.equal(Buffer.from(imports[1].content, 'base64').toString(), 'original model bytes');
  await expect(page.locator('.pero-app-bar').getByRole('button', { name: 'Add data', exact: true })).toBeVisible();
});

for (const kind of ['model', 'opaque']) test(`${kind} files expose file and history capabilities`, async t => {
  const value = { ...catalog, assets: [{ ...asset('a'), name: 'A long original research file with a name that must remain readable.bin', kind: kind === 'model' ? 'model' : 'dataset', format: 'bin' }],
    datasets: [{ ...catalog.datasets[0], name: 'A long original research file with a name that must remain readable.bin', kind: kind === 'model' ? 'model' : 'dataset', versions: ['a'] }] };
  const { page } = await fixture(t, { catalog: value, inspect: false });
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Versions (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Chart', exact: true })).toHaveCount(0);
  await expect(page.getByText('Fields are available', { exact: false })).toHaveCount(0);
  const palette = JSON.parse(await readFile(resolve(root, 'web/src/theme.generated.json'), 'utf8')).dark;
  await page.evaluate(palette => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true, appearance: { dark: true, accent: 'teal', palette, typography: { ui: 24, chat: 24, code: 24 } } } }, '*'), palette);
  await expect(page.locator('html')).toHaveCSS('font-size', '24px');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole('list', { name: 'Data library', exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(screenshots, `${kind}-dark-narrow.png`), fullPage: true });
});


test('chart requests retain a labelled previous chart and retry without remounting its surface', async t => {
  const { page, next } = await fixture(t, { tab: 'Table' });
  const pending = [];
  await page.route('**/api/chart', route => { pending.push(route); });
  const nextChart = async () => { await expect.poll(() => pending.length).toBeGreaterThan(0); return pending.shift(); };
  const response = title => ({ artifactId: title, content: JSON.stringify({ title }), document: {
    id: title, title, chart: { type: 'bar', y: 'value' }, rows: [{ label: 'A', value: 1 }],
    source: { label: 'Synthetic chart fixture', catalogDatasetId: 'measurements', assetId: 'a', sha256: 'a'.repeat(64), records: [{ ordinal: 0, pointer: '/0', line: 2 }] },
  } });
  await page.getByRole('tab', { name: 'Chart', exact: true }).click();
  const panel = page.locator('.data-chart-panel');
  await panel.getByRole('button', { name: 'Chart data', exact: true }).click();
  await page.getByRole('option', { name: 'Record fields', exact: true }).click();
  await panel.getByRole('button', { name: 'Create chart', exact: true }).click();
  await (await nextChart()).fulfill({ json: response('First chart') });
  await expect(panel.getByRole('heading', { name: 'First chart', exact: true })).toBeVisible();
  const surface = await panel.locator('iframe[data-pero-chart]').elementHandle();
  await panel.getByRole('button', { name: 'Create chart', exact: true }).click();
  const delayed = await nextChart();
  await expect(panel.getByText('Showing the previous chart', { exact: false })).toBeVisible();
  assert.equal(await surface.evaluate(node => node.isConnected), true);
  await delayed.fulfill({ status: 503, json: { detail: 'Temporary chart failure' } });
  await expect(panel.getByRole('heading', { name: 'First chart', exact: true })).toBeVisible();
  await expect(panel.getByText('Showing the previous chart', { exact: false })).toContainText('latest request failed');
  await panel.getByRole('button', { name: 'Retry chart', exact: true }).click();
  await (await nextChart()).fulfill({ json: response('Updated chart') });
  await expect(panel.getByRole('heading', { name: 'Updated chart', exact: true })).toBeVisible();
  assert.equal(await surface.evaluate(node => node.isConnected), true);
  await expect(panel.getByText('Showing the previous chart', { exact: false })).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'Chart source records', exact: true })).toContainText('/0');
  await panel.getByRole('button', { name: 'Chart details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Chart source details', exact: true })).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  await expect(panel.getByRole('button', { name: 'Chart details', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const invalid = await next();
  await invalid.reply({ status: 'changed', datasetId: 'measurements', assetId: 'a', message: 'Original bytes changed' });
  await expect(panel.getByRole('heading', { name: 'Updated chart', exact: true })).toHaveCount(0);
  assert.equal(await surface.evaluate(node => node.isConnected), false);
});

test('metadata editing keeps a failed draft and uses sandbox-safe Enter submission', async t => {
  const { page } = await fixture(t, { tab: 'Table' });
  const updates = [];
  await page.route('**/api/datasets/update', async route => {
    updates.push(route.request().postDataJSON());
    await route.fulfill({ status: updates.length === 1 ? 503 : 200,
      json: updates.length === 1 ? { detail: 'Temporary save failure' } : { ...catalog, datasets: [{ ...catalog.datasets[0], name: updates[1].name }] } });
  });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dataset details', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Unlost metadata');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unlost metadata');
  await dialog.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect(dialog.getByText('Details saved.', { exact: true })).toBeVisible();
  assert.equal(updates.length, 2);
  assert.equal(updates[1].name, 'Unlost metadata');
  await dialog.press('Escape');
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused();
});
