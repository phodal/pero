// Real Electron/GPUI content tabs and retained App frame; Agent replies use ACP fixture data.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setAppearance } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/workspace');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-workspace-e2e-'));
const capture = resolve(temp, 'prompts.jsonl');
const agents = resolve(temp, 'agents.json');
await mkdir(out, { recursive: true });
await rm(resolve(out, 'failure.png'), { force: true });
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Workspace ACP fixture',
  command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), '--composer', `--capture=${capture}`] }]));
await writeFile(resolve(temp, 'settings.json'), JSON.stringify({ chat_agent: 'fixture' }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_LOCALE: 'en',
  PERO_APPS_ROOT: resolve(temp, 'apps'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
  PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_AGENTS_FILE: agents };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const checks = [];
const errors = [];
let app;
let page;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const viewport = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const screenshot = name => page.screenshot({ path: resolve(out, `${name}.png`) });
const appItem = { kind: 'app', value: { name: 'virtual-cell', panel: 'main' } };
const turns = async () => {
  try { return (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

async function ready() {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await expect.poll(async () => (await state()).agents?.some(agent => agent.id === 'fixture')).toBe(true);
  await paint();
}

async function input(text) {
  const { width, height } = await viewport();
  await page.mouse.click(Math.min(950, width - 180), height - 55);
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.insertText', { text });
  await cdp.detach();
  await expect.poll(async () => (await state()).composer).toBe(text);
}

async function openAppFromCatalog() {
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'virtual-cell')).toBe(true);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await paint();
  const snapshot = await state();
  // Compact catalog rows start below the workspace tab strip.
  const row = snapshot.apps.findIndex(item => item.name === 'virtual-cell');
  await page.mouse.click(1305, 76 + (snapshot.contentTabs.length ? 30 : 0) + 58 * row);
  await expect.poll(async () => (await state()).activeContent).toEqual(appItem);
  const frame = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(frame.getByRole('tab', { name: 'Reactions & simulation', exact: true })).toBeVisible({ timeout: 20000 });
  return frame;
}

try {
  app = await launch();
  await ready();
  await setAppearance(page, 'light');
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).navigation).toBe(0);
  await expect.poll(async () => (await state()).chats.length).toBe(1);
  await paint();
  const { width, height } = await viewport();
  await expect.poll(async () => (await state()).chats[0].agent).toBe('fixture');
  // Establish a real Host-owned fixture session before testing that closing its
  // content tab leaves both the session and its unsent draft available.
  await input('Workspace fixture session');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[0].state, { timeout: 15000 }).toBe('idle');
  await expect.poll(async () => (await turns()).length).toBe(1);
  const original = (await state()).chats[0];
  const conversationItem = { kind: 'conversation', value: original.id };
  const draft = 'Keep this unsent workspace draft while reviewing the App.';
  await input(draft);
  await expect.poll(async () => (await state()).contentTabs).toEqual([conversationItem]);
  await screenshot('conversation-light');

  await page.mouse.click(80, (await viewport()).height - 60);
  await expect.poll(async () => (await state()).navigation).toBe(7);
  let frame = await openAppFromCatalog();
  await expect.poll(async () => (await state()).contentTabs).toEqual([conversationItem, appItem]);
  await frame.getByRole('tab', { name: 'Reactions & simulation', exact: true }).click();
  await frame.getByLabel('Duration (s)', { exact: true }).fill('12');
  const frameUrl = await page.locator('iframe[title="virtual-cell"]').getAttribute('src');
  const appDraft = 'Review the selected reaction parameters without running them.';
  // This is the existing App SDK compose transport from the managed App origin.
  await frame.locator('body').evaluate((_element, text) => parent.postMessage({ type: 'pero:app:chat', text }, '*'), appDraft);
  await expect.poll(async () => (await state()).appChatOpen).toBe(true);
  await expect.poll(async () => (await state()).composer).toBe(appDraft);
  await expect.poll(async () => (await state()).scope).toEqual({ app: 'virtual-cell', panel: 'main' });
  expect((await state()).chats.find(chat => chat.scope?.app === 'virtual-cell').messages).toHaveLength(0);
  expect(await turns()).toHaveLength(1);
  checks.push('App compose opens the shared chat and fills a scoped draft without sending a prompt');
  await screenshot('app-chat-light');

  // Compose focused the GPUI composer, so these exercise the actual root shortcut.
  await page.keyboard.press('Control+Tab');
  await expect.poll(async () => (await state()).activeContent).toEqual(conversationItem);
  await expect.poll(async () => (await state()).composer).toBe(draft);
  await expect(page.locator('#pero-app-surface')).toBeHidden();
  await expect(page.locator('iframe[title="virtual-cell"]')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(async () => (await state()).activeContent).toEqual(appItem);
  await expect.poll(async () => (await state()).composer).toBe(appDraft);
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  expect(await page.locator('iframe[title="virtual-cell"]').getAttribute('src')).toBe(frameUrl);
  checks.push('forward/reverse content switching restores separate drafts and retains the edited App document');

  const initialWidth = (await state()).chatPanelWidth;
  // Read the actual iframe slot; the GPUI resize handle starts immediately right of it.
  const surface = await page.locator('#pero-app-surface').boundingBox();
  expect(surface).not.toBeNull();
  const divider = surface.x + surface.width + 2;
  await page.mouse.move(divider, 300);
  await page.mouse.down();
  await page.mouse.move(divider - 84, 300, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await state()).chatPanelWidth).toBeGreaterThan(initialWidth + 60);
  await expect.poll(async () => (await state()).preferencesStatus).toBe('saved');
  const draggedWidth = (await state()).chatPanelWidth;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await state()).chatPanelWidth).toBe(draggedWidth + 20);
  await expect.poll(async () => (await state()).preferencesStatus).toBe('saved');
  const savedWidth = (await state()).chatPanelWidth;
  await expect(page.locator('#pero-app-surface')).toBeVisible();
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  checks.push('dragging the chat divider changes the runtime-owned preference and preserves App state');

  // Close the active tab using its measured bounds rather than a fixed width.
  await page.mouse.click(310, 24);
  await expect.poll(async () => (await state()).activeContent).toEqual(conversationItem);
  await page.mouse.click((await state()).activeTabBounds.right - 13, 14);
  await expect.poll(async () => (await state()).contentTabs).toEqual([appItem]);
  await expect.poll(async () => (await state()).activeContent).toEqual(appItem);
  const retained = (await state()).chats.find(chat => chat.id === original.id);
  expect(retained.state).toBe('idle');
  expect(retained.messages).toEqual(original.messages);
  // Filtering makes the retained session the sole recent row, independent of
  // the new App-scoped draft's position. These are the existing sidebar coordinates.
  await page.mouse.click(100, 76);
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.type(original.title);
  await expect.poll(async () => (await state()).sidebarSearch).toBe(original.title);
  await paint();
  await page.mouse.click(100, 130);
  await expect.poll(async () => (await state()).activeContent).toEqual(conversationItem);
  await expect.poll(async () => (await state()).composer).toBe(draft);
  await expect.poll(async () => (await state()).contentTabs).toEqual([appItem, conversationItem]);
  await page.mouse.click(100, 76);
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await state()).sidebarSearch).toBe('');
  await page.mouse.click(310, 24);
  await expect.poll(async () => (await state()).activeContent).toEqual(appItem);
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  checks.push('closing a content tab retains its Host session; reopening from the sidebar restores its draft');
  await screenshot('retained-app-light');
  await page.keyboard.press('Control+Tab');
  await expect.poll(async () => (await state()).activeContent).toEqual(conversationItem);
  await page.evaluate(id => window.pero.sessionCommand({ action: 'delete', thread_id: id }), original.id);
  await expect.poll(async () => (await state()).chats.some(chat => chat.id === original.id)).toBe(false);
  await expect.poll(async () => (await state()).contentTabs).toEqual([appItem]);
  await expect.poll(async () => (await state()).activeContent).toEqual(appItem);
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  checks.push('deleting a source conversation activates the adjacent App content');

  const savedSettings = await readFile(env.PERO_SETTINGS_PATH, 'utf8');
  await writeFile(env.PERO_SETTINGS_PATH, 'invalid');
  await page.evaluate(preferences => window.pero.sessionCommand({ method: 'settings.workbench', preferences }), (await state()).preferences);
  await expect.poll(async () => (await state()).error).toBe('error.preferences');
  await expect.poll(async () => (await page.locator('#pero-app-surface').boundingBox())?.y).toBeGreaterThan(48);
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  await screenshot('app-error-layout');
  await writeFile(env.PERO_SETTINGS_PATH, savedSettings);
  await setAppearance(page, 'dark');
  await expect.poll(async () => (await state()).error).toBeNull();
  checks.push('the App surface follows its actual content slot and leaves global errors visible');
  await expect.poll(async () => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await screenshot('workspace-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await expect(page.locator('#pero-app-surface')).toBeHidden();
  await expect(page.locator('iframe[title="virtual-cell"]')).toHaveCount(1);
  await screenshot('narrow-chat');
  await page.mouse.click((await viewport()).width - 80, 24);
  await expect.poll(async () => (await state()).appChatOpen).toBe(false);
  await expect(page.locator('#pero-app-surface')).toBeVisible();
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  expect(await frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect((await state()).chatPanelWidth).toBe(savedWidth);
  await screenshot('narrow-app');
  await page.mouse.click((await viewport()).width - 80, 24);
  await expect.poll(async () => (await state()).appChatOpen).toBe(true);
  await expect.poll(async () => (await state()).preferencesStatus).toBe('saved');
  checks.push('light/dark and narrow App/chat views retain state without overwriting the preferred chat width');

  await app.close(); app = undefined;
  app = await launch();
  await ready();
  await expect.poll(async () => (await state()).chatPanelWidth).toBe(savedWidth);
  expect((await state()).preferences.layout.chat_open).toBe(true);
  expect((await state()).contentTabs).toEqual([]);
  expect((await state()).activeContent).toBeNull();
  await page.mouse.click(80, (await viewport()).height - 60);
  await expect.poll(async () => (await state()).navigation).toBe(7);
  frame = await openAppFromCatalog();
  await expect(page.locator('#pero-app-surface')).toBeVisible();
  const restoredSurface = await page.locator('#pero-app-surface').boundingBox();
  expect(Math.abs((await viewport()).width - restoredSurface.x - restoredSurface.width - savedWidth)).toBeLessThanOrEqual(2);
  expect(await turns()).toHaveLength(1);
  await screenshot('restored-layout');
  checks.push('Desktop restart restores chat visibility/width through Host settings; content tabs are session-only');

  // Existing Host/App commands exercise catalog reconciliation and its visible recovery state.
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_disable', name: 'virtual-cell' }));
  await expect(page.locator('iframe[title="virtual-cell"]')).toHaveCount(0);
  await expect.poll(async () => (await state()).contentTabs.some(item => item.kind === 'app' && item.value.name === 'virtual-cell')).toBe(false);
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_open', name: 'virtual-cell', panel: 'main' }));
  await expect.poll(async () => (await state()).appError).toContain('Enable');
  await screenshot('disabled-app-error');
  await page.evaluate(() => window.pero.appsCommand({ action: 'apps_enable', name: 'virtual-cell' }));
  frame = await openAppFromCatalog();
  await expect(frame.getByRole('tab', { name: 'Reactions & simulation', exact: true })).toBeVisible();
  await screenshot('app-recovered');
  checks.push('disabling an App removes its content tab; the visible enable error recovers after re-enabling');
  await frame.getByRole('tab', { name: 'Reactions & simulation', exact: true }).click();
  await frame.getByLabel('Duration (s)', { exact: true }).fill('22');
  await page.mouse.click((await state()).activeTabBounds.right - 13, 14);
  await expect.poll(async () => (await state()).contentTabs).toEqual([]);
  await expect.poll(async () => (await state()).activeApp).toBeNull();
  await page.mouse.click(80, (await viewport()).height - 60);
  await expect.poll(async () => (await state()).activeContent).toBeNull();
  await expect(page.locator('#pero-app-surface')).toBeHidden();
  frame = await openAppFromCatalog();
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('22');
  checks.push('closing the final App tab returns to the library; explicit reopening retains its document');

  expect(errors).toEqual([]);
  const result = { passed: true, fixtureAgent: true, realModel: false, savedChatWidth: savedWidth, checks, errors, state: await state() };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ checks, errors, savedChatWidth: savedWidth }));
} catch (error) {
  const snapshot = page ? await state().catch(() => null) : null;
  if (page) await screenshot('failure').catch(() => {});
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: false, checks, errors, failure: error.message, state: snapshot }, null, 2));
  console.error('Workspace failure', { error: error.message, errors, state: snapshot });
  throw error;
} finally {
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
