import { chromium, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { electron, focusPage } from './electron.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-paired-display-'));
const output = resolve(root, 'test-results/linux-desktop-share');
const socket = process.env.PERO_REMOTE_DESKTOP_DOCKER_SOCKET || resolve(homedir(), '.colima/pero-remote-desktop/docker.sock');
const docker = async (...args) => (await promisify(execFile)('docker', ['--host', `unix://${socket}`, ...args])).stdout.trim();
const guests = async () => (await docker('ps', '-a', '--filter', 'name=pero-linux-desktop-', '--format', '{{.Names}}')).split('\n').filter(Boolean);
const original = await guests();
const key = randomBytes(32).toString('hex');
const relay = spawn(process.execPath, [resolve(root, 'environments/linux-desktop/relay.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PERO_DESKTOP_RELAY_KEY: key, PERO_DESKTOP_RELAY_PORT: '0' },
});
const lines = createInterface({ input: relay.stdout });
const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) });
const url = `http://127.0.0.1:${ready.match(/(\d+)$/)[1]}`;
let desktop, browser, viewer, guest;
const errors = [];
const diagnostics = [];
try {
  await mkdir(output, { recursive: true });
  expect((await fetch(url + '/api/pair', { method: 'POST' })).status).toBe(401);
  browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  desktop = await electron.launch({ args: ['--use-mock-keychain', '--disable-features=WebRtcHideLocalIpsWithMdns', resolve(root, 'desktop')],
    cwd: root, env: { ...process.env, PERO_DESKTOP_RELAY_URL: url, PERO_DESKTOP_RELAY_KEY: key,
      PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_LOCALE: 'en' } });
  const workbench = await desktop.firstWindow();
  await workbench.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected);
  const opened = desktop.waitForEvent('window');
  await desktop.evaluate(({ Menu, BrowserWindow }) => Menu.getApplicationMenu().getMenuItemById('linux-desktop').click(undefined, BrowserWindow.getAllWindows()[0]));
  viewer = await opened;
  await focusPage(viewer);
  viewer.on('pageerror', error => errors.push(error.message));
  viewer.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  const button = name => viewer.getByRole('button', { name, exact: true });
  const frame = () => expect(viewer.locator('.framebuffer')).toHaveAttribute('data-frame', 'connected', { timeout: 20_000 });
  await button('Start desktop').click();
  await frame();
  [guest] = (await guests()).filter(name => !original.includes(name));
  const proof = '/home/pero/paired-proof.txt';
  await docker('exec', guest, 'touch', proof);
  await docker('exec', '-d', guest, 'mousepad', proof);
  await expect.poll(() => docker('exec', guest, 'xwininfo', '-root', '-tree')).toContain('paired-proof.txt');
  const file = () => docker('exec', guest, 'cat', proof);

  async function pair(action, fallback = false) {
    await button(action).click();
    const link = await viewer.getByLabel('One-time pairing link').inputValue();
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
    if (fallback) await page.addInitScript(() => { globalThis.RTCPeerConnection = undefined; });
    await page.goto(link);
    await expect(page.getByRole('status')).toHaveText(fallback ? 'You have control · Relay' : 'Viewing only · WebRTC', { timeout: 20_000 });
    expect(new URL(page.url()).hash).toBe('');
    return { page, link };
  }
  const passive = await pair('Share view');
  await passive.page.locator('canvas').click();
  await passive.page.keyboard.type('NoInput');
  await passive.page.keyboard.press('Control+s');
  expect(await file()).toBe('');
  await passive.page.screenshot({ path: resolve(output, 'webrtc.png') });
  await button('End sharing').click();
  await expect(passive.page.getByRole('status')).toContainText('disconnected');
  await frame();
  await passive.page.goto(passive.link);
  await expect(passive.page.getByRole('status')).toContainText('disconnected');
  await passive.page.close();

  await button('Take control').click();
  await frame();
  const control = await pair('Share control', true);
  await control.page.locator('canvas').click();
  await control.page.locator('canvas').focus();
  await control.page.keyboard.type('PairedVNC');
  await control.page.keyboard.press('Control+s');
  await control.page.screenshot({ path: resolve(output, 'relay-control.png') });
  await expect.poll(file).toBe('PairedVNC');
  await control.page.close();
  await frame();
  await expect(button('Take control')).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ webRtc: 'read-only',
    ice: process.env.PERO_DESKTOP_TURN_ONLY === '1' ? 'TURN only' : 'default', relay: 'controlled input',
    fileContent: 'PairedVNC', linkReuse: 'rejected', disconnect: 'control returned' }, null, 2));
  console.log('Paired desktop passed: real WebRTC, opaque one-time links, relay fallback, saved input, and control release.');
} catch (error) {
  if (diagnostics.length) console.error(diagnostics);
  throw error;
} finally {
  await browser?.close();
  await desktop?.close();
  if (guest && (await guests()).includes(guest)) await docker('rm', '-f', guest);
  relay.kill();
  await rm(temp, { recursive: true, force: true });
}
