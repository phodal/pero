// Reopen a completed controlled journey in the actual Desktop, Paper panel and artifact reader.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const profile = process.env.PERO_RESEARCH_UI_PROFILE;
assert(profile, 'Use a retained successful paper-program journey profile');
const workspace = process.env.PERO_RESEARCH_UI_WORKSPACE || profile;
const out = join(root, 'test-results/paper-program-desktop');
await mkdir(out, { recursive: true });
await cp(join(root, 'apps/paper-agent/dist'), join(profile, 'apps/paper-agent/dist'), { recursive: true });
if (existsSync(join(profile, 'apps/scientific-viewer')))
  await cp(join(root, 'apps/scientific-viewer/dist'), join(profile, 'apps/scientific-viewer/dist'), { recursive: true });
const manifestPath = join(profile, 'apps/paper-agent/app.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.permissions.events = ['chat:closed'];
await writeFile(manifestPath, JSON.stringify(manifest));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
Object.assign(env, { PERO_DESKTOP_DATA_DIR: join(profile, 'desktop'), PERO_SETTINGS_PATH: join(profile, 'settings.json'),
  PERO_HISTORY_PATH: join(profile, 'history.jsonl'), PERO_AGENTS_FILE: join(profile, 'agents.json'),
  PERO_APPS_ROOT: join(profile, 'apps'), PERO_BUILTIN_APPS: 'scientific-viewer', PERO_REQUIRED_APPS: 'paper-agent,scientific-viewer', PERO_LOCALE: 'en',
  PERO_HOST_EXECUTABLE: process.env.PERO_RESEARCH_HOST || join(root, 'target/research-validation/debug/pero-host' + (process.platform === 'win32' ? '.exe' : '')), PERO_APP_NODE: process.execPath,
  PERO_ENV_FILE: join(profile, 'no-env'), UV_OFFLINE: '1' });
const app = await electron.launch({ args: [join(root, 'desktop')], cwd: root, env });
let page, chat;
const errors = [];
try {
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), workspace);
  const normalized = path => path.replace(/^\\\\\?\\/, '').replaceAll('\\', '/').toLowerCase();
  await expect.poll(async () => normalized(await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).workspace))).toBe(normalized(workspace));
  await clickAppShortcut(page, 'paper-agent');
  const frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.getByText('Synthetic model mismatch study', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await frame.getByRole('button', { name: 'Autonomous research', exact: true }).press('Enter', { timeout: 30000 });
  await expect(frame.getByRole('heading', { name: 'New research plan', exact: true })).toBeVisible();
  await frame.locator('.pa-program-list .pero-list-open').first().press('Enter');
  await expect(frame.getByText('Round limit reached', { exact: true })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Saved reading batches', exact: true })).toBeVisible();
  await expect(frame.locator('.pa-program-claim')).toContainText('Supporting evidence');
  await expect(frame.getByText('Research progress or artifact delivery needs retry:', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: join(out, 'completed-program.png') });
  await frame.getByRole('button', { name: 'Open reading record', exact: true }).first().click();
  await expect(frame.locator('.pa-reading-screen')).toBeVisible();
  await expect(frame.locator('#paper-research-records')).toContainText('What assumptions does the original source make?');
  await expect.poll(() => frame.locator('.pa-pdf-page img').first().evaluate(image => image.complete && image.naturalWidth > 0).catch(() => false), { timeout: 30000 }).toBe(true);
  await page.screenshot({ path: join(out, 'saved-reading-record.png') });
  await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Back to library', exact: true }).click();
  await frame.getByRole('button', { name: 'Autonomous research', exact: true }).click();
  await expect(frame.getByText('Round limit reached', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Source report', exact: true }).click();
  await expect.poll(() => frame.locator('.pa-pdf-page img').first().evaluate(image => image.complete && image.naturalWidth > 0).catch(() => false), { timeout: 30000 }).toBe(true);
  await expect(frame.locator('[data-citation-region]').first()).toBeVisible();
  await page.screenshot({ path: join(out, 'exact-source-pdf.png') });
  await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Back to library', exact: true }).click();
  await frame.getByRole('button', { name: 'Autonomous research', exact: true }).click();
  await frame.getByRole('button', { name: 'Open conversation and artifacts', exact: true }).press('Enter');
  chat = page.mainFrame(); // The workbench embeds the shared ChatPanel in its primary canvas.
  const state = () => chat.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await expect.poll(async () => (await state()).artifacts?.items?.length || 0, { timeout: 30000 }).toBe(4);
  async function click(key) {
    let bounds;
    await expect.poll(async () => { bounds = (await state()).artifacts.bounds[key]; return bounds?.width > 0 && bounds?.height > 0; }).toBe(true);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }
  await click('toggle');
  const report = (await state()).artifacts.items.find(item => item.title === 'research-report.md');
  assert(report);
  const viewer = page.frameLocator('iframe[title="Scientific Viewer"]');
  const tile = viewer.getByRole('option', { name: /research-report\.md/ });
  await tile.focus();
  await tile.press('Enter');
  await expect.poll(async () => (await state()).artifacts.reading).toBe(false);
  await expect.poll(async () => (await state()).artifacts.selected?.[0]).toBe(report.id);
  assert.equal((await state()).artifacts.error, null);
  await expect(viewer.locator('.artifact-document')).toContainText('needs_review');
  await expect(viewer.locator('.artifact-document')).toContainText('Independent replication remains missing.');
  await page.screenshot({ path: join(out, 'research-artifact-reader.png') });
  for (const version of [3, 2]) {
    await viewer.getByRole('button', { name: 'Previous version', exact: true }).press('Enter');
    await expect.poll(async () => (await state()).artifacts.selected?.[1]).toBe(version);
  }
  await expect(viewer.locator('.artifact-document')).toContainText('Model mismatch causes the synthetic method to fail.');
  await expect(viewer.locator('.artifact-document')).toContainText('Final execution accounting: not yet recorded');
  await expect(viewer.locator('.artifact-document')).not.toContainText('An adaptive correction restores the result');
  await page.evaluate(() => {
    const state = JSON.parse(window.peroDiagnostics.snapshot());
    return window.pero.sessionCommand({ method: 'settings.workbench', preferences: { ...state.preferences, appearance: 'dark' } });
  });
  await expect.poll(async () => (await state()).dark).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect.poll(() => viewer.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: join(out, 'historical-artifact-dark-narrow.png') });
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed: true, profile, artifacts: (await state()).artifacts,
    viewedVersions: [4, 3, 2], keyboardPreview: true, darkNarrow: true,
    errors, limitation: 'Real Desktop and saved controlled evidence; no live model or scientific verdict.' }, null, 2));
  assert.deepEqual(errors, []);
  console.log('PASS actual Desktop reopened Paper research and its saved artifact reader');
} catch (error) {
  await page?.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
  await writeFile(join(out, 'failure.json'), JSON.stringify({ error: String(error), errors,
    workbench: await page?.evaluate(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot())).catch(() => null),
    chat: await chat?.evaluate(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).artifacts).catch(() => null) }, null, 2));
  throw error;
} finally {
  await app.close();
}
