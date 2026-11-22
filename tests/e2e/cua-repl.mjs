import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickNewChat } from './sidebar-controls.mjs';
import { computerFixture, waitFor } from '../fixtures/computer-app.mjs';

const native = process.argv.includes('--native');
const language = native ? 'python' : 'javascript';
const desktopInput = process.platform === 'darwin' && process.env.PERO_COMPUTER_NATIVE === '1';
const fixtureName = `PeroReplFixture${process.pid}`;
const fixtureBundle = JSON.stringify(`dev.pero.${fixtureName.toLowerCase()}`);
const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-cua-repl-')));
const profile = resolve(temp, 'profile');
const settings = resolve(profile, 'settings.json');
const agents = resolve(temp, 'agents.json');
const agent = 'browser-use-fixture';
await mkdir(profile);
await writeFile(agents, JSON.stringify([{ id: agent, name: 'REPL fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/browser-use-agent.mjs')] }]));
await writeFile(settings, JSON.stringify({ chat_agent: agent, computer_use: { enabled: desktopInput }, workbench: { layout: { chat_open: true } } }));
let networkHits = 0;
const server = createServer((request, response) => {
  if (request.url === '/probe') networkHits++;
  response.setHeader('Content-Type', 'text/html');
  response.end(`<title>REPL test</title><button onclick="if (event.isTrusted) document.querySelector('output').textContent = 'Trusted input'">Apply</button><output>Waiting</output>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
const cell = (code, timeout_ms) => ({
  action: 'repl', tool: `${language}_repl${code === undefined ? '_reset' : ''}`, code, timeout_ms,
});
const denied = cell(native ? 'await cua.browser({"action":"observe"})' : 'await cua.browser({action:"observe"})');
const action = cell(native ? `
import json
import socket
count = 1
locator = {"by": "role", "role": "button", "name": "Apply"}
observation = await cua.browser({"action": "locate", "locator": locator})
receipt = await cua.browser({"action": "click", "ref": observation["nodes"][0]["ref"]})
verified = await cua.browser({"action": "observe"})
try:
    with open(${JSON.stringify(agents)}):
        raise AssertionError("Read host file")
except PermissionError:
    pass
try:
    socket.create_connection(("127.0.0.1", ${port}), timeout=1)
    raise AssertionError("Opened host network connection")
except PermissionError:
    pass
print(json.dumps({"receipt": receipt["receiptId"], "effect": any(n.get("text") == "Trusted input" for n in verified["nodes"])}))
` : `
let count = 1;
const locator = {by:"role", role:"button", name:"Apply"};
const observation = await cua.browser({action:"locate", locator});
const receipt = await cua.browser({action:"click", ref:observation.nodes[0].ref});
const verified = await cua.browser({action:"observe"});
nodeRepl.write({receipt:receipt.receiptId, effect:verified.nodes.some(n => n.text === "Trusted input")});
nodeRepl.emitImage(await cua.browser({action:"screenshot"}));
`);
const second = cell(native ? `
count += 1
desktop = await cua.computer({"operation":"status"})
print(count, desktop["kind"], locator["name"])
` : `
const desktop = await cua.computer({operation:"status"});
nodeRepl.write(++count, desktop.kind, locator.name, typeof process);
`);
const timeout = cell(native ? 'while True: pass' : 'while (true) {}', 200);
const cleared = cell(native ? 'print("count" in globals())' : 'nodeRepl.write(typeof count)');
const assignment = cell(native ? 'count = 42' : 'let count = 42');
const desktopAction = cell(native ? `
targets = (await cua.computer({"operation": "targets"}))["targets"]
target = next((item["reference"] for item in targets if item.get("application_id") == ${fixtureBundle}), None)
assert target is not None, f"AppKit fixture is missing from {len(targets)} reported desktop targets"
desktop_observation = (await cua.computer({"operation": "observe", "target": target, "options": {"want_image": False}}))["observation"]
button = next((element for element in desktop_observation["elements"] if element.get("label") == "Increment"), None)
assert button is not None, f"AppKit fixture has no accessible Increment control among {len(desktop_observation['elements'])} elements; AX permission: {desktop['status']['accessibility']}"
result = await cua.computer({"operation": "act", "action": {
    "request_id": "repl-desktop-input", "target": target, "observation_id": desktop_observation["id"], "delivery": "background",
    "input": {"kind": "click", "anchor": {"kind": "element", "element_id": button["id"]}, "button": "left", "count": 1}
}})
print(result["receipt"]["outcome"]["status"])
` : `
const targets = (await cua.computer({operation:"targets"})).targets;
const target = targets.find(item => item.application_id === ${fixtureBundle}).reference;
const desktopObservation = (await cua.computer({operation:"observe", target, options:{want_image:false}})).observation;
const button = desktopObservation.elements.find(element => element.label === "Increment");
const result = await cua.computer({operation:"act", action:{
  request_id:"repl-desktop-input", target, observation_id:desktopObservation.id, delivery:"background",
  input:{kind:"click", anchor:{kind:"element", element_id:button.id}, button:"left", count:1},
}});
nodeRepl.write(result.receipt.outcome.status);
`);
const turns = [
  { commands: [denied] },
  { permission: 'allow', commands: [action] },
  { commands: [second, timeout, cleared, assignment, cell(), cleared, ...(desktopInput ? [desktopAction] : [])] },
  { permission: 'revoke', commands: [denied] },
];
let app, child, fixture;
try {
  if (desktopInput) fixture = await computerFixture(root, temp, false, { background: !native, name: fixtureName });
  let replies, thread;
  if (native) {
    assert.equal(process.platform, 'darwin');
    const report = resolve(temp, 'native.json');
    child = spawn(process.env.PERO_NATIVE_BROWSER_BINARY || resolve(root, 'target/debug/pero-native'),
      ['--verify-apps', report, 'browser'], {
        cwd: root,
        env: { ...process.env, PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: profile,
          PERO_AGENTS_FILE: agents, PERO_ADAPTER_NODE: process.execPath, PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '',
          PERO_LOCALE: 'en', PERO_NATIVE_BROWSER_PROBE_URL: url, PERO_NATIVE_BROWSER_PROBE_WORKSPACE: temp,
          PERO_NATIVE_BROWSER_PROBE_TURNS: JSON.stringify(turns),
          PERO_NATIVE_BROWSER_PROBE_COMMANDS: JSON.stringify([...turns[1].commands, ...turns[2].commands]) },
        stdio: ['ignore', 'ignore', 'inherit'],
      });
    const timer = setTimeout(() => child.kill('SIGTERM'), 70_000);
    try { assert.deepEqual(await once(child, 'exit'), [0, null]); }
    finally { clearTimeout(timer); }
    ({ replies, thread } = JSON.parse(await readFile(report, 'utf8')));
    if (replies.length === 3) {
      const [before, [scripted, ...continued], revoked] = replies;
      for (const [result] of [before, revoked]) assert.deepEqual(result, { authorized: false, isError: false });
      replies = [[], [scripted], continued, []];
    }
  } else {
    app = await electron.launch({
      args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
      env: { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: settings, PERO_AGENTS_FILE: agents,
        PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_LOCALE: 'en', PERO_APPS_ROOT: resolve(temp, 'apps') },
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
    const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
    const active = async () => { const s = await state(); return s.chats[s.activeChat]; };
    const menu = key => app.evaluate(({ Menu, BrowserWindow }, id) => {
      Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0]);
    }, key);
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, temp);
    await page.evaluate(() => window.pero.chooseWorkspace());
    await expect.poll(async () => (await state()).workspace).toBe(temp);
    await clickNewChat(page);
    if (!(await state()).chatVisible) await menu('toggle_chat');
    replies = [];
    for (const turn of turns) {
      await page.evaluate(url => window.pero.webCommand({ action: 'web_open', url }), url);
      await expect.poll(async () => (await state()).webDocuments.find(item => item.id === url)?.observation.load.kind).toBe('ready');
      if (turn.permission) {
        await menu(turn.permission === 'allow' ? 'browser-use-allow' : 'browser-use-revoke');
        await expect.poll(async () => (await state()).webDocuments.find(item => item.id === url)?.observation.notice ?? null)
          .toBe(turn.permission === 'allow' ? 'Browser Use allowed' : null);
      }
      await expect.poll(async () => (await active())?.state).toBe('idle');
      const previous = (await active()).messages.length;
      const input = (await state()).composerBounds.input;
      await page.mouse.click(input.x + input.width / 2, input.y + input.height / 2);
      await expect.poll(async () => (await state()).composerFocused).toBe(true);
      await page.keyboard.insertText(JSON.stringify(turn.commands));
      await page.keyboard.press('Enter');
      let result;
      await expect.poll(async () => {
        const chat = await active();
        result = chat.messages.slice(previous).find(item => item.role === 'assistant')?.text;
        return chat.state === 'idle' && result?.startsWith('BROWSER_RESULT:');
      }, { timeout: 15_000 }).toBe(true);
      replies.push(JSON.parse(result.slice('BROWSER_RESULT:'.length)));
    }
    thread = (await active()).id;
  }
  const [[before], [scripted], [persisted, timedOut, afterTimeout, assigned, reset, afterReset, clickedDesktop], [revoked]] = replies;
  for (const refusal of [before, revoked].filter(Boolean)) {
    assert.equal(refusal.isError, true);
    assert.match(refusal.text, /allow.*tab|grant/i);
  }
  assert.equal(scripted.isError, false, scripted.text);
  const { receipt, effect } = JSON.parse(scripted.text);
  assert.equal(effect, true);
  assert.match(receipt, /^[0-9a-f-]{36}$/);
  if (!native) assert.match(scripted.images[0], /^[0-9a-f]{64}$/);
  const directory = createHash('sha256').update(thread).digest('hex');
  const saved = JSON.parse(await readFile(resolve(profile, 'browser-use-evidence', directory, receipt + '.result.json'), 'utf8'));
  assert.equal(saved.outcome, 'dispatched');
  assert.equal(persisted.isError, false, persisted.text);
  assert.equal(persisted.text.trim(), native ? '2 status Apply' : '2 status Apply undefined');
  assert.equal(timedOut.isError, true);
  assert.match(timedOut.text, /timed out/);
  assert.equal(assigned.isError, false, assigned.text);
  assert.equal(reset.isError, false, reset.text);
  for (const result of [afterTimeout, afterReset]) assert.equal(result.text.trim(), native ? 'False' : 'undefined');
  assert.equal(networkHits, 0);
  if (fixture) {
    assert.equal(clickedDesktop.isError, false, clickedDesktop.text);
    assert.equal(clickedDesktop.text.trim(), 'executed');
    const name = createHash('sha256').update('repl-desktop-input').digest('hex') + '.json';
    const journal = JSON.parse(await readFile(resolve(profile, 'computer-use', directory, name), 'utf8'));
    assert.equal(journal.receipt.request_id, 'repl-desktop-input');
    assert.equal(journal.receipt.outcome.status, 'executed');
    await waitFor(async () => (await fixture.state()).count > 0, 'REPL input in the owned AppKit window');
    assert.equal((await fixture.state()).count, 1);
  }
  console.log(`Pero ${language} REPL passed through ${native ? 'Native' : 'Electron'} Chat, Host and ACP/MCP.`);
} finally {
  await app?.close();
  child?.kill();
  await fixture?.close();
  await new Promise(done => server.close(done));
  await rm(temp, { recursive: true, force: true });
}
