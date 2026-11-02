// Fresh profiles browse local projects before connecting a Cloud account.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-local-start-'));
const out = resolve(root, 'test-results/local-project-start');
await mkdir(out, { recursive: true });
const settings = resolve(temp, 'settings.json');
await writeFile(settings, JSON.stringify({ locale: 'zh-CN', workbench: { appearance: 'light' } }));
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }]));
let app, page;
const errors = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const capture = async name => { await frame(); await page.screenshot({ path: resolve(out, `${name}.png`) }); };
async function launch() {
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
    PERO_HISTORY_PATH: resolve(temp, 'history'), PERO_LOCALE: 'zh-CN', PERO_AGENTS_FILE: agents };
  for (const key of ['PERO_CLOUD_URL', 'PERO_CLIENT_TOKEN', 'PERO_OPERATOR_TOKEN', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow(); await focusPage(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).localExecution?.setup && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await frame();
}
try {
  await launch();
  expect((await state()).localExecution.setup.onboarding_complete).toBe(false);
  expect((await state()).remote.state.configured).toBe(false);
  await capture('01-fresh-local-projects');
  // Open the local workspace from the visible Project list.
  await page.mouse.click(100, 100); await frame();
  await page.mouse.click(await page.evaluate(() => innerWidth - 35), 151);
  await expect.poll(async () => (await state()).selectedProject).toBe(`workspace:${root}`);
  await expect.poll(async () => (await state()).localRoadmap.data.items.length).toBeGreaterThan(0);
  expect((await state()).localRoadmap.show_cloud).toBe(false);
  expect((await state()).projectTab).toBe('overview');
  const tasks = (await state()).projectControls['tab:nav.tasks'];
  await page.mouse.click(tasks.x + tasks.width / 2, tasks.y + tasks.height / 2);
  await expect.poll(async () => (await state()).projectTab).toBe('tasks');
  await capture('02-local-roadmap');
  await clickAppShortcut(page, 'account');
  await capture('03-account-settings');
  await page.keyboard.press('Escape');
  await setAppearance(page, 'dark');
  await capture('04-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
  await capture('05-narrow-dark');
  await app.close(); app = undefined;
  await launch();
  expect((await state()).localExecution.setup.onboarding_complete).toBe(false);
  expect((await state()).remote.state.configured).toBe(false);
  await capture('06-restart-local');
  expect(errors).toEqual([]);
  console.log('Passed: fresh/restarted local projects, offline ROADMAP, account entry, dark/narrow; no login required.');
} catch (error) {
  if (page) { await capture('failure'); await writeFile(resolve(out, 'failure-state.json'), JSON.stringify(await state(), null, 2)); }
  throw error;
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
