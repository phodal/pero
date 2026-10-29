// Existing Desktop profile: new builtin discovery must not reset installed Apps.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const profile = await mkdtemp(resolve(tmpdir(), 'pero-app-discovery-'));
const out = resolve(root, 'test-results/app-discovery');
await mkdir(out, { recursive: true });
const installed = resolve(profile, 'apps'), original = resolve(root, 'apps/virtual-cell');
await mkdir(installed);
await cp(original, resolve(installed, 'virtual-cell'), { recursive: true, filter: path => !relative(original, path).split(sep).some(part => ['node_modules', '.venv', '__pycache__', '.git'].includes(part)) });
await writeFile(resolve(installed, 'virtual-cell/.installation.json'), '{"enabled":false}');
await writeFile(resolve(installed, '.builtins-seeded'), '1\n');
await mkdir(resolve(profile, 'app-data/virtual-cell'), { recursive: true });
await writeFile(resolve(profile, 'app-data/virtual-cell/draft.txt'), 'retained research');
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const launch = () => electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
let app;
const errors = [];
async function catalog() {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.length ?? 0)).toBeGreaterThan(0);
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 76));
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).appsLoading)).toBe(false);
  return page;
}
try {
  app = await launch();
  let page = await catalog();
  const entries = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps);
  expect(entries.map(app => [app.name, app.enabled])).toEqual([['paper-agent', true], ['virtual-cell', false]]);
  expect(await readFile(resolve(installed, 'virtual-cell/.installation.json'), 'utf8')).toBe('{"enabled":false}');
  expect(await readFile(resolve(profile, 'app-data/virtual-cell/draft.txt'), 'utf8')).toBe('retained research');
  await page.screenshot({ path: resolve(out, 'legacy-profile-discovered.png') });
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_uninstall', name: 'paper-agent' }));
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps.map(app => app.name))).toEqual(['virtual-cell']);
  await app.close(); app = undefined;
  app = await launch(); page = await catalog();
  expect(await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps.map(app => [app.name, app.enabled]))).toEqual([['virtual-cell', false]]);
  await page.screenshot({ path: resolve(out, 'removal-retained.png') });
  expect(errors).toEqual([]);
  const result = { checks: ['legacy profile discovers new builtin at startup', 'disabled App and domain data retained', 'explicit uninstall retained after refresh and restart'], errors };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (app) await (await app.firstWindow()).screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
