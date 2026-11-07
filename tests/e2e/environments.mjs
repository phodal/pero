// Real Electron App origin -> Host -> configured interpreter metadata probes.
// No solver, training, preparation, Agent or scientific verdict is exercised.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppOpen, clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/environments');
const profile = await mkdtemp(resolve(tmpdir(), 'pero-environments-e2e-'));
const python = process.env.PERO_ENVIRONMENTS_TEST_VENV;
if (!python) throw new Error('Set PERO_ENVIRONMENTS_TEST_VENV to an existing prepared App venv; this suite never installs dependencies.');
await mkdir(out, { recursive: true });
await rm(resolve(out, 'failure.png'), { force: true });
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ workbench: { appearance: 'light' }, app_python: { default: python } }));
const env = { ...process.env,
  PERO_DESKTOP_DATA_DIR: profile, PERO_LOCALE: 'en', PERO_SETTINGS_PATH: resolve(profile, 'settings.json'),
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl') };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT; delete env.PERO_BUILTIN_APPS;
let app, page;
const errors = [], checks = [], reports = {};
const targets = ['paper-agent.pcgym', 'control-lab.python-control', 'control-lab.ngspice', 'lcms2yield.inference'];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const post = (frame, body) => frame.locator('body').evaluate(async (_, body) => {
  const response = await fetch('/host/environment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, text: await response.text() };
}, body);
async function open(name) {
  if (name === 'paper-agent' || name === 'environments') await clickAppShortcut(page, name);
  else { await clickAppShortcut(page, 'apps'); await clickAppOpen(page, name); }
  const frame = page.frameLocator(`iframe[title="${name}"]`);
  await expect(frame.locator('body')).toBeVisible({ timeout: 30000 });
  return frame;
}
try {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.filter(item => ['environments', 'paper-agent', 'control-lab'].includes(item.name)).length).toBe(3);
  const frame = await open('environments');
  await expect(frame.getByRole('heading', { name: 'Environments', exact: true })).toBeVisible();
  await expect(frame.getByRole('table').getByText('Not checked', { exact: true })).toHaveCount(4);
  await frame.getByLabel('Search environments', { exact: true }).fill('missing query');
  await expect(frame.getByText('No matching environments.', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'PC-Gym', exact: true })).toBeVisible();
  checks.push('default product registration, Workspace sidebar, React mount and search recovery');
  const responses = [];
  const responseListener = response => {
    if (new URL(response.url()).pathname === '/host/environment') responses.push(response);
  };
  page.on('response', responseListener);
  await frame.getByRole('button', { name: 'Check all', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Check all', exact: true })).toBeEnabled({ timeout: 30000 });
  page.off('response', responseListener);
  expect(responses).toHaveLength(4);
  for (const response of responses) {
    expect(response.status(), await response.text()).toBe(200);
    const value = await response.json();
    expect(targets).toContain(value.method);
    expect(value.schema).toBe('pero.environment.inspection.v1');
    expect(value.evidence).toBe('metadata_only');
    expect(value.matched).toBe(value.missing.length === 0);
    reports[value.method] = value;
  }
  await writeFile(resolve(out, 'observations.json'), JSON.stringify(reports, null, 2));
  await page.screenshot({ path: resolve(out, 'catalog-light.png') });
  await frame.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(frame.locator('.env-tile')).toHaveCount(4);
  await frame.getByRole('button', { name: 'PC-Gym', exact: true }).click();
  await expect(frame.getByRole('table', { name: 'Software', exact: true })).toBeVisible();
  await expect(frame.getByText('Python', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Requirements', exact: true }).click();
  await expect(frame.locator('.env-requirements li')).toHaveCount(reports['paper-agent.pcgym'].requirements.required.length);
  await frame.getByRole('button', { name: 'Observation', exact: true }).click();
  await frame.locator('summary').filter({ hasText: 'JSON' }).click();
  expect(JSON.parse(await frame.locator('.env-json').textContent())).toEqual(reports['paper-agent.pcgym']);
  await page.screenshot({ path: resolve(out, 'observation-light.png') });
  const exportPath = resolve(out, 'exported-observation.json');
  await rm(exportPath, { force: true });
  await app.evaluate(({ session }, exportPath) => session.defaultSession.once('will-download', (_, item) => item.setSavePath(exportPath)), exportPath);
  await frame.getByRole('button', { name: 'Export observation', exact: true }).click();
  await expect.poll(async () => {
    try { return JSON.parse(await readFile(exportPath, 'utf8')); } catch { return null; }
  }, { timeout: 15000 }).toEqual(reports['paper-agent.pcgym']);
  checks.push('all four configured-interpreter probes, table/grid, requirements, observation JSON and actual file export');
  expect((await post(frame, { target: targets[0], name: 'paper-agent' })).status).toBe(400);
  expect((await post(frame, { target: 'arbitrary' })).status).toBeGreaterThanOrEqual(400);
  checks.push('transport rejects caller injection and unknown methods');
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_disable', name: 'control-lab' }));
  await expect.poll(async () => (await state()).apps.find(item => item.name === 'control-lab').enabled).toBe(false);
  await frame.getByRole('button', { name: 'Back', exact: true }).click();
  await frame.getByRole('button', { name: 'Control', exact: true }).click();
  await frame.getByRole('button', { name: 'Check: Control', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('App is disabled');
  await expect(frame.getByRole('table', { name: 'Software', exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(out, 'disabled-error-light.png') });
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_enable', name: 'control-lab' }));
  await expect.poll(async () => (await state()).apps.find(item => item.name === 'control-lab').enabled).toBe(true);
  await frame.getByRole('button', { name: 'Retry: Control', exact: true }).click();
  await expect(frame.getByRole('table', { name: 'Software', exact: true })).toBeVisible();
  await expect(frame.getByRole('alert')).toHaveCount(0);
  checks.push('disabled App error clears old observation and Retry recovers after enabling');
  await setAppearance(page, 'dark');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  await expect(frame.getByRole('button', { name: '观察记录', exact: true })).toBeVisible();
  await expect.poll(async () => frame.locator('html').evaluate(el => el.style.colorScheme)).toBe('dark');
  await frame.getByRole('button', { name: '软件', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(480, 600); window.setSize(720, 788); });
  await expect.poll(() => frame.locator('html').evaluate(el => el.clientWidth)).toBeLessThan(581);
  expect(await frame.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(frame.getByRole('columnheader', { name: '版本', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'software-dark-narrow-zh.png') });
  checks.push('live language/theme, narrow layout and visible software versions');
  await app.evaluate(({ BrowserWindow, Menu }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 900); Menu.getApplicationMenu().getMenuItemById('locale-en').click(); });
  const control = await open('control-lab');
  await control.locator('summary').filter({ hasText: 'Engine availability' }).click();
  const trigger = control.getByRole('button', { name: 'Environment', exact: true });
  await trigger.click();
  const dialog = control.getByRole('dialog', { name: 'Environments', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'PC-Gym', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Control', exact: true }).click();
  await dialog.getByRole('button', { name: 'Check: Control', exact: true }).click();
  await expect(dialog.getByRole('table', { name: 'Software', exact: true })).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: resolve(out, 'control-inspector.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect((await post(control, { target: 'paper-agent.pcgym' })).status).toBeGreaterThanOrEqual(400);
  checks.push('actual Control Lab task inspector, scoped methods, Escape and focus return');
  // The task can inspect its own method; cross-App scopes are refused by the Host.
  const paper = await open('paper-agent');
  const own = await post(paper, { target: 'paper-agent.pcgym' });
  expect(own.status, own.text).toBe(200);
  expect((await post(paper, { target: 'control-lab.python-control' })).status).toBeGreaterThanOrEqual(400);
  checks.push('actual Paper App origin can inspect PC-Gym and cannot inspect Control');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ checks, errors, scope: 'development Electron with actual configured software metadata; no scientific execution' }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
