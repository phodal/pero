// Development Product with real Virtual Cell and a scripted ACP Agent.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/virtual-cell-product-chat');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-virtual-cell-product-test-')));
await mkdir(output, { recursive: true });
// Stage a development Product from the current build, avoiding stale packaged assets.
const distribution = resolve(temp, 'distribution');
await mkdir(resolve(distribution, 'desktop/dist'), { recursive: true });
await mkdir(resolve(distribution, 'bin'), { recursive: true });
for (const binary of ['pero-host', 'pero-computer']) {
  const name = process.platform === 'win32' ? `${binary}.exe` : binary;
  await cp(resolve(root, 'target/debug', name), resolve(distribution, 'bin', name));
}
await cp(resolve(root, 'web/dist'), resolve(distribution, 'web/chat'), { recursive: true });
await mkdir(resolve(distribution, 'apps/virtual-cell'), { recursive: true });
for (const entry of ['app.json', 'dist', 'backend', 'examples', 'evidence', 'licenses']) {
  await cp(resolve(root, 'apps/virtual-cell', entry), resolve(distribution, 'apps/virtual-cell', entry), { recursive: true });
}
await build({ entryPoints: { product: resolve(root, 'desktop/src/main/product.ts'), 'product-preload': resolve(root, 'desktop/src/product/preload.ts') },
  outdir: resolve(distribution, 'desktop/dist'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const script = await build({ entryPoints: [resolve(root, 'desktop/src/product/shell.ts')], bundle: true, platform: 'browser', format: 'iife', write: false });
const style = await readFile(resolve(root, 'desktop/src/product/shell.css'), 'utf8');
await writeFile(resolve(distribution, 'desktop/dist/product.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body><script>${script.outputFiles[0].text}</script></body></html>`);
await writeFile(resolve(distribution, 'package.json'), JSON.stringify({ main: 'desktop/dist/product.cjs' }));
await writeFile(resolve(distribution, 'product.json'), JSON.stringify({ schemaVersion: 1, id: 'com.openpero.virtualcellchat', name: 'Virtual Cell Chat', version: '0.2.0', shell: 'app', apps: ['virtual-cell'], entry: { app: 'virtual-cell', panel: 'main' }, python: 'system', chat: true }));
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
  const panel = page.locator('#product-chat');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/compact/);
  await expect.poll(async () => (await state()).scope).toEqual({ app: 'virtual-cell', panel: 'main' });
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.insertText('Review setup');
  await expect.poll(async () => (await state()).composer).toBe('Review setup');
  const before = await state();
  const thread = before.chats[before.activeChat].id;
  await frame.getByRole('button', { name: 'Discuss context', exact: true }).click();
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  expect((await state()).chats[(await state()).activeChat].messages).toHaveLength(0);
  await page.screenshot({ path: resolve(output, 'light.png') });
  await expect.poll(async () => (await state()).contextPreviewBounds[0]?.bounds?.width || 0).toBeGreaterThan(0);
  let preview = (await state()).contextPreviewBounds[0].bounds;
  const canvas = await chat.locator('canvas:not([role="textbox"])').boundingBox();
  await page.mouse.click(canvas.x + preview.x / 2, canvas.y + preview.y + preview.height / 2);
  await expect.poll(async () => (await state()).attachments.length).toBe(0);
  await frame.getByRole('button', { name: 'Discuss context', exact: true }).click();
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  await expect.poll(async () => (await state()).contextPreviewBounds[0]?.bounds?.width || 0).toBeGreaterThan(0);
  preview = (await state()).contextPreviewBounds[0].bounds;
  await page.mouse.click(canvas.x + preview.x + preview.width / 2, canvas.y + preview.y + preview.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await expect.poll(async () => (await state()).dark).toBe(true);
  await chat.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: resolve(output, 'dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  await expect(panel).toBeVisible();
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  await expect.poll(async () => (await state()).chats[(await state()).activeChat].id).toBe(thread);
  await page.screenshot({ path: resolve(output, 'narrow.png') });
  await panel.getByRole('button', { name: 'Close chat', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(frame.getByLabel('Duration (s)', { exact: true })).toHaveValue('12');
  await page.locator('#product-chat-toggle').click();
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await state()).chats[(await state()).activeChat].id).toBe(thread);
  await expect.poll(async () => (await state()).composer).toContain('Review setup');
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  const bounds = await chat.locator('canvas:not([role="textbox"])').boundingBox();
  expect(bounds).not.toBeNull();
  await chat.locator('canvas:not([role="textbox"])').click({ position: { x: 120, y: bounds.height - 24 } });
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.press('Enter');
  await expect(panel).not.toHaveClass(/compact/);
  await expect.poll(async () => (await state()).chats[(await state()).activeChat].messages.some(message => message.role === 'assistant' && message.text.includes('中文流式回复')), { timeout: 30000 }).toBe(true);
  expect(errors).toEqual([]);
  const result = { checks: ['built Virtual Cell Chat Product uses a compact floating conversation; input and frozen context survive close, reopen and narrow layout', 'manual submission receives scripted ACP fixture reply'], errors, realModel: false };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png') });
  throw error;
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}
