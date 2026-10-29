// Visual and interaction acceptance for the shared GPUI Kit workbench geometry.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { openSettings, setAppearance } from './sidebar-controls.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/workbench-polish');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-polish-'));
await mkdir(out, { recursive: true });
const agents = resolve(temp, 'agents.json');
// Override the initial Agent as well, so readiness never starts a real provider.
await writeFile(agents, JSON.stringify(['codex', 'claude', 'copilot', 'grok'].map(id => ({ id, name: 'ACP visual fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), '--composer'] }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_LOCALE: 'en',
  PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
  PERO_APPS_ROOT: resolve(temp, 'apps'), PERO_AGENTS_FILE: agents };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
const page = await app.firstWindow();
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const viewport = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const capture = async name => { await paint(); await page.screenshot({ path: resolve(out, `${name}.png`), scale: 'css' }); console.log(name); };
const input = async text => {
  const { width, height } = await viewport();
  await page.mouse.click(Math.min(750, width - 160), height - 70);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.insertText', { text });
  await cdp.detach();
  await expect.poll(async () => (await state()).composer).toBe(text);
};
try {
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 880));
  await page.waitForFunction(() => innerWidth === 1280);
  await setAppearance(page, 'light');
  await page.mouse.click(90, 25);
  await expect.poll(async () => ['draft', 'idle'].includes((await state()).chats.at(-1)?.state), { timeout: 20000 }).toBe(true);
  await capture('01-ready-light');
  await input('toolmatrix');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[0].tools.length).toBeGreaterThanOrEqual(3);
  await capture('02-running');
  await expect.poll(async () => (await state()).chats[0].state, { timeout: 20000 }).toBe('idle');
  expect((await state()).chats[0].tools).toHaveLength(9);
  await capture('03-tools-light');
  checks.push('fixture prompt, running and completed tools, visible failure and cancellation');
  // The disclosure follows the user message and two streamed text segments.
  await page.mouse.click(600, 233);
  await expect.poll(async () => (await state()).toolViews[0]).toBe(1);
  await capture('04-expanded-light');
  await page.mouse.click(600, 153);
  await expect.poll(async () => (await state()).toolViews[0]).toBe(0);
  checks.push('tool disclosure expands and collapses retained output');
  await input('Review the result without sending another request.');
  const first = (await state()).activeContent;
  await page.mouse.click(90, 25);
  await expect.poll(async () => (await state()).contentTabs).toHaveLength(2);
  await expect.poll(async () => ['draft', 'idle'].includes((await state()).chats.at(-1)?.state)).toBe(true);
  await page.mouse.click(310, 18);
  await expect.poll(async () => (await state()).activeContent).toEqual(first);
  expect((await state()).composer).toContain('without sending');
  await capture('05-tabs-draft');
  await page.mouse.click(420, 18);
  await expect.poll(async () => (await state()).activeContent).not.toEqual(first);
  await page.mouse.click(482, 18);
  await expect.poll(async () => (await state()).contentTabs).toHaveLength(1);
  await expect.poll(async () => (await state()).activeContent).toEqual(first);
  expect((await state()).composer).toContain('without sending');
  checks.push('content tab switching and closure preserve unsent draft and session');
  await openSettings(page);
  await capture('06-settings-light');
  await page.keyboard.press('Escape');
  await setAppearance(page, 'dark');
  await capture('07-dark');
  await openSettings(page);
  await capture('07-settings-dark');
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
  await page.waitForFunction(() => innerWidth === 1000);
  await capture('08-narrow-dark');
  await input('/');
  await expect.poll(async () => (await state()).completion.open).toBe(true);
  await expect.poll(async () => (await state()).completion.loading).toBe(false);
  await capture('09-completions-dark');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state()).completion.open).toBe(false);
  await setAppearance(page, 'light');
  await capture('10-narrow-light');
  checks.push('light/dark menu, narrow layout, completion picker and Escape dismissal');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, checks, errors, fixture: true, realModel: false }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
  if (process.env.PERO_POLISH_PREVIEW === '1') {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(1280, 880);
      window.show();
      window.focus();
    });
    await page.waitForFunction(() => innerWidth === 1280);
    await input('Review the result and continue here.');
    await capture('11-preview-light');
    console.log('Pero GPUI polish preview is open with simulated ACP data. Close the window to stop.');
    await app.waitForEvent('close', { timeout: 0 });
  }
} catch (error) {
  await capture('failure');
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: false, checks, errors, error: error.message, state: await state() }, null, 2));
  throw error;
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
