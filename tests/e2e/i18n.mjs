import { _electron as electron, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/i18n');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-i18n-'));
const settings = resolve(temp, 'runtime-settings.json');
await mkdir(output, { recursive: true });
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_LOCALE: 'zh-CN', PERO_SETTINGS_PATH: settings };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected);
  return page;
}
const state = page => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const selectLocale = locale => app.evaluate(({ Menu }, value) => Menu.getApplicationMenu().getMenuItemById(`locale-${value}`).click(), locale);
try {
  let page = await launch();
  expect((await state(page)).locale).toBe('zh-CN');
  expect((await state(page)).labels.tasks).toBe('任务');
  await page.screenshot({ path: resolve(output, 'zh-CN.png') });

  // Runtime state is not recreated when UI strings and native menus change.
  const before = await state(page);
  await selectLocale('en');
  await expect.poll(async () => (await state(page)).locale).toBe('en');
  await page.mouse.click(64, await page.evaluate(() => innerHeight - 30));
  await expect.poll(async () => (await state(page)).dark).toBe(true);
  await page.screenshot({ path: resolve(output, 'en-dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760));
  await page.waitForFunction(() => innerWidth === 1000);
  await page.screenshot({ path: resolve(output, 'en-narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  expect((await state(page)).labels.tasks).toBe('Tasks');
  expect((await state(page)).chats).toEqual(before.chats);
  expect((await state(page)).workspace).toBe(before.workspace);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(await page.title()).toBe('Pero · Workbench');
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('connection-message').label)).toBe('Send connection message');
  await page.screenshot({ path: resolve(output, 'en.png') });

  // The visible sidebar switch takes the same runtime-owned preference path.
  await page.mouse.click(28, await page.evaluate(() => innerHeight - 30));
  await expect.poll(async () => (await state(page)).locale).toBe('zh-CN');
  await selectLocale('en');
  await expect.poll(async () => (await state(page)).locale).toBe('en');

  // Echo payloads are user content: Chinese must remain byte-for-byte identical in English UI.
  await page.evaluate(() => window.pero.sendProbe({ id: 'i18n-content', text: '用户原文，不应翻译 🐈' }));
  await expect.poll(async () => (await state(page)).events.find(event => event.request_id === 'i18n-content')?.text).toBe('用户原文，不应翻译 🐈');
  await expect(page.evaluate(() => window.pero.setLocale('fr'))).rejects.toThrow();
  expect(JSON.parse(await readFile(settings, 'utf8')).locale).toBe('en');

  await app.close();
  page = await launch();
  expect((await state(page)).locale).toBe('en'); // Saved runtime preference beats system default.
  await selectLocale('zh-CN');
  await expect.poll(async () => (await state(page)).locale).toBe('zh-CN');
  expect((await state(page)).labels.tasks).toBe('任务');
  expect(await page.title()).toBe('Pero · 工作台');

  // Same WASM in a bridge-free window exercises the browser preview locale path.
  const previewReady = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }) => {
    const preview = new BrowserWindow({ width: 1488, height: 1086, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await preview.loadURL('pero://workbench/');
  });
  const preview = await previewReady;
  preview.on('pageerror', error => errors.push(error.message));
  await preview.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).ready);
  expect(await preview.evaluate(() => typeof window.pero)).toBe('undefined');
  await preview.evaluate(() => window.peroSetLocale('zh-CN'));
  await expect.poll(async () => (await state(preview)).locale).toBe('zh-CN');
  await preview.mouse.click(28, await preview.evaluate(() => innerHeight - 30));
  await expect.poll(async () => (await state(preview)).locale).toBe('en');
  expect((await state(preview)).labels.tasks).toBe('Tasks');
  expect(JSON.parse(await readFile(settings, 'utf8')).locale).toBe('zh-CN');
  await preview.close();
  expect(errors).toEqual([]);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ state: await state(page), errors, persistence: true }, null, 2));
  console.log('Passed: live locale switch, native menu/document language, untranslated user content, invalid locale rejection, runtime preference after restart, bridge-free browser preview.');
} catch (error) {
  const page = await app?.firstWindow();
  if (page) {
    console.error(await state(page), errors);
    await page.screenshot({ path: resolve(output, 'failure.png') });
  }
  throw error;
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}
