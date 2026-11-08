// Fresh profiles browse local projects before connecting a Cloud account.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { clickAppShortcut, openSettings, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-local-start-')));
const out = resolve(root, 'test-results/local-project-start');
await mkdir(out, { recursive: true });
const settings = resolve(temp, 'settings.json');
const otherWorkspace = resolve(temp, 'another-workspace');
await mkdir(otherWorkspace);
await writeFile(resolve(otherWorkspace, 'ROADMAP.md'), '- [ ] Another workspace task\n');
await writeFile(settings, JSON.stringify({ locale: 'zh-CN', workbench: {
  appearance: 'light', projects: [{ workspace: otherWorkspace, project_id: 'fixture' }],
} }));
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
  await clickAppShortcut(page, 'projects');
  await capture('01-fresh-local-projects');
  const workspace = (await state()).projectControls[`open:workspace:${root}`];
  await page.mouse.click(workspace.x + workspace.width / 2, workspace.y + workspace.height / 2);
  await expect.poll(async () => (await state()).selectedProject).toBe(`workspace:${root}`);
  await expect.poll(async () => (await state()).localRoadmap.data.items.length).toBeGreaterThan(0);
  expect((await state()).localRoadmap.show_cloud).toBe(false);
  expect((await state()).projectTab).toBe('overview');
  expect((await state()).projectControls['tab:research.linked']).toBeUndefined();
  await capture('02-workspace-overview');
  const tasks = (await state()).projectControls['view-tasks'];
  await page.mouse.click(tasks.x + tasks.width / 2, tasks.y + tasks.height / 2);
  await expect.poll(async () => (await state()).projectTab).toBe('tasks');
  await capture('02-local-roadmap');
  const switcher = (await state()).projectControls['project-switcher'];
  await page.mouse.click(switcher.x + switcher.width / 2, switcher.y + switcher.height / 2);
  await capture('02-project-switcher');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).selectedProject).toBe(`workspace:${otherWorkspace}`);
  expect((await state()).projectTab).toBe('overview');
  expect((await state()).activeTabBounds).toBeUndefined();
  await expect.poll(async () => (await state()).localRoadmap.data?.items.map(item => item.title))
    .toEqual(['Another workspace task']);
  const settingsTab = (await state()).projectControls['tab:settings.title'];
  await page.mouse.click(settingsTab.x + settingsTab.width / 2, settingsTab.y + settingsTab.height / 2);
  await expect.poll(async () => (await state()).projectTab).toBe('settings');
  await frame();
  expect((await state()).projectControls['tab:settings.title'].y).toBe(settingsTab.y);
  await capture('02-project-settings');
  await openSettings(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).settingsOpen).toBe(true);
  await expect.poll(async () => (await state()).settings.section).toBe('connector.title');
  await capture('03-account-settings');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state()).settingsOpen).toBe(false);
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
  console.log('Passed: fresh/restarted local projects, offline ROADMAP, keyboard project switching, account entry, dark/narrow.');
} catch (error) {
  if (page) { await capture('failure'); await writeFile(resolve(out, 'failure-state.json'), JSON.stringify(await state(), null, 2)); }
  throw error;
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
