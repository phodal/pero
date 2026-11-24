// Opt-in macOS acceptance. System Events needs Accessibility access.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { siteToolPage, partnerSiteToolPage } from '../fixtures/browser-site-tools.mjs';

assert.equal(process.platform, 'darwin');
const root = resolve(import.meta.dirname, '../..');
const cdp = process.argv.includes('--cdp');
const fixturePath = cdp ? '/cdp' : '/webmcp';
const installed = process.env.PERO_NATIVE_REPL_INSTALLED_APP;
const payload = installed && resolve(installed, 'Contents/Resources/app');
const extension = payload
  ? resolve(payload, 'packages/connectors/helpers/chrome-extension')
  : resolve(root, 'target/chrome-extension');
const binary = installed
  ? resolve(installed, 'Contents/MacOS/pero-native')
  : process.env.PERO_NATIVE_BROWSER_BINARY || resolve(root, 'target/debug/pero-native');
if (installed) execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', installed]);
const { version: extensionVersion } = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-chrome-approval-'));
const profile = resolve(temp, 'profile'),
  agents = resolve(temp, 'agents.json');
const report = resolve(temp, 'session.json'),
  pairing = resolve(temp, 'pairing.json');
const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (cdp) {
    res.end(`<!doctype html><title>Native CDP fixture</title>
      <button onclick="console.info('native CDP clicked')">Log CDP event</button>
      <script>console.info('native CDP loaded'); throw new Error('native CDP exception');</script>
      <iframe title="CDP child fixture" srcdoc="<script>console.warn('native CDP child')</script>"></iframe>`);
    return;
  }
  res.end(siteToolPage(req.url === '/webmcp-frame', foreignOrigin));
});
const partner = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(partnerSiteToolPage(origin));
});
const listen = (server) => new Promise((done) => server.listen(0, '127.0.0.1', done));
await Promise.all([listen(site), listen(partner)]);
const origin = 'http://127.0.0.1:' + site.address().port;
const foreignOrigin = 'http://127.0.0.1:' + partner.address().port;
const agent = 'browser-use-fixture';
await mkdir(profile);
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ chat_agent: agent }));
await writeFile(resolve(profile, 'chrome-site-access.json'), JSON.stringify({ [origin]: 'allow' }));
await writeFile(
  agents,
  JSON.stringify([
    {
      id: agent,
      name: 'Browser fixture',
      command: process.execPath,
      args: [resolve(root, 'tests/fixtures/browser-use-agent.mjs')],
    },
  ]),
);
const code = cdp ? `
import json
import sys
status = await cua.browser({"action":"status","provider":"chrome"})
assert status["chrome"]["state"] == "connected", status
tab = next(tab["tabId"] for tab in (await cua.browser({"action":"tabs"}))["tabs"] if tab["url"].endswith("/cdp"))
async def browser(action, **params):
    return await cua.browser({"action":action,"tabId":tab,**params})
layout = {"method":"Page.getLayoutMetrics"}
try:
    await browser("cdpSend", command=layout)
except Exception as error:
    assert "diagnostics were declined" in str(error), repr(error)
else:
    raise AssertionError("Native CDP command ran after consent was declined")
metrics = await browser("cdpSend", command=layout)
assert metrics["result"]["cssLayoutViewport"]["clientWidth"] > 0, metrics
performance = await browser("cdpSend", command={"method":"Performance.getMetrics"})
assert any(metric["name"] == "ScriptDuration" for metric in performance["result"]["metrics"]), performance
document = await browser("cdpSend", command={"method":"DOM.getDocument","params":{"depth":1}})
assert document["result"]["root"]["nodeName"] == "#document", document
first = await browser("cdpReadEvents", limit=1)
assert first["hasMore"] and [event["text"] for event in first["events"]] == ["native CDP loaded"], first
second = await browser("cdpReadEvents", after=first["cursor"])
assert not second["hasMore"] and [event["text"] for event in second["events"]] == ["Error: native CDP exception"], second
assert second["cursor"]["stream"] == first["cursor"]["stream"], second
clicked = await browser("act", locator={"by":"role","role":"button","name":"Log CDP event"}, operation={"action":"click"})
assert clicked["outcome"] == "dispatched", clicked
delta = await browser("cdpReadEvents", after=second["cursor"])
assert [event["text"] for event in delta["events"]] == ["native CDP clicked"], delta
reloaded = await browser("reload")
assert reloaded["outcome"] == "dispatched", reloaded
try:
    await browser("cdpReadEvents", after=delta["cursor"])
except Exception as error:
    assert "cursor is stale" in str(error), repr(error)
else:
    raise AssertionError("Native CDP cursor survived a reload")
print(json.dumps({"receiptId":clicked["receiptId"], "denied":True, "tab":tab, "python":sys.executable,
    "commands":3, "pagedEvents":True, "childFrameExcluded":True, "cursorExpiresOnReload":True}))
` : `
import json
import sys
tab = next(tab["tabId"] for tab in (await cua.browser({"action":"tabs"}))["tabs"] if tab["url"].endswith("/webmcp"))
listed = await cua.browser({"action":"listSiteTools","tabId":tab})
assert any(tool["name"] == "set_frame_heading" for tool in listed["tools"]), listed
top = next(tool for tool in listed["tools"] if tool["name"] == "set_fixture_heading")
request = {"action":"callSiteTool","tabId":tab,"toolId":top["id"],"input":{"text":"Native tool approved"}}
try:
    await cua.browser({**request, "input":{"text":"Native tool declined"}})
except Exception as error:
    assert "site tool call was declined" in str(error), repr(error)
else:
    raise AssertionError("Native site tool accepted first, declined call")
result = await cua.browser(request)
assert result["outcome"] == "dispatched", result
assert result["result"]["displayed"] == "Native tool approved", result
print(json.dumps({"receiptId":result["receiptId"], "denied":True, "tab":tab, "python":sys.executable}))
`;
let app,
  chrome,
  exit,
  timer,
  log = '';
try {
  app = spawn(binary, ['--verify-apps', report, 'browser'], {
    cwd: installed ? temp : root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      ...(installed
        ? {
            PERO_ADAPTER_NODE: undefined,
            PERO_NATIVE_HOST: undefined,
            PATH: '/usr/bin:/bin',
            DEVELOPER_DIR: resolve(temp, 'no-developer-tools'),
          }
        : {
            PERO_ADAPTER_NODE: process.execPath,
            PERO_NATIVE_HOST: process.env.PERO_NATIVE_HOST || resolve(root, 'target/debug/pero-host'),
          }),
      PERO_NATIVE_EPHEMERAL_SECRETS: '1',
      PERO_NATIVE_DATA_DIR: profile,
      PERO_AGENTS_FILE: agents,
      PERO_BUILTIN_APPS: '',
      PERO_REQUIRED_APPS: '',
      PERO_LOCALE: 'en',
      PERO_NATIVE_BROWSER_PROBE_WORKSPACE: temp,
      PERO_NATIVE_BROWSER_PROBE_URL: origin + fixturePath,
      PERO_NATIVE_REPL_PROBE_AGENT: agent,
      PERO_NATIVE_REPL_CHROME_PAIRING_PATH: pairing,
      PERO_NATIVE_REPL_CHROME_SITE_TOOLS: cdp ? undefined : '1',
      PERO_NATIVE_REPL_CHROME_DEVELOPER_MODE: cdp ? '1' : undefined,
      PERO_NATIVE_REPL_PROBE_PROMPT: JSON.stringify([{ action: 'repl', tool: 'python_repl', code }]),
    },
  });
  app.stderr.on('data', (chunk) => {
    log += chunk;
  });
  exit = once(app, 'exit');
  timer = setTimeout(() => app.kill('SIGTERM'), 150000);
  chrome = await chromium.launchPersistentContext(resolve(temp, 'chrome'), {
    executablePath: process.env.PERO_RELAY_CHROME || chromium.executablePath(),
    headless: false,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      ...(cdp ? [] : ['--enable-blink-features=WebMCP']),
    ],
  });
  const worker =
    chrome.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://')) ??
    (await chrome.waitForEvent('serviceworker'));
  const target = chrome.pages()[0] ?? (await chrome.newPage());
  const targetConsole = [];
  target.on('console', message => targetConsole.push(message.text()));
  await target.goto(origin + fixturePath);
  if (!cdp) await expect.poll(() => target.evaluate(() => document.body.dataset.ready)).toBe('yes');
  let credential;
  await expect
    .poll(
      async () => {
        if (app.exitCode !== null || app.signalCode !== null) throw new Error(log);
        credential = await readFile(pairing, 'utf8').catch(() => '');
        return credential.length;
      },
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  const panel = await chrome.newPage();
  await panel.goto(
    worker.url().replace(/\/service-worker\.js$/, '/relay.html#') + new URLSearchParams({ pair: credential }),
  );
  await expect(panel.locator('#status')).toContainText('Connected');
  await rm(pairing);
  await target.bringToFront();
  // Use the actual Native sheet. Match both its title and unique fixture
  // input before touching a button, and target only this fixture's PID.
  await writeFile(resolve(temp, 'pairing.ready'), '');
  const approvalTitle = cdp ? 'Allow browser diagnostics on this site?' : 'Run this website tool?';
  const respond = async (marker, button) => {
    const script = `
      tell application "System Events"
        set p to first application process whose unix id is ${app.pid}
        tell window 1 of p
          if not (exists sheet 1) then return "waiting for approval sheet"
          tell sheet 1
            set labels to (value of every static text) as text
            if labels does not contain "${approvalTitle}" or labels does not contain "${marker}" then return labels
            click button "${button}"
            return "responded"
          end tell
        end tell
      end tell`;
    await expect
      .poll(
        () => {
          if (app.exitCode !== null || app.signalCode !== null) throw new Error(log);
          return execFileSync('/usr/bin/osascript', ['-e', script], {
            encoding: 'utf8',
            timeout: 5000,
          }).trim();
        },
        { timeout: 15000 },
      )
      .toBe('responded');
  };
  if (cdp) {
    await respond(origin, 'Cancel');
    for (let i = 0; i < 7; i++) await respond(origin, 'Allow');
  } else {
    await respond('Native tool declined', 'Cancel');
    await expect(target.getByRole('heading', { name: 'Waiting for a site tool' })).toBeVisible();
    await respond('Native tool approved', 'Allow');
  }
  assert.deepEqual(await exit, [0, null], log);
  const result = JSON.parse(await readFile(report, 'utf8'));
  const [reply] = JSON.parse(result.reply.replace(/^BROWSER_RESULT:/, ''));
  assert.equal(result.error, null, JSON.stringify(result));
  assert.equal(reply.isError, false, reply.text);
  if (cdp) assert.equal(targetConsole.filter(message => message === 'native CDP clicked').length, 1);
  else await expect(target.getByRole('heading', { name: 'Native tool approved' })).toBeVisible();
  const evidence = JSON.parse(reply.text);
  if (payload)
    assert.equal(
      await realpath(evidence.python),
      await realpath(resolve(payload, 'runtime/python/bin/python3')),
    );
  const visit = resolve(
    profile,
    'browser-use-evidence',
    createHash('sha256').update(result.thread).digest('hex'),
  );
  const receipt = JSON.parse(await readFile(resolve(visit, evidence.receiptId + '.result.json'), 'utf8'));
  assert.equal(receipt.outcome, 'dispatched');
  const output = resolve(root, cdp ? 'test-results/native-chrome-cdp' : 'test-results/native-chrome-site-tools');
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        installed: !!installed,
        extensionVersion,
        ...evidence,
        receipt,
      },
      null,
      2,
    ),
  );
  console.log(
    `Native Python REPL verified ${cdp ? 'CDP commands and event cursors' : 'WebMCP discovery and approved tool calls'} through the real Chrome extension.`,
  );
} catch (error) {
  if (log.trim()) console.error(log);
  throw error;
} finally {
  clearTimeout(timer);
  if (app && app.exitCode === null && app.signalCode === null) {
    app.kill('SIGTERM');
    await exit;
  }
  await chrome?.close();
  await Promise.all([new Promise((done) => site.close(done)), new Promise((done) => partner.close(done))]);
  await rm(temp, { recursive: true, force: true });
}
