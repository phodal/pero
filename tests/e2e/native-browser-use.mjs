// Real macOS Native Workbench, stdio Host, ACP session, MCP, and WebKit.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { browserInputCommands, browserInputFrame, browserInputPage, verifyBrowserInputs } from '../fixtures/browser-use-inputs.mjs';
import { browserNavigationPage } from '../fixtures/browser-use-navigation.mjs';

assert.equal(process.platform, 'darwin');
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-browser-'));
const hits = new Map();
const downloadText = 'browser,value\nwebkit,已验证\n';
const blobText = 'Blob from the authorized WebKit tab';
const listen = handler => new Promise((done, fail) => {
  const server = createServer(handler);
  server.once('error', fail);
  server.listen(0, '127.0.0.1', () => done(server));
});
const count = path => hits.set(path, (hits.get(path) ?? 0) + 1);
const foreign = await listen((request, response) => {
  count('foreign' + request.url);
  response.end('Other site');
});
const foreignOrigin = 'http://127.0.0.1:' + foreign.address().port;
const server = await listen((request, response) => {
  const path = request.url;
  count(path);
  if (path === '/jump') {
    response.writeHead(302, { Location: foreignOrigin + '/redirect' });
    response.end();
    return;
  }
  if (path === '/report.csv') {
    if (request.headers.cookie !== 'pero=webkit') { response.writeHead(403).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="webkit.csv"' }).end(downloadText);
    return;
  }
  if (path === '/download-redirect') {
    response.writeHead(302, { Location: foreignOrigin + '/download' }).end();
    return;
  }
  if (path.startsWith('/dialog-effect?')) { response.writeHead(204).end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/suite') response.setHeader('Set-Cookie', 'pero=webkit; HttpOnly; SameSite=Strict');
  const page = path === '/batch-frame' ? browserInputFrame
    : path === '/suite' ? browserNavigationPage('First', foreignOrigin + '/frame').replace('<p data-testid="wheel">', `
      <a href="/report.csv" download>Protected report</a>
      <a id="blob" download="webkit-blob.txt">Local Blob</a>
      <a href="/download-redirect" download>Redirecting report</a>
      <button id="foreign-popup">Open foreign popup</button>
      <button>No popup expected</button>
      <a href="/popup" target="_blank" rel="noopener">Open popup fixture</a>
      <script>
        document.querySelector('#blob').href = URL.createObjectURL(new Blob([${JSON.stringify(blobText)}]));
        document.querySelector('#foreign-popup').onclick = () => window.open(${JSON.stringify(foreignOrigin + '/popup')}, '_blank');
      </script>
      <p data-testid="wheel">`)
    : path === '/dialogs' ? `<!doctype html><title>Native WebKit dialogs</title>
      <button onclick="finish('confirm', String(confirm('Native confirmation')))" >Open WebKit confirm</button>
      <button onclick="finish('prompt', prompt('Native input', 'Default'))" >Open WebKit prompt</button>
      <button onclick="alert('Native alert'); finish('alert', 'closed')" >Open WebKit alert</button>
      <p data-testid="dialog-result">Waiting</p>
      <script>function finish(kind, value) {
        document.querySelector('[data-testid="dialog-result"]').textContent = value;
        fetch('/dialog-effect?' + new URLSearchParams({kind, value}));
      }</script>`
    : path === '/second' ? browserNavigationPage('Second')
    : path === '/popup' ? browserNavigationPage('Popup fixture')
    : browserInputPage;
  response.end(page);
});
let child, timer;
try {
  const data = resolve(temp, 'data');
  const workspace = resolve(temp, 'workspace');
  const output = resolve(root, 'test-results/native-browser-use');
  const agents = resolve(temp, 'agents.json');
  const receipt = resolve(output, 'session.json');
  await Promise.all([mkdir(data), mkdir(workspace), mkdir(output, { recursive: true })]);
  await rm(receipt, { force: true });
  await writeFile(agents, JSON.stringify([{ id: 'browser-use-fixture', name: 'Browser Use fixture', command: process.execPath,
    args: [resolve(root, 'tests/fixtures/browser-use-agent.mjs')] }]));
  await writeFile(resolve(data, 'settings.json'), JSON.stringify({ chat_agent: 'browser-use-fixture' }));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const status = { action: 'status' };
  const tabs = { action: 'tabs' };
  const observe = { action: 'observe' };
  const clip = { x: 40, y: 40, width: 80, height: 40 };
  const draft = { action: 'locate', locator: { by: 'label', value: 'Tab draft' } };
  const waitText = (id, value) => ({ action: 'wait', locator: { by: 'testId', value: id }, condition: { kind: 'text', value }, timeoutMs: 3000 });
  const byRole = (role, name) => ({ action: 'locate', locator: { by: 'role', role, name } });
  const clickForPopup = (role, name) => [byRole(role, name), { action: 'click', name, expectPopup: true }];
  const wheel = { action: 'scroll', deltaX: 0, deltaY: 460 };
  const dialogCell = `
import asyncio, json, time

async def inspect_dialog():
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        found = (await cua.browser({"action": "getJsDialog"}))["dialog"]
        if found:
            return found
        await asyncio.sleep(0.05)
    raise AssertionError("WebKit did not expose the active dialog")

results = []
previous = None
for kind, decision, answer, marker in [
    ("confirm", "accept", None, "true"),
    ("confirm", "dismiss", None, "false"),
    ("prompt", "accept", "Pero 已验证 🌱", "Pero 已验证 🌱"),
    ("alert", "dismiss", None, "closed"),
]:
    located = await cua.browser({"action": "locate", "locator": {"by": "role", "role": "button", "name": "Open WebKit " + kind}})
    await cua.browser({"action": "click", "ref": located["nodes"][0]["ref"]})
    dialog = await inspect_dialog()
    assert dialog["type"] == kind, dialog
    if previous:
        try:
            stale = await cua.browser({"action": "handleJsDialog", "dialogId": previous, "decision": "dismiss"})
        except Exception as error:
            stale = error.result
        assert stale["outcome"] == "rejected", stale
    action = {"action": "handleJsDialog", "dialogId": dialog["id"], "decision": decision}
    if answer is not None:
        action["promptText"] = answer
    handled = await cua.browser(action)
    verified = await cua.browser({"action": "wait", "locator":{"by":"testId","value":"dialog-result"}, "condition":{"kind":"text","value":marker}})
    assert handled["outcome"] == "dispatched" and verified["matched"], (handled, verified)
    assert (await cua.browser({"action":"getJsDialog"}))["dialog"] is None
    results.append({"kind":kind,"marker":marker,"receiptId":handled["receiptId"],"dialogId":dialog["id"],"decision":decision})
    previous = dialog["id"]
print(json.dumps(results))`;
  const turns = [
    { commands: [status] },
    { permission: 'allow', attachments: true, commands: [...browserInputCommands, { action: 'navigate', url: origin + '/suite' }] },
    { commands: ['Protected report', 'Local Blob', 'Redirecting report'].flatMap(name => [
      byRole('link', name), { action: 'download', name },
    ]) },
    { commands: [{ action: 'navigate', url: origin + '/dialogs' }] },
    { commands: [{ action: 'repl', tool: 'python_repl', code: dialogCell }, { action: 'navigate', url: origin + '/suite' }] },
    { commands: [
      ...clickForPopup('button', 'No popup expected'),
      ...clickForPopup('button', 'Open foreign popup'),
      ...clickForPopup('link', 'Open popup fixture'),
    ] },
    { commands: [{ ...status, tabId: '$duplicate' }, { ...observe, tabId: '$duplicate' }] },
    { permission: 'allow', commands: [{ ...observe, tabId: '$duplicate' }, { action: 'closeTab', tabId: '$duplicate' }] },
    { commands: [
      { action: 'screenshot' }, { action: 'screenshot', clip },
      { action: 'screenshot', clip: { ...clip, x: 10000 } },
      draft, { action: 'fill', name: 'Tab draft', text: 'first tab only' }, observe, wheel, wheel,
      waitText('wheel', 'Wheel trusted true'), waitText('scroll-ready', 'Scrolled'),
      { action: 'open', url: foreignOrigin + '/denied' },
      { action: 'open', url: origin + '/suite' },
    ] },
    { commands: [
      { ...status, tabId: '$duplicate' }, { ...observe, tabId: '$duplicate' },
      { action: 'closeTab', tabId: '$duplicate' }, tabs,
    ] },
    { permission: 'allow', commands: [
      tabs, draft, { action: 'fill', name: 'Tab draft', text: 'second tab only' },
      { action: 'back' }, byRole('link', 'Jump to the section'), { action: 'click', name: 'Jump to the section' },
      waitText('anchor-status', 'Anchor opened'), { action: 'back' }, waitText('anchor-status', 'Anchor cleared'),
      byRole('link', 'Open second page here'), { action: 'click', name: 'Open second page here' },
    ] },
    { commands: [
      { action: 'back' }, { action: 'forward' },
      draft, { action: 'fill', name: 'Tab draft', text: 'reload clears' },
      { action: 'reload' }, draft, { action: 'activate', tabId: '$first' },
    ] },
    { commands: [{ action: 'handoff', tabId: '$first' }, status] },
    { permission: 'allow', commands: [status] },
    { commands: [
      tabs, draft, { action: 'closeTab', tabId: '$duplicate' }, tabs,
      byRole('button', 'Attach foreign frame'), { action: 'scrollIntoView', name: 'Attach foreign frame' },
      byRole('button', 'Attach foreign frame'), { action: 'click', name: 'Attach foreign frame' },
      waitText('frame-status', 'Frame loaded'), { action: 'screenshot', clip },
      { action: 'navigate', url: origin + '/jump' },
    ] },
    { permission: 'revoke', commands: [status] },
  ];
  child = spawn(process.env.PERO_NATIVE_BROWSER_BINARY || resolve(root, 'target/debug/pero-native'),
    ['--verify-apps', receipt, 'browser'], {
      cwd: root,
      env: { ...process.env, PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: data,
        PERO_AGENTS_FILE: agents, PERO_ADAPTER_NODE: process.execPath, PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en',
        PERO_NATIVE_BROWSER_PROBE_WORKSPACE: workspace, PERO_NATIVE_BROWSER_PROBE_TURNS: JSON.stringify(turns),
        PERO_NATIVE_BROWSER_PROBE_URL: origin + '/' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let log = '';
  child.stderr.on('data', chunk => { log += chunk; });
  child.stdout.on('data', chunk => { log += chunk; });
  timer = setTimeout(() => child.kill('SIGTERM'), 72_000);
  const exit = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  await writeFile(resolve(output, 'native.log'), log);
  assert.deepEqual(exit, { code: 0, signal: null }, log);
  const session = JSON.parse(await readFile(receipt, 'utf8'));
  assert.equal(session.passed, true, session.error);
  assert(session.mcp.servers.some(server => server.server === 'pero-app-use'));
  const [before, inputs, downloads, , [dialogs], popups, popupDenied, popupGranted, first, unauthorized, approved, history,
    handoff, restored, final, after] = session.replies;
  assert.deepEqual(before, [{ authorized: false, isError: false }]);
  verifyBrowserInputs(inputs.slice(0, -1));
  const threadDigest = createHash('sha256').update(session.thread).digest('hex');
  for (const [index, name, contents] of [[1, 'webkit.csv', downloadText], [3, 'webkit-blob.txt', blobText]]) {
    assert(downloads[index - 1].nodes[0].actions.includes('download'), JSON.stringify(downloads));
    const result = downloads[index];
    assert.equal(result.outcome, 'dispatched', JSON.stringify(result));
    const artifact = result.transfer.artifactReceipt.artifact;
    assert.equal(artifact.thread_id, session.thread);
    const [version] = artifact.versions;
    assert.equal(version.filename, name);
    assert.equal(version.sha256, createHash('sha256').update(contents).digest('hex'));
    assert.equal(await readFile(resolve(data, 'settings.artifacts', threadDigest, 'snapshots', version.sha256 + '.bin'), 'utf8'), contents);
  }
  assert(downloads[5].isError && !downloads[5].transfer, JSON.stringify(downloads[5]));
  assert.equal(hits.get('foreign/download') ?? 0, 0);
  assert.equal(hits.get('/report.csv'), 1);
  assert.equal(dialogs.isError, false, dialogs.text);
  const answers = JSON.parse(dialogs.text);
  assert.deepEqual(answers.map(answer => [answer.kind, answer.marker]), [
    ['confirm', 'true'], ['confirm', 'false'], ['prompt', 'Pero 已验证 🌱'], ['alert', 'closed'],
  ]);
  for (const answer of answers) {
    assert.equal(hits.get('/dialog-effect?' + new URLSearchParams({ kind: answer.kind, value: answer.marker })), 1);
    const directory = resolve(data, 'browser-use-evidence', threadDigest);
    const recorded = JSON.parse(await readFile(resolve(directory, answer.receiptId + '.result.json'), 'utf8'));
    assert.deepEqual(recorded, { id: answer.receiptId, dialogId: answer.dialogId, decision: answer.decision, outcome: 'dispatched' });
    const intent = JSON.parse(await readFile(resolve(directory, answer.receiptId + '.intent.json'), 'utf8'));
    assert(!('promptText' in intent));
  }
  assert.deepEqual((await readdir(workspace)).filter(name => name.startsWith('.pero-browser-download-')), []);
  assert.equal(popups[1].popup.kind, 'notObserved', JSON.stringify(popups));
  assert.equal(popups[3].popup.kind, 'blocked', JSON.stringify(popups));
  assert.match(popups[3].popup.reason, /outside the authorized site/i);
  const { popup } = popups[5];
  assert.equal(popup.kind, 'tabOpened', JSON.stringify(popups));
  assert.match(popup.tabId, /^web-tab:/);
  assert.equal(popup.authorized, false);
  assert.deepEqual(popupDenied[0], { authorized: false, isError: false });
  assert.equal(popupDenied[1].isError, true);
  assert.equal(popupGranted[0].url, origin + '/popup');
  assert(popupGranted[0].nodes.some(node => node.name === 'Browser Use Popup fixture' || node.text === 'Browser Use Popup fixture'));
  assert.equal(popupGranted[1].tabId, popup.tabId);
  assert.ok((hits.get('/popup') ?? 0) > 0);
  assert.equal(hits.get('foreign/popup') ?? 0, 0);

  const [viewport, clipped, invalidClip, , fill, , scroll, staleScroll, wheelResult, position, blockedOpen, opened] = first;
  const dispatched = result => {
    assert.equal(result.outcome, 'dispatched', JSON.stringify(result));
    assert.equal(result.verified, false);
  };
  dispatched(fill);
  dispatched(scroll);
  assert.match(staleScroll.error, /observation is stale/i);
  assert.equal(wheelResult.matched, true, JSON.stringify(wheelResult));
  assert.equal(position.matched, true, JSON.stringify(position));
  assert.match(position.nodes[0].name, /^Page Y [1-9]/);
  const pointer = wheelResult.nodes[0].name;
  const [, x, y, width, height] = /^Pointer (\d+),(\d+) in (\d+)x(\d+)$/.exec(pointer) ?? [];
  assert(Math.abs(Number(x) - Number(width) / 2) <= 4, pointer);
  assert(Math.abs(Number(y) - Number(height) / 2) <= 4, pointer);
  assert.match(invalidClip.error, /fit inside the visible viewport/i);
  assert.match(blockedOpen.error, /outside the authorized site/i);
  assert.match(opened.tabId, /^web-tab:/);
  assert.equal(opened.authorized, false);
  assert.deepEqual(unauthorized[0], before[0]);
  assert(unauthorized[1].isError && unauthorized[2].isError);
  assert.equal(unauthorized[3].tabs.length, 1);
  assert.equal(unauthorized[3].tabs[0].active, false);
  assert.equal(approved[0].tabs.length, 2);
  assert.equal(approved[0].tabs.find(tab => tab.active)?.tabId, opened.tabId);
  assert.equal(approved[1].nodes[0].state.value, '');
  assert.match(approved[3].reason, /no history entry/i);
  assert.equal(approved[3].outcome, 'rejected');
  assert.equal(approved[6].matched, true, JSON.stringify(approved[6]));
  dispatched(approved[7]);
  assert.equal(approved[7].url, origin + '/suite');
  assert.equal(approved[8].matched, true, JSON.stringify(approved[8]));

  const [back, forward, , , reload, cleared, activated] = history;
  for (const effect of [back, forward, reload]) dispatched(effect);
  assert.deepEqual([back.url, forward.url, reload.url], [origin + '/suite', origin + '/second', origin + '/second']);
  assert.equal(cleared.nodes[0].state.value, '');
  assert.equal(activated.kind, 'tabActivated');
  assert.equal(activated.tabId, origin + '/');
  assert.equal(final[0].tabs.find(item => item.active)?.tabId, activated.tabId);
  assert.equal(final[1].nodes[0].state.value, 'first tab only');
  assert.deepEqual(final[2], { kind: 'tabClosed', tabId: opened.tabId, isError: false });
  assert.equal(final[3].tabs.length, 1);
  assert.equal(final[8].matched, true, JSON.stringify(final[8]));
  assert.match(final[9].error, /frame outside the authorized site/i);
  assert.deepEqual(handoff[0], { kind: 'tabHandedOff', tabId: activated.tabId, isError: false });
  assert.deepEqual(handoff[1], before[0]);
  assert.equal(restored[0].authorized, true);
  assert.deepEqual(after, before);
  assert.equal(hits.get('/jump'), 1);
  assert.equal(hits.get('foreign/frame'), 1);
  assert.equal(hits.get('foreign/redirect') ?? 0, 0);
  assert.equal(hits.get('foreign/denied') ?? 0, 0);
  assert.ok((hits.get('/second') ?? 0) >= 2, 'Reload fetched the page again.');

  const directory = resolve(data, 'browser-use-evidence', createHash('sha256').update(session.thread).digest('hex'));
  const receipts = await readdir(directory);
  for (const action of session.replies.flat().filter(result => result.receiptId && result.outcome)) {
    const { receiptId } = action;
    assert(receipts.includes(receiptId + '.intent.json'));
    const result = JSON.parse(await readFile(resolve(directory, receiptId + '.result.json'), 'utf8'));
    assert.equal(result.outcome, action.outcome);
    if (action.popup) assert.deepEqual(result.popup, action.popup);
  }
  for (const [shot, name] of [[viewport, 'viewport'], [clipped, 'clip']]) {
    assert.equal(shot.kind, 'screenshot', JSON.stringify(shot));
    const { id, ...stored } = shot.receipt;
    const png = await readFile(resolve(directory, id + '.png'));
    assert.deepEqual(JSON.parse(await readFile(resolve(directory, id + '.json'), 'utf8')), shot.receipt);
    assert.equal(stored.sha256, createHash('sha256').update(png).digest('hex'));
    assert.deepEqual(shot.pixels, { width: stored.width, height: stored.height, bytes: stored.bytes, sha256: stored.sha256 });
    await writeFile(resolve(output, name + '.png'), png);
  }
  assert.equal(clipped.receipt.width, clip.width);
  assert.equal(clipped.receipt.height, clip.height);
  assert(clipped.receipt.width < viewport.receipt.width && clipped.receipt.height < viewport.receipt.height);
  const decoded = PNG.sync.read(await readFile(resolve(output, 'clip.png')));
  const middle = (Math.floor(decoded.height / 2) * decoded.width + Math.floor(decoded.width / 2)) * 4;
  const expected = [36, 104, 180, 255];
  for (const [channel, value] of decoded.data.subarray(middle, middle + 4).entries())
    assert(Math.abs(value - expected[channel]) <= 3, 'Screenshot clip sampled the blue viewport marker.');
  console.log('Native Browser Use passed: JavaScript dialogs, popup outcomes, independent tabs, approval, history, trusted scroll, guarded screenshots and WebKit downloads.');
} finally {
  clearTimeout(timer);
  child?.kill();
  await Promise.all([server, foreign].map(server => new Promise(done => server.close(done))));
  await rm(temp, { recursive: true, force: true });
}
