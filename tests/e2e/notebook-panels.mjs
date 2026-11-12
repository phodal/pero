import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppOpen, clickAppShortcut } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const profile = await mkdtemp(resolve(tmpdir(), 'pero-notebook-desktop-'));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_LOCALE: 'en',
  PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl') };
delete env.PERO_APPS_ROOT;
delete env.PERO_BUILTIN_APPS_ROOT;
const ownerFixtures = process.env.PERO_NOTEBOOK_OWNER_FIXTURES === '1';
const ownerExport = (script, owner) => execFileSync(process.env.PERO_APP_PYTHON || 'python3', [
  resolve(root, 'packages/notebook/test/fixtures', script), resolve(profile, 'app-data', owner),
], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 16 * 1024 * 1024 });
let app;
try {
  if (ownerFixtures) {
    assert.ok(process.env.PERO_APP_PYTHON, 'Set PERO_APP_PYTHON to a virtual environment with the Paper Agent and Control Lab dependencies.');
    const ownerPython = dirname(dirname(process.env.PERO_APP_PYTHON));
    await writeFile(env.PERO_SETTINGS_PATH, JSON.stringify({ app_python: { apps: {
      'paper-agent': ownerPython, 'control-lab': ownerPython,
    } } }));
  } else if (process.env.PERO_APP_PYTHON) await writeFile(env.PERO_SETTINGS_PATH, JSON.stringify({ app_python: { apps: { notebook: dirname(dirname(process.env.PERO_APP_PYTHON)) } } }));
  const paper = ownerFixtures && ownerExport('generate-paper-export.py', 'paper-agent');
  const control = ownerFixtures && ownerExport('control-export.py', 'control-lab');
  const expectedTrial = control && JSON.parse(control).experiment.trials.at(-1);
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
    resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow();
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60_000 });
  await expect.poll(async () => (await state()).apps?.some(entry => entry.name === 'notebook')).toBe(true);
  if ((await state()).sidebarButtonBounds?.notebook) await clickAppShortcut(page, 'notebook');
  else {
    await page.mouse.click(80, await page.evaluate(() => innerHeight - 76));
    await clickAppOpen(page, 'notebook');
  }
  const frame = page.frameLocator('iframe[title="notebook"]');
  await frame.getByRole('button', { name: 'New notebook' }).click({ timeout: 20_000 });
  await frame.getByRole('textbox', { name: 'Notebook title' }).fill('Live App panel acceptance');
  await frame.getByRole('button', { name: 'Insert', exact: true }).click();
  await frame.getByRole('menuitem', { name: 'App Canvas', exact: true }).click();
  const canvas = frame.locator('[data-kind=appCanvas]');
  await canvas.getByRole('button', { name: 'Installed App', exact: true }).click();
  await frame.getByRole('option', { name: /Skills/ }).click();
  await canvas.getByRole('button', { name: 'Declared view', exact: true }).click();
  await frame.getByRole('option', { name: /Skills/ }).click();
  await canvas.getByRole('button', { name: 'Save binding', exact: true }).click();
  await canvas.locator('[data-pero-app-panel=skills]').scrollIntoViewIfNeeded();
  const skills = page.frameLocator('iframe[title=skills]');
  await expect(skills.getByRole('searchbox')).toBeVisible({ timeout: 30_000 });
  await expect(skills.locator('.skills-row').first()).toBeVisible({ timeout: 30_000 });
  const box = await canvas.locator('[data-pero-app-panel=skills]').boundingBox();
  const mounted = await page.locator('iframe[title=skills]').boundingBox();
  for (const field of ['x','y','width','height']) assert.ok(Math.abs(box[field] - mounted[field]) <= 2, `Embedded ${field}: ${box[field]} / ${mounted[field]}`);
  await skills.getByRole('searchbox').fill('writing');
  await expect(skills.getByRole('searchbox')).toHaveValue('writing');
  const output = resolve(root, 'test-results/notebook'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'desktop-embedded-skills.png') });
  // Notebook menus cover the child surface, then closing restores its state.
  await frame.locator('[data-notebook-menu=file] .pero-ui-popover-trigger').click();
  await expect(page.locator('iframe[title=skills]')).toHaveAttribute('aria-hidden', 'true');
  await frame.locator('[data-notebook-menu=file] .pero-ui-popover-trigger').press('Escape');
  await expect(page.locator('iframe[title=skills]')).toHaveAttribute('aria-hidden', 'false');
  await expect(skills.getByRole('searchbox')).toHaveValue('writing');
  await frame.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(frame.locator('.notebook-status')).toHaveText('Revision 2');
  await frame.locator('[data-notebook-menu=file] .pero-ui-popover-trigger').click();
  await frame.getByRole('button', { name: 'Revision history', exact: true }).click();
  await frame.getByRole('button', { name: 'Revision 2', exact: true }).click();
  await expect(frame.getByText('Historical notebook revision. Open the App separately to use its current page.', { exact: true })).toBeVisible();
  await expect(page.locator('iframe[title=skills]')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Return to current notebook', exact: true }).click();
  await expect(skills.getByRole('searchbox')).toBeVisible({ timeout: 30_000 });
  assert.deepEqual(errors, []);
  console.log('Real Skills page embedded after Save binding; search, menu occlusion, saved revision and historical release passed.');
} catch (error) {
  if (app) { const page = await app.firstWindow(); await mkdir(resolve(root, 'test-results/notebook'), { recursive: true }); await page.screenshot({ path: resolve(root, 'test-results/notebook/panel-failure.png') }); console.error(await page.locator('body').innerText()); for (const child of page.frames().slice(1)) console.error((await child.locator('body').innerText().catch(() => '')).slice(0,2000)); }
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
