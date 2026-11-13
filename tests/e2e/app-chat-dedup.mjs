// Real HPC App -> shared Composer; no model request or benchmark execution.
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/app-chat-dedup');
const profile = await mkdtemp(resolve(tmpdir(), 'pero-app-chat-dedup-'));
await mkdir(output, { recursive: true });
const python = process.env.PERO_APP_PYTHON || 'python3';
const pythonRoot = execFileSync(python, ['-c', 'import sys; print(sys.prefix)'], { encoding: 'utf8' }).trim();
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ workbench: { appearance: 'light' }, app_python: { apps: { hpc: pythonRoot } } }));
const env = { ...process.env, PERO_BUILTIN_APPS: 'hpc', PERO_DESKTOP_DATA_DIR: profile,
  PERO_LOCALE: 'en', PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
const app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function focusComposer() {
  const bounds = (await state()).composerBounds.input;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => !!(await state()).sidebarButtonBounds?.hpc).toBe(true);
  await clickAppShortcut(page, 'hpc');
  const frame = page.frameLocator('iframe[title="hpc"]');
  const button = frame.getByRole('button', { name: 'Discuss with Agent', exact: true });
  await expect(button).toBeEnabled({ timeout: 60000 });
  await frame.locator('body').evaluate(() => {
    window.chatResults = [];
    window.addEventListener('message', event => {
      if (event.data?.type === 'pero:app:chat-result') window.chatResults.push(event.data);
    });
  });
  async function discuss() {
    const count = await frame.locator('body').evaluate(() => window.chatResults.length);
    await button.click();
    await expect.poll(() => frame.locator('body').evaluate(() => window.chatResults.length)).toBe(count + 1);
    expect(await frame.locator('body').evaluate(() => window.chatResults.at(-1).ok)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await discuss();
  await expect.poll(async () => (await state()).attachments).toEqual(['HPC Benchmarks']);
  const first = (await state()).composer;
  expect(first).toContain('Review HPC benchmark');
  await page.screenshot({ path: resolve(output, 'first.png') });
  for (let count = 0; count < 3; count++) {
    await discuss();
    expect((await state()).composer).toBe(first);
  }
  await expect.poll(async () => (await state()).composer).toBe(first);
  await expect.poll(async () => (await state()).attachments).toEqual(['HPC Benchmarks']);
  await page.screenshot({ path: resolve(output, 'repeated-light.png') });

  await focusComposer();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText(' 保留我的补充问题。');
  await expect.poll(async () => (await state()).composer).toBe(`${first} 保留我的补充问题。`);
  const edited = (await state()).composer;
  await discuss();
  await expect.poll(async () => (await state()).composer).toBe(edited);

  const method = frame.getByRole('button', { name: 'Poisson 1D finite differences', exact: true });
  await method.click();
  await discuss();
  await expect.poll(async () => (await state()).composer).toContain('Review HPC benchmark Poisson 1D finite differences');
  const changed = (await state()).composer;
  expect(changed).toContain('保留我的补充问题。');
  await expect.poll(async () => (await state()).attachments).toHaveLength(2);
  await discuss();
  await expect.poll(async () => (await state()).composer).toBe(changed);

  await focusComposer();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await state()).composer).toBe('');
  await discuss();
  await expect.poll(async () => (await state()).attachments).toEqual(['HPC Benchmarks']);
  await expect.poll(async () => (await state()).composer).toContain('Review HPC benchmark Poisson');
  await page.evaluate(preferences => window.pero.sessionCommand({ method: 'settings.workbench', preferences }), { ...(await state()).preferences, appearance: 'dark' });
  await expect.poll(async () => (await state()).dark).toBe(true);
  await page.screenshot({ path: resolve(output, 'repeated-dark.png') });
  expect((await state()).chats.every(chat => chat.messages.length === 0)).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ checks: ['repeat discussion', 'preserved user edits', 'different method', 'clear and re-add', 'light/dark'], errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
