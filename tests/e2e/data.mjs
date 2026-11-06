// Real Electron -> App SDK -> Host -> Data Python backend. Disposable local files only.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/data');
await mkdir(out, { recursive: true });
for (const name of ['result.json', 'failure.json']) await rm(resolve(out, name), { force: true });
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-data-e2e-')));
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_LOCALE: 'en',
  PERO_AGENTS_FILE: agents, PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
const bytes = Buffer.from('id,value\n001,12.1\n002,\n001,12.1\n');
const changed = Buffer.from('id,value\n' + Array.from({ length: 61 }, (_, i) => `${i + 10},${i + 20}`).join('\n') + '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const errors = [], requests = [], checks = [];
let app, page, frame;
const desktop = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const datasetEntry = name => frame.locator('.data-catalog .pero-list-open').filter({ has: frame.getByText(name, { exact: true }) });
const detailsDialog = () => frame.getByRole('dialog', { name: 'Dataset details', exact: true });
const catalog = () => frame.locator('body').evaluate(async () => {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error(`Data state: HTTP ${response.status}`);
  return response.json();
});
// SDK Select is an accessible button/listbox, not a native <select>.
async function choose(scope, label, option, optionLabel = option) {
  const trigger = scope.getByRole('button', { name: label, exact: true });
  await trigger.click();
  await frame.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: optionLabel, exact: true }).click();
  await expect(trigger).toHaveAttribute('data-value', option);
}
async function openData() {
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await desktop()).apps?.some(item => item.name === 'data')).toBe(true);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await clickAppShortcut(page, 'data');
  await expect.poll(async () => (await desktop()).activeContent).toEqual({ kind: 'app', value: { name: 'data', panel: 'main' } });
  frame = page.frameLocator('iframe[title="data"]');
  await expect(frame.getByRole('button', { name: 'Add data', exact: true })).toBeEnabled({ timeout: 20000 });
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
  const current = app; app = undefined;
  await current.close();
}
try {
  await launch();
  expect((await catalog()).assets).toEqual([]);
  expect((await page.locator('iframe[title="data"]').getAttribute('sandbox')).split(/\s+/)).not.toContain('allow-forms');
  await expect(frame.getByText('No data yet', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'servo-response.csv', exact: true })).toHaveCount(0);
  await frame.getByRole('button', { name: 'Add data', exact: true }).click();
  const dialog = frame.getByRole('dialog');
  await dialog.getByText('Source and details (optional)', { exact: true }).click();
  await dialog.getByLabel('Source', { exact: true }).press('Enter');
  await expect(dialog).toBeVisible();
  expect(requests.filter(r => r.method === 'POST' && r.path === '/api/import')).toHaveLength(0);
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'measurements.csv', mimeType: 'text/csv', buffer: bytes });
  await dialog.getByLabel('Project reference', { exact: true }).fill('control-lab');
  await dialog.getByLabel('Project reference', { exact: true }).press('Enter');
  await expect(dialog).toBeHidden();
  const first = await catalog(), v1 = first.assets[0], datasetId = first.datasets[0].id;
  expect(first.assets).toHaveLength(1);
  expect(v1.sha256).toBe(digest(bytes));
  expect(relative(temp, v1.location)).not.toMatch(/^\.\./);
  expect(await readFile(v1.location)).toEqual(bytes);
  const preview = () => frame.getByRole('complementary', { name: 'Preview' });
  await expect(preview().getByText('001', { exact: true })).toHaveCount(2);
  await preview().getByRole('tab', { name: 'Fields', exact: true }).click();
  await preview().getByLabel('Unit for value', { exact: true }).fill('V');
  await preview().getByLabel('Unit for value', { exact: true }).press('Tab');
  await expect(preview().getByLabel('Unit for value', { exact: true })).toHaveValue('V');
  await preview().getByRole('tab', { name: 'Checks', exact: true }).click();
  await expect(preview().locator('dt').filter({ hasText: /^Duplicate rows$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('1');
  await expect(preview().locator('dt').filter({ hasText: /^Empty strings$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('1');
  await preview().getByRole('tab', { name: 'Table', exact: true }).click();
  await choose(preview(), 'Filter field', 'value');
  await choose(preview(), 'Condition', 'gte', 'At least');
  await preview().getByLabel('Filter value', { exact: true }).fill('invalid');
  await preview().getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(preview().getByRole('alert')).toHaveText('A numeric filter needs a finite decimal value');
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(3);
  await expect(preview().getByText('Showing the last successful result', { exact: false })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'data-rejected-filter.png') });
  await preview().getByRole('button', { name: 'Clear filter', exact: true }).click();
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(3);
  await expect(preview().getByRole('columnheader', { name: 'value (V)', exact: true })).toBeVisible();
  await choose(preview(), 'Filter field', 'id');
  await preview().getByLabel('Filter value', { exact: true }).fill('001');
  await preview().getByLabel('Filter value', { exact: true }).press('Enter');
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(2);
  await preview().getByLabel('View name', { exact: true }).press('Enter');
  expect((await catalog()).views).toHaveLength(0);
  await preview().getByLabel('View name', { exact: true }).fill('baseline');
  await preview().getByLabel('View name', { exact: true }).press('Enter');
  await expect.poll(async () => (await catalog()).views.length).toBe(1);
  const saved = (await catalog()).views[0];
  expect(saved).toMatchObject({ datasetId, assetId: v1.id, sha256: v1.sha256, view: { filter: { field: 'id', operator: 'contains', value: '001' }, units: { value: 'V' } }, report: { rowCount: 3, duplicateRows: 1 } });
  await preview().getByRole('button', { name: 'Edit details', exact: true }).click();
  await detailsDialog().getByLabel('Name', { exact: true }).fill('');
  await detailsDialog().getByLabel('Name', { exact: true }).press('Enter');
  expect((await catalog()).datasets[0].name).toBe('measurements.csv');
  await detailsDialog().getByLabel('Name', { exact: true }).fill('measurements.csv');
  await detailsDialog().getByLabel('Name', { exact: true }).press('Enter');
  await expect.poll(() => requests.filter(r => r.method === 'POST' && r.path === '/api/datasets/update').length).toBe(1);
  await expect(detailsDialog().getByRole('button', { name: 'Save details', exact: true })).toBeEnabled();
  await detailsDialog().getByRole('button', { name: 'Save details', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.method === 'POST' && r.path === '/api/datasets/update').length).toBe(2);
  await expect(detailsDialog().getByRole('button', { name: 'Save details', exact: true })).toBeEnabled();
  await detailsDialog().getByRole('button', { name: 'Close details', exact: true }).click();
  checks.push('single-line Enter submits Import, Apply, Save view and Save details; required fields reject empty input');
  checks.push('explicit import persists exact bytes; literal IDs, field units, full-input checks and filtered saved view');

  await preview().getByRole('button', { name: 'Add version', exact: true }).click();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'measurements-v2.csv', mimeType: 'text/csv', buffer: changed });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
  const second = await catalog(), v2 = second.assets[0];
  expect(second.datasets).toHaveLength(1);
  expect(second.datasets[0]).toMatchObject({ id: datasetId, versions: [v1.id, v2.id], projectRef: 'control-lab' });
  expect(v2.sha256).toBe(digest(changed));
  expect(await readFile(v1.location)).toEqual(bytes);
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(50);
  await preview().getByRole('button', { name: 'Next', exact: true }).click();
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(11);
  await expect(preview().locator('.data-rows tbody tr').first().locator('th')).toHaveText('51');
  await preview().getByRole('tab', { name: 'History', exact: true }).click();
  const reference = resolve(temp, 'baseline-reference.json');
  await app.evaluate(({ session }, path) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path)), reference);
  await preview().getByRole('button', { name: 'Export reference', exact: true }).click();
  await expect.poll(async () => readFile(reference, 'utf8').then(JSON.parse, () => null)).toMatchObject({
    type: 'pero-dataset-view', ...saved, source: { name: 'measurements.csv', sha256: digest(bytes) },
  });
  await preview().getByRole('button', { name: 'baseline', exact: true }).click();
  await expect(preview().getByRole('button', { name: 'Version', exact: true })).toHaveAttribute('data-value', v1.id);
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(2);
  await choose(frame, 'Project filter', 'control-lab');
  await frame.getByRole('searchbox', { name: 'Search data' }).fill('does-not-exist');
  await expect(frame.getByText('No matches', { exact: true })).toBeVisible();
  await frame.getByRole('searchbox', { name: 'Search data' }).fill('');
  await expect(preview().getByRole('button', { name: 'Version', exact: true })).toHaveAttribute('data-value', v1.id);
  await preview().getByRole('tab', { name: 'History', exact: true }).click();
  await preview().getByRole('button', { name: 'Archive dataset', exact: true }).click();
  await preview().getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await expect.poll(async () => (await catalog()).datasets[0].archived).toBe(true);
  await frame.getByRole('checkbox', { name: 'Archived', exact: true }).check();
  await datasetEntry('measurements.csv').click();
  await preview().getByRole('tab', { name: 'History', exact: true }).click();
  await preview().getByRole('button', { name: 'Restore dataset', exact: true }).click();
  await expect.poll(async () => (await catalog()).datasets[0].archived).toBe(false);
  await frame.getByRole('checkbox', { name: 'Archived', exact: true }).uncheck();
  checks.push('explicit v2 preserves v1; paginated records, pinned saved view, project filter and reversible archive');

  await close();
  await launch();
  const reopened = await catalog();
  expect(reopened.datasets[0]).toMatchObject({ id: datasetId, versions: [v1.id, v2.id], projectRef: 'control-lab' });
  expect(reopened.views[0]).toEqual(saved);
  await expect(datasetEntry('measurements.csv')).toBeVisible();
  await preview().getByRole('tab', { name: 'History', exact: true }).click();
  await preview().getByRole('button', { name: 'baseline', exact: true }).click();
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(2);
  await preview().getByRole('button', { name: 'Edit details', exact: true }).click();
  await detailsDialog().getByLabel('Project reference', { exact: true }).fill('');
  await detailsDialog().getByRole('button', { name: 'Save details', exact: true }).click();
  await expect.poll(async () => (await catalog()).datasets[0].projectRef).toBe('');
  await detailsDialog().getByRole('button', { name: 'Close details', exact: true }).click();
  await writeFile(v1.location, Buffer.from(bytes.toString().replace('001', '009')));
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  const corruption = preview().getByText('Original bytes no longer match the stored SHA-256', { exact: true });
  await expect(corruption).toBeVisible();
  await expect(frame.getByRole('table', { name: '' }).getByRole('cell', { name: 'Changed', exact: true })).toBeVisible();
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(0);
  expect((await catalog()).views[0]).toEqual(saved);
  await preview().getByRole('tab', { name: 'History', exact: true }).click();
  await expect(preview().getByRole('heading', { name: 'Saved views', exact: true })).toBeVisible();
  await expect(corruption).toBeVisible();
  await page.screenshot({ path: resolve(out, 'data-changed-original.png') });
  await preview().getByRole('tab', { name: 'Table', exact: true }).click();
  await writeFile(v1.location, bytes);
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(preview().locator('.data-rows tbody tr')).toHaveCount(2);
  await setAppearance(page, 'light');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('light');
  await page.screenshot({ path: resolve(out, 'data-light.png') });
  await setAppearance(page, 'dark');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  const splitter = frame.getByRole('separator', { name: 'Resize datasets', exact: true });
  await expect(splitter).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  await expect(splitter).toBeHidden();
  expect(await frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(out, 'data-dark-narrow.png') });

  const malformed = Buffer.from('{"value":1}\n\n{"value":}\n');
  const longName = `instrument-${'measurements-'.repeat(10)}raw.jsonl`;
  await frame.getByRole('button', { name: 'Add data', exact: true }).click();
  const reopenedDialog = frame.getByRole('dialog');
  await reopenedDialog.locator('input[type="file"]').setInputFiles({ name: longName, mimeType: 'application/jsonl', buffer: malformed });
  await reopenedDialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(reopenedDialog).toBeHidden();
  await expect(preview().getByRole('heading', { name: longName, exact: true })).toBeVisible();
  await expect(preview().getByRole('alert')).toHaveText('Line 3, column 10: Expecting value');
  expect(await frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const original = (await catalog()).assets[0];
  expect(original.sha256).toBe(digest(malformed));
  expect(await readFile(original.location)).toEqual(malformed);
  await page.screenshot({ path: resolve(out, 'data-malformed-narrow.png') });

  expect(requests.filter(r => r.method === 'POST' && r.path === '/api/import')).toHaveLength(3);
  expect(requests.filter(r => r.method === 'POST' && r.path === '/api/views')).toHaveLength(1);
  expect(requests.filter(r => r.method === 'POST' && r.path === '/api/datasets/update')).toHaveLength(5);
  expect(requests.filter(r => r.path.includes('download') && r.method === 'POST')).toEqual([]);
  expect(errors).toEqual([]);
  checks.push('restart preserves identities and view; same-length corruption refuses current preview; light/dark narrow screenshots');
  checks.push('clear a rejected filter without losing field units; export exact saved reference; unlink project; locate malformed JSONL while keeping original bytes');
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
