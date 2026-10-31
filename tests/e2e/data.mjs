// Real Electron -> App SDK -> Host -> Data Python backend. Tiny local files only.
// This is development workbench acceptance, not live source/model or installer acceptance.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppOpen, setAppearance } from './sidebar-controls.mjs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/data');
await mkdir(out, { recursive: true });
for (const name of ['result.json', 'failure.json']) await rm(resolve(out, name), { force: true });
const temp = await mkdtemp(resolve(tmpdir(), 'pero-data-e2e-'));
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_LOCALE: 'en',
  PERO_AGENTS_FILE: agents, PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
const fixtures = [
  { name: 'measurements.csv', kind: 'dataset', buffer: Buffer.from('time,voltage\n0,12.1\n1,12.2\n'), mimeType: 'text/csv' },
  { name: 'opaque-weights.model', kind: 'model', buffer: Buffer.from([0x80, 4, 0, 255, 65, 66]), mimeType: 'application/octet-stream' },
];
const errors = [], requests = [], checks = [];
let app, page, frame;
const desktop = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const catalog = () => frame.locator('body').evaluate(async () => {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error(`Data state: HTTP ${response.status}`);
  return response.json();
});
async function openData() {
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await desktop()).apps?.some(item => item.name === 'data')).toBe(true);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  // The existing bottom Apps menu exposes measured Open button bounds.
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 55));
  await expect.poll(async () => (await desktop()).navigation).toBe(7);
  await expect.poll(async () => (await desktop()).appsLoading).toBe(false);
  await clickAppOpen(page, 'data');
  await expect.poll(async () => (await desktop()).activeContent).toEqual({ kind: 'app', value: { name: 'data', panel: 'main' } });
  frame = page.frameLocator('iframe[title="data"]');
  await expect(frame.getByRole('heading', { name: 'Data', exact: true })).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => (await catalog()).sources.length).toBe(2);
}
async function launch() {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'pero-app:' && url.hostname === 'data' && url.pathname.startsWith('/api/'))
      requests.push({ method: request.method(), path: url.pathname });
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await openData();
}
async function close() {
  if (!app) return;
  const current = app;
  app = undefined;
  await current.close();
}
try {
  await launch();
  expect((await catalog()).assets).toEqual([]);
  expect((await catalog()).download).toBeNull();
  await frame.getByRole('button', { name: 'Sources', exact: true }).click();
  await expect(frame.getByRole('dialog').getByRole('button', { name: 'Download', exact: true })).toHaveCount(2);
  await frame.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  for (const fixture of fixtures) {
    await frame.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = frame.getByRole('dialog');
    await expect(dialog.getByText('Up to 10 MiB', { exact: true })).toBeVisible();
    await dialog.getByLabel('Type', { exact: true }).selectOption(fixture.kind);
    await dialog.locator('input[type="file"]').setInputFiles({ name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer });
    if (fixture.kind === 'dataset') await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    else await dialog.getByRole('button', { name: 'Import', exact: true }).press('Enter');
    await expect(dialog).toBeHidden();
    await expect(frame.getByRole('button', { name: fixture.name, exact: true })).toBeVisible();
  }
  const before = await catalog();
  expect(before.assets).toHaveLength(2);
  for (const fixture of fixtures) {
    const asset = before.assets.find(item => item.name === fixture.name);
    expect(asset.kind).toBe(fixture.kind);
    expect(asset.localAvailable).toBe(true);
    expect(asset.sha256).toBe(createHash('sha256').update(fixture.buffer).digest('hex'));
    await frame.getByRole('button', { name: fixture.name, exact: true }).click();
    await expect(frame.getByRole('complementary', { name: 'Asset details' }).getByText(asset.sha256, { exact: true })).toBeVisible();
    await expect(frame.getByRole('complementary', { name: 'Asset details' }).getByText(asset.location, { exact: true })).toBeVisible();
  }
  checks.push('sandbox-safe click and Enter import tiny CSV and opaque model; metadata and SHA256 match original bytes');
  await frame.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(frame.locator('tbody tr')).toHaveCount(1);
  await expect(frame.locator('tbody')).toContainText('opaque-weights.model');
  await frame.getByRole('button', { name: 'All', exact: true }).click();
  await frame.getByRole('searchbox').fill('measurements');
  await expect(frame.locator('tbody tr')).toHaveCount(1);
  await expect(frame.locator('tbody')).toContainText('measurements.csv');
  await frame.getByRole('searchbox').fill('');
  await setAppearance(page, 'light');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('light');
  await page.screenshot({ path: resolve(out, 'data-light.png') });
  await setAppearance(page, 'dark');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  expect(await frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(out, 'data-dark-narrow.png') });
  checks.push('kind filter, name search, selected details, light and dark narrow layout');
  await close();
  await launch();
  expect((await catalog()).assets).toEqual(before.assets);
  expect((await catalog()).download).toBeNull();
  await expect(frame.locator('tbody tr')).toHaveCount(2);
  expect(requests.filter(request => request.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/import' }, { method: 'POST', path: '/api/import' },
  ]);
  expect(errors).toEqual([]);
  checks.push('restart restores files and metadata; Sources browsing and startup never issue download requests');
  await close();
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ scope: 'development-workbench-local-files', checks, requests, errors,
    exclusions: ['live upstream downloads', 'model execution', 'standalone bundled runtime or signed installer'] }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, requests, errors }, null, 2));
  throw error;
} finally {
  await close();
  await rm(temp, { recursive: true, force: true });
}
