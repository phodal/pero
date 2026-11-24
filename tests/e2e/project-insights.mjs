// Electron Workbench and Rust Host with an isolated journal and scripted ACP.
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-project-insights-')));
const out = resolve(root, 'test-results/project-insights');
const workspace = resolve(temp, 'shared-checkout');
await Promise.all([mkdir(workspace), mkdir(out, { recursive: true })]);
const settings = resolve(temp, 'settings.json');
const history = resolve(temp, 'history.jsonl');
const agents = resolve(temp, 'agents.json');
const reply = resolve(temp, 'reply.json');
const projects = ['alpha', 'beta'].map(id => ({ id, title: `Project ${id}`, goal: `Goal for ${id}`, workspace, resources: [] }));
await writeFile(settings, JSON.stringify({ locale: 'en', workbench: { appearance: 'light', research_projects: projects } }));
const publication = title => JSON.stringify({ summary: `${title} with supporting project records.`, cards: [{ kind: 'change', title }] });
await writeFile(reply, publication('Generated Beta finding'));
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Scripted ACP', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), `--reply-file=${reply}`] }]));
const thread = (thread_id, metadata, request, response) => [
  ['session_created', '', { agent: 'fixture', workspace, ...metadata }],
  ['user_message', request, {}],
  ['session_update', '', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: response } }],
  ['turn_finished', 'EndTurn', { stopReason: 'end_turn' }],
].map(([kind, text, data]) => ({ version: 1, kind, text, thread_id, data }));
await writeFile(history, [
  ...thread('alpha-work', { projectAgent: { project_id: 'alpha', label: 'Alpha work' } }, 'Alpha-only source', 'Alpha activity'),
  ...thread('beta-work', { projectAgent: { project_id: 'beta', label: 'Beta work' } }, 'Beta-only source', 'Beta activity'),
  ...thread('ambiguous-work', {}, 'Unassigned shared-directory source', 'Unassigned activity'),
  ...thread('app:insights:old-alpha', { scope: { app: 'insights', panel: 'main' }, appBinding: {
    app: 'insights', requestId: 'old-alpha', agentId: 'fixture', prompt: 'Saved Alpha brief', insightsProjectId: 'alpha',
  } }, 'Saved Alpha brief', publication('Saved Alpha finding')),
  ...thread('app:insights:legacy', { scope: { app: 'insights', panel: 'main' }, appBinding: {
    app: 'insights', requestId: 'legacy', agentId: 'fixture', prompt: 'Legacy brief',
  } }, 'Legacy brief', publication('Unscoped legacy finding')),
].map(event => JSON.stringify(event)).join('\n') + '\n');
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: history, PERO_LOCALE: 'en', PERO_AGENTS_FILE: agents, PERO_ENV_FILE: resolve(temp, 'no-env'),
  PERO_BUILTIN_APPS: 'insights', PERO_REQUIRED_APPS: 'insights' };
for (const key of ['PERO_CLOUD_URL', 'PERO_CLIENT_TOKEN', 'PERO_OPERATOR_TOKEN']) delete env[key];
let app, page;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const brief = () => page.frameLocator('iframe[title="insights"]');
const savedSettings = async () => JSON.parse(await readFile(settings, 'utf8')).workbench;
async function launch() {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 980));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 120000 });
}
async function bounds(find) {
  let control;
  await expect.poll(async () => { control = find(await state()); return control?.width ?? 0; }).toBeGreaterThan(0);
  return control;
}
async function openProject(id) {
  const control = await bounds(state => state.projectControls[`sidebar:open:research:${id}`]);
  await page.mouse.click(control.x + control.width / 2, control.y + control.height / 2);
  await expect.poll(async () => (await state()).selectedProject).toBe(`research:${id}`);
  await expect(brief().getByRole('heading', { name: 'Work brief', exact: true })).toBeVisible();
  await expect(brief().locator('.pero-app-bar, .point-insights-split')).toHaveCount(0);
  expect(await brief().locator('main').evaluate(main => {
    const sample = document.createElement('span');
    sample.style.backgroundColor = 'var(--pero-surface)';
    main.append(sample);
    const surface = getComputedStyle(sample).backgroundColor;
    sample.remove();
    return [main, document.body, document.documentElement]
      .every(element => getComputedStyle(element).backgroundColor === surface);
  })).toBe(true);
}
async function drag(find, delta) {
  const control = await bounds(find);
  const x = control.x + control.width / 2;
  const y = control.y + control.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 8 });
  await page.mouse.up();
  return control;
}
try {
  await launch();
  await openProject('alpha');
  await expect(brief().getByRole('heading', { name: 'Saved Alpha finding' })).toBeVisible();
  expect((await state()).sidebarButtonBounds.insights).toBeUndefined();
  await page.screenshot({ path: resolve(out, 'alpha-overview.png') });

  const sidebar = state => state.sidebarButtonBounds.resize;
  const priorSidebar = await drag(sidebar, 75);
  await expect.poll(async () => (await bounds(sidebar)).x).toBeGreaterThan(priorSidebar.x + 50);
  await expect.poll(async () => (await savedSettings()).layout?.sidebar_width ?? 0).toBeGreaterThan(310);
  const inspector = state => state.projectControls['agent:splitter'];
  const priorInspector = await drag(inspector, -100);
  await expect.poll(async () => (await bounds(inspector)).x).toBeLessThan(priorInspector.x - 75);
  await expect(brief().getByRole('heading', { name: 'Saved Alpha finding' })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'resized-overview.png') });

  await openProject('beta');
  await expect(brief().getByRole('heading', { name: 'Saved Alpha finding' })).toHaveCount(0);
  await expect(brief().getByRole('heading', { name: 'Unscoped legacy finding' })).toHaveCount(0);
  await expect(brief().getByRole('button', { name: 'Generate brief', exact: true })).toBeEnabled();
  await page.screenshot({ path: resolve(out, 'beta-overview-empty.png') });
  expect(await readFile(history, 'utf8')).not.toContain('Generated Beta finding');
  await brief().getByRole('button', { name: 'Generate brief', exact: true }).click();
  await expect(brief().getByRole('heading', { name: 'Generated Beta finding' })).toBeVisible();
  const journal = (await readFile(history, 'utf8')).trim().split('\n').map(JSON.parse);
  const beta = journal.find(event => event.kind === 'session_created' && event.data.appBinding?.insightsProjectId === 'beta');
  expect(beta.data.workspace).toBe(workspace);
  expect(beta.data.appBinding.prompt).toContain('Beta-only source');
  expect(beta.data.appBinding.prompt).not.toMatch(/Alpha-only source|Unassigned shared-directory source|Unscoped legacy finding/);
  await app.close(); app = undefined;

  const preferences = JSON.parse(await readFile(settings, 'utf8'));
  preferences.workbench.appearance = 'dark';
  await writeFile(settings, JSON.stringify(preferences));
  await launch();
  await openProject('beta');
  await expect(brief().getByRole('heading', { name: 'Generated Beta finding' })).toBeVisible();
  await page.screenshot({ path: resolve(out, 'beta-overview-dark.png') });
  await openProject('alpha');
  await expect(brief().getByRole('heading', { name: 'Saved Alpha finding' })).toBeVisible();
  await expect(brief().getByRole('heading', { name: 'Generated Beta finding' })).toHaveCount(0);
  await brief().getByRole('button', { name: 'Discuss this brief' }).click();
  await expect.poll(async () => (await state()).composer.trim()).toBe('Discuss this brief@Work brief');
  console.log('Passed project-scoped generation, switching, restart recovery, discussion draft and pane resizing.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(out, 'failure.png') });
    console.error(await brief().locator('body').innerText({ timeout: 2000 }).catch(() => 'Insights frame unavailable'));
    const events = (await readFile(history, 'utf8')).trim().split('\n').map(JSON.parse);
    console.error(events.filter(event => event.thread_id?.startsWith('app:insights:insights-'))
      .map(({ kind, text }) => ({ kind, text })));
  }
  throw error;
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}
