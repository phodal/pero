// Real Desktop → Rust Host → bundled Go harness. No model request until prompted.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-builtin-'));
const out = resolve(root, 'test-results/builtin-harness');
await mkdir(out, { recursive: true });
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
const started = performance.now();
const app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {});
  await expect.poll(async () => (await state()).connected, { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await state()).agents?.[0]?.id).toBe('pero');
  await page.waitForFunction(() => !document.getElementById('loading'));
  const hostReadyMs = performance.now() - started;
  const preparation = performance.now();
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).chats?.[0]?.state, { timeout: 15000 }).toBe('idle');
  const sessionReadyMs = performance.now() - preparation;
  expect((await state()).chats[0].agent).toBe('pero');
  expect((await state()).chats[0].messages).toHaveLength(0);
  await page.screenshot({ path: resolve(out, 'ready.png') });
  let reply;
  if (process.env.DEEPSEEK_REAL_API === '1') {
    await page.mouse.click(800, await page.evaluate(() => innerHeight - 75));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.insertText', { text: 'Reply exactly PERO_HARNESS_OK. Do not use tools or modify files.' });
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).chats[0].messages.filter(m => m.role === 'assistant').map(m => m.text).join(''), { timeout: 90000 }).toBe('PERO_HARNESS_OK');
    reply = 'PERO_HARNESS_OK';
    await expect.poll(async () => (await state()).chats[0].state).toBe('idle');
    await page.screenshot({ path: resolve(out, 'reply.png') });
  }
  await setAppearance(page, 'light');
  await page.screenshot({ path: resolve(out, 'light.png') });
  await setAppearance(page, 'dark');
  await page.screenshot({ path: resolve(out, 'dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1000);
  await page.waitForFunction(() => document.querySelector('canvas')?.width === Math.round(innerWidth * devicePixelRatio));
  await page.screenshot({ path: resolve(out, 'narrow.png') });
  expect(errors).toEqual([]);
  const result = { agent: 'pero', hostReadyMs, sessionReadyMs, reply, errors };
  await writeFile(resolve(out, reply ? 'real-result.json' : 'readiness-result.json'), JSON.stringify(result, null, 2));
  console.log(result);
} finally { await app.close(); }
