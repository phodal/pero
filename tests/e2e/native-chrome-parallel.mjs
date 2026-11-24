import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { parallelBrowserFixture } from '../fixtures/browser-parallel.mjs';

assert.equal(process.platform, 'darwin');
const root = resolve(import.meta.dirname, '../..');
const installed = process.env.PERO_NATIVE_REPL_INSTALLED_APP;
const payload = installed && resolve(installed, 'Contents/Resources/app');
const binary = installed ? resolve(installed, 'Contents/MacOS/pero-native')
  : process.env.PERO_NATIVE_BROWSER_BINARY || resolve(root, 'target/debug/pero-native');
if (installed) execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', installed]);
const extension = payload ? resolve(payload, 'packages/connectors/helpers/chrome-extension') : resolve(root, 'target/chrome-extension');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-chrome-parallel-'));
const profile = resolve(temp, 'profile'), agents = resolve(temp, 'agents.json');
const report = resolve(temp, 'session.json'), pairing = resolve(temp, 'pairing.json');
const fixture = parallelBrowserFixture();
const site = createServer((req, res) => { if (!fixture.handle(req, res)) res.writeHead(404).end(); });
await new Promise(done => site.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${site.address().port}`;
const agent = 'browser-use-fixture';
await mkdir(profile);
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ chat_agent: agent }));
// The loopback fixture is the only standing site rule in this disposable profile.
await writeFile(resolve(profile, 'chrome-site-access.json'), JSON.stringify({ [origin]: 'allow' }));
await writeFile(agents, JSON.stringify([{ id: agent, name: 'Browser fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/browser-use-agent.mjs')] }]));
const code = `
import asyncio
import json
import sys
tabs = (await cua.browser({"action":"tabs"}))["tabs"]
slow_tab = next(tab["tabId"] for tab in tabs if tab["url"].endswith("/parallel-source"))
fast_tab = next(tab["tabId"] for tab in tabs if tab["url"].endswith("/parallel-peer"))
def button(name):
    return {"by":"role", "role":"button", "name":name}
async def slow_lane():
    return await cua.browser({"action":"navigate", "tabId":slow_tab, "background":True, "url":${JSON.stringify(origin + '/parallel-held')}})
async def fast_lane():
    ready = await cua.browser({"action":"wait", "tabId":fast_tab, "locator":button("Apply in other tab"),
        "condition":{"kind":"enabled"}, "timeoutMs":6000})
    assert ready["matched"]
    try:
        await cua.browser({"action":"observe", "tabId":slow_tab, "background":True})
    except Exception as error:
        assert "already in progress for this target" in str(error), repr(error)
    else:
        raise AssertionError("The same Chrome tab accepted a conflicting operation")
    applied = await cua.browser({"action":"act", "tabId":fast_tab, "locator":button("Apply in other tab"),
        "operation":{"action":"click"}})
    release = await cua.browser({"action":"wait", "tabId":fast_tab, "locator":button("Release navigation"),
        "condition":{"kind":"enabled"}, "timeoutMs":6000})
    assert release["matched"]
    await cua.browser({"action":"act", "tabId":fast_tab, "locator":button("Release navigation"),
        "operation":{"action":"click"}})
    return applied
navigation, applied = await asyncio.gather(slow_lane(), fast_lane())
print(json.dumps({"navigation":navigation["outcome"], "applied":applied["outcome"], "python":sys.executable}))
`;
let app, chrome, exited, log = '', timer;
try {
  const env = { ...process.env, PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: profile,
    PERO_AGENTS_FILE: agents, PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en',
    PERO_NATIVE_BROWSER_PROBE_WORKSPACE: temp, PERO_NATIVE_BROWSER_PROBE_URL: origin + '/parallel-source',
    PERO_NATIVE_REPL_PROBE_AGENT: agent, PERO_NATIVE_REPL_CHROME_PAIRING_PATH: pairing,
    PERO_NATIVE_REPL_PROBE_PROMPT: JSON.stringify([{ action: 'repl', tool: 'python_repl', code }]) };
  if (installed) {
    delete env.PERO_NATIVE_HOST;
    delete env.PERO_ADAPTER_NODE;
    env.PATH = '/usr/bin:/bin';
    env.DEVELOPER_DIR = resolve(temp, 'no-developer-tools');
  } else env.PERO_ADAPTER_NODE = process.execPath;
  app = spawn(binary, ['--verify-apps', report, 'browser'], { cwd: installed ? temp : root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  app.stderr.on('data', chunk => { log += chunk; });
  exited = once(app, 'exit');
  timer = setTimeout(() => app.kill('SIGTERM'), 60_000);
  chrome = await chromium.launchPersistentContext(resolve(temp, 'chrome'), {
    executablePath: process.env.PERO_RELAY_CHROME || chromium.executablePath(), headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = chrome.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://'))
    ?? await chrome.waitForEvent('serviceworker');
  const slow = chrome.pages()[0] ?? await chrome.newPage();
  const fast = await chrome.newPage();
  await slow.goto(origin + '/parallel-source');
  await fast.goto(origin + '/parallel-peer', { waitUntil: 'domcontentloaded' });
  await fast.bringToFront();
  let credential;
  await expect.poll(async () => {
    if (app.exitCode !== null || app.signalCode !== null)
      throw new Error(`Native exited before creating a pairing ticket. ${log} ${await readFile(report, 'utf8').catch(() => '')}`);
    credential = await readFile(pairing, 'utf8').catch(() => '');
    return credential.length;
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  const panel = await chrome.newPage();
  await panel.goto(worker.url().replace(/\/service-worker\.js$/, '/relay.html#') + new URLSearchParams({ pair: credential }));
  await expect(panel.locator('#status')).toContainText('Connected');
  await rm(pairing);
  await fast.bringToFront();
  await writeFile(resolve(temp, 'pairing.ready'), '');
  assert.deepEqual(await exited, [0, null], log);
  const result = JSON.parse(await readFile(report, 'utf8'));
  const [reply] = JSON.parse(result.reply.replace(/^BROWSER_RESULT:/, ''));
  assert.equal(result.error, null, JSON.stringify(result));
  assert.equal(reply.isError, false, reply.text);
  const { python, ...actions } = JSON.parse(reply.text);
  assert.deepEqual(actions, { navigation: 'dispatched', applied: 'dispatched' });
  if (payload) assert.equal(await realpath(python), await realpath(resolve(payload, 'runtime/python/bin/python3')));
  await expect(fast.locator('output')).toHaveText('Trusted independent click');
  await expect(slow.getByRole('heading')).toHaveText('Slow navigation completed');
  assert.deepEqual(fixture.events, ['slow-request', 'fast-click', 'release']);
  const output = resolve(root, 'test-results/native-chrome-parallel');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, installed: !!installed,
    python, events: fixture.events, sameTabConflictRejected: true }, null, 2));
  console.log('Native Python REPL completed parallel operations through the real Chrome extension.');
} finally {
  clearTimeout(timer);
  fixture.close();
  await chrome?.close();
  if (app && app.exitCode === null && app.signalCode === null) { app.kill('SIGTERM'); await exited; }
  await new Promise(done => site.close(done));
  await rm(temp, { force: true, recursive: true });
}
