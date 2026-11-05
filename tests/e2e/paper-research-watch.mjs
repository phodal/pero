// Real Desktop, Host scheduler and Data storage. The upstream check uses official arXiv metadata.
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';

if (process.env.PERO_RESEARCH_WATCH_LIVE !== '1') throw Error('Set PERO_RESEARCH_WATCH_LIVE=1 for the official arXiv metadata check');
const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'test-results/paper-research-watch');
const profile = await realpath(await mkdtemp(join(tmpdir(), 'pero-research-watch-')));
await mkdir(output, { recursive: true });
const settings = join(profile, 'settings.json');
await writeFile(settings, JSON.stringify({ workbench: { appearance: 'light' },
  ...(process.env.PERO_RESEARCH_WATCH_VENV ? { app_python: { default: process.env.PERO_RESEARCH_WATCH_VENV } } : {}) }));
const agents = join(profile, 'agents.json');
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode']
  .map(id => ({ id, name: id, command: join(profile, `unavailable-${id}`) }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(profile, 'desktop'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: join(profile, 'history.jsonl'), PERO_ENV_FILE: join(profile, '.env'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
delete env.PERO_APPS_ROOT;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
}
async function open(name) {
  await clickAppShortcut(page, name);
  const frame = page.frameLocator(`iframe[title="${name}"]`);
  await expect(frame.locator('body')).toBeVisible({ timeout: 20000 });
  return frame;
}
function api(frame, path, body) {
  return frame.locator('body').evaluate(async (_, { path, body }) => {
    const response = await fetch(path, body === undefined ? undefined : { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw Error(await response.text());
    return response.json();
  }, { path, body });
}
async function importData(frame, name, data) {
  const dialog = frame.getByRole('dialog');
  await dialog.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(data) });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
}
const watchRequest = (frame, method = 'GET', body = null) => api(frame, '/host/automation', { method, path: '/api/research-watch', body });
const question = 'Review the local measurements against the saved PC-Gym version';
try {
  await launch();
  let data = await open('data');
  await data.getByRole('button', { name: 'Add data', exact: true }).click();
  await importData(data, 'measurements.csv', 'sample,value\n1,1.25\n');
  const initial = (await api(data, '/api/state')).assets[0];

  const paper = await open('paper-agent');
  await api(paper, '/api/papers/import', { title: 'PC-Gym arXiv v3 version reference', sourceId: '2410.22093v3',
    url: 'https://arxiv.org/abs/2410.22093v3', authors: [], contentKind: 'full-text', content: 'Local test record for the official version reference.' });
  await paper.getByRole('button', { name: 'Refresh', exact: true }).click();
  await paper.getByRole('button', { name: 'Research results', exact: true }).click();
  const records = paper.locator('.pa-manual-records');
  await records.getByText('Question and scope', { exact: true }).click();
  await records.getByRole('button', { name: 'New record', exact: true }).click();
  await records.getByLabel('Question', { exact: true }).fill(question);
  await records.getByLabel('Scope', { exact: true }).fill('Official version identity and one local dataset');
  await records.getByLabel('Inclusion criteria', { exact: true }).fill('Explicit source and immutable data version');
  await records.getByLabel('Exclusion criteria', { exact: true }).fill('Unbound materials');
  await records.getByRole('checkbox', { name: 'PC-Gym arXiv v3 version reference' }).check();
  await records.getByLabel('Reason', { exact: true }).fill('Saved version reference');
  await records.getByText('Data Workspace', { exact: true }).click();
  await records.getByRole('button', { name: 'Choose Data versions' }).click();
  await records.getByRole('combobox', { name: /^measurements.csv/ }).selectOption(initial.id);
  await records.getByRole('button', { name: 'Save revision', exact: true }).click();
  const record = records.getByRole('article', { name: 'Saved research record' });
  await expect(record).toBeVisible();
  const first = (await api(paper, '/api/research/record', { operation: 'list' })).records[0];
  expect(first.dataVersions[0]).toMatchObject({ versionId: initial.id, sha256: initial.sha256 });

  data = await open('data');
  await data.getByRole('button', { name: 'Add version', exact: true }).click();
  await importData(data, 'measurements-v2.csv', 'sample,value\n1,2.50\n');
  const newer = (await api(data, '/api/state')).assets[0];
  expect(newer.id).not.toBe(initial.id);

  await open('paper-agent');
  await record.getByText('Watch for updates', { exact: true }).click();
  const panel = record.getByRole('region', { name: 'Research updates', exact: true });
  await panel.getByRole('button', { name: 'Check daily', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Pause checks', exact: true })).toBeVisible();
  const checkNow = panel.getByRole('button', { name: 'Check now', exact: true });
  await checkNow.focus();
  await checkNow.press('Enter');
  await expect(panel.getByRole('link', { name: '2410.22093v4', exact: true })).toBeVisible({ timeout: 35000 });
  await expect(panel.getByText(newer.id.slice(0, 8), { exact: false })).toBeVisible();
  const result = (await watchRequest(paper)).body.updates.find(item => item.researchRecordId === first.id).result;
  expect(result.papers[0]).toMatchObject({ pinned: '2410.22093v3', latest: '2410.22093v4', status: 'changed' });
  expect(result.datasets[0]).toMatchObject({ pinned: initial.id, latest: newer.id, status: 'changed' });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'paper-light.png') });

  await record.getByRole('button', { name: 'Revise', exact: true }).click();
  await records.getByText('Data Workspace', { exact: true }).click();
  await records.getByRole('button', { name: 'Choose Data versions' }).click();
  const versions = records.getByRole('combobox', { name: /^measurements.csv/ });
  await expect(versions).toHaveValue(initial.id);
  await versions.selectOption(newer.id);
  await records.getByRole('button', { name: 'Save revision', exact: true }).click();
  const revisions = () => api(paper, '/api/research/record', { operation: 'list' });
  await expect.poll(async () => (await revisions()).records.length).toBe(2);
  const revised = (await revisions()).records.find(item => item.parentId === first.id);
  expect(revised.dataVersions[0]).toMatchObject({ versionId: newer.id, sha256: newer.sha256 });
  expect((await watchRequest(paper)).body.watches.some(watch => watch.recordId === revised.id)).toBe(false);

  const automations = await open('automations');
  const watchRow = automations.getByRole('row').filter({ hasText: 'Research updates' });
  await expect(watchRow).toContainText('Managed in Paper');
  await watchRow.getByRole('button', { name: 'Research updates', exact: true }).click();
  const automationDetails = automations.getByRole('region', { name: 'Automation details' });
  await expect(automationDetails.getByText('succeeded', { exact: true })).toBeVisible();
  await expect(automationDetails.getByRole('button', { name: 'Open session' })).toHaveCount(0);
  await page.screenshot({ path: join(output, 'automation-light.png') });

  const insights = await open('insights');
  const updates = insights.getByRole('region', { name: 'Research updates', exact: true });
  await expect(updates.getByText(question, { exact: true })).toBeVisible();
  await expect(updates.getByText(/measurements.csv — Update available/)).toBeVisible();
  expect((await watchRequest(insights, 'POST', { operation: 'pause', recordId: first.id })).status).toBe(403);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 760));
  await setAppearance(page, 'dark');
  await expect.poll(() => insights.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: join(output, 'insights-dark-narrow.png') });

  await app.close();
  await launch();
  const reopened = await open('paper-agent');
  const saved = (await watchRequest(reopened)).body;
  expect(saved.watches.find(watch => watch.recordId === first.id)).toMatchObject({ scheduled: true, running: false });
  expect(saved.updates.find(item => item.researchRecordId === first.id).result).toEqual(result);
  expect((await api(reopened, '/api/research/record', { operation: 'read', recordId: first.id })).dataVersions).toEqual(first.dataVersions);
  const paused = (await watchRequest(reopened, 'POST', { operation: 'pause', recordId: first.id })).body;
  expect(paused.watches.find(watch => watch.recordId === first.id)).toMatchObject({ scheduled: false, next: null });
  expect(errors).toEqual([]);
  await writeFile(join(output, 'report.json'), JSON.stringify({ result, watch: saved.watches.find(watch => watch.recordId === first.id),
    revisedId: revised.id, checks: ['exact Data version pinned', 'new Data version and official arXiv revision observed',
      'explicit rebind produces a new revision', 'Automation history without an Agent session', 'Insights read-only',
      'retained after restart', 'schedule can be paused'] }, null, 2));
  console.log('Paper and Insights retained the same real Data version change and official arXiv revision across restart.');
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), timeout: 3000 }).catch(() => {});
  throw error;
} finally {
  try { await app?.close(); } finally { await rm(profile, { recursive: true, force: true }); }
}
