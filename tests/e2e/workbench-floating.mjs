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
  await page.mouse.click(width - 45, 14);
  await expect.poll(async () => (await state()).floatingChat).toBe(true);
  await expect.poll(() => page.locator('iframe[title="virtual-cell"]').getAttribute('data-pero-chat-covered')).toBe('true');
  await expect.poll(async () => (await state()).composer).toBe(appDraft);
  await screenshot('floating-light');
  await page.mouse.click(width - 250, height - 190);
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.insertText('Floating fixture question');
  await expect.poll(async () => (await state()).composer).toBe('Floating fixture question');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).floatingChatExpanded).toBe(true);
  await expect.poll(async () => (await turns()).length).toBe(2);
  await screenshot('floating-sent');
  await page.mouse.click(width - 45, 14);
  await expect.poll(async () => (await state()).floatingChat).toBe(false);
  await page.mouse.click(width - 45, 14);
  await expect.poll(async () => (await state()).floatingChat).toBe(true);
  await setAppearance(page, 'dark');
  await expect.poll(async () => (await state()).dark).toBe(true);
  await screenshot('floating-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1000);
  await expect(page.locator('iframe[title="virtual-cell"]')).toBeVisible();
  await expect.poll(async () => (await state()).floatingChat).toBe(true);
  await screenshot('floating-narrow');
  if (process.env.PERO_TEST_HEADED === '1') {
    const result = await frame.locator('body').evaluate(() => new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => reject(new Error('App capture timed out')), 30000);
      window.addEventListener('message', function receive(event) {
        if (event.source !== parent || event.data?.type !== 'pero:app:chat-result' || event.data.id !== id) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        event.data.ok ? resolve(event.data.value) : reject(new Error(event.data.error));
      });
      parent.postMessage({type:'pero:app:chat', id, options:{capture:true}}, '*');
    }));
    expect(result.references).toHaveLength(2);
    await expect.poll(() => page.locator('iframe[title="virtual-cell"]').getAttribute('data-pero-chat-covered')).toBe('true');
    checks.push('visible native App capture temporarily clears and restores floating Chat');
  }
  checks.push('floating composer input', 'submit expands transcript', 'light/dark and narrow retain App');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({checks, errors}));
} catch (error) { await page?.screenshot({path:resolve(out,'floating-failure.png')}); throw error; }
finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
