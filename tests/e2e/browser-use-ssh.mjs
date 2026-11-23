// Electron Workbench, Linux Host/Agent via OpenSSH, and an actual Chrome extension.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickNewChat } from './sidebar-controls.mjs';
import { EXTENSION_ID, RELAY_PROTOCOL } from '../../packages/chrome-extension/src/protocol.ts';

const profilePath = process.env.PERO_TEST_SSH_PROFILE;
assert(profilePath && process.env.PERO_SSH_CONFIG, 'Configure the disposable Linux SSH Host and Browser Use fixture Agent.');
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-ssh-browser-'));
const output = resolve(root, 'test-results/browser-use-ssh');
await mkdir(output, { recursive: true });
const effects = [];
const site = createServer((request, response) => {
  if (request.url.startsWith('/effect/')) { effects.push(request.url); response.writeHead(204).end(); return; }
  const embedded = request.url === '/embedded';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>${embedded ? 'SSH Embedded fixture' : 'SSH Browser fixture'}</title><button>Mark fixture</button>
    <p data-testid="effect">Waiting</p><script>
    document.querySelector('button').onclick = event => {
      if (!event.isTrusted) return;
      document.querySelector('p').textContent = 'Trusted remote click';
      fetch('/effect/${embedded ? 'embedded' : 'chrome'}');
    };
    </script>`);
});
await new Promise(done => site.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${site.address().port}/`;
let app, chrome;
try {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
    env: { ...process.env, PERO_REMOTE_HOST_PROFILE: profilePath, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_LOCALE: 'en' } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const selected = async () => { const snapshot = await state(); return snapshot.chats[snapshot.activeChat]; };
  await clickNewChat(page);
  await expect.poll(async () => (await selected())?.state).toBe('idle');
  const thread = (await selected()).id;
  await page.evaluate(thread_id => window.pero.appUseCommand({ action: 'select', thread_id }), thread);
  const prompt = async text => {
    const at = (await selected()).messages.length;
    await page.evaluate(({ thread_id, text }) => window.pero.sessionCommand({ action: 'prompt', thread_id, text }), { thread_id: thread, text });
    let response;
    await expect.poll(async () => {
      const chat = await selected();
      response = chat.messages.slice(at).find(item => item.role === 'assistant')?.text;
      return chat.state === 'idle' && response?.startsWith('SSH_BROWSER:');
    }, { timeout: 25000 }).toBe(true);
    const result = JSON.parse(response.slice('SSH_BROWSER:'.length));
    assert.equal(result.error, undefined, result.error);
    return result;
  };

  await app.evaluate(({ dialog, clipboard }) => {
    dialog.showMessageBox = async (_window, options) => {
      if (options.type === 'question') globalThis.sshBrowserConsent = options;
      return { response: globalThis.sshBrowserApproved ? 1 : 0 };
    };
    clipboard.writeText = value => { globalThis.sshBrowserTicket = value; };
  });
  const menu = id => app.evaluate(({ Menu, BrowserWindow }, id) => {
    Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0]);
  }, id);
  const before = await prompt('List tabs before pairing.');
  assert.equal(before.platform, 'Linux');
  assert.deepEqual(before.tabs, []);
  for (const action of ['files', 'upload', 'download']) assert(!before.actions.includes(action));
  const embeddedUrl = new URL('/embedded', url).href;
  await page.evaluate(url => window.pero.webCommand({ action: 'web_open', url }), embeddedUrl);
  await expect.poll(async () => (await state()).webDocuments.find(item => item.id === embeddedUrl)?.observation.load.kind).toBe('ready');
  if (!(await state()).chatVisible) await menu('toggle_chat');
  await expect.poll(async () => (await state()).chatVisible).toBe(true);
  await menu('browser-use-allow');
  await expect.poll(() => app.evaluate(() => globalThis.sshBrowserConsent?.detail)).toContain(profile.host);
  assert.deepEqual((await prompt('List tabs after declining the embedded grant.')).tabs, []);
  await app.evaluate(() => { globalThis.sshBrowserApproved = true; });
  await menu('browser-use-allow');
  const embedded = await prompt('Exercise the owned embedded fixture.');
  assert.equal(embedded.tabs[0].url, embeddedUrl);
  assert.equal(embedded.verified.matched, true);
  assert.equal(embedded.screenshot.mimeType, 'image/png');
  await menu('browser-use-revoke');
  assert.deepEqual((await prompt('List tabs after revoking the embedded grant.')).tabs, []);
  await app.evaluate(() => { globalThis.sshBrowserApproved = false; globalThis.sshBrowserConsent = undefined; });
  await menu('browser-use-pair-chrome');
  await expect.poll(() => app.evaluate(() => globalThis.sshBrowserConsent?.detail)).toContain(profile.host);
  assert.equal(await app.evaluate(() => globalThis.sshBrowserTicket ?? null), null);
  await app.evaluate(() => { globalThis.sshBrowserApproved = true; });
  await menu('browser-use-pair-chrome');
  await expect.poll(async () => {
    const value = await app.evaluate(() => globalThis.sshBrowserTicket);
    return value && JSON.parse(value).protocol;
  }).toBe(RELAY_PROTOCOL);
  const ticket = await app.evaluate(() => globalThis.sshBrowserTicket);

  const extension = resolve(root, 'target/chrome-extension');
  chrome = await chromium.launchPersistentContext(resolve(temp, 'chrome'), {
    executablePath: chromium.executablePath(), headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const target = chrome.pages()[0] ?? await chrome.newPage();
  await target.goto(url);
  const panel = await chrome.newPage();
  await panel.goto(`chrome-extension://${EXTENSION_ID}/relay.html#` + new URLSearchParams({ pair: ticket }));
  await expect(panel.locator('#status')).toContainText('Connected');
  await target.bringToFront();
  const result = await prompt('Exercise the owned Chrome fixture.');
  assert.equal(result.platform, 'Linux');
  assert.equal(result.tabs.find(tab => tab.url === url)?.title, 'SSH Browser fixture');
  assert.equal(result.click.outcome, 'dispatched');
  assert.equal(result.verified.matched, true);
  assert.equal(result.screenshot.mimeType, 'image/png');
  await expect(target.getByTestId('effect')).toHaveText('Trusted remote click');
  await expect.poll(() => effects).toEqual(['/effect/embedded', '/effect/chrome']);
  await target.screenshot({ path: resolve(output, 'trusted-remote-click.png') });
  await menu('browser-use-stop-chrome');
  await expect(panel.locator('#status')).not.toContainText('Connected');
  assert.deepEqual((await prompt('List tabs after stopping access.')).tabs, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ platform: result.platform,
    remoteConsent: true, effects, embeddedReceipt: embedded.click, chromeReceipt: result.click, screenshot: result.screenshot,
    browserFilesAdvertised: false, revoked: true }, null, 2));
  console.log('SSH Browser Use passed explicit consent, Linux ACP, trusted input in Embedded and Chrome, PNG digests and revocation.');
} finally {
  await chrome?.close();
  await app?.close();
  site.close();
  await rm(temp, { recursive: true, force: true });
}
