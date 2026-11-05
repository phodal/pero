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

async function fixture(t) {
  const pending = [], errors = [];
  const json = (response, value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  const server = createServer(async (request, response) => {
    if (request.url === '/api/state') return json(response, catalog);
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
  await (await next()).reply();
  await page.getByRole('tab', { name: 'Fields', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Unit for voltage', exact: true })).toBeVisible();
  return { page, next };
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
  await page.getByRole('option', { name: 'v2 — b.csv', exact: true }).click();
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

for (const failure of ['changed', 'transport']) test(`${failure} failure removes prior field checks rather than claiming current integrity`, async t => {
  const { page, next } = await fixture(t);
  const input = page.getByRole('textbox', { name: 'Unit for voltage', exact: true });
  await input.fill('V'); await input.press('Tab');
  const request = await next();
  if (failure === 'changed') await request.reply({ status: 'changed', datasetId: 'measurements', assetId: 'a', message: 'Fixture bytes no longer match' });
  else await request.reply({ error: 'Fixture inspection unavailable' }, 503);
  await expect(input).toHaveCount(0);
  await expect(page.getByText('Bytes matched', { exact: false })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Checks', exact: true }).click();
  await expect(page.getByText('No current checks.', { exact: true })).toBeVisible();
  if (failure === 'transport') {
    await page.getByRole('button', { name: 'Retry inspection', exact: true }).click();
    const retry = await next();
    assert.deepEqual(retry.input, request.input);
    await retry.reply();
    await expect(page.getByText('Full input / 1 records', { exact: true })).toBeVisible();
  }
});
