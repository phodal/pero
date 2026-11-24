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
import { scopedNetworkScript, serveDiagnosticAssets } from '../fixtures/browser-diagnostics.mjs';

assert.equal(process.platform, 'darwin');
const root = resolve(import.meta.dirname, '../..');
const targetDetach = process.argv.includes('--cdp-target-detach');
const targetNetwork = targetDetach || process.argv.includes('--cdp-target-network');
const targetTree = targetNetwork || process.argv.includes('--cdp-target-tree');
const targets = targetTree || process.argv.includes('--cdp-targets');
const live = targets || process.argv.includes('--cdp-live');
const cdp = live || process.argv.includes('--cdp');
const fixturePath = cdp ? '/cdp' : '/webmcp';
const output = resolve(root, targetDetach ? 'test-results/native-chrome-cdp-target-detach' : targetNetwork ? 'test-results/native-chrome-cdp-target-network' : targetTree ? 'test-results/native-chrome-cdp-target-tree'
  : targets ? 'test-results/native-chrome-cdp-targets' : live ? 'test-results/native-chrome-cdp-live'
    : cdp ? 'test-results/native-chrome-cdp' : 'test-results/native-chrome-site-tools');
await rm(resolve(output, 'result.json'), { force: true });
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
  if (live && serveDiagnosticAssets(req, res, foreignOrigin)) return;
  res.setHeader('Content-Type', 'text/html');
  if (cdp) {
    res.end(`<!doctype html><title>Native CDP fixture</title>
      <button onclick="console.info('native CDP clicked')">Log CDP event</button>
      <script>console.info('native CDP loaded'); throw new Error('native CDP exception');</script>
      <iframe title="CDP child fixture" srcdoc="<script>console.warn('native CDP child')</script>"></iframe>
      ${live ? `<link rel="stylesheet" href="/diagnostic.css">
      <iframe title="Local CDP frame" src="/diagnostic-frame"></iframe>
      <iframe title="Foreign CDP frame" id="cdp-child" src="${targets ? childOrigin : foreignOrigin}/diagnostic-frame?${childQuery}"></iframe>
      <button onclick="requestFixture()">Run network fixture</button><output>Waiting for network fixture</output>
      <script>
        async function requestFixture() {
          const [response] = await Promise.all([
            fetch('/cdp-response?native-private-query'),
            fetch('/cdp-redirect', {mode: 'no-cors'}),
          ]);
          await response.json();
          document.querySelector('output').textContent = 'Native network fixture complete';
        }
      </script>` : ''}
      ${targets ? `<button onclick="replaceFixtureChild()">Replace CDP child</button><output id="child-state">Child waiting</output>
      <script>
        function replaceFixtureChild() {
          const frame = document.querySelector('#cdp-child');
          frame.addEventListener('load', () => document.querySelector('#child-state').textContent = 'Native child replaced', { once: true });
          frame.src = ${JSON.stringify(childOrigin + '/diagnostic-frame?replacement')};
        }
      </script>` : ''}
      ${targetNetwork ? `<button onclick="runScopedNetwork()">Run scoped network fixture</button>
      <p id="scoped-network-state">Waiting for scoped network</p><script>${scopedNetworkScript(childOrigin)}</script>` : ''}
      ${targetDetach ? `<button onclick="document.querySelector('#cdp-child').remove(); this.nextElementSibling.textContent = 'Native child removed'">Remove CDP child</button>
      <output>Child present</output>` : ''}`);
    return;
  }
  res.end(siteToolPage(req.url === '/webmcp-frame', foreignOrigin));
});
const partner = createServer((req, res) => {
  if (live && serveDiagnosticAssets(req, res, targetTree ? origin : undefined)) return;
  res.setHeader('Content-Type', 'text/html');
  res.end(partnerSiteToolPage(origin));
});
const listen = (server) => new Promise((done) => server.listen(0, '127.0.0.1', done));
await Promise.all([listen(site), listen(partner)]);
const origin = 'http://127.0.0.1:' + site.address().port;
const foreignOrigin = 'http://127.0.0.1:' + partner.address().port;
const childOrigin = 'http://localhost:' + partner.address().port;
const childQuery = targetTree ? 'native-foreign-frame&outside-frame-marker' : 'native-foreign-frame';
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
    await browser("cdpSend", command=${live ? '{"method":"Network.enable"}' : 'layout'})
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
proof = {"receiptId":clicked["receiptId"], "denied":True, "tab":tab, "python":sys.executable,
    "commands":3, "pagedEvents":True, "childFrameExcluded":True, "cursorExpiresOnReload":True}
${live ? `async def send(method, params=None):
    command = {"method":method, **({"params":params} if params else {})}
    return (await browser("cdpSend", command=command))["result"]
frames = (await send("Page.getFrameTree"))["frameTree"]
assert [child["frame"]["url"].rsplit("/", 1)[-1] for child in frames["childFrames"]] == ["diagnostic-frame"], frames
resources = (await send("Page.getResourceTree"))["frameTree"]
assert any(res["url"].endswith("/diagnostic.css") for res in resources["resources"]), resources
assert "native-foreign-frame" not in json.dumps(resources), resources
capture = await send("Network.enable")
action = await browser("act", locator={"by":"role","role":"button","name":"Run network fixture"}, operation={"action":"click"})
assert action["outcome"] == "dispatched", action
ready = await browser("wait", locator={"by":"text","value":"Native network fixture complete"}, condition={"kind":"visible"}, timeoutMs=3000)
assert ready["matched"], ready
methods = ["Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFinished"]
page = await browser("cdpReadEvents", after=capture["cursor"], methods=methods, limit=1)
assert page["hasMore"], page
tail = await browser("cdpReadEvents", after=page["cursor"], methods=methods)
assert not tail["hasMore"], tail
events = page["events"] + tail["events"]
response = next(event["params"] for event in events if event["method"] == "Network.responseReceived"
    and event["params"]["url"].endswith("/cdp-response"))
assert response["status"] == 202 and "native-private-query" not in json.dumps(events), events
read_body = {"requestId":response["requestId"]}
body = await send("Network.getResponseBody", read_body)
assert body == {"body": '{"fixture":"network-response"}', "base64Encoded":False}, body
redirect = next(event["params"]["requestId"] for event in events if event["method"] == "Network.requestWillBeSent"
    and event["params"]["url"].endswith("/cdp-redirect"))
try:
    await send("Network.getResponseBody", {"requestId":redirect})
except Exception as error:
    assert "same-origin" in str(error), repr(error)
else:
    raise AssertionError("Native CDP read a cross-origin redirect response")
await send("Network.disable")
try:
    await send("Network.getResponseBody", read_body)
except Exception as error:
    assert "Enable Network" in str(error), repr(error)
else:
    raise AssertionError("Native CDP read a response after capture ended")
proof.update({"commands":8, "scopedTrees":True, "network":{"status":response["status"], "paged":True,
    "responseBody":True, "crossOriginRejected":True, "stopped":True}})` : ''}
${targets ? `import asyncio
from time import monotonic
child_origin = ${JSON.stringify(childOrigin)}
scoped = await browser("cdpListTargets")
assert scoped["targets"] == [], scoped
try:
    await browser("cdpListTargets", fromOrigins=[child_origin])
except Exception as error:
    assert "diagnostics were declined" in str(error), repr(error)
else:
    raise AssertionError("Native disclosed a child target without its origin approval")
children = await browser("cdpListTargets", fromOrigins=[child_origin]${targetTree ? ', depth=2' : ''})
assert len(children["targets"]) == ${targetTree ? 2 : 1} and children["targets"][0]["origin"] == child_origin, children
child = children["targets"][0]
target = {"id":child["id"],"origin":child_origin}
command = {"method":"DOM.getDocument","params":{"depth":1}}
child_dom = await browser("cdpSend", target=target, command=command)
assert child_dom["result"]["root"]["documentURL"] == child_origin + "/diagnostic-frame?${childQuery}", child_dom
${targetTree ? `nested = children["targets"][1]
assert nested["parentId"] == child["id"] and nested["url"] == ${JSON.stringify(origin + '/cdp-nested')}, nested
nested_target = {"id":nested["id"],"origin":nested["origin"]}
nested_dom = await browser("cdpSend", target=nested_target, command=command)
assert nested_dom["result"]["root"]["documentURL"] == nested["url"], nested_dom
direct_events = await browser("cdpReadEvents", target=target)
nested_events = await browser("cdpReadEvents", target=nested_target)
assert [event["text"] for event in direct_events["events"]] == ["direct target log", "Error: direct target exception"], direct_events
assert [event["text"] for event in nested_events["events"]] == ["nested target log"], nested_events
try:
    await browser("cdpReadEvents", target=nested_target, after=direct_events["cursor"])
except Exception as error:
    assert "cursor is stale" in str(error), repr(error)
else:
    raise AssertionError("Native accepted a cursor from another child target")
proof["nestedTargets"] = {"nestedDom":True,"isolatedEvents":True,"cursorIsolation":True}` : ''}
replaced = await browser("act", locator={"by":"role","role":"button","name":"Replace CDP child"}, operation={"action":"click"})
assert replaced["outcome"] == "dispatched", replaced
deadline = monotonic() + 5
while True:
    try:
        ready = await browser("wait", locator={"by":"text","value":"Native child replaced"}, condition={"kind":"visible"}, timeoutMs=500)
        if ready["matched"]:
            break
    except Exception as error:
        if "wait for the page to finish loading" not in str(error):
            raise
    assert monotonic() < deadline, "Native child replacement did not finish loading"
    await asyncio.sleep(0.05)
try:
    await browser("cdpSend", target=target, command=command)
except Exception as error:
    assert "child document changed" in str(error) or "target is stale" in str(error), repr(error)
else:
    raise AssertionError("Native used a child target grant on its replacement document")
proof["childTargets"] = {"scoped":True,"declined":True,"childDom":True,"staleAfterNavigation":True}` : ''}
print(json.dumps(proof))
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
const iframeNetworkCode = `
import json
import sys
child_origin = ${JSON.stringify(childOrigin)}
status = await cua.browser({"action":"status","provider":"chrome"})
assert status["chrome"]["state"] == "connected", status
tab = next(tab["tabId"] for tab in (await cua.browser({"action":"tabs"}))["tabs"] if tab["url"].endswith("/cdp"))
async def browser(action, **params):
    return await cua.browser({"action":action,"tabId":tab,**params})
listed = await browser("cdpListTargets", fromOrigins=[child_origin])
assert len(listed["targets"]) == 1, listed
target = {"id":listed["targets"][0]["id"],"origin":child_origin}
def child_command(method, params=None):
    return browser("cdpSend", target=target, command={"method":method, **({"params":params} if params else {})})
try:
    await child_command("Network.enable")
except Exception as error:
    assert "diagnostics were declined" in str(error), repr(error)
else:
    raise AssertionError("Native started a capture without child-origin approval")
captured = await child_command("Network.enable")
clicked = await browser("act", locator={"by":"role","role":"button","name":"Run scoped network fixture"}, operation={"action":"click"})
assert clicked["outcome"] == "dispatched", clicked
ready = await browser("wait", locator={"by":"text","value":"Scoped network complete"}, condition={"kind":"visible"}, timeoutMs=3000)
assert ready["matched"], ready
methods = ["Network.responseReceived", "Network.loadingFinished"]
network = await browser("cdpReadEvents", target=target, after=captured["result"]["cursor"], timeoutMs=1500,
    methods=methods${targetDetach ? ', limit=1' : ''})
response = next(event["params"] for event in network["events"] if event["method"] == "Network.responseReceived"
    and event["params"]["url"].endswith("/cdp-child-response"))
assert response["status"] == 202 and "cdp-parent-response" not in json.dumps(network), network
body_query = {"requestId":response["requestId"]}
resp = await child_command("Network.getResponseBody", body_query)
assert resp["result"]["body"] == '{"fixture":"child"}', resp
${targetDetach ? `assert network["hasMore"], network
removed = await browser("act", locator={"by":"role","role":"button","name":"Remove CDP child"}, operation={"action":"click"})
assert removed["outcome"] == "dispatched", removed
gone = await browser("wait", locator={"by":"text","value":"Native child removed"}, condition={"kind":"visible"}, timeoutMs=3000)
assert gone["matched"], gone
retained = await browser("cdpReadEvents", target=target, after=network["cursor"], timeoutMs=500, methods=methods)
assert retained["detached"] and len(retained["events"]) == 1, retained
event = retained["events"][0]
assert event["method"] == "Network.loadingFinished" and event["params"]["requestId"] == response["requestId"], retained` : 'await child_command("Network.disable")'}
try:
    await child_command("Network.getResponseBody", body_query)
except Exception as error:
    assert ${JSON.stringify(targetDetach ? 'target is detached' : 'Enable Network')} in str(error), repr(error)
else:
    raise AssertionError("Native accepted child response access after stopping its capture")
print(json.dumps({"receiptId":clicked["receiptId"],"denied":True,"tab":tab,"python":sys.executable,
    "childNetwork":{"isolated":True,"body":True,"stopped":True${targetDetach ? ',"detachedCursor":True' : ''}}}))
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
      PERO_NATIVE_REPL_PROBE_PROMPT: JSON.stringify([{ action: 'repl', tool: 'python_repl', code: targetNetwork ? iframeNetworkCode : code,
        ...(targets && { timeout_ms: 60_000 }) }]),
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
            ${live ? 'if labels does not contain "same-origin response content" then return labels' : ''}
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
  if (targetNetwork) {
    await respond(origin, 'Allow');
    await respond(childOrigin, 'Allow');
    await respond(childOrigin, 'Cancel');
    for (let i = 0; i < 5; i++) await respond(childOrigin, 'Allow');
  } else if (cdp) {
    await respond(origin, 'Cancel');
    for (let i = 0; i < (live ? 16 : 7); i++) await respond(origin, 'Allow');
    if (targets) {
      await respond(origin, 'Allow');
      await respond(origin, 'Allow');
      await respond(childOrigin, 'Cancel');
      await respond(origin, 'Allow');
      await respond(childOrigin, 'Allow');
      await respond(childOrigin, 'Allow');
      if (targetTree) {
        await respond(origin, 'Allow');
        await respond(childOrigin, 'Allow');
        await respond(origin, 'Allow');
        await respond(origin, 'Allow');
      }
      await respond(childOrigin, 'Allow');
    }
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
  if (targetNetwork) await expect(target.getByText('Scoped network complete')).toBeVisible();
  else if (live) await expect(target.getByText('Native network fixture complete')).toBeVisible();
  if (targetDetach) {
    await expect(target.getByText('Native child removed')).toBeVisible();
    await expect(target.locator('#cdp-child')).toHaveCount(0);
  }
  if (cdp && !targetNetwork) assert.equal(targetConsole.filter(message => message === 'native CDP clicked').length, 1);
  if (!cdp) await expect(target.getByRole('heading', { name: 'Native tool approved' })).toBeVisible();
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
  const tracePrefix = 'Native REPL probe: ';
  const probeStates = log.split('\n').filter(line => line.startsWith(tracePrefix)).map(line => JSON.parse(line.slice(tracePrefix.length)));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        installed: !!installed,
        extensionVersion,
        ...evidence,
        ...(probeStates.length && { probeStates }),
        receipt,
      },
      null,
      2,
    ),
  );
  console.log(
    `Native Python REPL verified ${targetDetach ? 'CDP iframe events after detachment' : targetNetwork ? 'scoped CDP iframe network capture' : targetTree ? 'nested CDP targets and events' : targets ? 'CDP child targets' : live ? 'live CDP network capture' : cdp ? 'CDP commands and event cursors'
      : 'WebMCP discovery and approved tool calls'} through the real Chrome extension.`,
  );
} catch (error) {
  if (log.trim()) console.error(log);
  const completed = await readFile(report, 'utf8').catch(() => undefined);
  if (completed) {
    const { error: chatError, reply } = JSON.parse(completed);
    console.error(JSON.stringify({ chatError, reply }));
  }
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
