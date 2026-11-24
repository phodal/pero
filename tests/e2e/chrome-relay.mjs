// Installs the actual unpacked MV3 build in headed Google Chrome for Testing.
// Pero Desktop and its Rust Host use the existing deterministic ACP test agent.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickNewChat, clickSessionRow } from './sidebar-controls.mjs';
import { RELAY_PROTOCOL } from '../../packages/chrome-extension/src/protocol.ts';
import { browserSnapshotFrame, browserSnapshotPage, browserSnapshotTree } from '../fixtures/browser-snapshot.mjs';
import { browserDiagnosticPage, verifyBrowserDiagnostics } from '../fixtures/browser-diagnostics.mjs';
import { axPath, axPage, axFramePath, axFramePage, foreignAxPath, foreignAxPage, verifyAccessibility } from '../fixtures/browser-accessibility.mjs';

const source = resolve(import.meta.dirname, '../..');
const root = resolve(process.env.PERO_CONTENT_TEST_ROOT || source);
const chromeBinary = process.env.PERO_RELAY_CHROME || chromium.executablePath();
const extension = resolve(source, 'target/chrome-extension');
const portManifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
assert.equal(portManifest.name, 'Pero Browser Use');
const temporary = await mkdtemp(resolve(tmpdir(), 'pero-chrome-relay-'));
const output = resolve(source, 'test-results/chrome-relay');
await mkdir(output, { recursive: true });
await rm(resolve(output, 'result.json'), { force: true });
const agents = resolve(temporary, 'agents.json');
const settings = resolve(temporary, 'settings.json');
const workspace = resolve(temporary, 'workspace');
const attachment = resolve(workspace, 'fixture.txt');
const uploadText = 'Selected file for Chrome\n'.repeat(4200);
const downloadText = 'chrome,relay\n1,verified\n';
await mkdir(workspace);
await writeFile(attachment, uploadText);
await writeFile(agents, JSON.stringify([{ id: 'browser-use-fixture', name: 'Browser Use Fixture', command: process.execPath,
  args: [resolve(source, 'tests/fixtures/browser-use-agent.mjs')] }]));
await writeFile(settings, JSON.stringify({ chat_agent: 'browser-use-fixture', workbench: { layout: { chat_open: true } } }));
let foreignHits = 0;
let leaveRequests = 0;
const otherOrigin = createServer((request, response) => {
  if (request.url === foreignAxPath) { response.setHeader('Content-Type', 'text/html'); response.end(foreignAxPage); return; }
  if (request.url.startsWith('/diagnostic-cross-origin?')) { response.writeHead(204).end(); return; }
  if (request.url === '/inventory-window' || request.url === '/popup-destination') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url === '/popup-destination'
      ? '<title>Chrome Popup Destination</title><h1>Cross-site popup reached</h1>'
      : '<title>Another Chrome window</title><h1>Second origin</h1>');
    return;
  }
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  foreignHits++;
  response.end('Outside the current origin');
});
await new Promise(done => otherOrigin.listen(0, '127.0.0.1', done));
const foreignUrl = `http://127.0.0.1:${otherOrigin.address().port}/outside`;
const popupUrl = new URL('/popup-destination', foreignUrl).href;
const site = createServer((request, response) => {
  if (request.url === axPath || request.url === axFramePath) {
    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === axPath ? axPage(foreignUrl) : axFramePage);
    return;
  }
  if (request.url.startsWith('/diagnostic-request?')) { response.writeHead(202).end(); return; }
  if (request.url === '/diagnostics') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(browserDiagnosticPage(foreignUrl));
    return;
  }
  if (request.url === '/leave-fixture') leaveRequests++;
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: foreignUrl }).end();
    return;
  }
  if (request.url === '/snapshot' || request.url === '/details') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url === '/snapshot' ? browserSnapshotPage : browserSnapshotFrame);
    return;
  }
  if (request.url === '/snapshot-large') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><main><h1>Large snapshot</h1>' +
      Array.from({ length: 80 }, (_, index) => `<label>Record ${index} <input value="Sample value"></label>`).join('') + '</main>');
    return;
  }
  if (request.url === '/report.csv') {
    if (request.headers.cookie !== 'relay=approved') { response.writeHead(403).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="relay.csv"' });
    response.end(downloadText);
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Set-Cookie', 'relay=approved; HttpOnly; SameSite=Strict');
  response.end(`<!doctype html><title>Chrome Relay fixture</title>
<style>body{margin:24px;font:16px system-ui;min-height:1600px}</style>
<h1>Chrome Relay fixture</h1><label>Relay message <input id="message"></label>
<button id="apply">Apply from Chrome</button><p data-testid="result">Waiting for input</p>
<label>Relay attachment <input id="upload" type="file"></label><output id="uploaded"></output>
<a href="/report.csv" download>Relay report</a><a id="blob" download="fixture-blob.txt">Relay Blob</a>
<a href="${foreignUrl}" download>Outside download</a>
<a href="/?popup" target="_blank">Open fixture link</a>
<button id="popup">Open delayed popup</button>
<button id="confirm">Open confirmation</button><button id="prompt">Open prompt</button>
<button id="alert">Open alert</button><output data-testid="dialog-result"></output>
<a href="/leave-fixture">Leave fixture</a>
<div aria-hidden="true" style="position:absolute;top:1550px;left:0;right:0;height:40px;background:#2468b4"></div>
<script>document.querySelector('#apply').onclick = event => {
  document.querySelector('[data-testid="result"]').textContent =
    document.querySelector('#message').value + ' · trusted ' + event.isTrusted;
};
document.querySelector('#message').onkeydown = event => {
  document.querySelector('#message').dataset.key = event.key + ':' + event.isTrusted;
};
document.querySelector('#upload').onchange = async event => {
  const [file] = event.target.files;
  document.querySelector('#uploaded').textContent = file.name + ' ' + (await file.text()).length;
};
document.querySelector('#blob').href = URL.createObjectURL(new Blob(['Blob from the approved tab']));
document.querySelector('#popup').onclick = () => setTimeout(() => window.open(${JSON.stringify(popupUrl)}, '_blank'), 60);
const dialogResult = document.querySelector('[data-testid="dialog-result"]');
document.querySelector('#confirm').onclick = () => { dialogResult.textContent = String(confirm('Continue fixture?')); };
document.querySelector('#prompt').onclick = () => { dialogResult.textContent = prompt('Fixture name?', 'Default'); };
document.querySelector('#alert').onclick = () => { alert('Fixture alert'); dialogResult.textContent = 'Alert closed'; };
</script>`);
});
await new Promise((done, fail) => { site.once('error', fail); site.listen(0, '127.0.0.1', done); });
const siteUrl = `http://127.0.0.1:${site.address().port}/`;
let app, chrome, panel, page;
try {
  app = await electron.launch({
    args: ['--use-mock-keychain', resolve(root, 'desktop')],
    cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temporary, 'desktop'), PERO_SETTINGS_PATH: settings,
      PERO_AGENTS_FILE: agents, PERO_HISTORY_PATH: resolve(temporary, 'sessions.jsonl'), PERO_LOCALE: 'en',
      PERO_APPS_ROOT: resolve(temporary, 'apps') },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const active = async () => { const value = await state(); return value.chats[value.activeChat]; };
  const menu = (id, checked) => app.evaluate(({ Menu, BrowserWindow }, { id, checked }) => {
    const item = Menu.getApplicationMenu().getMenuItemById(id);
    if (!item) throw new Error(`Missing Pero menu action ${id}`);
    if (checked === undefined || item.checked !== checked) item.click(undefined, BrowserWindow.getAllWindows()[0]);
    if (checked !== undefined && item.checked !== checked) throw new Error(`Menu action ${id} did not toggle.`);
  }, { id, checked });
  const prompt = async commands => {
    await expect.poll(async () => (await active())?.state, { timeout: 10000 }).toBe('idle');
    const previous = (await active()).messages.length;
    const input = (await state()).composerBounds.input;
    assert(input?.width > 0, 'The actual Pero composer is not visible.');
    await page.mouse.click(input.x + input.width / 2, input.y + input.height / 2);
    await expect.poll(async () => (await state()).composerFocused).toBe(true);
    const text = JSON.stringify(commands);
    await page.keyboard.insertText(text);
    await expect.poll(async () => (await state()).composer).toContain(text);
    await page.keyboard.press('Enter');
    let response;
    await expect.poll(async () => {
      const chat = await active();
      response = chat?.messages.slice(previous).find(item => item.role === 'assistant')?.text;
      return response?.startsWith('BROWSER_RESULT:') && chat.state === 'idle';
    }, { timeout: 15000 }).toBe(true);
    return JSON.parse(response.slice('BROWSER_RESULT:'.length));
  };
  await app.evaluate(({ dialog, clipboard }) => {
    // Keep the actual menu/IPC/Host path and isolate its two presentation
    // effects so the test can run without touching the user’s clipboard.
    dialog.showMessageBox = async (_window, options) => {
      globalThis.relayFixtureMessage = options.message;
      if (options.message === 'Allow Browser Use on this site?') {
        globalThis.relaySitePrompts = (globalThis.relaySitePrompts ?? 0) + 1;
        return { response: globalThis.relaySiteDecision ?? 2, checkboxChecked: false };
      }
      if (options.message === 'Chrome site permissions') {
        globalThis.relaySiteRules = options.detail;
        return { response: globalThis.relayClearSites ? 1 : 0, checkboxChecked: false };
      }
      if (options.message === 'Allow browser diagnostics on this site?') {
        globalThis.relayDiagnosticPrompts = (globalThis.relayDiagnosticPrompts ?? 0) + 1;
        return { response: globalThis.relayDiagnosticDecision ?? 0, checkboxChecked: false };
      }
      return { response: 0, checkboxChecked: false };
    };
    clipboard.writeText = value => { globalThis.relayFixtureClipboard = value; };
    clipboard.readText = () => globalThis.relayFixtureClipboard ?? '';
    clipboard.clear = () => { globalThis.relayFixtureClipboard = ''; };
  });
  const siteDecision = response => app.evaluate((_electron, value) => { globalThis.relaySiteDecision = value; }, response);
  const sitePrompts = () => app.evaluate(() => globalThis.relaySitePrompts ?? 0);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await expect.poll(async () => (await state()).workspace).toBe(await realpath(workspace));
  await clickNewChat(page);
  await expect.poll(async () => (await active())?.state, { timeout: 10000 }).toBe('idle');
  const original = (await active()).id;

  chrome = await chromium.launchPersistentContext(resolve(temporary, 'chrome'), {
    executablePath: chromeBinary, headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let worker = chrome.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://'));
  worker ??= await chrome.waitForEvent('serviceworker', { predicate: candidate => candidate.url().startsWith('chrome-extension://') });
  const extensionOrigin = new URL(worker.url()).origin === 'null' ? worker.url().split('/service-worker.js')[0] : new URL(worker.url()).origin;
  const target = chrome.pages()[0] ?? await chrome.newPage();
  await target.goto(siteUrl);
  await target.getByRole('heading', { name: 'Chrome Relay fixture' }).waitFor();
  // Display the extension's toolbar panel as its own Chrome window so it has
  // a regular WebContents and the authorized page stays active in its window.
  const panelReady = chrome.waitForEvent('page');
  await worker.evaluate(url => chrome.windows.create({ url, type: 'popup', width: 480, height: 460 }), extensionOrigin + '/relay.html');
  panel = await panelReady;
  await expect(panel.getByRole('heading', { name: 'Pero Browser Use' })).toBeVisible();
  const status = panel.locator('#status');
  const extensionAttached = (url = siteUrl) => worker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url });
    if (!tab?.id) return false;
    // Playwright also attaches a debugger. Ask Chrome whether this extension's
    // own session can send a read-only command on the known fixture tab.
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.getFrameTree'); return true; }
    catch { return false; }
  }, url);
  const pairingCode = async () => {
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await menu('browser-use-pair-chrome');
    let code;
    await expect.poll(async () => {
      code = await app.evaluate(({ clipboard }) => clipboard.readText());
      try { return JSON.parse(code).protocol; } catch { return null; }
    }).toBe(RELAY_PROTOCOL);
    return code;
  };
  const requestPair = async () => {
    const code = await pairingCode();
    // Exercise the Native deep link with a real one-time ticket from the Host.
    await panel.goto('about:blank');
    await panel.goto(extensionOrigin + '/relay.html#' + new URLSearchParams({ pair: code }));
    await expect(status).toContainText('Connected');
    return code;
  };
  try {
    const chromeStatus = { action: 'status', provider: 'chrome' };
    const [unpaired, unpairedStatus] = await prompt([{ action: 'tabs' }, chromeStatus]);
    assert.deepEqual(unpaired.tabs, []);
    assert.equal(unpaired.chrome.state, 'notPaired');
    assert.equal(unpairedStatus.chrome.state, 'notPaired');
    await menu('browser-use-chrome-status');
    await expect.poll(() => app.evaluate(() => globalThis.relayFixtureMessage))
      .toBe('Chrome is not paired with this conversation');

    const expiredCode = JSON.parse(await pairingCode());
    assert.equal((await prompt([chromeStatus]))[0].chrome.state, 'pairing');
    await app.evaluate(expiresAt => {
      globalThis.relayFixtureClock = Date.now;
      Date.now = () => expiresAt;
    }, expiredCode.expiresAt);
    try {
      assert.equal((await prompt([chromeStatus]))[0].chrome.state, 'expired');
    } finally {
      await app.evaluate(() => {
        Date.now = globalThis.relayFixtureClock;
        delete globalThis.relayFixtureClock;
      });
    }
    const incompatibleCode = JSON.parse(await pairingCode());
    const rejection = await worker.evaluate(async ({ baseUrl, ticket }) => {
      const socket = new WebSocket(baseUrl.replace('http:', 'ws:') + '/v1/browser-connector/connect');
      socket.onopen = () => socket.send(JSON.stringify({ type: 'pair', protocol: 'pero-browser-connector/2', ticket }));
      return new Promise(resolve => { socket.onclose = event => resolve(event.reason); });
    }, incompatibleCode);
    assert.match(rejection, /protocol mismatch/);
    assert.equal((await prompt([chromeStatus]))[0].chrome.state, 'incompatible');

    await target.goto('about:blank');
    const oneTimeCode = await requestPair();
    const [connectedWithoutTabs] = await prompt([{ action: 'tabs' }]);
    assert.deepEqual(connectedWithoutTabs.tabs, []);
    assert.equal(connectedWithoutTabs.chrome.state, 'connected');
    await target.goto(siteUrl);
    const inventoryUrl = new URL('/inventory-window', foreignUrl).href;
    const inventoryReady = chrome.waitForEvent('page');
    await worker.evaluate(url => chrome.windows.create({ url, type: 'normal' }), inventoryUrl);
    const inventoryPage = await inventoryReady;
    await expect(inventoryPage.getByRole('heading', { name: 'Second origin' })).toBeVisible();
    const paired = await prompt([{ action: 'tabs' }, { action: 'status' }]);
    const discovered = paired[0].tabs.find(tab => tab.url === siteUrl);
    assert.deepEqual(paired[0].tabs.map(tab => [tab.url, tab.title, tab.authorized, tab.siteAccess]).sort(), [
      [siteUrl, 'Chrome Relay fixture', false, 'ask'], [inventoryUrl, 'Another Chrome window', false, 'ask'],
    ].sort());
    assert.match(discovered.tabId, /^chrome:/);
    assert.equal(paired[0].chrome.state, 'connected');
    assert.equal(paired[1].authorized, false);
    assert.equal(await extensionAttached(), false);
    const observeMain = { action: 'observe', tabId: discovered.tabId };
    const mainStatus = { action: 'status', tabId: discovered.tabId };
    await siteDecision(0);
    const [firstDecline, secondDecline, declinedSite] = await prompt([
      { ...observeMain, action: 'getAXState' }, observeMain, mainStatus,
    ]);
    for (const result of [firstDecline, secondDecline]) assert.match(result.error, /site access was declined/);
    assert.equal(declinedSite.siteAccess, 'declined');
    assert.equal(await sitePrompts(), 1);
    assert.equal(await extensionAttached(), false);
    await siteDecision(1);
    const [inventoryOnce, observeOnce, onceStatus] = await prompt([
      { action: 'observe', tabId: paired[0].tabs.find(tab => tab.url === inventoryUrl).tabId }, observeMain, mainStatus,
    ]);
    assert.equal(inventoryOnce.url, inventoryUrl);
    assert.equal(observeOnce.url, siteUrl);
    assert.equal(onceStatus.siteAccess, 'allowed');
    assert.equal((await prompt([mainStatus]))[0].siteAccess, 'ask');
    assert.equal(await sitePrompts(), 3);
    await siteDecision(2);
    const observed = [inventoryOnce, ...(await prompt([observeMain]))];
    assert.deepEqual(observed.map(result => [result.kind, result.url, result.isError]).sort(), [
      ['observation', siteUrl, false], ['observation', inventoryUrl, false],
    ].sort());
    assert(observed.find(result => result.url === inventoryUrl)?.nodes.some(node => node.name === 'Second origin' || node.text === 'Second origin'));
    assert.equal(await extensionAttached(), true);
    await inventoryPage.close();
    await panel.screenshot({ path: resolve(output, 'paired.png') });
    const [available] = await prompt([{ action: 'tabs' }]);
    assert.equal(available.tabs.length, 1);
    const tabId = available.tabs[0].tabId;
    assert.equal(tabId, discovered.tabId);
    assert.equal(available.tabs[0].url, siteUrl);
    assert.equal(available.tabs[0].authorized, true);

    const diagnosticPage = await chrome.newPage();
    const diagnosticUrl = new URL('/diagnostics', siteUrl).href;
    await diagnosticPage.goto(diagnosticUrl);
    const [diagnosticTabs] = await prompt([{ action: 'tabs' }]);
    const diagnosticId = diagnosticTabs.tabs.find(tab => tab.url === diagnosticUrl).tabId;
    const diagnose = { action: 'diagnose', tabId: diagnosticId, captureMs: 1500, profile: true,
      style: { selector: 'h1', properties: ['color'] } };
    const [developerOff] = await prompt([diagnose]);
    assert.match(developerOff.error, /Enable Browser Developer Mode/);
    assert.equal(await extensionAttached(diagnosticUrl), false);
    assert.equal(await app.evaluate(() => globalThis.relayDiagnosticPrompts), undefined);
    await menu('browser-use-developer-mode', true);
    const [developerDeclined] = await prompt([diagnose]);
    assert.match(developerDeclined.error, /diagnostics were declined/);
    assert.equal(await extensionAttached(diagnosticUrl), false);
    await app.evaluate(() => { globalThis.relayDiagnosticDecision = 1; });
    const [diagnostics] = await prompt([diagnose]);
    verifyBrowserDiagnostics(diagnostics, new URL(siteUrl).origin, { profileRequired: false });
    assert.equal(await app.evaluate(() => globalThis.relayDiagnosticPrompts), 2);
    await menu('browser-use-developer-mode', false);
    await diagnosticPage.close();

    const accessibilityPage = await chrome.newPage();
    const accessibilityUrl = new URL(axPath, siteUrl).href;
    await accessibilityPage.goto(accessibilityUrl);
    const [axTabs] = await prompt([{ action: 'tabs' }]);
    const accessibility = await verifyAccessibility({ tabId: axTabs.tabs.find(tab => tab.url === accessibilityUrl).tabId,
      prompt, readStatus: () => accessibilityPage.getByRole('status').textContent() });
    await accessibilityPage.close();

    const snapshotPage = await chrome.newPage();
    const snapshotUrl = new URL('/snapshot', siteUrl).href;
    await snapshotPage.goto(snapshotUrl);
    await expect(snapshotPage.frameLocator('iframe').getByRole('button', { name: 'Inspect' })).toBeVisible();
    const [snapshotTabs] = await prompt([{ action: 'tabs' }]);
    const snapshotTabId = snapshotTabs.tabs.find(tab => tab.url === snapshotUrl).tabId;
    const button = { by: 'role', role: 'button', name: 'Apply' };
    const [plain, withTree, duplicate, scoped, frameTree] = await prompt([
      { action: 'observe', tabId: snapshotTabId },
      { action: 'observe', tabId: snapshotTabId, includeTree: true },
      { action: 'locate', tabId: snapshotTabId, locator: button },
      { action: 'locate', tabId: snapshotTabId, locator: button, within: { by: 'role', role: 'region', name: 'Draft' } },
      { action: 'observe', tabId: snapshotTabId, includeTree: true, frame: [{ by: 'title', value: 'Details' }] },
    ]);
    assert.equal(plain.tree, undefined);
    assert.equal(withTree.tree, browserSnapshotTree);
    assert.equal(withTree.treeTruncated, undefined);
    assert.deepEqual(withTree.frames, plain.frames);
    assert.deepEqual(withTree.nodes, plain.nodes.map(node => node.ref
      ? { ...node, ref: node.ref.replace(plain.observationId, withTree.observationId) }
      : node));
    assert.equal(duplicate.isError, true);
    assert.match(duplicate.error, /ambiguous/);
    assert.equal(scoped.nodes[0].state.disabled, false);
    assert.equal(frameTree.tree, '- main:\n  - heading "Run details" [level=2]\n  - button "Inspect"');
    const [, matches, counted, clicked] = await prompt([
      { action: 'observe', tabId: snapshotTabId, includeTree: true },
      { action: 'query', tabId: snapshotTabId, locator: button },
      { action: 'query', tabId: snapshotTabId, locator: button, limit: 0,
        within: { by: 'role', role: 'region', name: 'Draft' } },
      { action: 'click', tabId: snapshotTabId, name: 'Apply' },
    ]);
    assert.deepEqual(matches.nodes, [
      { role: 'button', name: 'Apply', state: { disabled: false } },
      { role: 'button', name: 'Apply', state: { disabled: true } },
    ]);
    assert.equal(matches.count, 2);
    assert.equal(matches.countExact, true);
    assert.equal(counted.count, 1);
    assert.deepEqual(counted.nodes, []);
    assert.equal(clicked.outcome, 'dispatched');
    await expect(snapshotPage.getByRole('status')).toHaveText('Applied; trusted = true');
    await snapshotPage.reload();
    const [ambiguousAct, scopedAct] = await prompt([
      { action: 'act', tabId: snapshotTabId, locator: button, operation: { action: 'click' } },
      { action: 'act', tabId: snapshotTabId, locator: button, within: { by: 'role', role: 'region', name: 'Draft' },
        operation: { action: 'click' } },
    ]);
    assert.equal(ambiguousAct.isError, true);
    assert.match(ambiguousAct.error, /ambiguous/);
    assert.equal(scopedAct.outcome, 'dispatched');
    await expect(snapshotPage.getByRole('status')).toHaveText('Applied; trusted = true');
    await snapshotPage.goto(new URL('/snapshot-large', siteUrl).href);
    const [largeTree] = await prompt([{ action: 'observe', tabId: snapshotTabId, includeTree: true }]);
    assert.equal(largeTree.treeInlineWithReference, true);
    assert.match(largeTree.tree, /heading "Large snapshot"/);
    assert.equal(await extensionAttached(snapshotPage.url()), true);
    const [handedOff, afterHandoff] = await prompt([
      { action: 'handoff', tabId: snapshotTabId }, { action: 'tabs' },
    ]);
    assert.deepEqual(handedOff, { kind: 'tabHandedOff', tabId: snapshotTabId, isError: false });
    assert.deepEqual(afterHandoff.tabs.map(tab => tab.tabId), [tabId]);
    assert.equal(afterHandoff.chrome.state, 'connected');
    assert.equal(await extensionAttached(snapshotPage.url()), false);
    await expect(snapshotPage.getByRole('heading', { name: 'Large snapshot' })).toBeVisible();
    await snapshotPage.close();

    const operations = await prompt([
      { action: 'observe', tabId },
      { action: 'locate', tabId, locator: { by: 'label', value: 'Relay message' } },
      { action: 'fill', tabId, name: 'Relay message', text: 'Verified through Pero' },
      { action: 'locate', tabId, locator: { by: 'role', role: 'button', name: 'Apply from Chrome' } },
      { action: 'click', tabId, name: 'Apply from Chrome' },
      { action: 'wait', tabId, locator: { by: 'testId', value: 'result' },
        condition: { kind: 'text', value: 'Verified through Pero · trusted true' }, timeoutMs: 3000 },
    ]);
    assert.equal(operations[2]?.outcome, 'dispatched', JSON.stringify(operations));
    assert.equal(operations[4].outcome, 'dispatched');
    assert.equal(operations[5].matched, true);
    await expect(target.getByTestId('result')).toHaveText('Verified through Pero · trusted true');
    await target.screenshot({ path: resolve(output, 'operation.png') });
    const evidence = resolve(temporary, 'desktop/browser-use-evidence', createHash('sha256').update(original).digest('hex'));
    const clickReceipt = operations[4].receiptId;
    assert.deepEqual(
      JSON.parse(await readFile(resolve(evidence, clickReceipt + '.result.json'), 'utf8')),
      { id: clickReceipt, outcome: 'dispatched' },
    );

    const captures = await prompt([{ action: 'screenshot', tabId },
      { action: 'screenshot', tabId, clip: { x: 16, y: 16, width: 64, height: 32 } }, { action: 'screenshot', tabId, fullPage: true }]);
    assert(captures[0].pixels?.width >= 64, JSON.stringify(captures));
    assert.deepEqual([captures[1].pixels.width, captures[1].pixels.height], [64, 32]);
    for (const capture of captures) {
      const bytes = await readFile(resolve(evidence, capture.receipt.id + '.png'));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), capture.pixels.sha256);
    }
    const full = captures[2];
    assert.equal(full.receipt.fullPage, true);
    assert(full.pixels.height > captures[0].pixels.height, JSON.stringify(full.pixels));
    const fullPng = await readFile(resolve(evidence, full.receipt.id + '.png'));
    const bottomPixel = await target.evaluate(async ({ data }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const y = Math.round(image.height * 1570 / document.documentElement.scrollHeight);
      context.drawImage(image, 5, y, 1, 1, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    }, { data: fullPng.toString('base64') });
    assert.deepEqual(bottomPixel, [36, 104, 180, 255]);
    assert.equal(await target.evaluate(() => scrollY), 0);
    await writeFile(resolve(output, 'full-page.png'), fullPng);

    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, attachment);
    const attach = (await state()).composerBounds.context;
    await page.mouse.click(attach.x + attach.width / 2, attach.y + attach.height / 2);
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).attachments).toEqual(['fixture.txt']);
    const transfers = await prompt([
      { action: 'files', tabId },
      { action: 'locate', tabId, locator: { by: 'label', value: 'Relay attachment' } },
      { action: 'upload', tabId, name: 'Relay attachment' },
      { action: 'locate', tabId, locator: { by: 'role', role: 'link', name: 'Relay report' } },
      { action: 'download', tabId, name: 'Relay report' },
      { action: 'locate', tabId, locator: { by: 'role', role: 'link', name: 'Relay Blob' } },
      { action: 'download', tabId, name: 'Relay Blob' },
      { action: 'locate', tabId, locator: { by: 'role', role: 'link', name: 'Outside download' } },
      { action: 'download', tabId, name: 'Outside download' },
    ]);
    assert.equal(transfers[2]?.outcome, 'dispatched', JSON.stringify(transfers));
    await expect(target.locator('#uploaded')).toHaveText(`fixture.txt ${uploadText.length}`);
    for (const [index, filename, contents] of [[4, 'relay.csv', downloadText], [6, 'fixture-blob.txt', 'Blob from the approved tab']]) {
      const artifact = transfers[index]?.transfer?.artifactReceipt.artifact;
      assert.equal(artifact?.thread_id, original, JSON.stringify(transfers));
      const [version] = artifact.versions;
      assert.equal(version.filename, filename);
      assert.equal(version.sha256, createHash('sha256').update(contents).digest('hex'));
      assert.equal(await readFile(resolve(temporary, 'settings.artifacts', createHash('sha256').update(original).digest('hex'),
        'snapshots', version.sha256 + '.bin'), 'utf8'), contents);
    }
    assert.equal(transfers[8]?.outcome, 'rejected', JSON.stringify(transfers));
    assert.equal(foreignHits, 0);

    const historyUrl = siteUrl + '?history';
    const history = await prompt([
      { action: 'navigate', tabId, url: historyUrl }, { action: 'back', tabId },
      { action: 'forward', tabId }, { action: 'reload', tabId }, { action: 'back', tabId },
    ]);
    assert.deepEqual(history.map(result => result.outcome), Array(5).fill('dispatched'), JSON.stringify(history));
    assert.deepEqual(history.slice(1).map(result => result.url), [siteUrl, historyUrl, historyUrl, siteUrl]);
    assert.equal(target.url(), siteUrl);

    const [blocked] = await prompt([{ action: 'open', tabId, url: siteUrl + 'redirect' }]);
    assert.equal(blocked.isError, true, JSON.stringify(blocked));
    assert.equal(foreignHits, 0, 'The redirect is refused before the foreign server receives a request.');
    await target.evaluate(url => {
      const iframe = document.createElement('iframe');
      iframe.title = 'Outside';
      iframe.src = url;
      document.body.append(iframe);
    }, foreignUrl);
    await expect(target.frameLocator('iframe').getByText('Outside the current origin')).toBeVisible();
    const [outsideTree, excluded] = await prompt([
      { action: 'observe', tabId, includeTree: true },
      { action: 'screenshot', tabId, fullPage: true },
    ]);
    assert.deepEqual(outsideTree.frames, [{ selector: { by: 'title', value: 'Outside' }, sameOrigin: false }]);
    assert.match(outsideTree.tree, /- iframe:/);
    assert.doesNotMatch(outsideTree.tree, /Outside the current origin/);
    assert.equal(excluded.isError, true, JSON.stringify(excluded));
    await target.locator('iframe').evaluate(frame => frame.remove());

    const nextTab = chrome.waitForEvent('page');
    const newUrl = siteUrl + '?new-tab';
    const [opened] = await prompt([{ action: 'open', tabId, url: newUrl }]);
    assert.equal(opened.kind, 'tabOpened', JSON.stringify(opened));
    assert.equal(opened.authorized, true);
    const newTab = await nextTab;
    await expect(newTab.getByTestId('result')).toHaveText('Waiting for input');
    const switched = await prompt([{ action: 'tabs' }, { action: 'observe', tabId }, { action: 'observe', tabId: opened.tabId }]);
    assert.deepEqual(switched[0].tabs.map(tab => [tab.tabId, tab.visible, tab.authorized]),
      [[tabId, false, true], [opened.tabId, true, true]]);
    assert.equal(switched[1].isError, true);
    assert.equal(switched[2].url, newUrl);
    assert.equal(switched[2].isError, false);
    const inactive = { tabId, background: true };
    const backgroundActions = await prompt([
      { action: 'observe', background: true },
      { action: 'observe', ...inactive },
      { action: 'act', ...inactive, locator: { by: 'label', value: 'Relay message' },
        operation: { action: 'fill', text: 'Background verified' } },
      { action: 'act', ...inactive, locator: { by: 'label', value: 'Relay message' },
        operation: { action: 'press', key: 'End' } },
      { action: 'act', ...inactive, locator: { by: 'role', role: 'button', name: 'Apply from Chrome' },
        operation: { action: 'click' } },
      { action: 'getAXState', ...inactive },
      { action: 'tabs' },
    ]);
    assert.match(backgroundActions[0].error, /explicit Chrome tabId/);
    assert.equal(backgroundActions[1].url, siteUrl);
    assert.deepEqual(backgroundActions.slice(2, 5).map(effect => effect.outcome), Array(3).fill('dispatched'),
      JSON.stringify(backgroundActions.slice(2, 5)));
    assert.equal(backgroundActions[5].kind, 'axState', JSON.stringify(backgroundActions[5]));
    assert.deepEqual(backgroundActions[6].tabs.map(tab => [tab.tabId, tab.active]), [[tabId, false], [opened.tabId, true]]);
    await expect(target.getByTestId('result')).toHaveText('Background verified · trusted true');
    await expect(target.getByLabel('Relay message')).toHaveAttribute('data-key', 'End:true');
    const [backgroundReload, afterBackgroundReload] = await prompt([{ action: 'reload', ...inactive }, { action: 'tabs' }]);
    assert.equal(backgroundReload.outcome, 'dispatched', JSON.stringify(backgroundReload));
    assert.deepEqual(afterBackgroundReload.tabs.map(tab => [tab.tabId, tab.active]), [[tabId, false], [opened.tabId, true]]);
    const switchedBack = await prompt([
      { action: 'tabs' }, { action: 'activate', tabId }, { action: 'closeTab', tabId: opened.tabId },
      { action: 'tabs' },
    ]);
    assert.deepEqual(switchedBack[0].tabs.map(tab => [tab.tabId, tab.active]), [[tabId, false], [opened.tabId, true]]);
    assert.equal(switchedBack[1].kind, 'tabActivated', JSON.stringify(switchedBack));
    assert.equal(switchedBack[2].kind, 'tabClosed');
    assert.deepEqual(switchedBack[3].tabs.map(tab => [tab.tabId, tab.active]), [[tabId, true]]);
    await expect.poll(() => newTab.isClosed()).toBe(true);

    const popupReceipts = [];
    for (const [name, expectedUrl, marker] of [
      ['Open fixture link', siteUrl + '?popup', 'Chrome Relay fixture'],
      ['Open delayed popup', popupUrl, 'Cross-site popup reached'],
      ['Apply from Chrome', null, null],
    ]) {
      const [, clicked] = await prompt([
        { action: 'observe', tabId }, { action: 'click', tabId, name, expectPopup: true },
      ]);
      assert.equal(clicked.outcome, 'dispatched', JSON.stringify(clicked));
      const receipt = JSON.parse(await readFile(resolve(evidence, clicked.receiptId + '.result.json'), 'utf8'));
      assert.deepEqual(receipt.popup, clicked.popup);
      if (!expectedUrl) assert.equal(clicked.popup?.kind, 'notObserved', JSON.stringify(clicked));
      else {
        assert.equal(clicked.popup?.kind, 'tabOpened', JSON.stringify(clicked));
        if (expectedUrl === popupUrl) assert.equal(clicked.popup.authorized, false);
        assert.notEqual(clicked.popup.tabId, tabId);
        await expect.poll(() => chrome.pages().find(candidate => candidate.url() === expectedUrl)?.url()).toBe(expectedUrl);
        const openedPage = chrome.pages().find(candidate => candidate.url() === expectedUrl);
        await expect(openedPage.getByRole('heading', { name: marker })).toBeVisible();
        const [popup] = await prompt([{ action: 'observe', tabId: clicked.popup.tabId }]);
        assert.equal(popup.url, expectedUrl, JSON.stringify(popup));
        assert(popup.nodes.some(node => node.name === marker || node.text === marker));
        const [, closed] = await prompt([{ action: 'activate', tabId }, { action: 'closeTab', tabId: clicked.popup.tabId }]);
        assert.equal(closed.kind, 'tabClosed');
        await expect.poll(() => openedPage.isClosed()).toBe(true);
      }
      popupReceipts.push(receipt);
    }

    const nativeDialogs = [];
    target.on('dialog', dialog => nativeDialogs.push({ type: dialog.type(), message: dialog.message() }));
    const dialogReceipts = [];
    let previousDialogId;
    for (const [name, type, message, decision, promptText, expected] of [
      ['Open confirmation', 'confirm', 'Continue fixture?', 'accept', undefined, 'true'],
      ['Open confirmation', 'confirm', 'Continue fixture?', 'dismiss', undefined, 'false'],
      ['Open prompt', 'prompt', 'Fixture name?', 'accept', 'Pero 已验证 🌱', 'Pero 已验证 🌱'],
      ['Open alert', 'alert', 'Fixture alert', 'dismiss', undefined, 'Alert closed'],
    ]) {
      const [, clicked, inspected] = await prompt([
        { action: 'observe', tabId }, { action: 'click', tabId, name }, { action: 'getJsDialog', tabId },
      ]);
      assert.equal(clicked.outcome, 'dispatched', JSON.stringify(clicked));
      assert.equal(inspected.kind, 'jsDialog', JSON.stringify(inspected));
      const { id: dialogId } = inspected.dialog;
      assert.notEqual(dialogId, previousDialogId);
      assert.deepEqual(inspected.dialog, { id: dialogId, type, message });
      assert.deepEqual(nativeDialogs.at(-1), { type, message });
      if (previousDialogId) {
        const [stale] = await prompt([{ action: 'handleJsDialog', tabId, dialogId: previousDialogId, decision }]);
        assert.equal(stale.outcome, 'rejected', JSON.stringify(stale));
      } else {
        const [blocked] = await prompt([{ action: 'observe', tabId }]);
        assert.equal(blocked.isError, true, JSON.stringify(blocked));
        assert.match(blocked.error, /JavaScript dialog/);
      }
      if (type === 'prompt' || type === 'alert') {
        const [invalid, stillOpen] = await prompt([
          { action: 'handleJsDialog', tabId, dialogId, decision: 'accept' }, { action: 'getJsDialog', tabId },
        ]);
        assert.equal(invalid.outcome, 'rejected');
        assert.equal(stillOpen.dialog.id, dialogId);
      }
      const [handled, cleared] = await prompt([
        { action: 'handleJsDialog', tabId, dialogId, decision, promptText }, { action: 'getJsDialog', tabId },
      ]);
      assert.equal(handled.outcome, 'dispatched', JSON.stringify(handled));
      assert.equal(cleared.dialog, null);
      await expect(target.getByTestId('dialog-result')).toHaveText(expected);
      const intent = JSON.parse(await readFile(resolve(evidence, handled.receiptId + '.intent.json'), 'utf8'));
      assert.equal(intent.promptText, undefined);
      assert.equal(intent.dialogId, dialogId);
      const receipt = JSON.parse(await readFile(resolve(evidence, handled.receiptId + '.result.json'), 'utf8'));
      assert.deepEqual(receipt, { id: handled.receiptId, dialogId, decision, outcome: 'dispatched' });
      dialogReceipts.push(receipt);
      previousDialogId = dialogId;
    }
    const [scriptedOpen, scriptedHandle] = await prompt([
      { action: 'repl', tool: 'javascript_repl', code: `
const dialogTab = ${JSON.stringify(tabId)};
const located = await cua.browser({action:'locate',tabId:dialogTab,locator:{by:'role',role:'button',name:'Open confirmation'}});
await cua.browser({action:'click',tabId:dialogTab,ref:located.nodes[0].ref});
const openedDialog = (await cua.browser({action:'getJsDialog',tabId:dialogTab})).dialog;
nodeRepl.write(openedDialog.type);` },
      { action: 'repl', tool: 'javascript_repl', code: `
const answer = await cua.browser({action:'handleJsDialog',tabId:dialogTab,dialogId:openedDialog.id,decision:'accept'});
nodeRepl.write(answer.outcome);` },
    ]);
    assert.equal(scriptedOpen.text.trim(), 'confirm', JSON.stringify(scriptedOpen));
    assert.equal(scriptedHandle.text.trim(), 'dispatched', JSON.stringify(scriptedHandle));
    await expect(target.getByTestId('dialog-result')).toHaveText('true');

    await target.evaluate(() => {
      window.onbeforeunload = event => { event.preventDefault(); event.returnValue = ''; };
    });
    const [, leave, beforeUnload] = await prompt([
      { action: 'observe', tabId }, { action: 'click', tabId, name: 'Leave fixture' }, { action: 'getJsDialog', tabId },
    ]);
    assert.equal(leave.outcome, 'dispatched', JSON.stringify(leave));
    assert.equal(beforeUnload.dialog?.type, 'beforeunload', JSON.stringify(beforeUnload));
    assert.equal(nativeDialogs.at(-1).type, 'beforeunload');
    const { id: leaveDialogId } = beforeUnload.dialog;
    const [declined, stayed, closedDialog] = await prompt([
      { action: 'handleJsDialog', tabId, dialogId: leaveDialogId, decision: 'accept' },
      { action: 'handleJsDialog', tabId, dialogId: leaveDialogId, decision: 'dismiss' },
      { action: 'getJsDialog', tabId },
    ]);
    assert.equal(declined.outcome, 'rejected');
    assert.equal(stayed.outcome, 'dispatched');
    assert.equal(closedDialog.dialog, null);
    // Playwright's navigation expectation can keep waiting for a commit that
    // was cancelled. Read the live renderer independently through CDP.
    const inspector = await chrome.newCDPSession(target);
    try {
      const { result } = await inspector.send('Runtime.evaluate', {
        expression: `window.onbeforeunload = null;
          ({ url: location.href, marker: document.querySelector('[data-testid="dialog-result"]').textContent })`,
        returnByValue: true,
      });
      assert.deepEqual(result.value, { url: siteUrl, marker: 'true' });
      assert.equal(leaveRequests, 0);
    } finally {
      await inspector.detach();
    }

    await clickNewChat(page);
    await expect.poll(async () => (await active())?.id).not.toBe(original);
    const other = await prompt([{ action: 'tabs' }, { action: 'observe', tabId }]);
    assert.deepEqual(other[0].tabs, []);
    assert.equal(other[1].isError, true);
    await clickSessionRow(page, original);
    await expect.poll(async () => (await active())?.id).toBe(original);

    await panel.getByRole('button', { name: 'Stop and take over' }).click();
    await expect(status).toHaveText('Disconnected');
    const afterStop = await prompt([{ action: 'status', tabId }, { action: 'observe', tabId }]);
    assert.equal(afterStop[0].authorized, false);
    assert.equal(afterStop[1].isError, true);
    await expect.poll(extensionAttached).toBe(false);
    assert.equal(target.isClosed(), false);
    await expect.poll(() => worker.evaluate(async url => (await chrome.tabs.query({ url })).some(tab => tab.active), siteUrl)).toBe(true);
    if (!await panel.locator('#code').isVisible()) await panel.getByText('Enter a pairing code manually').click();
    await panel.getByRole('textbox', { name: 'Pairing code from Pero' }).fill(oneTimeCode);
    await panel.getByRole('button', { name: 'Pair with Pero' }).click();
    await expect(panel.locator('#error')).toContainText('pairing code');
    await expect(status).toHaveText('Disconnected');

    await requestPair();
    const beforeReconnectObserve = await sitePrompts();
    const [reconnected] = await prompt([{ action: 'observe' }]);
    assert.equal(reconnected.isError, false);
    assert.equal(await sitePrompts(), beforeReconnectObserve);
    assert.equal(await extensionAttached(), true);
    await menu('browser-use-stop-chrome');
    await expect(status).toHaveText('Disconnected');
    await expect.poll(extensionAttached).toBe(false);
    const [disconnected] = await prompt([{ action: 'tabs' }]);
    assert.deepEqual(disconnected.tabs, []);
    assert.equal(disconnected.chrome.state, 'disconnected');
    await panel.screenshot({ path: resolve(output, 'revoked.png') });

    await requestPair();
    const blockedPage = await chrome.newPage();
    const blockedUrl = new URL('/inventory-window', foreignUrl);
    blockedUrl.hostname = 'localhost';
    await blockedPage.goto(blockedUrl.href);
    const [beforeBlock] = await prompt([{ action: 'tabs' }]);
    const blockedTab = beforeBlock.tabs.find(tab => tab.url === blockedUrl.href).tabId;
    const blockedObserve = { action: 'observe', tabId: blockedTab };
    await siteDecision(3);
    const beforeBlockPrompt = await sitePrompts();
    const [block] = await prompt([blockedObserve]);
    assert.match(block.error, /site access was blocked/);
    const [refused, blockedState] = await prompt([blockedObserve, { action: 'status', tabId: blockedTab }]);
    assert.match(refused.error, /site access was blocked/);
    assert.equal(blockedState.siteAccess, 'blocked');
    assert.equal(await sitePrompts(), beforeBlockPrompt + 1);
    assert.equal(await extensionAttached(blockedUrl.href), false);
    const rulesFile = resolve(temporary, 'desktop', 'chrome-site-access.json');
    const readRules = async () => JSON.parse(await readFile(rulesFile, 'utf8'));
    assert.deepEqual(await readRules(), {
      [new URL(siteUrl).origin]: 'allow',
      [new URL(popupUrl).origin]: 'allow',
      [blockedUrl.origin]: 'block',
    });
    await app.evaluate(() => { globalThis.relayClearSites = true; });
    await menu('browser-use-chrome-sites');
    await expect.poll(readRules).toEqual({});
    assert.match(await app.evaluate(() => globalThis.relaySiteRules), /localhost:.*Blocked/);
    await expect(status).toHaveText('Disconnected');
    await writeFile(resolve(output, 'result.json'), JSON.stringify({
      passed: true, chrome: await worker.evaluate(() => navigator.userAgent), extension: portManifest.name,
      paired: true, pairedTabsAcrossWindows: true, attachesOnFirstUse: true, inactiveTabDenied: true, otherConversationDenied: true,
      clickReceiptVerified: true,
      chromeConnectionStatesVerified: true,
      chromeBackground: { explicitTarget: true, trustedClick: true, trustedKey: true, ax: true, reload: true,
        foregroundUnchanged: true },
      accessibility,
      browserDiagnostics: { defaultOff: true, separateConsent: true, metrics: diagnostics.metrics, style: diagnostics.style,
        cpu: diagnostics.cpu, profileUnavailable: diagnostics.profileUnavailable },
      chromeSitePermissions: { pendingAfterPairing: true, onceEndsWithTurn: true, persistentAllow: true,
        declineDoesNotAttach: true, persistentBlock: true, settingsClear: true },
      chromeHandoffLeavesTabOpenAndReleasesDebugger: true,
      semanticTree: { snapshot: withTree.tree, codexFixtureMatched: true, preservesNodesAndRefs: true,
        scopedDuplicateResolved: true, foreignFrameContentExcluded: true, trustedClick: true, inlineWithContentReference: true,
        scopedLocatorActionAfterReload: true, readOnlyQueryPreservesRefs: true },
      screenshots: captures.map(capture => capture.pixels), uploadVerified: true, downloadsVerified: true,
      historyVerified: true, openedTabImmediatelyAvailable: true, tabSwitchAndCloseVerified: true, popupReceipts, dialogReceipts,
      beforeUnloadDismissed: true, dialogHandledThroughRepl: true,
      foreignRedirectRefused: true, foreignFrameScreenshotRefused: true, foreignDownloadRefused: true,
      pairingReplayDenied: true, chromeTakeoverReleasedDebugger: true, workbenchStopReleasedDebugger: true,
      operation: operations[5].nodes[0].text,
    }, null, 2));
    console.log('Pero Chrome Relay passed in Google Chrome for Testing and actual Electron/ACP.');
  } finally {
    // The test-owned pairing code should not survive the run.
    await app.evaluate(({ clipboard }, protocol) => {
      try { if (JSON.parse(clipboard.readText()).protocol === protocol) clipboard.clear(); } catch {}
    }, RELAY_PROTOCOL);
  }
} catch (error) {
  if (panel && !panel.isClosed()) {
    await panel.locator('#code').evaluate(field => { field.value = ''; }).catch(() => {});
    await panel.screenshot({ path: resolve(output, 'failed-panel.png') }).catch(() => {});
  }
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, 'failed-workbench.png') }).catch(() => {});
  throw error;
} finally {
  await chrome?.close();
  await app?.close();
  await new Promise(done => site.close(done));
  await new Promise(done => otherOrigin.close(done));
  await rm(temporary, { recursive: true, force: true });
}
