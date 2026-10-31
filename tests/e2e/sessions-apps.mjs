// Real Desktop navigation: session ownership stays in Host, Apps stay in its catalog.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppShortcut, clickAppOpen, clickNewChat, clickSessionRow, setAppearance } from './sidebar-controls.mjs';
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
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: journal, PERO_APPS_ROOT: resolve(temp, 'apps'), PERO_AGENTS_FILE: agents, PERO_BUILTIN_APPS: 'data,insights,connectors', PERO_LOCALE: 'en' };
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
  // Focus the search directly beneath the measured New chat control.
  const button = (await state()).newChatButtonBounds;
  await page.mouse.click(button.x - 90, button.y + button.height + 20);
  await page.keyboard.type('assay');
  await expect.poll(async () => Object.keys((await state()).sessionRowBounds || {})).toEqual(['assay-reading']);
  await shot('sessions-filtered.png');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => Object.keys((await state()).sessionRowBounds || {}).length).toBe(2);
  await clickAppShortcut(page, name);
  const frame = page.frameLocator(`iframe[title="${name}"]`);
  await expect(frame.getByRole('heading', { name: 'Library sample' })).toBeVisible();
  await frame.getByRole('textbox', { name: 'Retained draft' }).fill('keep this draft');
  expect((await state()).sessionRowBounds).toEqual({});
  await clickAppShortcut(page, 'sessions');
  await clickSessionRow(page, 'assay-reading');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'conversation', value: 'assay-reading' });
  await clickAppShortcut(page, name);
  await expect(frame.getByRole('textbox', { name: 'Retained draft' })).toHaveValue('keep this draft');
  await clickAppShortcut(page, 'apps');
  await expect.poll(async () => Object.keys((await state()).appOpenButtonBounds || {}).includes(name)).toBe(true);
  await expect.poll(async () => Object.keys((await state()).sidebarButtonBounds || {}).sort()).toEqual(['apps', 'sessions', 'terminal', 'connectors', 'data', 'insights', name].sort());
  const shortcuts=(await state()).sidebarButtonBounds;
  expect(shortcuts.apps.y).toBeLessThan(shortcuts.connectors.y);
  expect(shortcuts.terminal.y).toBeGreaterThan(shortcuts[name].y);
  await shot('apps-light.png');
  await clickAppOpen(page, name);
  await expect(frame.getByRole('textbox', { name: 'Retained draft' })).toHaveValue('keep this draft');
  await clickNewChat(page);
  await expect.poll(async () => (await state()).navigation).toBe(0);
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
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, checks: ['dedicated session list', 'real session selection', 'workspace name folds in place', 'session search', 'enabled Apps in sidebar', 'App grid opens real local panel', 'App draft retained across Sessions navigation', 'new chat within Sessions', 'light/dark and narrow window', 'Host journal preserved'], errors }, null, 2));
  await rm(resolve(out, 'failure.png'), { force: true });
  console.log('Sessions / Apps navigation passed.');
} catch (error) {
  if (page) { await shot('failure.png').catch(() => {}); console.error(await state().catch(() => ({}))); }
  throw error;
} finally {
  if (desktop) await desktop.close();
  await rm(temp, { recursive: true, force: true });
}
