// Development Product with real Virtual Cell and a scripted ACP Agent.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
if (!process.env.PERO_PRODUCT_TEST_ROOT) throw new Error('Set PERO_PRODUCT_TEST_ROOT to a built virtual-cell-chat development Product');
const distribution = resolve(process.env.PERO_PRODUCT_TEST_ROOT);
const output = resolve(root, 'test-results/virtual-cell-product-chat');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-virtual-cell-product-test-')));
await mkdir(output, { recursive: true });
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Virtual Cell ACP fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), '--composer'] }]));
await mkdir(resolve(temp, 'profile'), { recursive: true });
const settings = resolve(temp, 'profile/runtime-settings.json');
await writeFile(settings, JSON.stringify({ chat_agent: 'fixture' }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
try {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), distribution], env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  const frame = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(frame.getByRole('tab', { name: 'Reactions & simulation', exact: true })).toBeVisible({ timeout: 30000 });
  await frame.getByRole('tab', { name: 'Reactions & simulation', exact: true }).click();
  await frame.getByLabel('Duration (s)', { exact: true }).fill('12');
  await expect.poll(() => page.frames().some(value => value.url().startsWith('pero://chat/'))).toBe(true);
  const chat = page.frames().find(value => value.url().startsWith('pero://chat/'));
  await chat.waitForFunction(() => window.peroChatDiagnostics && JSON.parse(window.peroChatDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  const state = () => chat.evaluate(() => JSON.parse(window.peroChatDiagnostics.snapshot()));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, temp);
  await page.evaluate(() => window.product.sessionCommand({ action: 'choose_workspace' }));
  await expect.poll(async () => (await state()).workspace).toBe(temp);
  await frame.getByRole('button', { name: 'Open chat', exact: true }).click();
  const slot = frame.locator('[data-pero-chat-slot]');
  await expect(slot).toHaveAttribute('data-mounted', 'true', { timeout: 20000 });
  await expect.poll(async () => (await state()).scope).toEqual({ app: 'virtual-cell', panel: 'main' });
  const box = await slot.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 100);
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.insertText('Review the reaction setup');
  await expect.poll(async () => (await state()).composer).toBe('Review the reaction setup');
  const before = await state();
  const thread = before.chats[before.activeChat].id;
  await frame.getByRole('button', { name: 'Discuss context', exact: true }).click();
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  expect((await state()).chats[(await state()).activeChat].messages).toHaveLength(0);
  await page.screenshot({ path: resolve(output, 'light.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await expect.poll(async () => (await state()).dark).toBe(true);
  await chat.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: resolve(output, 'dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  await expect(slot).toHaveAttribute('data-mounted', 'true');
  await expect.poll(async () => (await state()).chats[(await state()).activeChat].id).toBe(thread);
  await page.screenshot({ path: resolve(output, 'narrow.png') });
  await frame.getByRole('button', { name: 'Close chat', exact: true }).click();
  await expect(slot).toHaveCount(0);
  await expect(page.locator('#product-chat')).toBeHidden();
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  await frame.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(slot).toHaveAttribute('data-mounted', 'true');
  await expect.poll(async () => (await state()).chats[(await state()).activeChat].id).toBe(thread);
  await expect.poll(async () => (await state()).composer).toContain('Review the reaction setup');
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  const restored = await slot.boundingBox();
  await page.mouse.click(restored.x + restored.width / 2, restored.y + restored.height - 100);
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[(await state()).activeChat].messages.some(message => message.role === 'assistant' && message.text.includes('中文流式回复')), { timeout: 30000 }).toBe(true);
  expect(errors).toEqual([]);
  const result = { checks: ['built Virtual Cell Chat Product embeds the existing scoped conversation; input and frozen context survive close, reopen and narrow layout', 'manual submission receives scripted ACP fixture reply'], errors, realModel: false };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png') });
  throw error;
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}
