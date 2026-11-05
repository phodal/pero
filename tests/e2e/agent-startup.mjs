// Real Electron → Host → Go Harness → builtin and failing optional MCP; no model prompt.
import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickNewChat, setAppearance, setSidebarLocale } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-agent-startup-'));
const out = resolve(root, 'test-results/agent-startup');
await mkdir(out, { recursive: true });
await copyFile(resolve(root, 'target/debug/pero-host'), resolve(temp, 'pero-host'));
const unavailable = createServer((_request, response) => response.writeHead(403).end());
await new Promise(done => unavailable.listen(0, '127.0.0.1', done));
const name = 'Unavailable research tools';
await writeFile(resolve(temp, 'settings.json'), JSON.stringify({ chat_agent: 'pero', local_mcp: { pero: {
  revision: 1, servers: [{ name, enabled: true, transport: { type: 'http', url: `http://127.0.0.1:${unavailable.address().port}/mcp` } }],
} } }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
  PERO_HOST_EXECUTABLE: resolve(temp, 'pero-host'),
  PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en',
  DEEPSEEK_API_KEY: 'synthetic-no-model-request', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1' };
delete env.PERO_AGENTS_FILE;
let app, page;
try {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {});
  const active = async () => { const s = await state(); return s.chats?.[s.activeChat]; };
  await expect.poll(async () => (await state()).connected, { timeout: 60000 }).toBe(true);
  await page.waitForFunction(() => !document.getElementById('loading'));
  await clickNewChat(page);
  await expect.poll(async () => (await active())?.state, { timeout: 10000 }).toBe('idle');
  await expect.poll(async () => (await active())?.mcp?.observable).toBe(true);
  const chat = await active();
  expect(chat.messages).toEqual([]);
  expect(chat.mcp.servers.find(server => server.server === name)?.status).toBe('error');
  for (const builtin of ['pero-connectors', 'pero-app-use'])
    expect(chat.mcp.servers.find(server => server.server === builtin)?.status).toBe('connected');
  expect(chat.mcp.servers.find(server => server.server === 'pero-connectors').tools).toEqual(['connectors_list', 'connectors_call']);
  for (const theme of ['light', 'dark']) {
    await setAppearance(page, theme);
    await page.screenshot({ path: resolve(out, `tools-unavailable-${theme}.png`) });
  }
  await setSidebarLocale(page, 'zh-CN');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1000);
  await page.waitForFunction(() => document.querySelector('canvas')?.width === Math.round(innerWidth * devicePixelRatio));
  await page.keyboard.press('Tab');
  await page.screenshot({ path: resolve(out, 'tools-unavailable-narrow-zh.png') });
  const settings = JSON.parse(await readFile(resolve(temp, 'settings.json'), 'utf8'));
  settings.local_mcp.pero = { revision: 2, servers: [] };
  await writeFile(resolve(temp, 'settings.json'), JSON.stringify(settings));
  await expect.poll(async () => (await state()).retryButtonBounds?.width ?? 0).toBeGreaterThan(0);
  const retry = (await state()).retryButtonBounds;
  await page.mouse.click(retry.x + retry.width / 2, retry.y + retry.height / 2);
  await expect.poll(async () => (await active())?.id).not.toBe(chat.id);
  await expect.poll(async () => (await active())?.state).toBe('idle');
  expect((await active()).mcp.servers.every(server => server.status === 'connected')).toBe(true);
  await page.screenshot({ path: resolve(out, 'tools-recovered.png') });
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, mcp: chat.mcp, errors }, null, 2));
  console.log('Agent startup passed: actual builtin tools, visible optional failure, light/dark and narrow Chinese.');
} catch (error) {
  if (page) await writeFile(resolve(out, 'failure.json'), await page.evaluate(() => window.peroDiagnostics.snapshot()));
  throw error;
} finally {
  await app?.close();
  await new Promise(done => unavailable.close(done));
  await rm(temp, { recursive: true, force: true });
}
