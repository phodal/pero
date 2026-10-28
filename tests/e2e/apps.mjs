// Real Electron, real Host installation and real Virtual Cell Python computation.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/apps');
await mkdir(out, { recursive: true });
await rm(resolve(out, 'simulation.json'), { force: true });
const profile = await mkdtemp(resolve(tmpdir(), 'pero-apps-e2e-'));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_LOCALE: 'en', PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
const launch = () => electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
let app;
const errors = [];
const checks = [];
try {
  app = await launch();
  let page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Renderer:', message.text()); });
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.[0]?.name).toBe('virtual-cell');
  await page.mouse.click(80, 409);
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await page.screenshot({ path: resolve(out, 'catalog.png') });
  // GPUI buttons are canvas-rendered; select the catalog's Open button.
  await page.mouse.click(1305, 110);
  await expect.poll(async () => (await state()).activeApp?.name).toBe('virtual-cell');
  const frame = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(frame.getByRole('tab', { name: 'Cells & perturbations' })).toBeVisible({ timeout: 20000 });
  await expect(frame.getByText('660 / 660 Cells', { exact: false }).first()).toBeVisible();
  await expect(frame.getByText('stored raw.X', { exact: false }).first()).toBeVisible();
  expect(await frame.locator('body').evaluate(() => typeof window.pero)).toBe('undefined');
  checks.push('builtin installation, live frame, 660-cell atlas, no Electron bridge in App');
  await page.screenshot({ path: resolve(out, 'atlas.png') });
  await frame.getByRole('tab', { name: 'Reactions & simulation' }).click();
  await frame.getByLabel('Duration (s)', { exact: true }).fill('12');
  await expect(frame.getByText('Parameters changed · curves not updated')).toBeVisible();
  await frame.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(frame.getByText('Parameters changed · curves not updated')).toBeHidden();
  // Electron owns native downloads; choose a test output path instead of opening a Save dialog.
  await app.evaluate(({ session }, path) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path)), resolve(out, 'simulation.json'));
  await frame.getByRole('button', { name: 'Export simulation & parameters' }).click();
  await expect.poll(async () => {
    try { return JSON.parse(await readFile(resolve(out, 'simulation.json'), 'utf8')).duration; }
    catch { return null; }
  }).toBe(12);
  checks.push('edited reaction parameters, numerical simulation, exported JSON');
  await page.screenshot({ path: resolve(out, 'reaction.png') });
  await frame.getByRole('tab', { name: '3D cell', exact: true }).click();
  await expect(frame.locator('canvas').first()).toBeVisible();
  await page.screenshot({ path: resolve(out, 'volume.png') });
  checks.push('3D volume canvas');
  await frame.getByRole('tab', { name: 'Cells & perturbations' }).click();
  await frame.getByRole('button', { name: 'Load synthetic example', exact: true }).click();
  const compare = frame.getByRole('button', { name: 'Compare baselines and predictions', exact: true });
  await expect(compare).toBeEnabled();
  await compare.click();
  await expect(frame.locator('.vc-models tbody tr')).toHaveCount(3);
  expect(await frame.locator('.vc-models tbody tr td:first-child').allTextContents()).toEqual(['control', 'train_mean', 'additive']);
  await expect.poll(async () => frame.locator('body').evaluate(async () => (await (await fetch('/api/inputs')).json()).items.length)).toBe(1);
  await page.screenshot({ path: resolve(out, 'perturbation.png') });
  checks.push('real authenticated Python import, immutable input persistence, three baseline model results');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  await expect(frame.getByRole('tab', { name: '单细胞与扰动' })).toBeVisible();
  await page.mouse.click(64, await page.evaluate(() => innerHeight - 29));
  await expect.poll(async () => (await state()).dark).toBe(true);
  await expect.poll(async () => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await page.screenshot({ path: resolve(out, 'dark-zh.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await expect.poll(async () => page.locator('#pero-app-surface').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(832);
  expect(await frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(out, 'narrow.png') });
  checks.push('live zh/en, dark, narrow viewport');
  // Navigating away retains the document. Returning to it retains simulation edits.
  const originalFrame = await page.locator('iframe').getAttribute('src');
  await page.mouse.click(75, 307);
  await expect(page.locator('#pero-app-surface')).toBeHidden();
  await page.mouse.click(75, 409);
  await expect(page.locator('#pero-app-surface')).toBeVisible();
  expect(await page.locator('iframe').getAttribute('src')).toBe(originalFrame);
  await frame.getByRole('tab', { name: '反应与模拟' }).click();
  await expect(frame.getByLabel('时长 (s)', { exact: true })).toHaveValue('12');
  checks.push('navigation retains frame and edited state');
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_disable', name: 'virtual-cell' }));
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect.poll(async () => (await state()).apps[0].enabled).toBe(false);
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_open', name: 'virtual-cell', panel: 'main' }));
  await expect.poll(async () => (await state()).appError).toContain('Enable');
  await page.screenshot({ path: resolve(out, 'disabled-error.png') });
  checks.push('disabled App refuses open with recovery message');
  await app.close(); app = undefined;
  app = await launch(); page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps[0].enabled).toBe(false);
  checks.push('disable removes frame and survives Desktop restart');
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_enable', name: 'virtual-cell' }));
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu().getMenuItemById('locale-en').click();
    BrowserWindow.getAllWindows()[0].setSize(1488, 1086);
  });
  await expect.poll(async () => (await state()).locale).toBe('en');
  await page.mouse.click(80, 409);
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await page.evaluate(() => new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
  await page.mouse.click(1305, 110);
  const restored = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(restored.getByRole('tab', { name: 'Cells & perturbations' })).toBeVisible();
  await expect.poll(async () => restored.locator('body').evaluate(async () => (await (await fetch('/api/inputs')).json()).items.length)).toBe(1);
  checks.push('restart and re-enable retain real imported inputs');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: resolve(out, 'failure.png') });
    console.error('App failure state', await page.evaluate(() => window.peroDiagnostics?.snapshot()));
  }
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
