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
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 850));
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
  const button = name => viewer.getByRole('button', { name, exact: true });
  const frame = () => expect(viewer.locator('.framebuffer')).toHaveAttribute('data-frame', 'connected', { timeout: 25_000 });
  const canvas = () => viewer.locator('.framebuffer canvas');
  const chat = async () => (await state()).chats.find(chat => chat.id === thread);
  const prompt = async command => {
    await expect.poll(async () => (await chat()).state).toBe('idle');
    const count = (await chat()).messages.length;
    if (command === 'write') {
      const input = (await state()).composerBounds.input;
      await workbench.mouse.click(input.x + input.width/2, input.y + input.height/2);
      await workbench.keyboard.insertText('DESKTOP_TEST:write @remo');
      const target = 'Use attached Linux desktop';
      await expect.poll(async () => {
        const picker = (await state()).completion;
        return !picker.loading && picker.items.includes(target);
      }).toBe(true);
      const picker = (await state()).completion;
      for (let n = (picker.items.indexOf(target)-picker.selected+picker.items.length)%picker.items.length; n; n--)
        await workbench.keyboard.press('ArrowDown');
      await workbench.keyboard.press('Enter');
      await expect.poll(async () => (await state()).attachments).toEqual([target]);
      await workbench.keyboard.press('Enter');
    } else await workbench.evaluate(({ thread, command }) => window.pero.sessionCommand({ action: 'prompt', thread_id: thread, text: `DESKTOP_TEST:${command}` }), { thread, command });
    let reply;
    await expect.poll(async () => {
      const current = await chat();
      reply = current.messages.slice(count).find(message => message.role === 'assistant' && message.text.startsWith('LINUX_RESULT:'))?.text;
      return !!reply && current.state === 'idle';
    }, { timeout: 25_000 }).toBe(true);
    return JSON.parse(reply.slice('LINUX_RESULT:'.length));
  };

  const input = (await state()).composerBounds.input;
  await workbench.mouse.click(input.x + input.width / 2, input.y + input.height / 2);
  await workbench.keyboard.insertText('@remo');
  await expect.poll(async () => (await state()).completion.items[0]).toBe('Remote Use · Linux Desktop');
  await workbench.keyboard.press('Enter');
  const desktopTab = workbench.locator('#pero-linux-desktop');
  const desktopView = desktopTab.contentFrame();
  const dockButton = label => desktopView.getByRole('button', { name: label, exact: true });
  const dockFrame = () => expect(desktopView.locator('.framebuffer')).toHaveAttribute('data-frame', 'connected', { timeout: 30_000 });
  const resourceTab = async key => {
    const bounds = async () => (await state()).files.browser?.bounds[key];
    await expect.poll(async () => (await bounds())?.width).toBeGreaterThan(0);
    const { x, y, width, height } = await bounds();
    await workbench.mouse.click(x + width / 2, y + height / 2);
  };
  await expect(desktopTab).toBeVisible();
  const initialDock = await desktopTab.boundingBox();
  const windowWidth = await workbench.evaluate(() => innerWidth);
  expect(initialDock.x).toBeGreaterThan(windowWidth / 2);
  expect(initialDock.x + initialDock.width).toBeCloseTo(windowWidth, 0);
  await dockButton('Start desktop').click();
  await dockFrame();
  const dividerX = initialDock.x - 7;
  const dividerY = initialDock.y + 150;
  await workbench.mouse.move(dividerX, dividerY);
  await workbench.mouse.down();
  await workbench.mouse.move(dividerX - 205, dividerY, { steps: 8 });
  await workbench.mouse.up();
  await expect.poll(async () => (await desktopTab.boundingBox())?.width).toBeGreaterThan(initialDock.width + 100);
  await dockFrame();

  const guests = (await containers()).filter(name => !original.includes(name));
  expect(guests).toHaveLength(1);
  [guest] = guests;
  expect(await docker('port', guest)).toBe('');
  const proof = '/home/pero/remote-proof.txt';
  await docker('exec', guest, 'touch', proof);
  await expect.poll(() => docker('exec', guest, 'xwininfo', '-root', '-tree')).toMatch(/mousepad/i);
  await docker('exec', guest, 'mousepad', '--quit');
  await docker('exec', '-d', guest, 'mousepad', '--disable-server', proof);
  await expect.poll(async () => {
    const windows = await docker('exec', guest, 'xwininfo', '-root', '-tree');
    const id = windows.match(/(0x[0-9a-f]+) ".*remote-proof\.txt.*"/i)?.[1];
    return id && (await docker('exec', guest, 'xwininfo', '-id', id)).includes('IsViewable');
  }).toBe(true);
  await dockButton('Enable Computer Use').click();
  await expect.poll(async () => JSON.parse(await readFile(settings, 'utf8')).computer_use.enabled).toBe(true);
  await dockButton('Connect selected chat').click();
  await expect(dockButton('Disconnect chat')).toBeVisible();
  const first = await prompt('write');
  expect(first.receipt?.outcome.status, JSON.stringify(first)).toBe('executed');
  await desktopTab.screenshot({ path: resolve(out, 'agent-vnc-panel.png') });
  const retained = await desktopTab.elementHandle();
  await resourceTab('files-tab');
  await expect(desktopTab).toBeHidden();
  await expect.poll(async () => (await state()).files.tab).toBe('files');
  await resourceTab('desktop-tab');
  await expect(desktopTab).toBeVisible();
  expect(await desktopTab.evaluate((node, previous) => node === previous, retained)).toBe(true);
  await retained.dispose();
  await dockFrame();

  const inputGuest = async text => {
    await desktopView.locator('.framebuffer canvas').click();
    await workbench.keyboard.press('End');
    await workbench.keyboard.type(text);
    await workbench.keyboard.press('Control+s');
  };
  await inputGuest('Ignored');
  expect((await state()).composer).toBe('');
  await dockButton('Take control').click();
  await dockFrame();
  expect((await prompt('while-human')).error).toMatch(/user has control/i);
  await inputGuest('-Human');
  const saved = () => docker('exec', guest, 'cat', proof);
  await expect.poll(saved).toBe('Agent-Human');
  if (process.platform === 'linux') await workbench.screenshot({ path: resolve(out, 'linux-workbench.png') });
  await dockButton('Return control').click();
  await dockFrame();
  const stale = await prompt('stale');
  expect(stale.outcome?.status, JSON.stringify(stale)).toBe('rejected');
  const resumed = await prompt('resume');
  expect(resumed.receipt?.outcome.status, JSON.stringify(resumed)).toBe('executed');
  expect(resumed.save?.outcome.status).toBe('executed');
  expect(resumed.runtime).not.toBe(first.runtime);
  await expect.poll(saved).toBe('Agent-Human-Resumed');
  await dockButton('Take control').click();
  await dockFrame();
  await resourceTab('artifacts-tab');
  await expect(desktopTab).toBeHidden();
  await expect.poll(async () => (await state()).files.tab).toBe('artifacts');
  await resourceTab('desktop-tab');
  await expect(desktopTab).toBeVisible();
  await expect(desktopView.getByText('Viewing only', { exact: true })).toBeVisible();
  await dockFrame();

  await resourceTab('files-tab');
  await expect(desktopTab).toBeHidden();
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
    fileContent: 'Agent-Human-Resumed', provider: 'scripted ACP', platform: process.platform, arch: process.arch, checks: ['composer @remote', 'right resource tab', 'resource splitter', 'Files and Artifacts tab switching', 'retained viewer', 'attached chat input', 'view-only', 'handoff', 'fresh observation', 'independent guest file',
      'switching tabs returns control', 'disconnect refuses local fallback', 'stop cancel and confirmation', 'guest exit and restart'] }, null, 2));
  for (const file of ['failure.png', 'workbench-failure.png']) await rm(resolve(out, file), { force: true });
  console.log(`Real Electron (${process.platform}/${process.arch}) and Docker Linux desktop passed right resource tabs, VNC takeover, return, saved file, and disconnect checks.`);
} catch (error) {
  await desktop?.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64")).then(data => writeFile(resolve(out, "workbench-failure.png"), Buffer.from(data, "base64"))).catch(() => {});
  await viewer?.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  console.error('Viewer errors:', errors);
  throw error;
} finally {
  await desktop?.close();
  if (guest && (await containers()).includes(guest)) await docker('rm', '-f', guest);
  await rm(temp, { recursive: true, force: true });
}
