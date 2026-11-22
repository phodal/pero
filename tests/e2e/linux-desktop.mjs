import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { electron, focusPage } from './electron.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-linux-desktop-'));
const out = resolve(root, 'test-results/linux-desktop');
const settings = resolve(temp, 'settings.json');
const agents = resolve(temp, 'agents.json');
const socket = process.env.PERO_REMOTE_DESKTOP_DOCKER_SOCKET || resolve(homedir(), '.colima/pero-remote-desktop/docker.sock');
const docker = async (...args) => (await promisify(execFile)(process.env.PERO_REMOTE_DESKTOP_DOCKER || 'docker', ['--host', `unix://${socket}`, ...args])).stdout.trim();
const containers = async () => (await docker('ps', '-a', '--filter', 'name=pero-linux-desktop-', '--format', '{{.Names}}')).split('\n').filter(Boolean);
await mkdir(out, { recursive: true });
await writeFile(settings, JSON.stringify({ chat_agent: 'linux-desktop-fixture', computer_use: { enabled: false }, workbench: { appearance: 'light', projects: [] } }));
await writeFile(agents, JSON.stringify([{ id: 'linux-desktop-fixture', name: 'Linux Desktop Fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/linux-desktop-acp.mjs')], env: {} }]));
const original = await containers();
let desktop, viewer, guest;
const errors = [];
try {
  desktop = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
      PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' } });
  const workbench = await desktop.firstWindow();
  const state = () => workbench.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await workbench.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  await expect.poll(async () => (await state()).agents.length).toBeGreaterThan(0);
  const menu = id => desktop.evaluate(({ Menu, BrowserWindow }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0]), id);
  await expect.poll(() => desktop.evaluate(({ Menu }) => !!Menu.getApplicationMenu().getMenuItemById('new_chat'))).toBe(true);
  await menu('new_chat');
  await expect.poll(async () => (await state()).chats[0]?.state).toBe('idle');
  const thread = (await state()).chats[0].id;
  await workbench.evaluate(thread_id => window.pero.appUseCommand({ action: 'select', thread_id }), thread);
  const openViewer = async () => {
    const next = desktop.waitForEvent('window');
    await menu('linux-desktop');
    viewer = await next;
    viewer.on('pageerror', error => errors.push(error.message));
    await focusPage(viewer);
  };
  await openViewer();
  const button = name => viewer.getByRole('button', { name, exact: true });
  const frame = () => expect(viewer.locator('.framebuffer')).toHaveAttribute('data-frame', 'connected', { timeout: 25_000 });
  const canvas = () => viewer.locator('.framebuffer canvas');
  const chat = async () => (await state()).chats.find(chat => chat.id === thread);
  const prompt = async command => {
    await expect.poll(async () => (await chat()).state).toBe('idle');
    const count = (await chat()).messages.length;
    await workbench.evaluate(({ thread, command }) => window.pero.sessionCommand({ action: 'prompt', thread_id: thread, text: `DESKTOP_TEST:${command}` }), { thread, command });
    let reply;
    await expect.poll(async () => {
      const current = await chat();
      reply = current.messages.slice(count).find(message => message.role === 'assistant' && message.text.startsWith('LINUX_RESULT:'))?.text;
      return !!reply && current.state === 'idle';
    }, { timeout: 25_000 }).toBe(true);
    return JSON.parse(reply.slice('LINUX_RESULT:'.length));
  };

  await button('Start desktop').click();
  await frame();
  const guests = (await containers()).filter(name => !original.includes(name));
  expect(guests).toHaveLength(1);
  [guest] = guests;
  expect(await docker('port', guest)).toBe('');
  const proof = '/home/pero/remote-proof.txt';
  await docker('exec', guest, 'touch', proof);
  await docker('exec', '-d', guest, 'mousepad', proof);
  await expect.poll(() => docker('exec', guest, 'xwininfo', '-root', '-tree')).toContain('remote-proof.txt');
  await button('Enable Computer Use').click();
  await expect.poll(async () => JSON.parse(await readFile(settings, 'utf8')).computer_use.enabled).toBe(true);
  await button('Connect selected chat').click();
  await expect(button('Disconnect chat')).toBeVisible();
  const first = await prompt('write');
  expect(first.receipt?.outcome.status, JSON.stringify(first)).toBe('executed');
  await viewer.screenshot({ path: resolve(out, 'watching.png') });

  await canvas().click();
  await viewer.keyboard.type('Ignored');
  await button('Take control').click();
  await frame();
  expect((await prompt('while-human')).error).toMatch(/user has control/i);
  await viewer.screenshot({ path: resolve(out, 'controlling.png') });
  await canvas().click();
  await viewer.keyboard.press('End');
  await viewer.keyboard.type('-Human');
  await viewer.keyboard.press('Control+s');
  const saved = () => docker('exec', guest, 'cat', proof);
  await expect.poll(saved).toBe('Agent-Human');

  await button('Return control').click();
  await frame();
  const stale = await prompt('stale');
  expect(stale.outcome?.status, JSON.stringify(stale)).toBe('rejected');
  const resumed = await prompt('resume');
  expect(resumed.receipt?.outcome.status, JSON.stringify(resumed)).toBe('executed');
  expect(resumed.save?.outcome.status).toBe('executed');
  expect(resumed.runtime).not.toBe(first.runtime);
  await expect.poll(saved).toBe('Agent-Human-Resumed');
  await button('Take control').click();
  await frame();
  const closed = viewer.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Linux Desktop').close());
  await closed;
  await openViewer();
  await frame();
  await expect(button('Take control')).toBeVisible();
  await expect.poll(saved).toBe('Agent-Human-Resumed');

  await workbench.evaluate(async () => {
    const preferences = JSON.parse(window.peroDiagnostics.snapshot()).preferences;
    await window.pero.sessionCommand({ method: 'settings.workbench', preferences: { ...preferences, appearance: 'dark' } });
  });
  await expect(viewer.locator('html')).toHaveAttribute('data-theme', 'dark');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Linux Desktop').setSize(460, 420));
  await viewer.screenshot({ path: resolve(out, 'narrow-dark.png') });
  const confirmStop = accept => desktop.evaluate(({ dialog }, accept) => {
    dialog.showMessageBox = async (_owner, options) => {
      if (!options.message.includes('discard its files')) throw new Error('Expected the stop confirmation');
      return { response: accept ? 1 : 0, checkboxChecked: false };
    };
  }, accept);
  await confirmStop(false);
  await button('Stop desktop').click();
  await expect(button('Take control')).toBeEnabled();
  expect(await saved()).toBe('Agent-Human-Resumed');

  await button('Disconnect chat').click();
  expect((await prompt('detached')).error).toMatch(/disconnected from the Linux desktop/i);
  await button('Connect selected chat').click();
  await expect(button('Disconnect chat')).toBeVisible();
  await confirmStop(true);
  await button('Stop desktop').click();
  await expect(button('Start desktop')).toBeVisible();
  expect((await containers()).includes(guest)).toBe(false);
  expect((await prompt('after-stop')).error).toMatch(/Linux desktop is unavailable/i);
  await button('Start desktop').click();
  await frame();
  [guest] = (await containers()).filter(name => !original.includes(name));
  await docker('stop', guest);
  await expect(viewer.getByText('Desktop unavailable', { exact: true }).first()).toBeVisible();
  expect((await prompt('after-stop')).error).toMatch(/Linux desktop is unavailable/i);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, guest, runtime: resumed.runtime,
    fileContent: 'Agent-Human-Resumed', provider: 'scripted ACP', checks: ['view-only', 'handoff', 'fresh observation', 'independent guest file',
      'close returns control', 'disconnect refuses local fallback', 'stop cancel and confirmation', 'guest exit and restart'] }, null, 2));
  await rm(resolve(out, 'failure.png'), { force: true });
  console.log('Real Electron and Colima Linux desktop passed view-only, Agent input, VNC takeover, resume, saved file, and disconnect checks.');
} catch (error) {
  await viewer?.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  console.error('Viewer errors:', errors);
  throw error;
} finally {
  await desktop?.close();
  if (guest && (await containers()).includes(guest)) await docker('rm', '-f', guest);
  await rm(temp, { recursive: true, force: true });
}
