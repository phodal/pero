// Developer preview with its own durable profile; closing the window ends this process.
import { _electron as electron, expect } from '@playwright/test';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const requested = process.argv.indexOf('--app');
const name = requested >= 0 ? process.argv[requested + 1] : 'virtual-cell';
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name || '')) throw new Error('Choose a valid App name');
const profile = resolve(root, name === 'virtual-cell' ? 'target/apps-preview' : `target/apps-preview-${name}`);
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_LOCALE: 'zh-CN' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
const app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-en').click());
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).locale)).toBe('en');
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 76));
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).appsLoading)).toBe(false);
  await page.evaluate(() => new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
  // The preview opens the first enabled App through its actual catalog control.
  const index = await page.evaluate(name => JSON.parse(window.peroDiagnostics.snapshot()).apps.findIndex(app => app.name === name && app.enabled), name);
  if (index >= 0) {
    await page.mouse.click(1305, 110 + index * 79);
    await expect(page.locator(`iframe[title="${name}"]`)).toBeVisible({ timeout: 20000 });
  }
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  console.log(`Pero ${name} preview is open. Profile: ${profile}. Close the window to stop.`);
  await app.waitForEvent('close', { timeout: 0 });
} catch (error) {
  await app.close();
  throw error;
}
