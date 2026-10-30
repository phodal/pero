// Managed Virtual Cell, the shared floating App Chat and a scripted ACP Agent.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setAppearance } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/virtual-cell-embedded-chat');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-virtual-cell-chat-'));
await mkdir(out, { recursive: true });
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Virtual Cell ACP fixture',
  command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), '--composer'] }]));
await writeFile(resolve(temp, 'settings.json'), JSON.stringify({ chat_agent: 'fixture' }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_LOCALE: 'en',
  PERO_APPS_ROOT: resolve(temp, 'apps'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
  PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_AGENTS_FILE: agents };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [], checks = [];
try {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'virtual-cell')).toBe(true);
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 60));
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await paint();
  const initial = await state();
  await page.mouse.click(1305, 76 + (initial.contentTabs.length ? 30 : 0) + 58 * initial.apps.findIndex(item => item.name === 'virtual-cell'));
  await expect.poll(async () => (await state()).activeApp?.name).toBe('virtual-cell');
  const frame = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(frame.getByRole('tab', { name: 'Reactions & simulation', exact: true })).toBeVisible({ timeout: 20000 });
  await frame.getByRole('tab', { name: 'Reactions & simulation', exact: true }).click();
  await frame.getByLabel('Duration (s)', { exact: true }).fill('12');
  const frameUrl = await page.locator('iframe[title="virtual-cell"]').getAttribute('src');
  await frame.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect.poll(async () => (await state()).floatingChat).toBe(true);
  await expect.poll(async () => (await state()).floatingChatExpanded).toBe(false);
  await expect.poll(async () => (await state()).scope).toEqual({ app: 'virtual-cell', panel: 'main' });
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.insertText('Review setup');
  await expect.poll(async () => (await state()).composer).toBe('Review setup');
  const before = await state();
  const thread = before.chats[before.activeChat].id;
  const messages = before.chats[before.activeChat].messages.length;
  await frame.getByRole('button', { name: 'Discuss context', exact: true }).click();
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  expect((await state()).chats[(await state()).activeChat].id).toBe(thread);
  expect((await state()).chats[(await state()).activeChat].messages.length).toBe(messages);
  await page.screenshot({ path: resolve(out, 'light.png') });
  await setAppearance(page, 'dark');
  await expect.poll(async () => (await state()).dark).toBe(true);
  await page.screenshot({ path: resolve(out, 'dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await expect.poll(async () => (await state()).floatingChat).toBe(true);
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  await page.screenshot({ path: resolve(out, 'narrow.png') });
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  // The compact surface is bottom-right; its last header icon minimizes Chat.
  await page.mouse.click(viewport.width - 30, viewport.height - 132);
  await expect.poll(async () => (await state()).appChatOpen).toBe(false);
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  expect(await page.locator('iframe[title="virtual-cell"]').getAttribute('src')).toBe(frameUrl);
  await frame.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect.poll(async () => (await state()).floatingChat).toBe(true);
  await expect.poll(async () => (await state()).chats[(await state()).activeChat].id).toBe(thread);
  await expect.poll(async () => (await state()).composer).toContain('Review setup');
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  expect((await state()).chats[(await state()).activeChat].messages.length).toBe(messages);
  checks.push('real Virtual Cell compact Chat, frozen context without send, retained session and App state, dark and narrow');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, realModel: false }, null, 2));
  console.log(JSON.stringify({ checks, errors, realModel: false }));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(out, 'failure.png') });
  throw error;
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}
