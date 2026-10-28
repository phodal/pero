// Developer preview with its own durable profile; closing the window ends this process.
import { _electron as electron, expect } from '@playwright/test';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const profile = resolve(root, 'target/apps-preview');
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_LOCALE: 'zh-CN' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
const app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-en').click());
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).locale)).toBe('en');
  await page.mouse.click(80, 409);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).appsLoading)).toBe(false);
  await page.evaluate(() => new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
  // The preview opens the first enabled App through its actual catalog control.
  const enabled = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps[0]?.enabled);
  if (enabled) {
    await page.mouse.click(1305, 110);
    await expect(page.frameLocator('iframe').getByRole('tab', { name: 'Cells & perturbations' })).toBeVisible({ timeout: 20000 });
  }
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  console.log('Pero App preview is open. Profile: target/apps-preview. Close the window to stop.');
  await app.waitForEvent('close', { timeout: 0 });
} catch (error) {
  await app.close();
  throw error;
}
