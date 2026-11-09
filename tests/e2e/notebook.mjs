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
  await frame.getByRole('textbox', { name: 'Notebook title' }).fill('Notebook in Pero');
  await frame.getByRole('textbox', { name: 'Notebook content' }).fill('Read the original parameters.');
  await frame.getByRole('button', { name: 'Insert', exact: true }).click();
  await frame.getByRole('menuitem', { name: 'Spreadsheet' }).click();
  const inputCell = frame.locator('[data-cell=A1]'), formulaCell = frame.locator('[data-cell=B1]');
  await inputCell.click();
  await inputCell.pressSequentially('2');
  await expect(inputCell).toHaveValue('2');
  await formulaCell.click();
  await formulaCell.pressSequentially('=A1*6');
  await inputCell.click();
  await expect(inputCell).toHaveValue('2');
  await expect(formulaCell).toHaveValue('12');
  if (paper && control) {
    await frame.getByRole('button', { name: 'Insert', exact: true }).click();
    await frame.getByRole('menuitem', { name: 'Evidence', exact: true }).click();
    const evidence = frame.locator('[data-kind=evidence]');
    await evidence.locator('input[type=file]').setInputFiles({ name: 'paper.json', mimeType: 'application/json', buffer: paper });
    await evidence.getByRole('button', { name: 'Choose a citation' }).click();
    await frame.getByRole('option').nth(1).click();
    await evidence.getByRole('button', { name: 'Attach snapshot' }).click();
    await expect(evidence.locator('blockquote')).toHaveText('Second page. Exact original evidence.');
    await frame.getByRole('button', { name: 'Insert', exact: true }).click();
    await frame.getByRole('menuitem', { name: 'Experiment reference', exact: true }).click();
    const experiment = frame.locator('[data-kind=experiment]');
    await experiment.locator('input[type=file]').setInputFiles({ name: 'control.json', mimeType: 'application/json', buffer: control });
    await experiment.getByRole('button', { name: 'Choose a trial receipt' }).click();
    await frame.getByRole('option', { name: new RegExp(expectedTrial.id.slice(0, 12)) }).click();
    await experiment.getByRole('button', { name: 'Attach snapshot' }).click();
    await expect(experiment.getByText('Recorded Control Lab verdict', { exact: true })).toBeVisible();
    await expect(experiment.locator('.notebook-snapshot > .notebook-reference-actions')).toContainText(expectedTrial.report.verdict);
  }
  await frame.getByRole('button', { name: 'Save revision' }).click();
  await expect(frame.locator('.notebook-status')).toHaveText('Revision 2');
  const output = resolve(root, 'test-results/notebook');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'desktop.png') });
  if (expectedTrial) {
    await frame.getByRole('button', { name: 'Open in Paper Agent' }).click();
    const paperFrame = page.frameLocator('iframe[title="paper-agent"]');
    await expect(paperFrame.locator('[data-page-number="2"] [data-citation-region=true]').first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: resolve(output, 'paper-source.png') });
    await clickAppShortcut(page, 'notebook');
    await frame.getByRole('button', { name: 'Open in Control Lab' }).click();
    const controlFrame = page.frameLocator('iframe[title="control-lab"]');
    await controlFrame.getByRole('button', { name: 'Raw evidence / hash' }).click({ timeout: 20_000 });
    await expect(controlFrame.getByRole('dialog', { name: 'Raw execution evidence' })).toContainText(expectedTrial.report.id);
    await expect(controlFrame.getByRole('dialog', { name: 'Raw execution evidence' })).toContainText(expectedTrial.id);
    await page.screenshot({ path: resolve(output, 'control-source.png') });
    await clickAppShortcut(page, 'notebook');
  }
  await frame.getByRole('button', { name: 'Ask Agent' }).click();
  await expect.poll(async () => {
    const current = await state();
    return current.appChatOpen && current.composer?.includes('revision 2') && current.contextPreviewBounds?.length > 0;
  }).toBe(true);
  assert.deepEqual(errors, []);
  console.log('Notebook saved a calculated sheet through Pero Host and attached the saved revision to a Chat draft.');
  if (expectedTrial) console.log('Notebook imported both owner exports and reopened the exact Paper citation and Control Lab trial.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
