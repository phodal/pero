// Real Electron, the standalone Chat Wasm and a bounded ACP fixture; no model login.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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
await writeFile(join(domain, 'dist/index.html'), '<!doctype html><style>html{height:100%}body{min-height:100%}</style><h1>Experiment</h1><label>Notes <input></label><button>Discuss selection</button><script src="index.js"></script>');
const fixtureScript = await build({ stdin: { contents: `import {AppSurface, installAppUseBridge} from './packages/app-sdk/src/app-use.ts';
  installAppUseBridge(new AppSurface());
  parent.postMessage({type:'pero:app:ready'},'*');
  document.querySelector('button').onclick=()=>parent.postMessage({type:'pero:app:chat',text:'Selected experiment'},'*');`, resolveDir: root }, bundle: true, format: 'iife', write: false });
await writeFile(join(domain, 'dist/index.js'), fixtureScript.outputFiles[0].text);
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
const nativeCapture = process.env.PERO_TEST_HEADED === '1';
try {
  app = await electron.launch({ requiresNativeWindow: nativeCapture, args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), distribution], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const domainFrame = page.frameLocator('iframe[title="fixture"]');
  await expect(domainFrame.getByRole('heading', { name: 'Experiment' })).toBeVisible();
  await expect(page.locator('#product-chat')).toBeHidden();
  await domainFrame.getByLabel('Notes').fill('Retained App state');
  await page.locator('#product-chat-toggle').click();
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
  expect(await page.locator('#product-chat').getAttribute('data-pero-app-chat-overlay')).toBe('');
  await expect(page.locator('#pero-app-surface')).toBeVisible();
  const appUseStatus = () => page.evaluate(async () => (await window.peroAppUse({ scope: { app: 'fixture', panel: 'main' }, request: { action: 'status' } })).value);
  await expect.poll(async () => (await appUseStatus()).capturable).toBe(false);
  await page.screenshot({ path: join(output, 'compact-light.png') });
  expect((await state()).chats[(await state()).activeChat].agent).toBe('codex');
  expect((await state()).chats.flatMap(value => value.messages).length).toBe(0);
  // Complex input needs room for the real Composer, not a clipped iframe.
  await page.keyboard.insertText('\nSecond line\nThird line');
  await expect.poll(async () => (await state()).composer).toContain('Third line');
  await expect(page.getByRole('button', { name: 'Hide messages' })).toBeVisible();
  await domainFrame.locator('body').evaluate(() => parent.postMessage({type:'pero:app:chat',options:{message:'Selected experiment',mode:'replace'}},'*'));
  await expect.poll(async () => (await state()).composer).toBe('Selected experiment');
  await page.getByRole('button', { name: 'Hide messages' }).click();
  await expect(page.getByRole('button', { name: 'Show messages' })).toBeVisible();
  await domainFrame.locator('body').evaluate(() => parent.postMessage({type:'pero:app:chat',options:{message:'Reset for completion',mode:'replace'}},'*'));
  await expect.poll(async () => (await state()).composer).toBe('Reset for completion');
  await chat.locator('canvas:not([role="textbox"])').click({position:{x:140,y:24}});
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText('/');
  await expect.poll(async () => (await state()).completion.open).toBe(true);
  await expect(page.getByRole('button', { name: 'Hide messages' })).toBeVisible();
  await page.keyboard.press('Escape');
  await domainFrame.locator('body').evaluate(() => parent.postMessage({type:'pero:app:chat',options:{message:'Reset for wrap',mode:'replace'}},'*'));
  await expect.poll(async () => (await state()).composer).toBe('Reset for wrap');
  await page.getByRole('button', { name: 'Hide messages' }).click();
  await domainFrame.locator('body').evaluate(() => parent.postMessage({type:'pero:app:chat',options:{message:'Selected experiment',mode:'replace'}},'*'));
  await expect.poll(async () => (await state()).composer).toBe('Selected experiment');
  await chat.locator('canvas:not([role="textbox"])').click({position:{x:140,y:24}});
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.insertText(' including detailed notes about the current selection and the associated experiment, its conditions, and the next steps');
  await expect(page.getByRole('button', { name: 'Hide messages' })).toBeVisible();
  await domainFrame.locator('body').evaluate(() => parent.postMessage({type:'pero:app:chat',options:{message:'Selected experiment',mode:'replace'}},'*'));
  await expect.poll(async () => (await state()).composer).toBe('Selected experiment');
  checks.push('multiline, wrapped input and completion expand the compact composer without losing the draft');
  await page.keyboard.insertText(' typed');
  await expect.poll(async () => (await state()).composer).toBe('Selected experiment typed');
  await page.keyboard.press('Enter');
  await expect(page.locator('#product-chat header button').first()).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await state()).chats[0]?.state, { timeout: 15000 }).toBe('idle');
  expect((await state()).chats[0].messages.some(message => message.role === 'assistant' && message.text.includes('中文流式回复'))).toBe(true);
  expect((await state()).chats[0].usage).toMatchObject({ context_used: 5000, context_capacity: 20000, cost: { amount: 0.02, currency: 'USD' } });
  checks.push('cross-origin Chat, Host ACP reply, App compose does not send, real keyboard input');
  await chat.locator('canvas:not([role="textbox"])').click({ position: { x: 180, y: 105 } });
  await expect.poll(async () => (await state()).expandedTools.length).toBe(1);
  await chat.locator('canvas:not([role="textbox"])').click({ position: { x: 180, y: 105 } });
  await expect.poll(async () => (await state()).expandedTools.length).toBe(0);
  const fill = async text => {
    await domainFrame.locator('body').evaluate((_, text) => parent.postMessage({ type: 'pero:app:chat', text }, '*'), text);
    await expect.poll(async () => (await state()).composer).toBe(text);
  };
  await fill('wait');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('running');
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.locator('#product-chat')).toBeHidden();
  await expect.poll(async () => (await appUseStatus()).capturable).toBe(true);
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('running');
  await expect(page.locator('#product-chat-toggle')).toContainText('Thinking');
  await expect(domainFrame.getByLabel('Notes')).toHaveValue('Retained App state');
  await page.locator('#product-chat-toggle').click();
  const runningMessages = (await state()).chats[0].messages.length;
  await page.evaluate(() => window.product.sessionCommand({ action: 'list_agents' }));
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('running');
  expect((await state()).chats[0].messages.length).toBe(runningMessages);
  await page.evaluate(thread_id => window.product.sessionCommand({ action: 'cancel', thread_id }), (await state()).chats[0].id);
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('idle');
  checks.push('tool disclosure and Host cancellation after minimizing a running conversation');
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
  const requestSlot = rect => domainFrame.locator('body').evaluate((_, rect) => new Promise(resolve => {
    const id = 'product-chat-test-slot';
    const listener = event => {
      if (event.source !== parent || event.data?.type !== 'pero:app:chat-slot-result' || event.data.id !== id) return;
      window.removeEventListener('message', listener); resolve(event.data.active);
    };
    window.addEventListener('message', listener);
    parent.postMessage({ type: 'pero:app:chat-slot', id, rect }, '*');
  }), rect);
  const previousChatBounds = await page.locator('#product-chat').boundingBox();
  for (const rect of [
    { x: 80, y: 130, width: 319, height: 300 },
    { x: 80, y: 130, width: 360, height: 239 },
    { x: -1, y: 130, width: 360, height: 300 },
    { x: 9000, y: 130, width: 360, height: 300 },
  ]) {
    expect(await requestSlot(rect)).toBe(false);
    await expect(page.locator('#product-chat header')).toBeVisible();
    expect(await page.locator('#product-chat').boundingBox()).toEqual(previousChatBounds);
  }
  const malformedReplies = await domainFrame.locator('body').evaluate(async () => {
    let replies = 0;
    const listener = event => { if (event.data?.type === 'pero:app:chat-slot-result' && event.data.id === 'malformed') replies++; };
    window.addEventListener('message', listener);
    parent.postMessage({ type:'pero:app:chat-slot', id:'malformed', rect:{x:0,y:0,width:NaN,height:300} }, '*');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.removeEventListener('message', listener);
    return replies;
  });
  expect(malformedReplies).toBe(0);
  await page.evaluate(async () => {
    const data = { type:'pero:app:chat-slot', id:'intruder', rect:{x:80,y:130,width:360,height:300} };
    const managed = document.querySelector('iframe[title="fixture"]');
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data }));
    window.dispatchEvent(new MessageEvent('message', { source: managed.contentWindow, origin: 'https://attacker.invalid', data }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator('#product-chat header')).toBeVisible();
  expect(await page.locator('#product-chat').boundingBox()).toEqual(previousChatBounds);
  expect(await requestSlot({ x: 80, y: 130, width: 360, height: 300 })).toBe(true);
  await expect(page.locator('#product-chat header')).toBeHidden();
  await expect(page.locator('#product-chat-toggle')).toBeHidden();
  await expect.poll(async () => Math.round((await page.locator('#product-chat').boundingBox()).width)).toBe(360);
  expect((await state()).composer).toBe('Keep this draft');
  expect((await state()).chats[(await state()).activeChat].id).toBe(before.chats[0].id);
  await page.screenshot({ path: join(output, 'embedded.png') });
  await page.getByRole('combobox', { name: 'Switch App' }).selectOption('other');
  await expect.poll(async () => (await state()).scope?.app).toBe('other');
  await expect(page.locator('#product-chat header')).toBeVisible();
  await page.getByRole('combobox', { name: 'Switch App' }).selectOption('fixture');
  await expect.poll(async () => (await state()).scope?.app).toBe('fixture');
  await expect(page.locator('#product-chat header')).toBeHidden();
  await expect.poll(async () => (await state()).composer).toBe('Keep this draft');
  expect(await requestSlot(null)).toBe(false);
  await expect(page.locator('#product-chat header')).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator('#product-chat').boundingBox()).width)).toBe(Math.round(previousChatBounds.width));
  expect((await state()).composer).toBe('Keep this draft');
  checks.push('embedded slot moves the same Chat surface, restores across App switches and preserves its draft when released');
  checks.push('slot rejects too small, out-of-bounds and foreign-source requests');
  if (nativeCapture) {
    const priorAttachments = (await state()).attachments.length;
    await page.getByRole('button', { name: 'Capture to chat' }).click();
    // This fixture does not advertise image input; the text annotation still
    // arrives and the UI reports the unsupported image without losing the draft.
    await expect.poll(async () => (await state()).attachments.length).toBe(priorAttachments + 1);
    expect((await state()).error).toContain('does not support images');
    expect((await state()).composer).toContain('Keep this draft');
    await expect(page.locator('#product-chat')).toBeVisible();
    await expect.poll(async () => (await appUseStatus()).capturable).toBe(false);
    const evidence = join(temp, 'profile/app-use-evidence');
    const png = (await readdir(evidence)).find(file => file.endsWith('.png'));
    expect(png).toBeTruthy();
    await cp(join(evidence, png), join(output, 'capture.png'));
    checks.push('capture temporarily hides the floating Chat, preserves its draft and restores the overlay');
  }
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await expect.poll(async () => (await state()).dark).toBe(true);
  await page.screenshot({ path: join(output, 'dark.png') });
  await app.evaluate(({ Menu, BrowserWindow }) => { Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click(); BrowserWindow.getAllWindows()[0].setSize(800, 700); });
  await expect.poll(async () => (await state()).locale).toBe('zh-CN');
  await expect(page.locator('#pero-app-surface')).toBeVisible();
  await expect(page.locator('#product-chat')).toBeVisible();
  await expect(domainFrame.getByLabel('Notes')).toHaveValue('Retained App state');
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
