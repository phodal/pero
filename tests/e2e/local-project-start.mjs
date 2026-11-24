// Fresh profiles browse local projects before connecting a Cloud account.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { clickAppShortcut, openSettings, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-local-start-')));
const out = resolve(root, 'test-results/local-project-start');
await mkdir(out, { recursive: true });
const settings = resolve(temp, 'settings.json');
const otherWorkspace = resolve(temp, 'another-workspace');
const missingWorkspace = resolve(temp, 'missing-workspace');
const removedWorkspace = resolve(temp, 'removed-workspace');
const replacement = resolve(temp, 'replacement');
const history = resolve(temp, 'history');
const removedKey = 'research:removed-project';
await mkdir(replacement);
await mkdir(otherWorkspace);
await writeFile(resolve(otherWorkspace, 'ROADMAP.md'), '- [ ] Another workspace task\n');
await writeFile(settings, JSON.stringify({ locale: 'zh-CN', workbench: {
  appearance: 'light', projects: [{ workspace: otherWorkspace, project_id: 'fixture' }, { workspace: missingWorkspace, project_id: 'missing' }],
  research_projects: [{ id: 'removed-project', title: 'Removed fixture', goal: '', workspace: removedWorkspace, resources: [] }],
} }));
await writeFile(history, [
  ['session_created', '', { agent: 'fixture', workspace: removedWorkspace, projectAgent: { project_id: 'removed-project', label: 'Primary' } }],
  ['user_message', 'Retained project history', {}],
  ['turn_finished', 'EndTurn', { stopReason: 'end_turn' }],
].map(([kind, text, data]) => JSON.stringify({ version: 1, kind, text, thread_id: 'retained-thread', data })).join('\n') + '\n');
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }]));
let app, page;
const errors = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const capture = async name => { await frame(); await page.screenshot({ path: resolve(out, `${name}.png`) }); };
async function launch() {
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
    PERO_HISTORY_PATH: history, PERO_LOCALE: 'zh-CN', PERO_AGENTS_FILE: agents };
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
  async function clickControl(key, options) {
    let bounds;
    await expect.poll(async () => {
      bounds = (await state()).projectControls[key];
      return bounds?.width || 0;
    }).toBeGreaterThan(0);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, options);
  }
  async function waitForDeletionDialog() {
    let bounds;
    await expect.poll(async () => {
      bounds = (await state()).projectControls['delete-project:confirm'];
      return bounds?.width || 0;
    }).toBeGreaterThan(0);
    // The dialog's slide transform moves the hit target after it is laid out.
    const clip = { x: Math.floor(bounds.x - 15), y: Math.floor(bounds.y - 50),
      width: Math.ceil(bounds.width + 30), height: Math.ceil(bounds.height + 62) };
    let previous = await page.screenshot({ clip });
    await expect.poll(async () => {
      const current = await page.screenshot({ clip });
      const settled = current.equals(previous);
      previous = current;
      return settled;
    }).toBe(true);
  }
  await clickControl(`sidebar:open:workspace:${root}`);
  await expect.poll(async () => (await state()).selectedProject).toMatch(/^research:/);
  const first = (await state()).selectedProject;
  await clickAppShortcut(page, 'projects');
  await expect.poll(async () => (await state()).projectControls[`sidebar:open:${first}`]?.width || 0).toBe(0);
  expect((await state()).selectedProject).toBe(first);
  await clickAppShortcut(page, 'projects');
  await clickControl(`sidebar:open:workspace:${otherWorkspace}`);
  await expect.poll(async () => (await state()).preferences.research_projects.find(p => p.workspace === otherWorkspace)?.id).toBeTruthy();
  const otherKey = `research:${(await state()).preferences.research_projects.find(p => p.workspace === otherWorkspace).id}`;
  await expect.poll(async () => (await state()).projectControls['agent:conversation']?.width || 0).toBeGreaterThan(0);
  if (!((await state()).projectControls['agent:context']?.width > 0)) await clickControl('agent:materials');
  await clickControl('tab:nav.tasks');
  await expect.poll(async () => (await state()).localRoadmap.data?.items.map(item => item.title))
    .toEqual(['Another workspace task']);
  await capture('02-local-roadmap');
  await clickControl(`sidebar:open:${first}`);
  await expect.poll(async () => (await state()).selectedProject).toBe(first);
  await clickControl(`sidebar:open:workspace:${missingWorkspace}`);
  await expect.poll(async () => (await state()).projectControls['repair-directory']?.width || 0).toBeGreaterThan(0);
  await expect.poll(async () => {
    const { composerBounds, projectControls } = await state();
    const input = composerBounds.input;
    const pane = projectControls['agent:conversation'];
    return input?.height > 0 && pane?.height > 0 && pane.y + pane.height - input.y - input.height < 110;
  }).toBe(true);
  await capture('07-empty-project-composer');
  const missingKey = (await state()).selectedProject;
  await clickControl(`sidebar:open:${first}`);
  await expect.poll(async () => (await state()).projectControls['repair-directory']?.width || 0).toBe(0);
  await clickControl(`sidebar:open:${removedKey}`);
  await expect.poll(async () => (await state()).projectControls['repair-directory']?.width || 0).toBeGreaterThan(0);
  if (!((await state()).projectControls['agent:context']?.width > 0)) await clickControl('agent:materials');
  await clickControl('agent:views-overflow');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await waitForDeletionDialog();
  await capture('08-delete-project-confirmation');
  await clickControl('delete-project:cancel');
  await expect.poll(async () => (await state()).projectControls['delete-project:confirm']?.width || 0).toBe(0);
  expect((await state()).selectedProject).toBe(removedKey);
  await clickControl(`sidebar:open:${removedKey}`, { button: 'right' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForDeletionDialog();
  await clickControl('delete-project:confirm');
  await expect.poll(async () => (await state()).projects.some(p => p.key === removedKey || p.workspace === removedWorkspace)).toBe(false);
  await expect.poll(async () => (await state()).selectedProject).not.toBe(removedKey);
  await clickControl(`sidebar:open:${otherKey}`, { button: 'right' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForDeletionDialog();
  await clickControl('delete-project:confirm');
  await expect.poll(async () => (await state()).projects.some(p => p.key === otherKey || p.workspace === otherWorkspace)).toBe(false);
  expect(await readFile(resolve(otherWorkspace, 'ROADMAP.md'), 'utf8')).toBe('- [ ] Another workspace task\n');
  await clickAppShortcut(page, 'sessions');
  let retained;
  await expect.poll(async () => {
    retained = (await state()).sessionRowBounds['retained-thread'];
    return retained?.width || 0;
  }).toBeGreaterThan(0);
  await page.mouse.click(retained.x + retained.width / 2, retained.y + retained.height / 2);
  await expect.poll(async () => {
    const s = await state();
    return s.chats[s.activeChat]?.messages.map(message => message.text);
  }).toContain('Retained project history');
  await clickControl(`sidebar:open:${missingKey}`);
  await clickControl('repair-directory');
  await clickControl('research-workspace');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(replacement);
  await clickControl('save');
  await expect.poll(async () => (await state()).preferences.research_projects.find(p => `research:${p.id}` === missingKey)?.workspace).toBe(replacement);
  await expect.poll(async () => (await state()).projectControls['repair-directory']?.width || 0).toBe(0);
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
  expect((await state()).projects.some(p => [removedWorkspace, otherWorkspace].includes(p.workspace))).toBe(false);
  await capture('06-restart-local');
  expect(errors).toEqual([]);
  console.log('Passed: local projects, bottom composer, directory repair, project deletion and cancellation, retained history and files, restart, account entry, dark/narrow.');
} catch (error) {
  if (page) { await capture('failure'); await writeFile(resolve(out, 'failure-state.json'), JSON.stringify(await state(), null, 2)); }
  throw error;
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
