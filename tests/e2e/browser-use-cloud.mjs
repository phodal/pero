// Run via TestCloudBrowserFollowsClaimAndRuntimeChannel, which owns the
// temporary PostgreSQL binding, HTTP Gateway and projected Pod fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickNewChat } from './sidebar-controls.mjs';
import { EXTENSION_ID, RELAY_PROTOCOL } from '../../packages/chrome-extension/src/protocol.ts';

const { PERO_TEST_CLOUD_BROWSER_ORIGIN: origin, PERO_TEST_CLOUD_BROWSER_CLIENT: client,
  PERO_TEST_CLOUD_BROWSER_POD: pod, PERO_TEST_CLOUD_BROWSER_RUN: runId,
  PERO_TEST_CLOUD_BROWSER_TASK: taskId } = process.env;
assert(origin && new URL(origin).hostname === '127.0.0.1' && client && pod && runId && taskId,
  'Start the isolated Browser Use Go test fixture.');
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-cloud-browser-'));
const output = resolve(root, 'test-results/browser-use-cloud');
await mkdir(output, { recursive: true });
const effects = [];
const site = createServer((request, response) => {
  if (request.url.startsWith('/effect/')) { effects.push(request.url); response.writeHead(204).end(); return; }
  const lane = request.url === '/chrome' ? 'chrome' : 'embedded';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Cloud Browser fixture ${lane}</title><button>Mark fixture</button>
    <p data-testid="effect">Waiting</p><script>
    document.querySelector('button').onclick = event => {
      if (!event.isTrusted) return;
      document.querySelector('p').textContent = 'Trusted Cloud click';
      fetch('/effect/${lane}');
    };
    </script>`);
});
await new Promise(done => site.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${site.address().port}/`;
const call = async args => {
  const endpoint = new URL(`/api/runtime/v1/runs/${runId}/browser/call`, origin);
  endpoint.searchParams.set('session_id', runId);
  const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${pod}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const text = await response.text();
  return { status: response.status, value: response.ok ? JSON.parse(text) : text };
};
let app, chrome;
try {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env: {
    PATH: process.env.PATH, HOME: process.env.HOME, PERO_LOCALE: 'en',
    PERO_CLOUD_URL: origin, PERO_CLIENT_TOKEN: client, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'),
    PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
  } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const menu = id => app.evaluate(({ Menu, BrowserWindow }, id) => {
    Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0]);
  }, id);
  await menu('remote-tasks');
  await page.evaluate(task_id => window.pero.remoteCommand({ action: 'remote_select', task_id }), taskId);
  await expect.poll(async () => (await state()).remote.state.detail?.run?.id, { timeout: 15000 }).toBe(runId);
  await page.evaluate(url => window.pero.webCommand({ action: 'web_open', url }), url);
  await expect.poll(async () => (await state()).webDocuments.find(item => item.id === url)?.observation.load.kind).toBe('ready');

  await app.evaluate(({ dialog, clipboard }) => {
    dialog.showMessageBox = async (_window, options) => {
      globalThis.cloudBrowserDialog = options;
      return { response: options.type === 'question' && globalThis.cloudBrowserApproved ? 1 : 0 };
    };
    clipboard.writeText = value => { globalThis.cloudChromeTicket = value; };
  });
  await menu('browser-use-cloud-share');
  const consent = () => app.evaluate(() => globalThis.cloudBrowserDialog);
  await expect.poll(async () => {
    const dialog = await consent();
    assert(dialog?.type !== 'info', dialog?.detail);
    return dialog?.type;
  }).toBe('question');
  assert.match((await consent()).detail, /Browser fixture/);
  assert.match((await consent()).detail, /Screenshots of the visible page/);
  assert((await consent()).detail.includes(origin) && (await consent()).detail.includes(new URL(url).origin));
  assert.equal((await call({ action: 'status' })).status, 409);
  await app.evaluate(() => { globalThis.cloudBrowserApproved = true; });
  await menu('browser-use-cloud-share');
  const shared = () => expect.poll(async () => {
    const result = await call({ action: 'status' });
    return result.status === 200 && result.value.authorized;
  }, { timeout: 10000 }).toBe(true);
  await shared();
  for (const blocked of [{ action: 'open', url }, { action: 'files' }, { action: 'observe', tabId: 'other-tab' }])
    assert.equal((await call(blocked)).value.kind, 'error');
  assert.equal((await call({ action: 'screenshot', fullPage: true })).value.kind, 'error');
  const screenshot = async lane => {
    const result = await call({ action: 'screenshot', clip: { x: 0, y: 0, width: 450, height: 250 } });
    assert.equal(result.value.kind, 'screenshot', JSON.stringify(result.value).slice(0, 300));
    const png = Buffer.from(result.value.png, 'base64');
    const { receipt } = result.value;
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([receipt.width, receipt.height], [450, 250]);
    assert.equal(receipt.bytes, png.length);
    assert.equal(receipt.sha256, createHash('sha256').update(png).digest('hex'));
    const model = new URL(`/api/runtime/v1/runs/${runId}/provider/v1/chat/completions`, origin);
    model.searchParams.set('session_id', runId);
    const response = await fetch(model, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${pod}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'fixture', messages: [{ role: 'tool', tool_call_id: 'shot',
        content: [{ type: 'text', text: JSON.stringify(receipt) },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + result.value.png } }] }] }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).sha256, receipt.sha256);
    await writeFile(resolve(output, lane + '-cloud-model.png'), png);
    return receipt;
  };
  const clickFixture = async () => {
    const match = await call({ action: 'locate', locator: { by: 'role', role: 'button', name: 'Mark fixture' } });
    assert.equal(match.value.kind, 'observation', JSON.stringify(match.value));
    const ref = match.value.nodes.find(node => node.name === 'Mark fixture')?.ref;
    assert(ref, JSON.stringify(match.value));
    const click = (await call({ action: 'click', ref })).value;
    assert.equal(click.outcome, 'dispatched', JSON.stringify(click));
    const result = (await call({ action: 'observe' })).value;
    assert(JSON.stringify(result).includes('Trusted Cloud click'));
    return click;
  };
  const click = await clickFixture();
  const embeddedScreenshot = await screenshot('embedded');
  await expect.poll(() => effects).toEqual(['/effect/embedded']);
  await page.screenshot({ path: resolve(output, 'embedded-cloud-share.png') });
  const captured = await app.evaluate(async ({ webContents }, address) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === address);
    return (await page.capturePage(undefined, { stayHidden: true })).toPNG().toString('base64');
  }, url);
  await writeFile(resolve(output, 'embedded-cloud-page.png'), Buffer.from(captured, 'base64'));

  await menu('browser-use-cloud-stop');
  await expect.poll(async () => (await call({ action: 'status' })).status).toBe(409);
  await clickNewChat(page);
  await expect.poll(async () => {
    const workbench = await state();
    return !!workbench.chats?.[workbench.activeChat]?.id;
  }).toBe(true);
  await menu('browser-use-pair-chrome');
  await expect.poll(async () => {
    const value = await app.evaluate(() => globalThis.cloudChromeTicket);
    return value && JSON.parse(value).protocol;
  }).toBe(RELAY_PROTOCOL);
  const ticket = await app.evaluate(() => globalThis.cloudChromeTicket);
  const extension = resolve(root, 'target/chrome-extension');
  chrome = await chromium.launchPersistentContext(resolve(temp, 'chrome'), {
    executablePath: chromium.executablePath(), headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const target = chrome.pages()[0] ?? await chrome.newPage();
  await target.goto(new URL('/chrome', url).href);
  const sibling = await chrome.newPage();
  await sibling.goto(new URL('/sibling', url).href);
  const panel = await chrome.newPage();
  await panel.goto(`chrome-extension://${EXTENSION_ID}/relay.html#` + new URLSearchParams({ pair: ticket }));
  await expect(panel.locator('#status')).toContainText('Connected');
  const mainWindow = await panel.evaluate(async () => (await chrome.tabs.getCurrent()).windowId);
  const otherWindow = await panel.evaluate(async url => (await chrome.windows.create({ url, type: 'normal', focused: true })).id,
    new URL('/second-window', url).href);
  const focusChromeWindow = id => panel.evaluate(id => chrome.windows.update(id, { focused: true }), id);
  await focusChromeWindow(mainWindow);
  await target.bringToFront();
  await menu('browser-use-cloud-chrome');
  await shared();
  assert.match((await consent()).detail, /Cloud Browser fixture chrome/);
  await focusChromeWindow(otherWindow);
  await expect.poll(async () => (await call({ action: 'status' })).value.visible).toBe(false);
  await focusChromeWindow(mainWindow);
  await sibling.bringToFront();
  await expect.poll(async () => (await call({ action: 'status' })).value.visible).toBe(false);
  assert.equal((await call({ action: 'observe' })).value.kind, 'error');
  await target.bringToFront();
  await expect.poll(async () => (await call({ action: 'status' })).value.visible).toBe(true);
  const chromeClick = await clickFixture();
  const chromeScreenshot = await screenshot('chrome');
  await expect(target.getByTestId('effect')).toHaveText('Trusted Cloud click');
  await expect(sibling.getByTestId('effect')).toHaveText('Waiting');
  await expect.poll(() => effects).toEqual(['/effect/embedded', '/effect/chrome']);
  await target.screenshot({ path: resolve(output, 'chrome-cloud-page.png') });
  await menu('browser-use-cloud-stop');
  await expect.poll(async () => (await call({ action: 'status' })).status).toBe(409);
  await expect(panel.locator('#status')).toContainText('Connected');
  await writeFile(resolve(output, 'result.json'), JSON.stringify({
    declined: true, granted: true, blockedOtherTabAndFiles: true, effects, click, chromeClick,
    embeddedScreenshot, chromeScreenshot, inactiveChromeTabBlocked: true, revoked: true, chromePairRetained: true,
  }, null, 2));
  console.log('Electron and paired Chrome each completed one trusted click through the real Cloud Runtime Gateway.');
} finally {
  await chrome?.close();
  await app?.close();
  site.close();
  await rm(temp, { recursive: true, force: true });
}
