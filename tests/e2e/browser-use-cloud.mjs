// Run via TestCloudBrowserFollowsClaimAndRuntimeChannel, which owns the
// temporary PostgreSQL binding, HTTP Gateway and projected Pod fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const installed = process.argv.includes('--native') && process.env.PERO_TEST_CLOUD_BROWSER_NATIVE_APP;
if (installed) execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', installed]);
const temp = await mkdtemp(resolve(tmpdir(), 'pero-cloud-browser-'));
const output = resolve(root, 'test-results', installed ? 'installed-browser-use-cloud' : 'browser-use-cloud');
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
const shared = () => expect.poll(async () => {
  const result = await call({ action: 'status' });
  return result.status === 200 && result.value.authorized;
}, { timeout: 10000 }).toBe(true);
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
let app, chrome, native, nativeExit;

async function expectActiveChromeTab(panel, target) {
  await expect.poll(() => panel.evaluate(async () => {
    const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [tab] = await chrome.tabs.query({ windowId: window.id, active: true });
    return tab?.url;
  })).toBe(target.url());
}

async function pairedChrome(ticket) {
  const extension = installed ? resolve(installed, 'Contents/Resources/app/packages/connectors/helpers/chrome-extension')
    : resolve(root, 'target/chrome-extension');
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
  await expect.poll(async () => ({
    status: await panel.locator('#status').textContent(), error: await panel.locator('#error').textContent(),
  })).toEqual({ status: expect.stringContaining('Connected'), error: '' });
  await target.bringToFront();
  await expectActiveChromeTab(panel, target);
  return { target, sibling, panel };
}

async function runNative() {
  assert.equal(process.platform, 'darwin');
  const receipt = resolve(temp, 'native.json');
  const binary = installed ? resolve(installed, 'Contents/MacOS/pero-native')
    : process.env.PERO_NATIVE_BROWSER_BINARY || resolve(root, 'target/debug/pero-native');
  const env = { ...process.env, PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: resolve(temp, 'native'),
    PERO_NATIVE_CLOUD_BROWSER_FIXTURE: temp, PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en' };
  if (installed) {
    for (const key of ['PERO_NATIVE_HOST', 'PERO_ADAPTER_NODE', 'PERO_AGENT_ROOT', 'PERO_BUILTIN_APPS_ROOT']) delete env[key];
    env.PERO_ENV_FILE = '/dev/null';
  } else {
    env.PERO_ADAPTER_NODE = process.execPath;
  }
  native = spawn(binary,
    ['--verify-apps', receipt, 'cloud-browser'], {
      cwd: installed ? temp : root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let log = '', exit;
  native.stdout.on('data', chunk => { log += chunk; });
  native.stderr.on('data', chunk => { log += chunk; });
  nativeExit = new Promise(done => {
    native.once('error', error => { exit = { error: error.message }; done(exit); });
    native.once('close', (code, signal) => { exit = { code, signal }; done(exit); });
  });
  const step = name => writeFile(resolve(temp, name), '');
  async function read(name) {
    let value;
    await expect.poll(async () => {
      try { value = JSON.parse(await readFile(resolve(temp, name), 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (exit) {
          const failure = await readFile(receipt, 'utf8').catch(() => log);
          throw new Error(`Native exited before ${name}: ${failure}`);
        }
      }
      return value ? 'ready' : 'waiting';
    }, { timeout: 15000 }).toBe('ready');
    return value;
  }
  try {
    const { code } = await read('ticket.json');
    const { target, sibling, panel } = await pairedChrome(code);
    await step('chrome-paired');
    for (const decision of ['deny', 'changed', 'approve']) {
      await step('prepare-' + decision);
      const consent = await read(`confirm-${decision}.json`);
      assert.equal(consent.taskTitle, 'Browser fixture');
      assert.equal(consent.cloudOrigin, origin);
      assert.equal(consent.pageTitle, 'Cloud Browser fixture chrome');
      assert.equal(consent.pageOrigin, new URL(url).origin);
      assert.equal(consent.screenshots, true);
      assert.equal((await call({ action: 'status' })).status, 409);
      if (decision === 'changed') {
        await sibling.bringToFront();
        await expectActiveChromeTab(panel, sibling);
      }
      await step(decision);
      await read(`done-${decision}.json`);
      if (decision === 'changed') {
        assert.equal((await call({ action: 'status' })).status, 409);
        await target.bringToFront();
        await expectActiveChromeTab(panel, target);
      }
    }
    await shared();
    for (const blocked of [{ action: 'open', url }, { action: 'files' }, { action: 'observe', tabId: 'other-tab' },
      { action: 'screenshot', fullPage: true }])
      assert.equal((await call(blocked)).value.kind, 'error');
    await sibling.bringToFront();
    await expect.poll(async () => (await call({ action: 'status' })).value.visible).toBe(false);
    assert.equal((await call({ action: 'observe' })).value.kind, 'error');
    await target.bringToFront();
    await expect.poll(async () => (await call({ action: 'status' })).value.visible).toBe(true);
    const click = await clickFixture();
    const chromeScreenshot = await screenshot('native-chrome');
    await expect(target.getByTestId('effect')).toHaveText('Trusted Cloud click');
    await expect(sibling.getByTestId('effect')).toHaveText('Waiting');
    await expect.poll(() => effects).toEqual(['/effect/chrome']);
    await step('stop');
    await expect.poll(async () => (await call({ action: 'status' })).status).toBe(409);
    await expect(panel.locator('#status')).toContainText('Connected');
    const result = await read('native.json');
    assert.equal(result.passed, true, result.error);
    assert.equal(result.stopped, true);
    await expect.poll(() => exit, { timeout: 5000, message: log }).toEqual({ code: 0, signal: null });
    await writeFile(resolve(output, 'result-native.json'), JSON.stringify({ ...result, click, effects, chromeScreenshot }, null, 2));
    console.log('Native Workbench shared a paired Chrome tab, delivered the verified PNG, and revoked the live Cloud stream.');
  } finally {
    await writeFile(resolve(output, 'native.log'), log);
  }
}

async function runElectron() {
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
  await shared();
  for (const blocked of [{ action: 'open', url }, { action: 'files' }, { action: 'observe', tabId: 'other-tab' }])
    assert.equal((await call(blocked)).value.kind, 'error');
  assert.equal((await call({ action: 'screenshot', fullPage: true })).value.kind, 'error');
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
  const { target, sibling, panel } = await pairedChrome(ticket);
  const mainWindow = await panel.evaluate(async () => (await chrome.tabs.getCurrent()).windowId);
  const otherWindow = await panel.evaluate(async url => (await chrome.windows.create({ url, type: 'normal', focused: true })).id,
    new URL('/second-window', url).href);
  const focusChromeWindow = id => panel.evaluate(id => chrome.windows.update(id, { focused: true }), id);
  await focusChromeWindow(mainWindow);
  await target.bringToFront();
  await expectActiveChromeTab(panel, target);
  await app.evaluate(() => { globalThis.cloudBrowserDialog = undefined; });
  await menu('browser-use-cloud-chrome');
  await expect.poll(async () => (await consent())?.detail).toContain('Cloud Browser fixture chrome');
  await shared();
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
}

try {
  if (process.argv.includes('--native')) await runNative();
  else await runElectron();
} finally {
  if (native && native.exitCode === null && native.signalCode === null) native.kill('SIGTERM');
  await nativeExit;
  await chrome?.close();
  await app?.close();
  site.close();
  await rm(temp, { recursive: true, force: true });
}
