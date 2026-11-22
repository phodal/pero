import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { electron, focusPage } from './electron.mjs';

const profilePath = process.env.PERO_TEST_SSH_PROFILE;
const vncPort = process.env.PERO_TEST_SSH_VNC_PORT;
if (!profilePath || !vncPort || !process.env.PERO_SSH_CONFIG) throw new Error('Configure the disposable SSH Host, managed guest and TCP VNC fixture.');
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-ssh-workbench-'));
const out = resolve(root, 'test-results/linux-desktop-ssh');
const ssh = (...args) => promisify(execFile)('/usr/bin/ssh', ['-F', process.env.PERO_SSH_CONFIG, '-o', 'StrictHostKeyChecking=yes', '--', profile.host, ...args]);
await mkdir(out, { recursive: true });
let desktop;
try {
  desktop = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
    env: { ...process.env, PERO_REMOTE_HOST_PROFILE: profilePath, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_LOCALE: 'en' } });
  const page = await desktop.firstWindow();
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toContain(profile.host);
  await page.evaluate(() => {
    window.remoteHostEvents = [];
    window.pero.onEvent(value => window.remoteHostEvents.push(value));
  });
  await page.evaluate(cwd => window.pero.sessionCommand({ method: 'terminal', action: 'open', id: 812, cwd, size: { rows: 24, cols: 80 } }), profile.workspace);
  const events = () => page.evaluate(() => window.remoteHostEvents);
  await expect.poll(async () => (await events()).find(item => item.kind === 'terminal' && item.data.kind === 'opened')?.data.cwd).toBe(profile.workspace);
  await page.evaluate(() => window.pero.sessionCommand({ method: 'terminal', action: 'write', id: 812,
    bytes: [...new TextEncoder().encode("uname -s > terminal-proof.txt\n")] }));
  await expect.poll(async () => (await ssh('cat', `${profile.workspace}/terminal-proof.txt`).catch(() => ({ stdout: '' }))).stdout.trim()).toBe('Linux');
  await page.evaluate(path => window.pero.sessionCommand({ method: 'documents', action: 'open', request_id: 'ssh-read', path }), `${profile.workspace}/terminal-proof.txt`);
  await expect.poll(async () => (await events()).find(item => item.kind === 'document_file' && item.request_id === 'ssh-read')?.text?.trim())
    .toBe('Linux');
  const revision = (await events()).find(item => item.kind === 'document_file' && item.request_id === 'ssh-read').data.revision;
  await page.evaluate(({ source, revision }) => window.pero.sessionCommand({ method: 'documents', action: 'save', request_id: 'ssh-save',
    source, revision, text: 'Linux remote file saved\n' }), { source: `${profile.workspace}/terminal-proof.txt`, revision });
  await expect.poll(async () => (await ssh('cat', `${profile.workspace}/terminal-proof.txt`)).stdout.trim()).toBe('Linux remote file saved');
  await page.evaluate(() => window.pero.sessionCommand({ method: 'terminal', action: 'close', id: 812 }));

  const menu = id => desktop.evaluate(({ Menu, BrowserWindow }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0]), id);
  await expect.poll(() => desktop.evaluate(({ Menu }) => !!Menu.getApplicationMenu().getMenuItemById('new_chat'))).toBe(true);
  await menu('new_chat');
  const selected = async () => { const snapshot = await state(); return snapshot.chats[snapshot.activeChat]; };
  await expect.poll(async () => (await selected())?.state).toBe('idle');
  const thread = (await selected()).id;
  await page.evaluate(thread_id => window.pero.appUseCommand({ action: 'select', thread_id }), thread);
  const opening = desktop.waitForEvent('window');
  await menu('linux-desktop');
  const viewer = await opening;
  await focusPage(viewer);
  const button = name => viewer.getByRole('button', { name, exact: true });
  const frame = async () => {
    await expect(viewer.locator('.framebuffer')).toHaveAttribute('data-frame', 'connected', { timeout: 20_000 });
    // RFB can finish negotiating before the first image reaches the canvas.
    await viewer.waitForFunction(() => {
      const canvas = document.querySelector('.framebuffer canvas');
      if (!canvas?.width || !canvas.height) return false;
      const context = canvas.getContext('2d');
      const pixel = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      const corner = context.getImageData(0, 0, 1, 1).data;
      return pixel[3] === 255 && Math.abs(pixel[0] - corner[0]) > 50;
    }, undefined, { timeout: 20_000 });
  };

  await viewer.getByLabel('SSH host or alias').fill(profile.host);
  await viewer.getByLabel('Remote VNC port').fill(vncPort);
  await button('Connect over SSH').click();
  await frame();
  await expect(button('Disconnect machine')).toBeVisible();
  await expect(button('Connect selected chat')).toHaveCount(0);
  await viewer.screenshot({ path: resolve(out, 'external-vnc.png') });
  await button('Disconnect machine').click();

  await button("Connect this host's desktop").click();
  await frame();
  const enable = button('Enable Computer Use');
  if (await enable.isVisible()) await enable.click();
  await button('Connect selected chat').click();
  await expect(button('Disconnect chat')).toBeVisible();
  await page.evaluate(thread_id => window.pero.sessionCommand({ action: 'prompt', thread_id, text: 'Read the remote status.' }), thread);
  await expect.poll(async () => (await selected()).messages.filter(message => message.role === 'assistant').map(message => message.text).join(''),
    { timeout: 20_000 }).toMatch(/SSH_COMPUTER:.*"platform":"linux".*"available":true/);
  await viewer.screenshot({ path: resolve(out, 'managed-ssh.png') });
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ host: 'Linux over OpenSSH', pty: 'Linux', files: 'opened and saved remote file',
    external: 'RFB through SSH', managed: 'VNC and remote ACP/MCP' }, null, 2));
  console.log('SSH Workbench passed remote PTY, file read, external VNC and remote ACP Computer Use.');
} finally { await desktop?.close(); await rm(temp, { recursive: true, force: true }); }
