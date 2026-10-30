// Real Electron, the standalone Chat Wasm and a bounded ACP fixture; no model login.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(join(tmpdir(), 'pero-product-chat-')));
const output = process.env.PERO_PRODUCT_CHAT_RESULTS || resolve(root, 'test-results/product-chat');
const distribution = join(temp, 'distribution');
await mkdir(output, { recursive: true });
await mkdir(join(distribution, 'desktop/dist'), { recursive: true });
await mkdir(join(distribution, 'bin'), { recursive: true });
const host = process.platform === 'win32' ? 'pero-host.exe' : 'pero-host';
await cp(process.env.PERO_TEST_HOST_BINARY || resolve(root, 'target/debug', host), join(distribution, 'bin', host));
const computer = process.platform === 'win32' ? 'pero-computer.exe' : 'pero-computer';
await cp(resolve(root, 'target/debug', computer), join(distribution, 'bin', computer));
await cp(resolve(root, 'web/dist'), join(distribution, 'web/chat'), { recursive: true });
await build({ entryPoints: { product: resolve(root, 'desktop/src/main/product.ts'), 'product-preload': resolve(root, 'desktop/src/product/preload.ts') },
  outdir: join(distribution, 'desktop/dist'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const script = await build({ entryPoints: [resolve(root, 'desktop/src/product/shell.ts')], bundle: true, platform: 'browser', format: 'iife', write: false });
const style = await readFile(resolve(root, 'desktop/src/product/shell.css'), 'utf8');
await writeFile(join(distribution, 'desktop/dist/product.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body><script>${script.outputFiles[0].text}</script></body></html>`);
await writeFile(join(distribution, 'package.json'), JSON.stringify({ main: 'desktop/dist/product.cjs' }));
await writeFile(join(distribution, 'product.json'), JSON.stringify({ schemaVersion: 1, id: 'com.openpero.chatfixture', name: 'Chat Fixture', version: '1.0.0', shell: 'app',
  apps: ['fixture', 'other'], entry: { app: 'fixture', panel: 'main' }, python: 'system', chat: true }));
const domain = join(distribution, 'apps/fixture');
await mkdir(join(domain, 'dist'), { recursive: true });
await writeFile(join(domain, 'app.json'), JSON.stringify({ schemaVersion: 1, name: 'fixture', version: '1.0.0', displayName: 'Fixture',
  contributes: { panels: [{ id: 'main', title: 'Fixture', entry: 'dist/index.html' }] } }));
await writeFile(join(domain, 'dist/index.html'), '<!doctype html><h1>Experiment</h1><label>Notes <input></label><button>Discuss selection</button><script src="index.js"></script>');
await writeFile(join(domain, 'dist/index.js'), "parent.postMessage({type:'pero:app:ready'},'*');document.querySelector('button').onclick=()=>parent.postMessage({type:'pero:app:chat',text:'Selected experiment'},'*');");
const other = join(distribution, 'apps/other');
await cp(domain, other, { recursive: true });
await writeFile(join(other, 'app.json'), JSON.stringify({ schemaVersion: 1, name: 'other', version: '1.0.0', displayName: 'Other',
  contributes: { panels: [{ id: 'main', title: 'Other', entry: 'dist/index.html' }] } }));
const agents = join(temp, 'agents.json');
await writeFile(agents, JSON.stringify(['codex', 'claude', 'copilot', 'grok'].map(id => ({ id, name: `ACP Chat fixture (${id})`, command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }))));
await mkdir(join(temp, 'profile'), { recursive: true });
const appearanceSettings = join(temp, 'profile', 'runtime-settings.json');
await writeFile(appearanceSettings, JSON.stringify({ chat_agent: 'codex' }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(temp, 'profile'), PERO_SETTINGS_PATH: appearanceSettings, PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const checks = [];
try {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), distribution], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const domainFrame = page.frameLocator('iframe[title="fixture"]');
  await expect(domainFrame.getByRole('heading', { name: 'Experiment' })).toBeVisible();
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(frame => frame.dataset.peroChat !== undefined));
  await expect.poll(() => page.frames().some(frame => frame.url().startsWith('pero://chat/'))).toBe(true);
  const chat = page.frames().find(frame => frame.url().startsWith('pero://chat/'));
  await chat.waitForFunction(() => window.peroChatDiagnostics && JSON.parse(window.peroChatDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  const state = () => chat.evaluate(() => JSON.parse(window.peroChatDiagnostics.snapshot()));
  await expect.poll(async () => (await state()).agents?.length || 0).toBeGreaterThan(0);
  if (process.platform === 'darwin') {
    await expect.poll(() => app.evaluate(({Menu}) => Menu.getApplicationMenu().getMenuItemById('computer-enable').checked)).toBe(false);
    await app.evaluate(({Menu}) => Menu.getApplicationMenu().getMenuItemById('computer-enable').click());
    await expect.poll(async () => JSON.parse(await readFile(appearanceSettings,'utf8')).computer_use?.enabled).toBe(true);
    await expect.poll(() => app.evaluate(({Menu}) => Menu.getApplicationMenu().getMenuItemById('computer-enable').checked)).toBe(true);
    await app.evaluate(({Menu}) => Menu.getApplicationMenu().getMenuItemById('computer-stop').click());
    await expect.poll(async () => JSON.parse(await readFile(appearanceSettings,'utf8')).computer_use?.enabled).toBe(false);
    expect(JSON.parse(await readFile(appearanceSettings,'utf8')).chat_agent).toBe('codex');
    checks.push('Computer Use menu persists enable/disable through Host and stops the staged native helper');
  }
  expect(await chat.evaluate(() => typeof window.product)).toBe('undefined');
  expect(await domainFrame.locator('body').evaluate(() => typeof window.product)).toBe('undefined');
  expect(await chat.evaluate(() => { try { return typeof parent.product; } catch { return 'cross-origin'; } })).toBe('cross-origin');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, temp);
  await page.evaluate(() => window.product.sessionCommand({ action: 'choose_workspace' }));
  await expect.poll(async () => (await state()).workspace).toBe(temp);
  await domainFrame.getByRole('button', { name: 'Discuss selection' }).click();
  await expect.poll(async () => (await state()).composer).toBe('Selected experiment');
  expect((await state()).chats[(await state()).activeChat].agent).toBe('codex');
  expect((await state()).chats.flatMap(value => value.messages).length).toBe(0);
  await page.keyboard.insertText(' typed');
  await expect.poll(async () => (await state()).composer).toBe('Selected experiment typed');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[0]?.state, { timeout: 15000 }).toBe('idle');
  expect((await state()).chats[0].messages.some(message => message.role === 'assistant' && message.text.includes('中文流式回复'))).toBe(true);
  expect((await state()).chats[0].usage).toMatchObject({ context_used: 5000, context_capacity: 20000, cost: { amount: 0.02, currency: 'USD' } });
  checks.push('cross-origin Chat, Host ACP reply, App compose does not send, real keyboard input');
  await chat.locator('canvas').click({ position: { x: 180, y: 105 } });
  await expect.poll(async () => (await state()).expandedTools.length).toBe(1);
  await chat.locator('canvas').click({ position: { x: 180, y: 105 } });
  await expect.poll(async () => (await state()).expandedTools.length).toBe(0);
  const fill = async text => {
    await domainFrame.locator('body').evaluate((_, text) => parent.postMessage({ type: 'pero:app:chat', text }, '*'), text);
    await expect.poll(async () => (await state()).composer).toBe(text);
  };
  await fill('wait');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('running');
  const runningMessages = (await state()).chats[0].messages.length;
  await page.evaluate(() => window.product.sessionCommand({ action: 'list_agents' }));
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('running');
  expect((await state()).chats[0].messages.length).toBe(runningMessages);
  const bounds = await chat.locator('canvas').boundingBox();
  await page.mouse.click(bounds.x + bounds.width - 42, bounds.y + bounds.height - 20);
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('idle');
  checks.push('tool disclosure and cancellation in the shared composer');
  await fill('Keep this draft');
  const before = await state();
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.locator('#product-chat')).toBeHidden();
  await page.getByRole('button', { name: 'Open chat' }).click();
  expect((await state()).composer).toBe('Keep this draft');
  expect((await state()).chats[0].id).toBe(before.chats[0].id);
  await page.getByRole('combobox', { name: 'Switch App' }).selectOption('other');
  await expect.poll(async () => (await state()).scope?.app).toBe('other');
  const otherFrame = page.frameLocator('iframe[title="other"]');
  await otherFrame.getByRole('button', { name: 'Discuss selection' }).click();
  await expect.poll(async () => (await state()).composer).toBe('Selected experiment');
  expect((await state()).chats[(await state()).activeChat].id).not.toBe(before.chats[0].id);
  await page.getByRole('combobox', { name: 'Switch App' }).selectOption('fixture');
  await expect.poll(async () => (await state()).composer).toBe('Keep this draft');
  await page.evaluate(() => window.product.sessionCommand({ action: 'list_agents' }));
  await expect.poll(async () => (await state()).composer).toBe('Keep this draft');
  expect((await state()).chats[(await state()).activeChat].id).toBe(before.chats[0].id);
  checks.push('App scope switches preserve separate drafts; replay preserves draft and running turn');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await expect.poll(async () => (await state()).dark).toBe(true);
  await page.screenshot({ path: join(output, 'dark.png') });
  await app.evaluate(({ Menu, BrowserWindow }) => { Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click(); BrowserWindow.getAllWindows()[0].setSize(800, 700); });
  await expect.poll(async () => (await state()).locale).toBe('zh-CN');
  await expect(page.locator('#pero-app-surface')).toBeHidden();
  await expect(page.locator('#product-chat')).toBeVisible();
  await page.screenshot({ path: join(output, 'narrow.png') });
  checks.push('retained iframe/draft, dark theme, live locale, narrow Chat');
  expect(errors).toEqual([]);
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, errors, state: await state() }, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    const chat = page.frames().find(frame => frame.url().startsWith('pero://chat/'));
    if (chat) await writeFile(join(output, 'failure-state.json'), await chat.evaluate(() => window.peroChatDiagnostics?.snapshot() || '{}'));
    await page.screenshot({ path: join(output, 'failure.png') });
  }
  throw error;
} finally {
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
