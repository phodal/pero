// Real Desktop navigation: session ownership stays in Host, Apps stay in its catalog.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppShortcut, clickAppOpen, openCatalogApp, pressNewChat, clickSessionRow, clickSessionSearch, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/sessions-apps');
await mkdir(out, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), 'pero-sessions-apps-'));
const journal = resolve(temp, 'sessions.jsonl');
const settings = resolve(temp, 'settings.json');
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), `--session-capture=${resolve(temp, 'acp-sessions.jsonl')}`] }]));
await writeFile(settings, JSON.stringify({ chat_agent: 'fixture', workbench: { appearance: 'light' } }));
const events = [];
for (const [id, text] of [['model-review', 'Review model assumptions'], ['assay-reading', 'Read assay results']]) {
  for (const [kind, content, data] of [['session_created', '', { agent: 'fixture', workspace: root }], ['user_message', text, {}], ['turn_finished', '', { stopReason: 'end_turn' }]]) events.push({ version: 1, kind, request_id: null, thread_id: id, text: content, data });
}
await writeFile(journal, events.map(event => JSON.stringify(event)).join('\n') + '\n');
const name = 'library-sample';
const appRoot = resolve(temp, 'apps', name);
await mkdir(resolve(appRoot, 'dist'), { recursive: true });
await writeFile(resolve(appRoot, '.installation.json'), '{"enabled":true}');
await writeFile(resolve(appRoot, 'app.json'), JSON.stringify({ schemaVersion: 1, name, version: '1.0.0', displayName: 'Library sample', description: 'A local App used to verify navigation.', contributes: { panels: [{ id: 'main', title: 'Sample', entry: 'dist/index.html' }] } }));
await writeFile(resolve(appRoot, 'dist/index.html'), `<html><body><h1>Library sample</h1><input aria-label="Retained draft"><script>parent.postMessage({type:'pero:app:ready'},'*')</script></body></html>`);
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: journal, PERO_APPS_ROOT: resolve(temp, 'apps'), PERO_AGENTS_FILE: agents, PERO_BUILTIN_APPS: 'data,compute,environments,notebook,paper-agent,insights,connectors', PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
let desktop, page;
const errors = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const shot = async filename => { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); await page.screenshot({ path: resolve(out, filename) }); };
try {
  desktop = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.some(app => app.name === name)).toBe(true);
  await expect.poll(async () => (await state()).projectControls['sidebar:actions']?.width).toBeGreaterThan(0);
  expect((await state()).projectControls['sidebar:new']).toBeUndefined();
  const expectedShortcuts = ['apps', 'sessions', 'projects', 'terminal', 'connectors', 'paper-agent', 'notebook'];
  const storeApps = ['compute', 'data', 'environments', name];
  const relevantApps = new Set([...expectedShortcuts, ...storeApps]);
  const expectShortcuts = () => expect.poll(async () => Object.keys((await state()).sidebarButtonBounds || {})
    .filter(name => relevantApps.has(name)).sort()).toEqual([...expectedShortcuts].sort());
  const projectRows = snapshot => Object.entries(snapshot.projectControls)
    .filter(([key]) => key.startsWith('sidebar:open:')).map(([, bounds]) => bounds);
  await expectShortcuts();
  await expect.poll(async () => projectRows(await state()).length).toBeGreaterThan(0);
  const expanded = await state();
  const shortcuts = expanded.sidebarButtonBounds;
  expect(shortcuts.projects.y).toBeLessThan(shortcuts['paper-agent'].y);
  for (const row of projectRows(expanded)) expect(row.y + row.height).toBeLessThan(shortcuts['paper-agent'].y);
  expect(shortcuts['paper-agent'].y).toBeLessThan(shortcuts.notebook.y);
  expect(shortcuts.notebook.y).toBeLessThan(shortcuts.apps.y);
  expect(shortcuts.apps.y).toBeLessThan(shortcuts.terminal.y);
  await clickAppShortcut(page, 'projects');
  await expect.poll(async () => projectRows(await state()).length).toBe(0);
  await expectShortcuts();
  await shot('projects-collapsed-light.png');
  await clickAppShortcut(page, 'projects');
  await expect.poll(async () => projectRows(await state()).length).toBeGreaterThan(0);
  await shot('projects-light.png');
  await clickAppShortcut(page, 'sessions');
  await expect.poll(async () => Object.keys((await state()).sessionRowBounds || {}).sort()).toEqual(['assay-reading', 'model-review']);
  await clickSessionRow(page, 'model-review');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'conversation', value: 'model-review' });
  // Clicking the workspace name only folds its sessions; the conversation stays active.
  const firstRow=Object.values((await state()).sessionRowBounds).sort((a,b)=>a.y-b.y)[0];
  const groupName={x:firstRow.x+80,y:firstRow.y-16};
  await page.mouse.click(groupName.x,groupName.y);
  await expect.poll(async()=>Object.keys((await state()).sessionRowBounds||{})).toEqual([]);
  expect((await state()).activeContent).toEqual({kind:'conversation',value:'model-review'});
  expect((await state()).navigation).toBe(0);
  await page.mouse.click(groupName.x,groupName.y);
  await expect.poll(async()=>Object.keys((await state()).sessionRowBounds||{}).length).toBe(2);
  await shot('sessions-light.png');
  await clickSessionSearch(page);
  await page.keyboard.type('assay');
  await expect.poll(async () => Object.keys((await state()).sessionRowBounds || {})).toEqual(['assay-reading']);
  await shot('sessions-filtered.png');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => Object.keys((await state()).sessionRowBounds || {}).length).toBe(2);
  await openCatalogApp(page, name);
  const frame = page.frameLocator(`iframe[title="${name}"]`);
  await expect(frame.getByRole('heading', { name: 'Library sample' })).toBeVisible();
  await frame.getByRole('textbox', { name: 'Retained draft' }).fill('keep this draft');
  const appChatDraft = 'Keep this App chat draft';
  await frame.locator('body').evaluate((_body, text) => parent.postMessage({ type: 'pero:app:chat', text }, '*'), appChatDraft);
  await expect.poll(async () => (await state()).appChatOpen).toBe(true);
  await expect.poll(async () => (await state()).composer).toBe(appChatDraft);
  await expect.poll(async () => (await state()).floatingChatExpanded).toBe(true);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.click(viewport.width - 56, viewport.height - 558);
  await expect.poll(async () => (await state()).floatingChat).toBe(false);
  const beforeDockNew = await state();
  const oldDockChat = beforeDockNew.chats[beforeDockNew.activeChat];
  expect(beforeDockNew.scope).toEqual({ app: name, panel: 'main' });
  await expect.poll(async () => (await state()).chatNewButtonBounds?.width ?? 0).toBeGreaterThan(0);
  const bounds = (await state()).chatNewButtonBounds;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect.poll(async () => {
    const current = await state();
    const selected = current.chats[current.activeChat];
    return { id: selected?.id, scope: current.scope, composer: current.composer,
      content: current.activeContent, focused: current.composerFocused };
  }).toEqual({ id: expect.not.stringMatching(oldDockChat.id),
    scope: { app: name, panel: 'main' }, composer: '',
    content: { kind: 'app', value: { name, panel: 'main' } }, focused: true });
  const afterDockNew = await state();
  const savedChat = afterDockNew.chats.find(chat => chat.id === oldDockChat.id);
  expect(savedChat?.messages).toEqual(oldDockChat.messages);
  expect(afterDockNew.chats[afterDockNew.activeChat].messages).toEqual([]);
  await shot('app-chat-new.png');
  expect((await state()).sessionRowBounds).toEqual({});
  await clickAppShortcut(page, 'sessions');
  await clickSessionRow(page, 'assay-reading');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'conversation', value: 'assay-reading' });
  await openCatalogApp(page, name);
  await expect(frame.getByRole('textbox', { name: 'Retained draft' })).toHaveValue('keep this draft');
  await clickAppShortcut(page, 'apps');
  await expect.poll(async () => Object.keys((await state()).appOpenButtonBounds || {}).sort()).toEqual([...storeApps].sort());
  await expectShortcuts();
  await shot('apps-light.png');
  await clickAppOpen(page, name);
  await expect(frame.getByRole('textbox', { name: 'Retained draft' })).toHaveValue('keep this draft');
  const chatCount = (await state()).chats.length;
  await pressNewChat(page);
  await expect.poll(async () => (await state()).navigation).toBe(0);
  await expect.poll(async () => (await state()).chats.length).toBe(chatCount + 1);
  await setAppearance(page, 'dark');
  await shot('sessions-dark.png');
  await clickAppShortcut(page, 'apps');
  await shot('apps-dark.png');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await shot('apps-narrow.png');
  await clickAppShortcut(page, 'sessions');
  await shot('sessions-narrow.png');
  expect(errors).toEqual([]);
  const saved = await readFile(journal, 'utf8');
  for (const id of ['model-review', 'assay-reading']) expect(saved).toContain(id);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, checks: ['dedicated session list', 'real session selection', 'workspace name folds in place', 'session search', 'Paper and Notebook stay visible when Projects folds', 'Data, Compute and Environments are in the App Store', 'App grid opens real local panel', 'App ChatDock creates a focused scoped draft without leaving the App', 'App draft retained across Sessions navigation', 'new chat within Sessions', 'light/dark and narrow window', 'Host journal preserved'], errors }, null, 2));
  await rm(resolve(out, 'failure.png'), { force: true });
  console.log('Sessions / Apps navigation passed.');
} catch (error) {
  if (page) { await shot('failure.png').catch(() => {}); console.error(await state().catch(() => ({}))); }
  throw error;
} finally {
  if (desktop) await desktop.close();
  await rm(temp, { recursive: true, force: true });
}
